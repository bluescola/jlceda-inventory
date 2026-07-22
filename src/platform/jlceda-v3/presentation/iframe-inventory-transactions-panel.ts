import type { Translate } from '../eda/i18n-client';
import type {
	IFrameInventoryTransactionsRequest,
	InventoryTransactionsLabels,
} from './iframe-inventory-transactions-protocol';
import type {
	InventoryTransactionsPanel,
	InventoryTransactionsPanelAction,
	InventoryTransactionsPanelActionHandler,
	InventoryTransactionsPanelInput,
} from './inventory-transactions-panel';
import type { DiagnosticTrace } from './native-diagnostics';
import {
	createIFrameInventoryTransactionsRequest,
	createIFrameInventoryTransactionsResponse,
	INVENTORY_TRANSACTIONS_EVENT_KEY,
	INVENTORY_TRANSACTIONS_IFRAME_ID,
	INVENTORY_TRANSACTIONS_IFRAME_PATH,
	INVENTORY_TRANSACTIONS_REQUEST_KEY,
	INVENTORY_TRANSACTIONS_RESPONSE_KEY,
	parseIFrameInventoryTransactionsEvent,
	parseIFrameInventoryTransactionsRequest,
} from './iframe-inventory-transactions-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 1240;
const PANEL_HEIGHT = 820;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions { title: string; onClose: () => void }

export interface InventoryTransactionsIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

export class InventoryTransactionsPanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`Inventory transactions panel unavailable: ${status}`, options);
		this.name = 'InventoryTransactionsPanelUnavailableError';
	}
}

type PanelResult = 'closed' | { error: unknown; ready: boolean };

export class IFrameInventoryTransactionsPanel implements InventoryTransactionsPanel {
	private queue: Promise<void> = Promise.resolve();

	public constructor(
		private readonly t: Translate,
		private readonly host: InventoryTransactionsIFrameHost = new EdaInventoryTransactionsIFrameHost(),
	) {}

	public open(
		input: InventoryTransactionsPanelInput,
		handleAction: InventoryTransactionsPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		return this.enqueue(async () => {
			const request = createIFrameInventoryTransactionsRequest(createId(), this.labels(), input);
			if (!parseIFrameInventoryTransactionsRequest(request)) {
				throw new TypeError('Invalid inventory transactions panel request.');
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
		request: IFrameInventoryTransactionsRequest,
		handleAction: InventoryTransactionsPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		const timerId = `${INVENTORY_TRANSACTIONS_IFRAME_ID}.${request.requestId}`;
		const processed = new Set<string>();
		let snapshot = request.snapshot;
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
			action: InventoryTransactionsPanelAction,
			operationId: string,
			writeResponse: boolean,
		): Promise<void> => {
			trace?.info('inventory-transactions-panel.action.started', { action: action.type });
			try {
				const invalidUndo = action.type === 'undo-batch'
					&& !snapshot.batches.some(batch => batch.id === action.batchId && batch.status === 'active');
				const handled = invalidUndo
					? { status: 'failed' as const, message: request.labels.operationError }
					: await handleAction(action);
				const outcome = action.type === 'undo-batch' && handled.status === 'succeeded' && !handled.snapshot
					? { status: 'failed' as const, message: request.labels.operationError }
					: handled;
				const response = createIFrameInventoryTransactionsResponse(request.requestId, operationId, outcome);
				if (writeResponse && !settled && !nativeCloseRequested
					&& !await this.host.write(INVENTORY_TRANSACTIONS_RESPONSE_KEY, response)) {
					throw new Error('The host rejected the inventory transactions response.');
				}
				if (response.status === 'succeeded' && response.snapshot) {
					snapshot = response.snapshot;
				}
				trace?.info('inventory-transactions-panel.action.completed', { action: action.type, status: outcome.status });
				if (action.type === 'close' && outcome.status === 'succeeded') {
					resolveResult('closed');
				}
			}
			catch (error) {
				trace?.error('inventory-transactions-panel.action.failed', {
					action: action.type,
					errorName: errorName(error),
				});
				if (writeResponse && !settled && !nativeCloseRequested) {
					await this.host.write(INVENTORY_TRANSACTIONS_RESPONSE_KEY, createIFrameInventoryTransactionsResponse(
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
				const event = parseIFrameInventoryTransactionsEvent(
					this.host.read(INVENTORY_TRANSACTIONS_EVENT_KEY),
					request.requestId,
				);
				if (!event)
					return;
				if (event.status === 'ready') {
					ready = true;
					return;
				}
				if (event.status === 'progress') {
					trace?.info('inventory-transactions-panel.iframe.stage', { stage: event.stage });
					return;
				}
				if (event.status === 'failed') {
					trace?.error('inventory-transactions-panel.iframe.failed', {
						errorName: event.errorName,
						stage: event.stage,
					});
					resolveResult({ error: new Error('The inventory transactions IFrame failed.'), ready });
					return;
				}
				if (processed.has(event.operationId) || active)
					return;
				processed.add(event.operationId);
				const action: InventoryTransactionsPanelAction = event.action === 'undo-batch'
					? { type: 'undo-batch', batchId: event.batchId }
					: { type: event.action };
				active = processAction(action, event.operationId, true).finally(() => {
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
				resolveResult({ error: new Error('The inventory transactions IFrame did not become ready.'), ready: false });
			}
		};

		try {
			await Promise.all([
				this.remove(INVENTORY_TRANSACTIONS_EVENT_KEY, trace),
				this.remove(INVENTORY_TRANSACTIONS_RESPONSE_KEY, trace),
			]);
			if (!await this.host.write(INVENTORY_TRANSACTIONS_REQUEST_KEY, request)) {
				throw new InventoryTransactionsPanelUnavailableError('init-failed');
			}
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted)
				throw new InventoryTransactionsPanelUnavailableError('api-missing');
			opened = await this.host.open({ title: request.labels.title, onClose: processNativeClose });
			if (!opened)
				throw new InventoryTransactionsPanelUnavailableError('init-failed');
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			poll();
			const result = await resultPromise;
			if (result !== 'closed') {
				if (result.ready)
					throw result.error;
				throw new InventoryTransactionsPanelUnavailableError('render-failed', { cause: result.error });
			}
		}
		catch (error) {
			if (error instanceof InventoryTransactionsPanelUnavailableError || ready)
				throw error;
			throw new InventoryTransactionsPanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			if (pollStarted)
				this.host.stopPolling(timerId);
			await Promise.all([
				this.remove(INVENTORY_TRANSACTIONS_REQUEST_KEY, trace),
				this.remove(INVENTORY_TRANSACTIONS_EVENT_KEY, trace),
				this.remove(INVENTORY_TRANSACTIONS_RESPONSE_KEY, trace),
			]);
			if (opened) {
				try {
					await this.host.close();
				}
				catch (error) {
					trace?.warn('inventory-transactions-panel.iframe.close.failed', { errorName: errorName(error) });
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
			trace?.warn('inventory-transactions-panel.iframe.cleanup.failed', { errorName: errorName(error) });
		}
	}

	private labels(): InventoryTransactionsLabels {
		return {
			title: this.t('inventoryTransactions.title'),
			batchesTitle: this.t('inventoryTransactions.batchesTitle'),
			transactionsTitle: this.t('inventoryTransactions.transactionsTitle'),
			batchCount: this.t('inventoryTransactions.batchCount'),
			transactionCount: this.t('inventoryTransactions.transactionCount'),
			filterType: this.t('inventoryTransactions.filterType'),
			filterBatch: this.t('inventoryTransactions.filterBatch'),
			filterAll: this.t('inventoryTransactions.filterAll'),
			typeStockOut: this.t('inventoryTransactions.type.stockOut'),
			typeReversal: this.t('inventoryTransactions.type.reversal'),
			statusActive: this.t('inventoryTransactions.status.active'),
			statusReversed: this.t('inventoryTransactions.status.reversed'),
			columnSource: this.t('inventoryTransactions.column.source'),
			columnFingerprint: this.t('inventoryTransactions.column.fingerprint'),
			columnCreatedAt: this.t('inventoryTransactions.column.createdAt'),
			columnStatus: this.t('inventoryTransactions.column.status'),
			columnLineCount: this.t('inventoryTransactions.column.lineCount'),
			columnTotalQuantity: this.t('inventoryTransactions.column.totalQuantity'),
			columnActions: this.t('inventoryTransactions.column.actions'),
			columnType: this.t('inventoryTransactions.column.type'),
			columnPartNumber: this.t('designStockCheck.column.partNumber'),
			columnName: this.t('designStockCheck.column.name'),
			columnManufacturerPartNumber: this.t('designStockCheck.column.manufacturerPart'),
			columnPackage: this.t('designStockCheck.column.package'),
			columnDelta: this.t('inventoryTransactions.column.delta'),
			columnBeforeQuantity: this.t('inventoryTransactions.column.beforeQuantity'),
			columnAfterQuantity: this.t('inventoryTransactions.column.afterQuantity'),
			columnBatch: this.t('inventoryTransactions.column.batch'),
			columnNote: this.t('inventoryTransactions.column.note'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			emptyBatches: this.t('inventoryTransactions.emptyBatches'),
			emptyTransactions: this.t('inventoryTransactions.emptyTransactions'),
			emptyFiltered: this.t('inventoryTransactions.emptyFiltered'),
			previousPage: this.t('inventoryOverview.previousPage'),
			nextPage: this.t('inventoryOverview.nextPage'),
			pageStatus: this.t('inventoryOverview.pageStatus'),
			undoBatch: this.t('inventoryTransactions.undoBatch'),
			confirmUndoBatch: this.t('inventoryTransactions.confirmUndoBatch'),
			undoing: this.t('inventoryTransactions.undoing'),
			undoSucceeded: this.t('inventoryTransactions.undoSucceeded'),
			refresh: this.t('inventoryTransactions.refresh'),
			refreshing: this.t('inventoryTransactions.refreshing'),
			refreshSucceeded: this.t('inventoryTransactions.refreshSucceeded'),
			cancel: this.t('dialog.cancel'),
			close: this.t('inventoryItem.close'),
			operationError: this.t('inventoryTransactions.operationError'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
		};
	}
}

class EdaInventoryTransactionsIFrameHost implements InventoryTransactionsIFrameHost {
	public read(key: string): unknown { return eda.sys_Storage.getExtensionUserConfig(key); }
	public write(key: string, value: unknown): Promise<boolean> { return eda.sys_Storage.setExtensionUserConfig(key, value); }
	public remove(key: string): Promise<boolean> { return eda.sys_Storage.deleteExtensionUserConfig(key); }
	public close(): Promise<boolean> { return eda.sys_IFrame.closeIFrame(INVENTORY_TRANSACTIONS_IFRAME_ID); }
	public startPolling(id: string, intervalMs: number, callback: () => void): boolean {
		return typeof eda.sys_Timer?.setIntervalTimer === 'function'
			&& eda.sys_Timer.setIntervalTimer(id, intervalMs, callback);
	}

	public stopPolling(id: string): boolean { return eda.sys_Timer.clearIntervalTimer(id); }
	public open(options: IFrameOpenOptions): Promise<boolean> {
		if (typeof eda.sys_IFrame?.openIFrame !== 'function') {
			throw new InventoryTransactionsPanelUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(
			INVENTORY_TRANSACTIONS_IFRAME_PATH,
			PANEL_WIDTH,
			PANEL_HEIGHT,
			INVENTORY_TRANSACTIONS_IFRAME_ID,
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
