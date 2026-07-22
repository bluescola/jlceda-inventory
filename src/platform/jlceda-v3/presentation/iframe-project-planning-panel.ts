import type { Translate } from '../eda/i18n-client';
import type { IFrameProjectPlanningRequest, ProjectPlanningLabels } from './iframe-project-planning-protocol';
import type { DiagnosticTrace } from './native-diagnostics';
import type { ProjectPlanningOperation, ProjectPlanningOperationHandler, ProjectPlanningPanel, ProjectPlanningPanelInput, ProjectPlanningViewState } from './project-planning-panel';
import {
	createIFrameProjectPlanningRequest,
	createIFrameProjectPlanningResponse,
	parseIFrameProjectPlanningEvent,
	parseIFrameProjectPlanningRequest,
	PROJECT_PLANNING_EVENT_KEY,
	PROJECT_PLANNING_IFRAME_ID,
	PROJECT_PLANNING_IFRAME_PATH,
	PROJECT_PLANNING_REQUEST_KEY,
	PROJECT_PLANNING_RESPONSE_KEY,
} from './iframe-project-planning-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 1240;
const PANEL_HEIGHT = 820;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions {
	title: string;
	onClose: () => void;
}

export interface ProjectPlanningIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	hide: () => Promise<boolean>;
	show: () => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

export class ProjectPlanningPanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`Project planning panel unavailable: ${status}`, options);
		this.name = 'ProjectPlanningPanelUnavailableError';
	}
}

type PanelResult = 'closed' | { error: unknown; ready: boolean };

export class IFrameProjectPlanningPanel implements ProjectPlanningPanel {
	private queue: Promise<void> = Promise.resolve();
	private sessionActive = false;
	private sessionOpened = false;

	public constructor(
		private readonly t: Translate,
		private readonly host: ProjectPlanningIFrameHost = new EdaProjectPlanningIFrameHost(),
	) {}

	public open(
		input: ProjectPlanningPanelInput,
		handleOperation: ProjectPlanningOperationHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		if (this.sessionActive) {
			if (!this.sessionOpened) {
				return Promise.resolve();
			}
			return this.host.show().then((shown) => {
				trace?.info('project-planning-panel.iframe.show', { status: shown ? 'shown' : 'failed' });
				if (!shown) {
					throw new ProjectPlanningPanelUnavailableError('init-failed');
				}
			});
		}
		this.sessionActive = true;
		return this.enqueue(async () => {
			try {
				await this.closeStaleHostSession(trace);
				const request = createIFrameProjectPlanningRequest(createRequestId(), this.labels(), input);
				if (!parseIFrameProjectPlanningRequest(request)) {
					throw new TypeError('Invalid project planning panel request.');
				}
				await this.openExclusive(request, handleOperation, trace);
			}
			finally {
				this.sessionActive = false;
				this.sessionOpened = false;
			}
		});
	}

	private async closeStaleHostSession(trace?: DiagnosticTrace): Promise<void> {
		let staleSessionFound = false;
		try {
			staleSessionFound = await this.host.hide();
			trace?.info('project-planning-panel.stale-session.probe', {
				status: staleSessionFound ? 'found' : 'missing',
			});
		}
		catch (error) {
			trace?.warn('project-planning-panel.stale-session.probe-failed', { errorName: errorName(error) });
		}
		if (!staleSessionFound) {
			return;
		}
		try {
			await this.host.close();
		}
		catch (error) {
			trace?.warn('project-planning-panel.stale-session.close-failed', { errorName: errorName(error) });
		}
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async openExclusive(
		request: IFrameProjectPlanningRequest,
		handleOperation: ProjectPlanningOperationHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		const timerId = `${PROJECT_PLANNING_IFRAME_ID}.${request.requestId}`;
		const processedOperations = new Set<string>();
		let opened = false;
		let pollStarted = false;
		let ready = false;
		let settled = false;
		let nativeCloseRequested = false;
		let activeOperation: Promise<void> | undefined;
		let readyDeadline: number | undefined;
		let lastViewState = request.initialState ?? defaultViewState();
		let resolveResult: (result: PanelResult) => void = () => undefined;
		const resultPromise = new Promise<PanelResult>((resolve) => {
			resolveResult = (result) => {
				if (!settled) {
					settled = true;
					resolve(result);
				}
			};
		});

		const processOperation = async (
			operation: ProjectPlanningOperation,
			writeResponse: boolean,
		): Promise<void> => {
			trace?.info('project-planning-panel.operation.started', { type: operation.intent.type });
			try {
				const result = await handleOperation(operation);
				if (writeResponse && !settled && !nativeCloseRequested) {
					const response = createIFrameProjectPlanningResponse(request.requestId, operation.operationId, result);
					if (!await this.host.write(PROJECT_PLANNING_RESPONSE_KEY, response)) {
						throw new Error('The host rejected the project planning response.');
					}
				}
				trace?.info('project-planning-panel.operation.completed', {
					status: result.status,
					type: operation.intent.type,
				});
				if (operation.intent.type === 'close' && result.status === 'succeeded') {
					resolveResult('closed');
				}
			}
			catch (error) {
				trace?.error('project-planning-panel.operation.failed', {
					errorName: errorName(error),
					type: operation.intent.type,
				});
				if (writeResponse && !settled && !nativeCloseRequested) {
					await this.host.write(PROJECT_PLANNING_RESPONSE_KEY, createIFrameProjectPlanningResponse(
						request.requestId,
						operation.operationId,
						{ status: 'failed', message: request.labels.operationError },
					));
				}
				if (operation.intent.type === 'close' && !writeResponse) {
					resolveResult('closed');
				}
			}
		};

		const processNativeClose = (): void => {
			if (settled || nativeCloseRequested) {
				return;
			}
			nativeCloseRequested = true;
			if (activeOperation) {
				return;
			}
			activeOperation = processOperation({
				operationId: createOperationId(),
				intent: { type: 'close', viewState: lastViewState },
			}, false).finally(() => {
				activeOperation = undefined;
				resolveResult('closed');
			});
		};

		const readEvent = (): void => {
			try {
				const event = parseIFrameProjectPlanningEvent(
					this.host.read(PROJECT_PLANNING_EVENT_KEY),
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
					trace?.info('project-planning-panel.iframe.stage', { stage: event.stage });
					return;
				}
				if (event.status === 'failed') {
					trace?.error('project-planning-panel.iframe.failed', {
						errorName: event.errorName,
						stage: event.stage,
					});
					resolveResult({ error: new Error('The project planning IFrame failed.'), ready });
					return;
				}
				if (processedOperations.has(event.operationId) || activeOperation) {
					return;
				}
				processedOperations.add(event.operationId);
				lastViewState = { ...event.intent.viewState };
				activeOperation = processOperation({
					operationId: event.operationId,
					intent: event.intent,
				}, true).finally(() => {
					activeOperation = undefined;
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
				resolveResult({ error: new Error('The project planning IFrame did not become ready.'), ready: false });
			}
		};

		try {
			await Promise.all([
				this.removeBridgeValue(PROJECT_PLANNING_EVENT_KEY, trace),
				this.removeBridgeValue(PROJECT_PLANNING_RESPONSE_KEY, trace),
			]);
			if (!await this.host.write(PROJECT_PLANNING_REQUEST_KEY, request)) {
				throw new ProjectPlanningPanelUnavailableError('init-failed');
			}
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted) {
				throw new ProjectPlanningPanelUnavailableError('api-missing');
			}
			opened = await this.host.open({ title: request.labels.title, onClose: processNativeClose });
			if (!opened) {
				throw new ProjectPlanningPanelUnavailableError('init-failed');
			}
			this.sessionOpened = true;
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			poll();
			const result = await resultPromise;
			if (result !== 'closed') {
				if (result.ready) {
					throw result.error;
				}
				throw new ProjectPlanningPanelUnavailableError('render-failed', { cause: result.error });
			}
		}
		catch (error) {
			if (error instanceof ProjectPlanningPanelUnavailableError || ready) {
				throw error;
			}
			throw new ProjectPlanningPanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			this.sessionOpened = false;
			if (pollStarted) {
				this.host.stopPolling(timerId);
			}
			await Promise.all([
				this.removeBridgeValue(PROJECT_PLANNING_REQUEST_KEY, trace),
				this.removeBridgeValue(PROJECT_PLANNING_EVENT_KEY, trace),
				this.removeBridgeValue(PROJECT_PLANNING_RESPONSE_KEY, trace),
			]);
			if (opened) {
				try {
					await this.host.close();
				}
				catch (error) {
					trace?.warn('project-planning-panel.iframe.close.failed', { errorName: errorName(error) });
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
			trace?.warn('project-planning-panel.iframe.cleanup.failed', {
				errorName: errorName(error),
				key,
			});
		}
	}

	private labels(): ProjectPlanningLabels {
		return {
			title: this.t('projectPlanning.title'),
			tabSnapshots: this.t('projectPlanning.tab.snapshots'),
			tabProcurement: this.t('projectPlanning.tab.procurement'),
			tabPurchases: this.t('projectPlanning.tab.purchases'),
			captureCurrent: this.t('projectPlanning.captureCurrent'),
			refresh: this.t('inventoryOverview.refresh'),
			close: this.t('inventoryItem.close'),
			pageSize: this.t('inventoryOverview.pageSize'),
			previousPage: this.t('inventoryOverview.previousPage'),
			nextPage: this.t('inventoryOverview.nextPage'),
			pageStatus: this.t('inventoryOverview.pageStatus'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			emptySnapshots: this.t('projectPlanning.empty.snapshots'),
			emptyProcurement: this.t('projectPlanning.empty.procurement'),
			emptyPurchases: this.t('projectPlanning.empty.purchases'),
			columnLabel: this.t('projectPlanning.column.label'),
			columnProjectUuid: this.t('projectPlanning.column.projectUuid'),
			columnDocumentUuid: this.t('projectPlanning.column.documentUuid'),
			columnDocumentKind: this.t('projectPlanning.column.documentKind'),
			columnBoardQuantity: this.t('projectPlanning.column.boardQuantity'),
			columnCapturedAt: this.t('projectPlanning.column.capturedAt'),
			columnDemandLines: this.t('projectPlanning.column.demandLines'),
			columnActions: this.t('inventoryOverview.columnActions'),
			documentSchematic: this.t('projectPlanning.document.schematic'),
			documentPcb: this.t('projectPlanning.document.pcb'),
			documentFile: this.t('projectPlanning.document.file'),
			setBoardQuantity: this.t('projectPlanning.setBoardQuantity'),
			boardQuantity: this.t('designStockCheck.boardQuantity'),
			boardQuantityInvalid: this.t('designStockCheck.boardQuantityInvalid'),
			confirmSetBoardQuantity: this.t('projectPlanning.confirmSetBoardQuantity'),
			removeSnapshot: this.t('projectPlanning.removeSnapshot'),
			confirmRemoveSnapshot: this.t('projectPlanning.confirmRemoveSnapshot'),
			columnPartNumber: this.t('designStockCheck.column.partNumber'),
			columnName: this.t('designStockCheck.column.name'),
			columnRequiredQuantity: this.t('designStockCheck.column.requiredQuantity'),
			columnAvailableQuantity: this.t('designStockCheck.column.availableQuantity'),
			columnSuggestedQuantity: this.t('projectPlanning.column.suggestedQuantity'),
			columnStatus: this.t('designStockCheck.column.status'),
			columnSources: this.t('projectPlanning.column.sources'),
			statusSufficient: this.t('designStockCheck.status.sufficient'),
			statusInsufficient: this.t('designStockCheck.status.insufficient'),
			statusReviewRequired: this.t('designStockCheck.status.reviewRequired'),
			statusStocktakeRequired: this.t('designStockCheck.status.stocktakeRequired'),
			statusInventoryMissing: this.t('designStockCheck.status.inventoryMissing'),
			statusIdentityUnmatched: this.t('designStockCheck.status.identityUnmatched'),
			quantityEstimated: this.t('designStockCheck.quantityEstimated'),
			quantityUnknown: this.t('inventory.unknown'),
			exportProcurement: this.t('projectPlanning.exportProcurement'),
			addPurchase: this.t('projectPlanning.addPurchase'),
			costSummary: this.t('projectPlanning.costSummary'),
			columnQuantity: this.t('inventory.quantityLabel'),
			columnUnitPriceMinor: this.t('projectPlanning.column.unitPriceMinor'),
			columnTotalMinor: this.t('projectPlanning.column.totalMinor'),
			columnCurrency: this.t('projectPlanning.column.currency'),
			columnPlatform: this.t('projectPlanning.column.platform'),
			columnOrderNumber: this.t('projectPlanning.column.orderNumber'),
			columnPurchasedAt: this.t('projectPlanning.column.purchasedAt'),
			removePurchase: this.t('projectPlanning.removePurchase'),
			confirmRemovePurchase: this.t('projectPlanning.confirmRemovePurchase'),
			fieldPartNumber: this.t('part.lcscLabel'),
			fieldName: this.t('part.nameLabel'),
			fieldQuantity: this.t('inventory.quantityLabel'),
			fieldUnitPriceMinor: this.t('projectPlanning.field.unitPriceMinor'),
			fieldCurrency: this.t('projectPlanning.field.currency'),
			fieldPlatform: this.t('projectPlanning.field.platform'),
			fieldProductUrl: this.t('projectPlanning.field.productUrl'),
			fieldOrderNumber: this.t('projectPlanning.field.orderNumber'),
			fieldPurchasedAt: this.t('projectPlanning.field.purchasedAt'),
			fieldSnapshots: this.t('projectPlanning.field.snapshots'),
			fieldNote: this.t('inventory.noteLabel'),
			savePurchase: this.t('projectPlanning.savePurchase'),
			cancel: this.t('dialog.cancel'),
			purchaseNameRequired: this.t('projectPlanning.validation.nameRequired'),
			purchasePartNumberInvalid: this.t('part.lcscInvalid'),
			purchaseQuantityInvalid: this.t('projectPlanning.validation.quantity'),
			purchasePriceInvalid: this.t('projectPlanning.validation.price'),
			purchaseCurrencyInvalid: this.t('projectPlanning.validation.currency'),
			purchaseDateInvalid: this.t('projectPlanning.validation.date'),
			operationPending: this.t('projectPlanning.operationPending'),
			operationError: this.t('projectPlanning.operationError'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
		};
	}
}

class EdaProjectPlanningIFrameHost implements ProjectPlanningIFrameHost {
	public read(key: string): unknown { return eda.sys_Storage.getExtensionUserConfig(key); }
	public write(key: string, value: unknown): Promise<boolean> { return eda.sys_Storage.setExtensionUserConfig(key, value); }
	public remove(key: string): Promise<boolean> { return eda.sys_Storage.deleteExtensionUserConfig(key); }
	public close(): Promise<boolean> { return eda.sys_IFrame.closeIFrame(PROJECT_PLANNING_IFRAME_ID); }
	public hide(): Promise<boolean> { return eda.sys_IFrame.hideIFrame(PROJECT_PLANNING_IFRAME_ID); }
	public show(): Promise<boolean> { return eda.sys_IFrame.showIFrame(PROJECT_PLANNING_IFRAME_ID); }

	public startPolling(id: string, intervalMs: number, callback: () => void): boolean {
		return typeof eda.sys_Timer?.setIntervalTimer === 'function'
			&& eda.sys_Timer.setIntervalTimer(id, intervalMs, callback);
	}

	public stopPolling(id: string): boolean { return eda.sys_Timer.clearIntervalTimer(id); }

	public open(options: IFrameOpenOptions): Promise<boolean> {
		if (typeof eda.sys_IFrame?.openIFrame !== 'function') {
			throw new ProjectPlanningPanelUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(
			PROJECT_PLANNING_IFRAME_PATH,
			PANEL_WIDTH,
			PANEL_HEIGHT,
			PROJECT_PLANNING_IFRAME_ID,
			{
				grayscaleMask: true,
				maximizeButton: true,
				title: options.title,
				buttonCallbackFn: button => button === 'close' ? options.onClose() : undefined,
			},
		);
	}
}

function defaultViewState(): ProjectPlanningViewState {
	return {
		tab: 'snapshots',
		snapshotPage: 1,
		procurementPage: 1,
		purchasePage: 1,
		pageSize: 25,
	};
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
