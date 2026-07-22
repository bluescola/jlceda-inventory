import type { Translate } from '../eda/i18n-client';
import type {
	DesignStockCheckPanel,
	DesignStockCheckPanelAction,
	DesignStockCheckPanelActionHandler,
	DesignStockCheckPanelInput,
} from './design-stock-check-panel';
import type {
	DesignStockCheckLabels,
	IFrameDesignStockCheckRequest,
} from './iframe-design-stock-check-protocol';
import type { DiagnosticTrace } from './native-diagnostics';
import {
	createDesignStockCheckRequest,
	createDesignStockCheckResponse,
	DESIGN_STOCK_CHECK_EVENT_KEY,
	DESIGN_STOCK_CHECK_IFRAME_ID,
	DESIGN_STOCK_CHECK_IFRAME_PATH,
	DESIGN_STOCK_CHECK_REQUEST_KEY,
	DESIGN_STOCK_CHECK_RESPONSE_KEY,
	parseIFrameDesignStockCheckEvent,
	parseIFrameDesignStockCheckRequest,
} from './iframe-design-stock-check-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 1180;
const PANEL_HEIGHT = 760;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions {
	title: string;
	onClose: () => void;
}

export interface DesignStockCheckIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

export class DesignStockCheckPanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`Design stock check panel unavailable: ${status}`, options);
		this.name = 'DesignStockCheckPanelUnavailableError';
	}
}

type PanelResult = 'closed' | { error: unknown; ready: boolean };

export class IFrameDesignStockCheckPanel implements DesignStockCheckPanel {
	private queue: Promise<void> = Promise.resolve();

	public constructor(
		private readonly t: Translate,
		private readonly host: DesignStockCheckIFrameHost = new EdaDesignStockCheckIFrameHost(),
	) {}

	public open(
		input: DesignStockCheckPanelInput,
		handleAction: DesignStockCheckPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		return this.enqueue(async () => {
			const request = createDesignStockCheckRequest(createRequestId(), this.labels(), input);
			if (!parseIFrameDesignStockCheckRequest(request)) {
				throw new TypeError('Invalid design stock check panel request.');
			}
			await this.openExclusive(request, handleAction, trace);
		});
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async openExclusive(
		request: IFrameDesignStockCheckRequest,
		handleAction: DesignStockCheckPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		const timerId = `${DESIGN_STOCK_CHECK_IFRAME_ID}.${request.requestId}`;
		const processedOperations = new Set<string>();
		let opened = false;
		let pollStarted = false;
		let ready = false;
		let settled = false;
		let nativeCloseRequested = false;
		let activeActionPromise: Promise<void> | undefined;
		let readyDeadline: number | undefined;
		let resolveResult: (result: PanelResult) => void = () => undefined;
		const resultPromise = new Promise<PanelResult>((resolve) => {
			resolveResult = (result) => {
				if (!settled) {
					settled = true;
					resolve(result);
				}
			};
		});
		const processAction = async (
			action: DesignStockCheckPanelAction,
			operationId: string,
			writeResponse: boolean,
		): Promise<void> => {
			trace?.info('design-stock-check-panel.action.started', { action: action.type });
			try {
				const outcome = await handleAction(action);
				if (writeResponse && !settled && !nativeCloseRequested) {
					const response = createDesignStockCheckResponse(request.requestId, operationId, outcome);
					if (!await this.host.write(DESIGN_STOCK_CHECK_RESPONSE_KEY, response)) {
						throw new Error('The host rejected the design stock check response.');
					}
				}
				trace?.info('design-stock-check-panel.action.completed', { action: action.type, status: outcome.status });
				if (action.type === 'close' && outcome.status === 'succeeded') {
					resolveResult('closed');
				}
			}
			catch (error) {
				trace?.error('design-stock-check-panel.action.failed', {
					action: action.type,
					errorName: errorName(error),
				});
				if (writeResponse && !settled && !nativeCloseRequested) {
					await this.host.write(DESIGN_STOCK_CHECK_RESPONSE_KEY, createDesignStockCheckResponse(
						request.requestId,
						operationId,
						{ status: 'failed', message: request.labels.operationError },
					));
				}
				if (action.type === 'close' && !writeResponse) {
					resolveResult('closed');
				}
			}
		};
		const processNativeClose = (): void => {
			if (settled || nativeCloseRequested) {
				return;
			}
			nativeCloseRequested = true;
			if (activeActionPromise) {
				return;
			}
			activeActionPromise = processAction({ type: 'close' }, createOperationId(), false)
				.finally(() => {
					activeActionPromise = undefined;
					resolveResult('closed');
				});
		};
		const readEvent = (): void => {
			try {
				const event = parseIFrameDesignStockCheckEvent(
					this.host.read(DESIGN_STOCK_CHECK_EVENT_KEY),
					request.requestId,
				);
				if (!event) {
					return;
				}
				if (event.status === 'ready') {
					ready = true;
					return;
				}
				if (event.status === 'progress') {
					trace?.info('design-stock-check-panel.iframe.stage', { stage: event.stage });
					return;
				}
				if (event.status === 'failed') {
					trace?.error('design-stock-check-panel.iframe.failed', {
						errorName: event.errorName,
						stage: event.stage,
					});
					resolveResult({ error: new Error('The design stock check IFrame failed.'), ready });
					return;
				}
				if (processedOperations.has(event.operationId) || activeActionPromise) {
					return;
				}
				processedOperations.add(event.operationId);
				activeActionPromise = processAction({ type: event.action }, event.operationId, true)
					.finally(() => {
						activeActionPromise = undefined;
						if (nativeCloseRequested) {
							resolveResult('closed');
						}
					});
			}
			catch (error) {
				resolveResult({ error, ready });
			}
		};
		const poll = (): void => {
			readEvent();
			if (!settled && !ready && readyDeadline !== undefined && Date.now() >= readyDeadline) {
				resolveResult({ error: new Error('The design stock check IFrame did not become ready.'), ready: false });
			}
		};

		try {
			await Promise.all([
				this.removeBridgeValue(DESIGN_STOCK_CHECK_EVENT_KEY, trace),
				this.removeBridgeValue(DESIGN_STOCK_CHECK_RESPONSE_KEY, trace),
			]);
			if (!await this.host.write(DESIGN_STOCK_CHECK_REQUEST_KEY, request)) {
				throw new DesignStockCheckPanelUnavailableError('init-failed');
			}
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted) {
				throw new DesignStockCheckPanelUnavailableError('api-missing');
			}
			opened = await this.host.open({ title: request.labels.title, onClose: processNativeClose });
			if (!opened) {
				throw new DesignStockCheckPanelUnavailableError('init-failed');
			}
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			poll();
			const result = await resultPromise;
			if (result !== 'closed') {
				if (result.ready) {
					throw result.error;
				}
				throw new DesignStockCheckPanelUnavailableError('render-failed', { cause: result.error });
			}
		}
		catch (error) {
			if (error instanceof DesignStockCheckPanelUnavailableError || ready) {
				throw error;
			}
			throw new DesignStockCheckPanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			if (pollStarted) {
				this.host.stopPolling(timerId);
			}
			await Promise.all([
				this.removeBridgeValue(DESIGN_STOCK_CHECK_REQUEST_KEY, trace),
				this.removeBridgeValue(DESIGN_STOCK_CHECK_EVENT_KEY, trace),
				this.removeBridgeValue(DESIGN_STOCK_CHECK_RESPONSE_KEY, trace),
			]);
			if (opened) {
				try {
					await this.host.close();
				}
				catch (error) {
					trace?.warn('design-stock-check-panel.iframe.close.failed', { errorName: errorName(error) });
				}
			}
			await delay(DIALOG_SETTLE_DELAY_MS);
		}
	}

	private async removeBridgeValue(key: string, trace?: DiagnosticTrace): Promise<void> {
		try {
			await this.host.remove(key);
		}
		catch (error) {
			trace?.warn('design-stock-check-panel.iframe.cleanup.failed', { errorName: errorName(error) });
		}
	}

	private labels(): DesignStockCheckLabels {
		return {
			title: this.t('designStockCheck.title'),
			source: this.t('designStockCheck.source'),
			sourceSchematic: this.t('designStockCheck.source.schematic'),
			sourcePcb: this.t('designStockCheck.source.pcb'),
			sourceFile: this.t('designStockCheck.source.file'),
			boardQuantity: this.t('designStockCheck.boardQuantity'),
			totalRows: this.t('designStockCheck.totalRows'),
			filterStatus: this.t('designStockCheck.filterStatus'),
			filterAll: this.t('designStockCheck.filterAll'),
			sufficient: this.t('designStockCheck.status.sufficient'),
			insufficient: this.t('designStockCheck.status.insufficient'),
			reviewRequired: this.t('designStockCheck.status.reviewRequired'),
			stocktakeRequired: this.t('designStockCheck.status.stocktakeRequired'),
			inventoryMissing: this.t('designStockCheck.status.inventoryMissing'),
			identityUnmatched: this.t('designStockCheck.status.identityUnmatched'),
			columnPartNumber: this.t('designStockCheck.column.partNumber'),
			columnName: this.t('designStockCheck.column.name'),
			columnManufacturerPart: this.t('designStockCheck.column.manufacturerPart'),
			columnPackage: this.t('designStockCheck.column.package'),
			columnDesignators: this.t('designStockCheck.column.designators'),
			columnUnitQuantity: this.t('designStockCheck.column.unitQuantity'),
			columnRequiredQuantity: this.t('designStockCheck.column.requiredQuantity'),
			columnAvailableQuantity: this.t('designStockCheck.column.availableQuantity'),
			columnShortageQuantity: this.t('designStockCheck.column.shortageQuantity'),
			columnStatus: this.t('designStockCheck.column.status'),
			quantityEstimated: this.t('designStockCheck.quantityEstimated'),
			quantityUnknown: this.t('inventory.unknown'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			emptyReport: this.t('designStockCheck.emptyReport'),
			emptyFiltered: this.t('designStockCheck.emptyFiltered'),
			previousPage: this.t('inventoryOverview.previousPage'),
			nextPage: this.t('inventoryOverview.nextPage'),
			pageStatus: this.t('inventoryOverview.pageStatus'),
			exportCsv: this.t('designStockCheck.exportCsv'),
			exporting: this.t('designStockCheck.exporting'),
			exportSucceeded: this.t('designStockCheck.exportSucceeded'),
			close: this.t('inventoryItem.close'),
			operationError: this.t('designStockCheck.operationError'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
		};
	}
}

class EdaDesignStockCheckIFrameHost implements DesignStockCheckIFrameHost {
	public read(key: string): unknown { return eda.sys_Storage.getExtensionUserConfig(key); }
	public write(key: string, value: unknown): Promise<boolean> { return eda.sys_Storage.setExtensionUserConfig(key, value); }
	public remove(key: string): Promise<boolean> { return eda.sys_Storage.deleteExtensionUserConfig(key); }
	public close(): Promise<boolean> { return eda.sys_IFrame.closeIFrame(DESIGN_STOCK_CHECK_IFRAME_ID); }
	public startPolling(id: string, intervalMs: number, callback: () => void): boolean {
		return typeof eda.sys_Timer?.setIntervalTimer === 'function'
			&& eda.sys_Timer.setIntervalTimer(id, intervalMs, callback);
	}

	public stopPolling(id: string): boolean { return eda.sys_Timer.clearIntervalTimer(id); }
	public open(options: IFrameOpenOptions): Promise<boolean> {
		if (typeof eda.sys_IFrame?.openIFrame !== 'function') {
			throw new DesignStockCheckPanelUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(
			DESIGN_STOCK_CHECK_IFRAME_PATH,
			PANEL_WIDTH,
			PANEL_HEIGHT,
			DESIGN_STOCK_CHECK_IFRAME_ID,
			{
				grayscaleMask: true,
				maximizeButton: true,
				title: options.title,
				buttonCallbackFn: button => button === 'close' ? options.onClose() : undefined,
			},
		);
	}
}

function createRequestId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createOperationId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}
