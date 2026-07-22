import type { Translate } from '../eda/i18n-client';
import type {
	BomStockOutPanel,
	BomStockOutPanelAction,
	BomStockOutPanelActionHandler,
	BomStockOutPanelInput,
} from './bom-stock-out-panel';
import type { BomStockOutLabels, IFrameBomStockOutRequest } from './iframe-bom-stock-out-protocol';
import type { DiagnosticTrace } from './native-diagnostics';
import {
	BOM_STOCK_OUT_EVENT_KEY,
	BOM_STOCK_OUT_IFRAME_ID,
	BOM_STOCK_OUT_IFRAME_PATH,
	BOM_STOCK_OUT_REQUEST_KEY,
	BOM_STOCK_OUT_RESPONSE_KEY,
	createIFrameBomStockOutRequest,
	createIFrameBomStockOutResponse,
	parseIFrameBomStockOutEvent,
	parseIFrameBomStockOutRequest,
} from './iframe-bom-stock-out-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 1180;
const PANEL_HEIGHT = 760;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions { title: string; onClose: () => void }

export interface BomStockOutIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

export class BomStockOutPanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`BOM stock-out panel unavailable: ${status}`, options);
		this.name = 'BomStockOutPanelUnavailableError';
	}
}

type PanelResult = 'closed' | { error: unknown; ready: boolean };

export class IFrameBomStockOutPanel implements BomStockOutPanel {
	private queue: Promise<void> = Promise.resolve();

	public constructor(
		private readonly t: Translate,
		private readonly host: BomStockOutIFrameHost = new EdaBomStockOutIFrameHost(),
	) {}

	public open(
		input: BomStockOutPanelInput,
		handleAction: BomStockOutPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		return this.enqueue(async () => {
			const request = createIFrameBomStockOutRequest(createId(), this.labels(), input);
			if (!parseIFrameBomStockOutRequest(request)) {
				throw new TypeError('Invalid BOM stock-out panel request.');
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
		request: IFrameBomStockOutRequest,
		handleAction: BomStockOutPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		const timerId = `${BOM_STOCK_OUT_IFRAME_ID}.${request.requestId}`;
		const processed = new Set<string>();
		let opened = false;
		let pollStarted = false;
		let ready = false;
		let settled = false;
		let nativeCloseRequested = false;
		let active: Promise<void> | undefined;
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
			action: BomStockOutPanelAction,
			operationId: string,
			writeResponse: boolean,
		): Promise<void> => {
			trace?.info('bom-stock-out-panel.action.started', { action: action.type });
			try {
				const outcome = action.type === 'commit' && request.status !== 'ready'
					? { status: 'failed' as const, message: request.labels.operationError }
					: await handleAction(action);
				if (writeResponse && !settled && !nativeCloseRequested) {
					const response = createIFrameBomStockOutResponse(request.requestId, operationId, outcome);
					if (!await this.host.write(BOM_STOCK_OUT_RESPONSE_KEY, response)) {
						throw new Error('The host rejected the BOM stock-out response.');
					}
				}
				trace?.info('bom-stock-out-panel.action.completed', { action: action.type, status: outcome.status });
				if ((action.type === 'close' || action.type === 'commit') && outcome.status === 'succeeded') {
					resolveResult('closed');
				}
			}
			catch (error) {
				trace?.error('bom-stock-out-panel.action.failed', { action: action.type, errorName: errorName(error) });
				if (writeResponse && !settled && !nativeCloseRequested) {
					await this.host.write(BOM_STOCK_OUT_RESPONSE_KEY, createIFrameBomStockOutResponse(
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
			if (settled || nativeCloseRequested)
				return;
			nativeCloseRequested = true;
			if (active)
				return;
			active = processAction({ type: 'close' }, createId(), false).finally(() => {
				active = undefined;
				resolveResult('closed');
			});
		};

		const readEvent = (): void => {
			try {
				const event = parseIFrameBomStockOutEvent(this.host.read(BOM_STOCK_OUT_EVENT_KEY), request.requestId);
				if (!event)
					return;
				if (event.status === 'ready') {
					ready = true;
					return;
				}
				if (event.status === 'progress') {
					trace?.info('bom-stock-out-panel.iframe.stage', { stage: event.stage });
					return;
				}
				if (event.status === 'failed') {
					trace?.error('bom-stock-out-panel.iframe.failed', { errorName: event.errorName, stage: event.stage });
					resolveResult({ error: new Error('The BOM stock-out IFrame failed.'), ready });
					return;
				}
				if (processed.has(event.operationId) || active)
					return;
				processed.add(event.operationId);
				active = processAction({ type: event.action }, event.operationId, true).finally(() => {
					active = undefined;
					if (nativeCloseRequested)
						resolveResult('closed');
				});
			}
			catch (error) {
				resolveResult({ error, ready });
			}
		};

		const poll = (): void => {
			readEvent();
			if (!settled && !ready && readyDeadline !== undefined && Date.now() >= readyDeadline) {
				resolveResult({ error: new Error('The BOM stock-out IFrame did not become ready.'), ready: false });
			}
		};

		try {
			await Promise.all([
				this.remove(BOM_STOCK_OUT_EVENT_KEY, trace),
				this.remove(BOM_STOCK_OUT_RESPONSE_KEY, trace),
			]);
			if (!await this.host.write(BOM_STOCK_OUT_REQUEST_KEY, request)) {
				throw new BomStockOutPanelUnavailableError('init-failed');
			}
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted)
				throw new BomStockOutPanelUnavailableError('api-missing');
			opened = await this.host.open({ title: request.labels.title, onClose: processNativeClose });
			if (!opened)
				throw new BomStockOutPanelUnavailableError('init-failed');
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			poll();
			const result = await resultPromise;
			if (result !== 'closed') {
				if (result.ready)
					throw result.error;
				throw new BomStockOutPanelUnavailableError('render-failed', { cause: result.error });
			}
		}
		catch (error) {
			if (error instanceof BomStockOutPanelUnavailableError || ready)
				throw error;
			throw new BomStockOutPanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			if (pollStarted)
				this.host.stopPolling(timerId);
			await Promise.all([
				this.remove(BOM_STOCK_OUT_REQUEST_KEY, trace),
				this.remove(BOM_STOCK_OUT_EVENT_KEY, trace),
				this.remove(BOM_STOCK_OUT_RESPONSE_KEY, trace),
			]);
			if (opened) {
				try {
					await this.host.close();
				}
				catch (error) {
					trace?.warn('bom-stock-out-panel.iframe.close.failed', { errorName: errorName(error) });
				}
			}
			await delay(DIALOG_SETTLE_DELAY_MS);
		}
	}

	private async remove(key: string, trace?: DiagnosticTrace): Promise<void> {
		try {
			await this.host.remove(key);
		}
		catch (error) {
			trace?.warn('bom-stock-out-panel.iframe.cleanup.failed', { errorName: errorName(error) });
		}
	}

	private labels(): BomStockOutLabels {
		return {
			title: this.t('bomStockOut.title'),
			sourceName: this.t('bomStockOut.sourceName'),
			boardQuantity: this.t('designStockCheck.boardQuantity'),
			lineCount: this.t('bomStockOut.lineCount'),
			fingerprint: this.t('bomStockOut.fingerprint'),
			statusReady: this.t('bomStockOut.status.ready'),
			statusBlocked: this.t('bomStockOut.status.blocked'),
			statusDuplicate: this.t('bomStockOut.status.duplicate'),
			atomicNotice: this.t('bomStockOut.atomicNotice'),
			columnPartNumber: this.t('designStockCheck.column.partNumber'),
			columnName: this.t('designStockCheck.column.name'),
			columnManufacturerPartNumber: this.t('designStockCheck.column.manufacturerPart'),
			columnPackage: this.t('designStockCheck.column.package'),
			columnDesignators: this.t('designStockCheck.column.designators'),
			columnRequestedQuantity: this.t('bomStockOut.column.requestedQuantity'),
			columnBeforeQuantity: this.t('bomStockOut.column.beforeQuantity'),
			columnAfterQuantity: this.t('bomStockOut.column.afterQuantity'),
			columnIssue: this.t('bomStockOut.column.issue'),
			issueDuplicateBatch: this.t('bomStockOut.issue.duplicateBatch'),
			issueItemMissing: this.t('bomStockOut.issue.itemMissing'),
			issueQuantityNotExact: this.t('bomStockOut.issue.quantityNotExact'),
			issueInsufficientStock: this.t('bomStockOut.issue.insufficientStock'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			emptyRows: this.t('bomStockOut.emptyRows'),
			previousPage: this.t('inventoryOverview.previousPage'),
			nextPage: this.t('inventoryOverview.nextPage'),
			pageStatus: this.t('inventoryOverview.pageStatus'),
			commit: this.t('bomStockOut.commit'),
			confirmCommit: this.t('bomStockOut.confirmCommit'),
			committing: this.t('bomStockOut.committing'),
			commitSucceeded: this.t('bomStockOut.commitSucceeded'),
			cancel: this.t('dialog.cancel'),
			close: this.t('inventoryItem.close'),
			operationError: this.t('bomStockOut.operationError'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
		};
	}
}

class EdaBomStockOutIFrameHost implements BomStockOutIFrameHost {
	public read(key: string): unknown { return eda.sys_Storage.getExtensionUserConfig(key); }
	public write(key: string, value: unknown): Promise<boolean> { return eda.sys_Storage.setExtensionUserConfig(key, value); }
	public remove(key: string): Promise<boolean> { return eda.sys_Storage.deleteExtensionUserConfig(key); }
	public close(): Promise<boolean> { return eda.sys_IFrame.closeIFrame(BOM_STOCK_OUT_IFRAME_ID); }
	public startPolling(id: string, intervalMs: number, callback: () => void): boolean {
		return typeof eda.sys_Timer?.setIntervalTimer === 'function'
			&& eda.sys_Timer.setIntervalTimer(id, intervalMs, callback);
	}

	public stopPolling(id: string): boolean { return eda.sys_Timer.clearIntervalTimer(id); }
	public open(options: IFrameOpenOptions): Promise<boolean> {
		if (typeof eda.sys_IFrame?.openIFrame !== 'function')
			throw new BomStockOutPanelUnavailableError('api-missing');
		return eda.sys_IFrame.openIFrame(
			BOM_STOCK_OUT_IFRAME_PATH,
			PANEL_WIDTH,
			PANEL_HEIGHT,
			BOM_STOCK_OUT_IFRAME_ID,
			{
				grayscaleMask: true,
				maximizeButton: true,
				title: options.title,
				buttonCallbackFn: button => button === 'close' ? options.onClose() : undefined,
			},
		);
	}
}

function createId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}
