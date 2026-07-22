import type { Translate } from '../eda/i18n-client';
import type {
	IFrameInventoryOverviewRequest,
	InventoryOverviewLabels,
	InventoryOverviewPanelStage,
} from './iframe-inventory-overview-protocol';
import type {
	InventoryOverviewInput,
	InventoryOverviewOperationHandler,
	InventoryOverviewPanel,
} from './inventory-overview-panel';
import type { DiagnosticTrace } from './native-diagnostics';
import {
	createIFrameInventoryOverviewOperationResponse,
	createInventoryOverviewRequest,
	INVENTORY_OVERVIEW_IFRAME_ID,
	INVENTORY_OVERVIEW_IFRAME_PATH,
	INVENTORY_OVERVIEW_REQUEST_KEY,
	INVENTORY_OVERVIEW_RESPONSE_KEY,
	INVENTORY_OVERVIEW_RESULT_KEY,
	INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY,
	parseIFrameInventoryOverviewResult,
} from './iframe-inventory-overview-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 1240;
const PANEL_HEIGHT = 800;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions {
	title: string;
	onClose: () => void;
	onWindowControl: (action: 'maximize' | 'minimize') => Promise<void>;
}

export interface InventoryOverviewIFrameHost {
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

export class InventoryOverviewPanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`Inventory overview panel unavailable: ${status}`, options);
		this.name = 'InventoryOverviewPanelUnavailableError';
	}
}

type PanelOutcome
	= | { status: 'cancelled' }
		| { status: 'failed'; error: unknown; ready: boolean };

export class IFrameInventoryOverviewPanel implements InventoryOverviewPanel {
	private queue: Promise<void> = Promise.resolve();
	private sessionActive = false;
	private sessionOpened = false;

	public constructor(
		private readonly t: Translate,
		private readonly host: InventoryOverviewIFrameHost = new EdaInventoryOverviewIFrameHost(),
	) {}

	public open(
		input: InventoryOverviewInput,
		onOperation: InventoryOverviewOperationHandler,
		trace?: DiagnosticTrace,
	): Promise<void> {
		if (this.sessionActive) {
			if (!this.sessionOpened) {
				return Promise.resolve();
			}
			trace?.info('inventory-overview-panel.iframe.show.request');
			return this.host.show().then((shown) => {
				trace?.info('inventory-overview-panel.iframe.show.response', { status: shown ? 'shown' : 'failed' });
				if (!shown) {
					throw new InventoryOverviewPanelUnavailableError('init-failed');
				}
			});
		}
		this.sessionActive = true;
		return this.enqueue(async () => {
			try {
				await this.closeStaleHostSession(trace);
				const request = createInventoryOverviewRequest(createRequestId(), this.labels(), input);
				await this.openExclusive(request, onOperation, trace);
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
			trace?.info('inventory-overview-panel.stale-session.probe', {
				status: staleSessionFound ? 'found' : 'missing',
			});
		}
		catch (error) {
			trace?.warn('inventory-overview-panel.stale-session.probe-failed', {
				errorName: errorName(error),
			});
		}
		if (!staleSessionFound) {
			return;
		}

		try {
			const closed = await this.host.close();
			trace?.info('inventory-overview-panel.stale-session.closed', {
				status: closed ? 'closed' : 'already-closed',
			});
		}
		catch (error) {
			trace?.warn('inventory-overview-panel.stale-session.close-failed', {
				errorName: errorName(error),
			});
		}
		await delay(DIALOG_SETTLE_DELAY_MS);
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async openExclusive(
		request: IFrameInventoryOverviewRequest,
		onOperation: InventoryOverviewOperationHandler,
		trace?: DiagnosticTrace,
	): Promise<PanelOutcome> {
		const timerId = `${INVENTORY_OVERVIEW_IFRAME_ID}.${request.requestId}`;
		let opened = false;
		let pollStarted = false;
		let ready = false;
		let settled = false;
		let nativeCloseRequested = false;
		let readyDeadline: number | undefined;
		let lastObservedStage: InventoryOverviewPanelStage | undefined;
		const observedStages = new Set<string>();
		const observedOperations = new Set<string>();
		let operationQueue: Promise<void> = Promise.resolve();
		let resolveOutcome: (outcome: PanelOutcome) => void = () => undefined;
		const outcomePromise = new Promise<PanelOutcome>((resolve) => {
			resolveOutcome = (outcome) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(outcome);
			};
		});
		const stopAfterReadFailure = (error: unknown): void => {
			if (ready) {
				trace?.warn('inventory-overview-panel.iframe.read.stopped', {
					errorName: errorName(error),
					stage: lastObservedStage ?? 'ready',
					status: 'host-unavailable',
				});
				resolveOutcome({ status: 'cancelled' });
				return;
			}
			trace?.error('inventory-overview-panel.iframe.result.invalid', {
				error: errorMessage(error),
				errorName: errorName(error),
				stage: lastObservedStage ?? 'none',
			});
			resolveOutcome({ status: 'failed', error, ready: false });
		};
		const readResult = (): void => {
			try {
				const result = parseIFrameInventoryOverviewResult(
					this.host.read(INVENTORY_OVERVIEW_RESULT_KEY),
					request.requestId,
				);
				if (!result) {
					return;
				}
				if (result.status === 'progress') {
					lastObservedStage = result.stage;
					if (!observedStages.has(result.stage)) {
						observedStages.add(result.stage);
						trace?.info('inventory-overview-panel.iframe.stage', { stage: result.stage });
					}
					return;
				}
				if (result.status === 'ready') {
					if (!ready) {
						ready = true;
						trace?.info('inventory-overview-panel.iframe.ready');
					}
					return;
				}
				if (result.status === 'failed') {
					trace?.error('inventory-overview-panel.iframe.failed', {
						error: result.error,
						errorName: result.errorName,
						stage: result.stage,
					});
					resolveOutcome({ status: 'failed', error: new Error('The inventory overview IFrame failed.'), ready });
					return;
				}
				if (result.status === 'operation') {
					if (!observedOperations.has(result.operation.operationId)) {
						observedOperations.add(result.operation.operationId);
						operationQueue = operationQueue.then(() => this.handleOperation(
							request,
							result.operation,
							onOperation,
							() => !settled && !nativeCloseRequested,
							trace,
						));
					}
					return;
				}
				resolveOutcome({ status: 'cancelled' });
			}
			catch (error) {
				stopAfterReadFailure(error);
			}
		};
		const processNativeClose = (): void => {
			if (settled || nativeCloseRequested) {
				return;
			}
			nativeCloseRequested = true;
			void operationQueue.then(
				() => resolveOutcome({ status: 'cancelled' }),
				() => resolveOutcome({ status: 'cancelled' }),
			);
		};
		const poll = (): void => {
			if (nativeCloseRequested) {
				return;
			}
			try {
				const activeRequestId = bridgeRequestId(this.host.read(INVENTORY_OVERVIEW_REQUEST_KEY));
				if (activeRequestId !== request.requestId) {
					trace?.info('inventory-overview-panel.iframe.session.superseded', {
						status: activeRequestId ? 'newer-request' : 'request-removed',
					});
					resolveOutcome({ status: 'cancelled' });
					return;
				}
			}
			catch (error) {
				stopAfterReadFailure(error);
				return;
			}
			readResult();
			if (!settled && !ready && readyDeadline !== undefined && Date.now() >= readyDeadline) {
				trace?.error('inventory-overview-panel.iframe.ready.timeout', {
					stage: lastObservedStage ?? 'none',
				});
				resolveOutcome({ status: 'failed', error: new Error('The inventory overview IFrame did not become ready.'), ready: false });
			}
		};

		try {
			await this.removeBridgeValue(INVENTORY_OVERVIEW_RESULT_KEY, trace);
			await this.removeBridgeValue(INVENTORY_OVERVIEW_RESPONSE_KEY, trace);
			await this.removeBridgeValue(INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY, trace);
			if (!await this.host.write(INVENTORY_OVERVIEW_REQUEST_KEY, request)) {
				throw new InventoryOverviewPanelUnavailableError('init-failed');
			}
			trace?.info('inventory-overview-panel.iframe.request.stored', {
				categoryCount: request.categories.length,
				itemCount: request.items.length,
			});
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted) {
				throw new InventoryOverviewPanelUnavailableError('api-missing');
			}
			trace?.info('inventory-overview-panel.iframe.open.request', {
				height: PANEL_HEIGHT,
				iframeId: INVENTORY_OVERVIEW_IFRAME_ID,
				path: INVENTORY_OVERVIEW_IFRAME_PATH,
				width: PANEL_WIDTH,
			});
			opened = await this.host.open({
				title: request.labels.title,
				onClose: processNativeClose,
				onWindowControl: async (action) => {
					trace?.info('inventory-overview-panel.iframe.window-control', { status: action });
					if (!await this.host.write(INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY, {
						action,
						requestId: request.requestId,
						timestamp: Date.now(),
					})) {
						trace?.warn('inventory-overview-panel.iframe.window-control.rejected', { status: action });
					}
				},
			});
			if (!opened) {
				throw new InventoryOverviewPanelUnavailableError('init-failed');
			}
			this.sessionOpened = true;
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			trace?.info('inventory-overview-panel.iframe.opened');
			poll();

			const outcome = await outcomePromise;
			trace?.info('inventory-overview-panel.iframe.response', { status: outcome.status });
			if (outcome.status === 'failed') {
				if (outcome.ready) {
					throw outcome.error;
				}
				throw new InventoryOverviewPanelUnavailableError('render-failed', { cause: outcome.error });
			}
			return outcome;
		}
		catch (error) {
			if (error instanceof InventoryOverviewPanelUnavailableError || ready) {
				throw error;
			}
			throw new InventoryOverviewPanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			const ownsHostSession = this.bridgeValueBelongsToRequest(
				INVENTORY_OVERVIEW_REQUEST_KEY,
				request.requestId,
				trace,
			);
			if (pollStarted) {
				try {
					this.host.stopPolling(timerId);
				}
				catch (error) {
					trace?.warn('inventory-overview-panel.iframe.polling.stop-failed', {
						errorName: errorName(error),
					});
				}
			}
			await this.removeBridgeValueForRequest(INVENTORY_OVERVIEW_REQUEST_KEY, request.requestId, trace);
			await this.removeBridgeValueForRequest(INVENTORY_OVERVIEW_RESULT_KEY, request.requestId, trace);
			await this.removeBridgeValueForRequest(INVENTORY_OVERVIEW_RESPONSE_KEY, request.requestId, trace);
			await this.removeBridgeValueForRequest(INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY, request.requestId, trace);
			if (opened && ownsHostSession) {
				this.sessionOpened = false;
				try {
					const closed = await this.host.close();
					trace?.info('inventory-overview-panel.iframe.closed', { status: closed ? 'closed' : 'already-closed' });
				}
				catch (error) {
					trace?.warn('inventory-overview-panel.iframe.close.failed', { errorName: errorName(error) });
				}
			}
			else if (opened) {
				trace?.info('inventory-overview-panel.iframe.close.skipped', {
					reason: 'newer-request-active',
				});
			}
			await delay(DIALOG_SETTLE_DELAY_MS);
		}
	}

	private async handleOperation(
		request: IFrameInventoryOverviewRequest,
		operation: Parameters<InventoryOverviewOperationHandler>[0],
		onOperation: InventoryOverviewOperationHandler,
		isSessionActive: () => boolean,
		trace?: DiagnosticTrace,
	): Promise<void> {
		trace?.info('inventory-overview-panel.operation.started', {
			operationId: operation.operationId,
			type: operation.intent.type,
		});
		let result;
		try {
			result = await onOperation(operation);
		}
		catch (error) {
			trace?.error('inventory-overview-panel.operation.failed', {
				errorName: errorName(error),
				operationId: operation.operationId,
				type: operation.intent.type,
			});
			result = { status: 'failed' as const, message: request.labels.connectionError };
		}
		const response = createIFrameInventoryOverviewOperationResponse(
			request.requestId,
			operation.operationId,
			result,
		);
		if (!isSessionActive()) {
			trace?.info('inventory-overview-panel.operation.response-discarded', {
				operationId: operation.operationId,
				reason: 'session-closed',
			});
			return;
		}
		if (!await this.host.write(INVENTORY_OVERVIEW_RESPONSE_KEY, response)) {
			trace?.warn('inventory-overview-panel.operation.response-rejected', {
				operationId: operation.operationId,
			});
			return;
		}
		trace?.info('inventory-overview-panel.operation.completed', {
			operationId: operation.operationId,
			status: result.status,
			type: operation.intent.type,
		});
	}

	private async removeBridgeValue(key: string, trace?: DiagnosticTrace): Promise<void> {
		try {
			await this.host.remove(key);
		}
		catch (error) {
			trace?.warn('inventory-overview-panel.iframe.cleanup.failed', { errorName: errorName(error) });
		}
	}

	private async removeBridgeValueForRequest(
		key: string,
		requestId: string,
		trace?: DiagnosticTrace,
	): Promise<void> {
		if (!this.bridgeValueBelongsToRequest(key, requestId, trace)) {
			return;
		}
		await this.removeBridgeValue(key, trace);
	}

	private bridgeValueBelongsToRequest(
		key: string,
		requestId: string,
		trace?: DiagnosticTrace,
	): boolean {
		try {
			return bridgeRequestId(this.host.read(key)) === requestId;
		}
		catch (error) {
			trace?.warn('inventory-overview-panel.iframe.cleanup.read-failed', {
				errorName: errorName(error),
			});
			return false;
		}
	}

	private labels(): InventoryOverviewLabels {
		return {
			title: this.t('inventoryOverview.title'),
			searchLabel: this.t('inventoryOverview.searchLabel'),
			searchPlaceholder: this.t('inventoryOverview.searchPlaceholder'),
			search: this.t('inventoryOverview.search'),
			clearSearch: this.t('inventoryOverview.clearSearch'),
			searchScope: this.t('inventoryOverview.searchScope'),
			searchAllCategories: this.t('inventoryOverview.searchAllCategories'),
			searchCurrentCategory: this.t('inventoryOverview.searchCurrentCategory'),
			openCategories: this.t('inventoryOverview.openCategories'),
			closeCategories: this.t('inventoryOverview.closeCategories'),
			allCategories: this.t('inventoryOverview.allCategories'),
			unclassified: this.t('inventoryOverview.unclassified'),
			systemCategories: this.t('inventoryOverview.systemCategories'),
			userCategories: this.t('inventoryOverview.userCategories'),
			manageCategories: this.t('inventoryOverview.manageCategories'),
			importEdaCategories: this.t('categoryImport.title'),
			addRootCategory: this.t('inventoryOverview.addRootCategory'),
			addChildCategory: this.t('inventoryOverview.addChildCategory'),
			renameCategory: this.t('inventoryOverview.renameCategory'),
			moveCategoryUp: this.t('inventoryOverview.moveCategoryUp'),
			moveCategoryDown: this.t('inventoryOverview.moveCategoryDown'),
			dragCategory: this.t('inventoryOverview.dragCategory'),
			expandCategory: this.t('inventoryOverview.expandCategory'),
			collapseCategory: this.t('inventoryOverview.collapseCategory'),
			deleteCategory: this.t('inventoryOverview.deleteCategory'),
			categoryName: this.t('inventoryOverview.categoryName'),
			categoryNamePlaceholder: this.t('inventoryOverview.categoryNamePlaceholder'),
			cancel: this.t('dialog.cancel'),
			confirm: this.t('dialog.confirm'),
			stockFilter: this.t('inventoryOverview.stockFilter'),
			stockAll: this.t('inventoryOverview.stockAll'),
			stockInStock: this.t('inventoryOverview.stockInStock'),
			stockDepleted: this.t('inventoryOverview.stockDepleted'),
			replenishmentFilter: this.t('inventoryOverview.replenishmentFilter'),
			replenishmentAll: this.t('inventoryOverview.replenishmentAll'),
			replenishmentNeedsReplenishment: this.t('inventoryOverview.replenishmentNeedsReplenishment'),
			replenishmentStocktakeRequired: this.t('inventoryOverview.replenishmentStocktakeRequired'),
			favoriteFilter: this.t('inventoryOverview.favoriteFilter'),
			favoriteAll: this.t('inventoryOverview.favoriteAll'),
			favoriteOnly: this.t('inventoryOverview.favoriteOnly'),
			modelFilter: this.t('inventoryOverview.modelFilter'),
			modelAll: this.t('inventoryOverview.modelAll'),
			modelAvailable: this.t('inventoryOverview.modelAvailable'),
			modelMissing: this.t('inventoryOverview.modelMissing'),
			modelFailed: this.t('inventoryOverview.modelFailed'),
			modelUnchecked: this.t('inventoryOverview.modelUnchecked'),
			sortLabel: this.t('inventoryOverview.sortLabel'),
			sortRelevance: this.t('inventoryOverview.sortRelevance'),
			sortName: this.t('inventoryOverview.sortName'),
			sortStock: this.t('inventoryOverview.sortStock'),
			sortUpdated: this.t('inventoryOverview.sortUpdated'),
			sortCategory: this.t('inventoryOverview.sortCategory'),
			clearFilters: this.t('inventoryOverview.clearFilters'),
			columnSettings: this.t('inventoryOverview.columnSettings'),
			columnPartIdentifier: this.t('inventoryOverview.columnPartIdentifier'),
			restoreDefaultColumns: this.t('inventoryOverview.restoreDefaultColumns'),
			exportReplenishment: this.t('inventoryOverview.exportReplenishment'),
			refresh: this.t('inventoryOverview.refresh'),
			itemsCount: this.t('inventoryOverview.itemsCount'),
			filteredCount: this.t('inventoryOverview.filteredCount'),
			selectedCount: this.t('inventoryOverview.selectedCount'),
			selectAllFiltered: this.t('inventoryOverview.selectAllFiltered'),
			clearSelection: this.t('inventoryOverview.clearSelection'),
			deleteSelected: this.t('inventoryOverview.deleteSelected'),
			confirmDeleteSelected: this.t('inventoryOverview.confirmDeleteSelected'),
			moveToCategory: this.t('inventoryOverview.moveToCategory'),
			primaryCategory: this.t('inventoryOverview.primaryCategory'),
			secondaryCategory: this.t('inventoryOverview.secondaryCategory'),
			noSecondaryCategory: this.t('inventoryOverview.noSecondaryCategory'),
			dragItem: this.t('inventoryOverview.dragItem'),
			dropItemToCategory: this.t('inventoryOverview.dropItemToCategory'),
			applyMove: this.t('inventoryOverview.applyMove'),
			selectAll: this.t('inventoryOverview.selectAll'),
			columnName: this.t('part.nameLabel'),
			columnNumber: this.t('inventoryOverview.columnNumber'),
			columnCategory: this.t('inventoryOverview.columnCategory'),
			columnQuantity: this.t('inventory.quantityLabel'),
			columnMinimumQuantity: this.t('inventoryOverview.columnMinimumQuantity'),
			columnReplenishment: this.t('inventoryOverview.columnReplenishment'),
			columnLocation: this.t('inventory.locationLabel'),
			structuredLocation: this.t('inventoryItem.structuredLocation'),
			locationCabinet: this.t('inventoryItem.locationCabinet'),
			locationBox: this.t('inventoryItem.locationBox'),
			locationRow: this.t('inventoryItem.locationRow'),
			locationColumn: this.t('inventoryItem.locationColumn'),
			datasheet: this.t('inventoryItem.datasheet'),
			columnModel: this.t('inventoryOverview.columnModel'),
			columnUpdatedAt: this.t('inventoryItem.updatedAt'),
			columnActions: this.t('inventoryOverview.columnActions'),
			lcscPartNumber: this.t('part.lcscLabel'),
			supplierId: this.t('inventoryItem.supplierId'),
			manufacturer: this.t('part.manufacturerLabel'),
			manufacturerPartNumber: this.t('part.manufacturerPartLabel'),
			package: this.t('part.packageLabel'),
			edaFootprint: this.t('edaModel.footprintLabel'),
			edaSymbol: this.t('edaModel.symbolLabel'),
			description: this.t('part.descriptionLabel'),
			precision: this.t('inventoryItem.precision'),
			exact: this.t('inventory.exact'),
			estimated: this.t('inventory.estimated'),
			depleted: this.t('inventory.depleted'),
			inStock: this.t('inventory.inStock'),
			stockState: this.t('inventoryItem.stockState'),
			favorite: this.t('inventoryItem.favorite'),
			favoriteYes: this.t('inventoryItem.favoriteYes'),
			favoriteNo: this.t('inventoryItem.favoriteNo'),
			replenishmentDepleted: this.t('inventoryItem.replenishment.depleted'),
			replenishmentLow: this.t('inventoryItem.replenishment.low'),
			replenishmentNeedsCount: this.t('inventoryItem.replenishment.needsCount'),
			replenishmentNotConfigured: this.t('inventoryItem.replenishment.notConfigured'),
			replenishmentPossiblyLow: this.t('inventoryItem.replenishment.possiblyLow'),
			replenishmentSufficient: this.t('inventoryItem.replenishment.sufficient'),
			note: this.t('inventory.noteLabel'),
			marketplace: this.t('marketplace.section'),
			marketplaceFromOrder: this.t('marketplace.fromOrder'),
			marketplaceUserConfirmed: this.t('marketplace.userConfirmed'),
			marketplaceUnconfirmed: this.t('marketplace.unconfirmed'),
			marketplaceNotLinked: this.t('marketplace.notLinked'),
			source: this.t('inventoryItem.source'),
			sourceManual: this.t('inventoryItem.source.manual'),
			sourceMarketplace: this.t('inventoryItem.source.marketplace'),
			sourceCatalog: this.t('inventoryItem.source.catalog'),
			sourceOrder: this.t('inventoryItem.source.order'),
			createdAt: this.t('inventoryItem.createdAt'),
			revision: this.t('inventoryItem.revision'),
			copyLcscPartNumber: this.t('inventoryOverview.copyLcscPartNumber'),
			copySucceeded: this.t('inventoryOverview.copySucceeded'),
			copyFailed: this.t('inventoryOverview.copyFailed'),
			save: this.t('inventoryItem.save'),
			nameRequired: this.t('inventoryItem.nameRequired'),
			lcscInvalid: this.t('part.lcscInvalid'),
			quantityRequired: this.t('inventoryItem.quantityRequired'),
			quantityInteger: this.t('inventoryItem.quantityInteger'),
			quantityNonNegative: this.t('inventoryItem.quantityNonNegative'),
			minimumQuantityPositive: this.t('inventoryItem.minimumQuantityPositive'),
			datasheetInvalid: this.t('inventoryItem.datasheetInvalid'),
			existing: this.t('inventoryItem.existing'),
			candidate: this.t('inventoryItem.candidate'),
			confirmMerge: this.t('inventoryItem.confirmMerge'),
			quantityUnknown: this.t('inventory.unknown'),
			quantityEstimated: this.t('inventoryOverview.quantityEstimated'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			viewItem: this.t('inventoryOverview.viewItem'),
			editItem: this.t('inventoryOverview.editItem'),
			deleteItem: this.t('inventoryOverview.deleteItem'),
			openMarketplace: this.t('marketplace.open'),
			openDatasheet: this.t('inventoryItem.openDatasheet'),
			retryModel: this.t('edaModel.retry'),
			copyCommon: this.t('inventory.copyCommon'),
			emptyResults: this.t('inventoryOverview.emptyResults'),
			pageSize: this.t('inventoryOverview.pageSize'),
			pageStatus: this.t('inventoryOverview.pageStatus'),
			firstPage: this.t('inventoryOverview.firstPage'),
			previousPage: this.t('inventoryOverview.previousPage'),
			nextPage: this.t('inventoryOverview.nextPage'),
			lastPage: this.t('inventoryOverview.lastPage'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
		};
	}
}

class EdaInventoryOverviewIFrameHost implements InventoryOverviewIFrameHost {
	public read(key: string): unknown {
		return eda.sys_Storage.getExtensionUserConfig(key);
	}

	public write(key: string, value: unknown): Promise<boolean> {
		return eda.sys_Storage.setExtensionUserConfig(key, value);
	}

	public remove(key: string): Promise<boolean> {
		return eda.sys_Storage.deleteExtensionUserConfig(key);
	}

	public open(options: IFrameOpenOptions): Promise<boolean> {
		if (typeof eda.sys_IFrame?.openIFrame !== 'function') {
			throw new InventoryOverviewPanelUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(
			INVENTORY_OVERVIEW_IFRAME_PATH,
			PANEL_WIDTH,
			PANEL_HEIGHT,
			INVENTORY_OVERVIEW_IFRAME_ID,
			{
				grayscaleMask: false,
				maximizeButton: true,
				minimizeButton: true,
				minimizeStyle: 'constricted',
				title: options.title,
				buttonCallbackFn: button => button === 'close'
					? options.onClose()
					: button === 'minimize' || button === 'maximize'
						? options.onWindowControl(button)
						: undefined,
			},
		);
	}

	public hide(): Promise<boolean> {
		if (typeof eda.sys_IFrame?.hideIFrame !== 'function') {
			return Promise.resolve(false);
		}
		return eda.sys_IFrame.hideIFrame(INVENTORY_OVERVIEW_IFRAME_ID);
	}

	public show(): Promise<boolean> {
		if (typeof eda.sys_IFrame?.showIFrame !== 'function') {
			return Promise.resolve(false);
		}
		return eda.sys_IFrame.showIFrame(INVENTORY_OVERVIEW_IFRAME_ID);
	}

	public close(): Promise<boolean> {
		return eda.sys_IFrame.closeIFrame(INVENTORY_OVERVIEW_IFRAME_ID);
	}

	public startPolling(id: string, intervalMs: number, callback: () => void): boolean {
		if (typeof eda.sys_Timer?.setIntervalTimer !== 'function') {
			return false;
		}
		return eda.sys_Timer.setIntervalTimer(id, intervalMs, callback);
	}

	public stopPolling(id: string): boolean {
		return eda.sys_Timer.clearIntervalTimer(id);
	}
}

function createRequestId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function errorName(error: unknown): string {
	if (error instanceof Error) {
		return error.name;
	}
	if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
		return error.name.slice(0, 80);
	}
	return typeof error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function bridgeRequestId(value: unknown): string | undefined {
	return value
		&& typeof value === 'object'
		&& 'requestId' in value
		&& typeof value.requestId === 'string'
		? value.requestId
		: undefined;
}
