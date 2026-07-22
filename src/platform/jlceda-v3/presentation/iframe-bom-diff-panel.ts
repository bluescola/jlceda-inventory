import type { Translate } from '../eda/i18n-client';
import type {
	BomDiffPanel,
	BomDiffPanelAction,
	BomDiffPanelActionHandler,
	BomDiffPanelInput,
} from './bom-diff-panel';
import type { BomDiffLabels, IFrameBomDiffRequest } from './iframe-bom-diff-protocol';
import type { DiagnosticTrace } from './native-diagnostics';
import {
	BOM_DIFF_EVENT_KEY,
	BOM_DIFF_IFRAME_ID,
	BOM_DIFF_IFRAME_PATH,
	BOM_DIFF_REQUEST_KEY,
	BOM_DIFF_RESPONSE_KEY,
	createIFrameBomDiffRequest,
	createIFrameBomDiffResponse,
	parseIFrameBomDiffEvent,
	parseIFrameBomDiffRequest,
} from './iframe-bom-diff-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 1240;
const PANEL_HEIGHT = 820;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions {
	title: string;
	onClose: () => void;
}

export interface BomDiffIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

export class BomDiffPanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`BOM diff panel unavailable: ${status}`, options);
		this.name = 'BomDiffPanelUnavailableError';
	}
}

type PanelResult = 'closed' | { error: unknown; ready: boolean };

export class IFrameBomDiffPanel implements BomDiffPanel {
	private queue: Promise<void> = Promise.resolve();

	public constructor(
		private readonly t: Translate,
		private readonly host: BomDiffIFrameHost = new EdaBomDiffIFrameHost(),
	) {}

	public open(
		input: BomDiffPanelInput,
		handleAction: BomDiffPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		return this.enqueue(async () => {
			const request = createIFrameBomDiffRequest(createRequestId(), this.labels(), input);
			if (!parseIFrameBomDiffRequest(request)) {
				throw new TypeError('Invalid BOM diff panel request.');
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
		request: IFrameBomDiffRequest,
		handleAction: BomDiffPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		const timerId = `${BOM_DIFF_IFRAME_ID}.${request.requestId}`;
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
			action: BomDiffPanelAction,
			operationId: string,
			writeResponse: boolean,
		): Promise<void> => {
			trace?.info('bom-diff-panel.action.started', { action: action.type });
			try {
				const outcome = await handleAction(action);
				if (writeResponse && !settled && !nativeCloseRequested) {
					if (!await this.host.write(
						BOM_DIFF_RESPONSE_KEY,
						createIFrameBomDiffResponse(request.requestId, operationId, outcome),
					)) {
						throw new Error('The host rejected the BOM diff response.');
					}
				}
				trace?.info('bom-diff-panel.action.completed', { action: action.type, status: outcome.status });
				if (action.type === 'close' && outcome.status === 'succeeded') {
					resolveResult('closed');
				}
			}
			catch (error) {
				trace?.error('bom-diff-panel.action.failed', { action: action.type, errorName: errorName(error) });
				if (writeResponse && !settled && !nativeCloseRequested) {
					await this.host.write(BOM_DIFF_RESPONSE_KEY, createIFrameBomDiffResponse(
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
				const event = parseIFrameBomDiffEvent(this.host.read(BOM_DIFF_EVENT_KEY), request.requestId);
				if (!event) {
					return;
				}
				if (event.status === 'ready') {
					ready = true;
					return;
				}
				if (event.status === 'progress') {
					trace?.info('bom-diff-panel.iframe.stage', { stage: event.stage });
					return;
				}
				if (event.status === 'failed') {
					trace?.error('bom-diff-panel.iframe.failed', { errorName: event.errorName, stage: event.stage });
					resolveResult({ error: new Error('The BOM diff IFrame failed.'), ready });
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
				resolveResult({ error: new Error('The BOM diff IFrame did not become ready.'), ready: false });
			}
		};

		try {
			await Promise.all([
				this.removeBridgeValue(BOM_DIFF_EVENT_KEY, trace),
				this.removeBridgeValue(BOM_DIFF_RESPONSE_KEY, trace),
			]);
			if (!await this.host.write(BOM_DIFF_REQUEST_KEY, request)) {
				throw new BomDiffPanelUnavailableError('init-failed');
			}
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted) {
				throw new BomDiffPanelUnavailableError('api-missing');
			}
			opened = await this.host.open({ title: request.labels.title, onClose: processNativeClose });
			if (!opened) {
				throw new BomDiffPanelUnavailableError('init-failed');
			}
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			poll();
			const result = await resultPromise;
			if (result !== 'closed') {
				if (result.ready) {
					throw result.error;
				}
				throw new BomDiffPanelUnavailableError('render-failed', { cause: result.error });
			}
		}
		catch (error) {
			if (error instanceof BomDiffPanelUnavailableError || ready) {
				throw error;
			}
			throw new BomDiffPanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			if (pollStarted) {
				this.host.stopPolling(timerId);
			}
			await Promise.all([
				this.removeBridgeValue(BOM_DIFF_REQUEST_KEY, trace),
				this.removeBridgeValue(BOM_DIFF_EVENT_KEY, trace),
				this.removeBridgeValue(BOM_DIFF_RESPONSE_KEY, trace),
			]);
			if (opened) {
				try {
					await this.host.close();
				}
				catch (error) {
					trace?.warn('bom-diff-panel.iframe.close.failed', { errorName: errorName(error) });
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
			trace?.warn('bom-diff-panel.iframe.cleanup.failed', { errorName: errorName(error) });
		}
	}

	private labels(): BomDiffLabels {
		return {
			title: this.t('bomDiff.title'),
			beforeFile: this.t('bomDiff.beforeFile'),
			afterFile: this.t('bomDiff.afterFile'),
			totalChanges: this.t('bomDiff.totalChanges'),
			filterChangeType: this.t('bomDiff.filterChangeType'),
			filterAll: this.t('bomDiff.filterAll'),
			changeAdded: this.t('bomDiff.change.added'),
			changeRemoved: this.t('bomDiff.change.removed'),
			changeQuantityIncreased: this.t('bomDiff.change.quantityIncreased'),
			changeQuantityDecreased: this.t('bomDiff.change.quantityDecreased'),
			changeIdentityChanged: this.t('bomDiff.change.identityChanged'),
			columnPartNumber: this.t('bomDiff.column.partNumber'),
			columnChangeType: this.t('bomDiff.column.changeType'),
			columnBeforeQuantity: this.t('bomDiff.column.beforeQuantity'),
			columnAfterQuantity: this.t('bomDiff.column.afterQuantity'),
			columnQuantityDelta: this.t('bomDiff.column.quantityDelta'),
			columnBeforeDesignators: this.t('bomDiff.column.beforeDesignators'),
			columnAfterDesignators: this.t('bomDiff.column.afterDesignators'),
			columnIdentityChanges: this.t('bomDiff.column.identityChanges'),
			identityName: this.t('bomDiff.identity.name'),
			identityManufacturerPartNumber: this.t('bomDiff.identity.manufacturerPartNumber'),
			identityManufacturer: this.t('bomDiff.identity.manufacturer'),
			identityPackage: this.t('bomDiff.identity.package'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			emptyReport: this.t('bomDiff.emptyReport'),
			emptyFiltered: this.t('bomDiff.emptyFiltered'),
			reviewTitle: this.t('bomDiff.reviewTitle'),
			reviewKind: this.t('bomDiff.reviewKind'),
			reviewBeforeUnmatched: this.t('bomDiff.review.beforeUnmatched'),
			reviewAfterUnmatched: this.t('bomDiff.review.afterUnmatched'),
			reviewBeforeIssues: this.t('bomDiff.review.beforeIssues'),
			reviewAfterIssues: this.t('bomDiff.review.afterIssues'),
			reviewEmpty: this.t('bomDiff.review.empty'),
			columnSourceRow: this.t('bomDiff.column.sourceRow'),
			columnQuantity: this.t('bomDiff.column.quantity'),
			columnDesignators: this.t('bomDiff.column.designators'),
			columnIdentity: this.t('bomDiff.column.identity'),
			columnIssue: this.t('bomDiff.column.issue'),
			columnField: this.t('bomDiff.column.field'),
			columnValue: this.t('bomDiff.column.value'),
			issueInvalidExclusion: this.t('bomDiff.issue.invalidExclusion'),
			issueInvalidLcscPartNumber: this.t('bomDiff.issue.invalidLcscPartNumber'),
			issueInvalidQuantity: this.t('bomDiff.issue.invalidQuantity'),
			issueMissingIdentity: this.t('bomDiff.issue.missingIdentity'),
			issueMissingLcscPartNumber: this.t('bomDiff.issue.missingLcscPartNumber'),
			issueMissingQuantity: this.t('bomDiff.issue.missingQuantity'),
			issueQuantityDesignatorMismatch: this.t('bomDiff.issue.quantityDesignatorMismatch'),
			fieldLcscPartNumber: this.t('bomMapping.field.lcscPartNumber'),
			fieldDesignators: this.t('bomMapping.field.designators'),
			fieldQuantity: this.t('bomMapping.field.quantity'),
			fieldName: this.t('bomMapping.field.name'),
			fieldManufacturerPartNumber: this.t('bomMapping.field.manufacturerPartNumber'),
			fieldManufacturer: this.t('bomMapping.field.manufacturer'),
			fieldPackage: this.t('bomMapping.field.package'),
			fieldExcludeFromBom: this.t('bomMapping.field.excludeFromBom'),
			previousPage: this.t('inventoryOverview.previousPage'),
			nextPage: this.t('inventoryOverview.nextPage'),
			pageStatus: this.t('inventoryOverview.pageStatus'),
			exportCsv: this.t('bomDiff.exportCsv'),
			exporting: this.t('bomDiff.exporting'),
			exportSucceeded: this.t('bomDiff.exportSucceeded'),
			close: this.t('inventoryItem.close'),
			operationError: this.t('bomDiff.operationError'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
		};
	}
}

class EdaBomDiffIFrameHost implements BomDiffIFrameHost {
	public read(key: string): unknown { return eda.sys_Storage.getExtensionUserConfig(key); }
	public write(key: string, value: unknown): Promise<boolean> { return eda.sys_Storage.setExtensionUserConfig(key, value); }
	public remove(key: string): Promise<boolean> { return eda.sys_Storage.deleteExtensionUserConfig(key); }
	public close(): Promise<boolean> { return eda.sys_IFrame.closeIFrame(BOM_DIFF_IFRAME_ID); }
	public startPolling(id: string, intervalMs: number, callback: () => void): boolean {
		return typeof eda.sys_Timer?.setIntervalTimer === 'function'
			&& eda.sys_Timer.setIntervalTimer(id, intervalMs, callback);
	}

	public stopPolling(id: string): boolean { return eda.sys_Timer.clearIntervalTimer(id); }
	public open(options: IFrameOpenOptions): Promise<boolean> {
		if (typeof eda.sys_IFrame?.openIFrame !== 'function') {
			throw new BomDiffPanelUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(
			BOM_DIFF_IFRAME_PATH,
			PANEL_WIDTH,
			PANEL_HEIGHT,
			BOM_DIFF_IFRAME_ID,
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
