import type { InventoryItem } from '../../../features/inventory/domain/inventory-item';
import type { Translate } from '../eda/i18n-client';
import type {
	IFrameInventoryItemRequest,
	InventoryItemEditFormState,
	InventoryItemPanelLabels,
	InventoryItemPanelMode,
} from './iframe-inventory-item-protocol';
import type { InventoryItemEditDraft, InventoryItemEditOptions, InventoryItemPanel } from './inventory-item-panel';
import type { DiagnosticTrace } from './native-diagnostics';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../../features/inventory/domain/inventory-item';
import {
	createInventoryItemSnapshot,
	createInventoryItemSuggestion,
	INVENTORY_ITEM_IFRAME_ID,
	INVENTORY_ITEM_IFRAME_PATH,
	INVENTORY_ITEM_PROTOCOL_VERSION,
	INVENTORY_ITEM_REQUEST_KEY,
	INVENTORY_ITEM_RESULT_KEY,
	parseIFrameInventoryItemResult,
} from './iframe-inventory-item-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 900;
const PANEL_HEIGHT = 720;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions {
	title: string;
	onClose: () => void;
}

export interface InventoryItemIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

export class InventoryItemPanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`Inventory item panel unavailable: ${status}`, options);
		this.name = 'InventoryItemPanelUnavailableError';
	}
}

type PanelOutcome
	= | { status: 'cancelled' | 'confirmed' | 'edit' }
		| { status: 'submitted'; value: InventoryItemEditFormState }
		| { status: 'failed'; error: unknown; ready: boolean };

export class IFrameInventoryItemPanel implements InventoryItemPanel {
	private queue: Promise<void> = Promise.resolve();

	public constructor(
		private readonly t: Translate,
		private readonly host: InventoryItemIFrameHost = new EdaInventoryItemIFrameHost(),
	) {}

	public view(item: InventoryItem, trace?: DiagnosticTrace): Promise<'edit' | undefined> {
		return this.enqueue(async () => {
			const requestId = createRequestId();
			const outcome = await this.openExclusive({
				protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
				requestId,
				mode: 'view',
				labels: this.labels(),
				item: this.snapshot(item),
			}, trace);
			return outcome.status === 'edit' ? 'edit' : undefined;
		});
	}

	public edit(item: InventoryItem, options?: InventoryItemEditOptions, trace?: DiagnosticTrace): Promise<InventoryItemEditDraft | undefined> {
		return this.enqueue(async () => {
			const requestId = createRequestId();
			const initial = createEditFormState(item, options?.initial);
			const outcome = await this.openExclusive({
				protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
				requestId,
				mode: 'edit',
				labels: this.labels(),
				item: this.snapshot(item),
				initial,
				locationOptions: normalizeLocationOptions(options?.locationOptions),
				suggestion: createInventoryItemSuggestion(options?.suggestion),
			}, trace);
			if (outcome.status !== 'submitted') {
				return undefined;
			}
			const draft = normalizeEditDraft(outcome.value);
			trace?.info('inventory-item-panel.submitted', {
				changedFields: countChangedFields(initial, outcome.value),
				mode: 'edit',
				status: 'submitted',
			});
			return draft;
		});
	}

	public compare(existing: InventoryItem, candidate: InventoryItem, trace?: DiagnosticTrace): Promise<boolean> {
		return this.enqueue(async () => {
			const requestId = createRequestId();
			const outcome = await this.openExclusive({
				protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
				requestId,
				mode: 'compare',
				labels: this.labels(),
				existing: this.snapshot(existing),
				candidate: this.snapshot(candidate),
			}, trace);
			const confirmed = outcome.status === 'confirmed';
			trace?.info('inventory-item-panel.compare.result', {
				mode: 'compare',
				status: confirmed ? 'confirmed' : 'cancelled',
			});
			return confirmed;
		});
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async openExclusive(request: IFrameInventoryItemRequest, trace?: DiagnosticTrace): Promise<PanelOutcome> {
		const timerId = `${INVENTORY_ITEM_IFRAME_ID}.${request.requestId}`;
		let opened = false;
		let pollStarted = false;
		let ready = false;
		let settled = false;
		let readyDeadline: number | undefined;
		const observedStages = new Set<string>();
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
		const readResult = (): void => {
			try {
				const result = parseIFrameInventoryItemResult(
					this.host.read(INVENTORY_ITEM_RESULT_KEY),
					request.requestId,
					request.mode,
				);
				if (!result) {
					return;
				}
				if (result.status === 'progress') {
					if (!observedStages.has(result.stage)) {
						observedStages.add(result.stage);
						trace?.info('inventory-item-panel.iframe.stage', { mode: request.mode, stage: result.stage });
					}
					return;
				}
				if (result.status === 'ready') {
					if (!ready) {
						ready = true;
						trace?.info('inventory-item-panel.iframe.ready', { mode: request.mode });
					}
					return;
				}
				if (result.status === 'failed') {
					trace?.error('inventory-item-panel.iframe.failed', {
						errorName: result.errorName,
						mode: request.mode,
						stage: result.stage,
					});
					resolveOutcome({ status: 'failed', error: new Error('The inventory item IFrame failed.'), ready });
					return;
				}
				resolveOutcome(result);
			}
			catch (error) {
				resolveOutcome({ status: 'failed', error, ready });
			}
		};
		const poll = (): void => {
			readResult();
			if (!settled && !ready && readyDeadline !== undefined && Date.now() >= readyDeadline) {
				resolveOutcome({ status: 'failed', error: new Error('The inventory item IFrame did not become ready.'), ready: false });
			}
		};

		try {
			await this.removeBridgeValue(INVENTORY_ITEM_RESULT_KEY, trace);
			if (!await this.host.write(INVENTORY_ITEM_REQUEST_KEY, request)) {
				throw new InventoryItemPanelUnavailableError('init-failed');
			}
			trace?.info('inventory-item-panel.iframe.request.stored', { mode: request.mode });
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted) {
				throw new InventoryItemPanelUnavailableError('api-missing');
			}
			trace?.info('inventory-item-panel.iframe.open.request', {
				height: PANEL_HEIGHT,
				iframeId: INVENTORY_ITEM_IFRAME_ID,
				mode: request.mode,
				path: INVENTORY_ITEM_IFRAME_PATH,
				width: PANEL_WIDTH,
			});
			opened = await this.host.open({
				title: panelTitle(request.mode, request.labels),
				onClose: () => {
					readResult();
					resolveOutcome({ status: 'cancelled' });
				},
			});
			if (!opened) {
				throw new InventoryItemPanelUnavailableError('init-failed');
			}
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			trace?.info('inventory-item-panel.iframe.opened', { mode: request.mode });
			poll();

			const outcome = await outcomePromise;
			trace?.info('inventory-item-panel.iframe.response', { mode: request.mode, status: outcome.status });
			if (outcome.status === 'failed') {
				if (outcome.ready) {
					throw outcome.error;
				}
				throw new InventoryItemPanelUnavailableError('render-failed', { cause: outcome.error });
			}
			return outcome;
		}
		catch (error) {
			if (error instanceof InventoryItemPanelUnavailableError || ready) {
				throw error;
			}
			throw new InventoryItemPanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			if (pollStarted) {
				this.host.stopPolling(timerId);
			}
			await this.removeBridgeValue(INVENTORY_ITEM_REQUEST_KEY, trace);
			await this.removeBridgeValue(INVENTORY_ITEM_RESULT_KEY, trace);
			if (opened) {
				try {
					const closed = await this.host.close();
					trace?.info('inventory-item-panel.iframe.closed', {
						mode: request.mode,
						status: closed ? 'closed' : 'already-closed',
					});
				}
				catch (error) {
					trace?.warn('inventory-item-panel.iframe.close.failed', {
						errorName: errorName(error),
						mode: request.mode,
					});
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
			trace?.warn('inventory-item-panel.iframe.cleanup.failed', { errorName: errorName(error) });
		}
	}

	private labels(): InventoryItemPanelLabels {
		return {
			viewTitle: this.t('inventoryItem.viewTitle'),
			editTitle: this.t('inventoryItem.editTitle'),
			compareTitle: this.t('inventoryItem.compareTitle'),
			lcscPartNumber: this.t('part.lcscLabel'),
			supplierId: this.t('inventoryItem.supplierId'),
			name: this.t('part.nameLabel'),
			manufacturer: this.t('part.manufacturerLabel'),
			manufacturerPartNumber: this.t('part.manufacturerPartLabel'),
			package: this.t('part.packageLabel'),
			description: this.t('part.descriptionLabel'),
			quantity: this.t('inventory.quantityLabel'),
			precision: this.t('inventoryItem.precision'),
			exact: this.t('inventory.exact'),
			estimated: this.t('inventory.estimated'),
			unknown: this.t('inventory.unknown'),
			stockState: this.t('inventoryItem.stockState'),
			depleted: this.t('inventory.depleted'),
			inStock: this.t('inventory.inStock'),
			location: this.t('inventory.locationLabel'),
			chooseLocation: this.t('inventoryItem.chooseLocation'),
			note: this.t('inventory.noteLabel'),
			marketplace: this.t('marketplace.section'),
			edaModel: this.t('edaModel.section'),
			edaSymbol: this.t('edaModel.symbolLabel'),
			edaFootprint: this.t('edaModel.footprintLabel'),
			source: this.t('inventoryItem.source'),
			createdAt: this.t('inventoryItem.createdAt'),
			updatedAt: this.t('inventoryItem.updatedAt'),
			revision: this.t('inventoryItem.revision'),
			close: this.t('inventoryItem.close'),
			fullEdit: this.t('inventoryItem.fullEdit'),
			cancel: this.t('dialog.cancel'),
			save: this.t('inventoryItem.save'),
			confirmMerge: this.t('inventoryItem.confirmMerge'),
			existing: this.t('inventoryItem.existing'),
			candidate: this.t('inventoryItem.candidate'),
			suggestionTitle: this.t('inventoryItem.suggestionTitle'),
			useSuggestion: this.t('inventoryItem.useSuggestion'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			nameRequired: this.t('inventoryItem.nameRequired'),
			lcscInvalid: this.t('part.lcscInvalid'),
			quantityRequired: this.t('inventoryItem.quantityRequired'),
			quantityInteger: this.t('inventoryItem.quantityInteger'),
			quantityNonNegative: this.t('inventoryItem.quantityNonNegative'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
			saveError: this.t('productForm.saveError'),
		};
	}

	private snapshot(item: InventoryItem): ReturnType<typeof createInventoryItemSnapshot> {
		return {
			...createInventoryItemSnapshot(item),
			marketplaceStatus: this.marketplaceStatus(item),
			edaModelStatus: this.t(`edaModel.${item.edaModelStatus}`),
			source: this.t(`inventoryItem.source.${item.source}`),
			createdAt: formatTimestamp(item.createdAt),
			updatedAt: formatTimestamp(item.updatedAt),
		};
	}

	private marketplaceStatus(item: InventoryItem): string {
		if (!item.marketplaceReference) {
			return this.t(item.identity.lcscPartNumber ? 'marketplace.unconfirmed' : 'marketplace.notLinked');
		}
		return this.t(item.marketplaceReference.evidence === 'order-import' ? 'marketplace.fromOrder' : 'marketplace.userConfirmed');
	}
}

class EdaInventoryItemIFrameHost implements InventoryItemIFrameHost {
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
			throw new InventoryItemPanelUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(
			INVENTORY_ITEM_IFRAME_PATH,
			PANEL_WIDTH,
			PANEL_HEIGHT,
			INVENTORY_ITEM_IFRAME_ID,
			{
				grayscaleMask: true,
				title: options.title,
				buttonCallbackFn: button => button === 'close' ? options.onClose() : undefined,
			},
		);
	}

	public close(): Promise<boolean> {
		return eda.sys_IFrame.closeIFrame(INVENTORY_ITEM_IFRAME_ID);
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

function createEditFormState(item: InventoryItem, initial?: InventoryItemEditDraft): InventoryItemEditFormState {
	if (initial) {
		return {
			...initial.identity,
			quantity: String(initial.quantity),
			precision: initial.quantity === 0 ? 'exact' : initial.precision,
			depleted: initial.quantity === 0,
			location: initial.location,
			note: initial.note,
		};
	}
	const quantity = item.quantity === null
		? item.state === 'depleted' ? '0' : ''
		: String(item.quantity);
	return {
		lcscPartNumber: item.identity.lcscPartNumber ?? '',
		supplierId: item.identity.supplierId ?? '',
		name: item.identity.name,
		manufacturer: item.identity.manufacturer ?? '',
		manufacturerPartNumber: item.identity.manufacturerPartNumber ?? '',
		package: item.identity.package ?? '',
		description: item.identity.description ?? '',
		quantity,
		precision: item.quantity === 0 ? 'exact' : item.precision === 'estimated' ? 'estimated' : 'exact',
		depleted: item.quantity === 0 || item.state === 'depleted',
		location: item.location ?? '',
		note: item.note ?? '',
	};
}

function normalizeEditDraft(value: InventoryItemEditFormState): InventoryItemEditDraft {
	const name = normalizeInventoryText(value.name);
	if (!name) {
		throw new TypeError('Component name is required.');
	}
	const quantityText = value.quantity.trim();
	if (!/^\d+$/.test(quantityText)) {
		throw new TypeError('Quantity must be a non-negative integer.');
	}
	const quantity = Number(quantityText);
	if (!Number.isSafeInteger(quantity)) {
		throw new TypeError('Quantity must be a safe integer.');
	}
	const depleted = value.depleted || quantity === 0;
	return {
		identity: {
			name,
			lcscPartNumber: normalizeLcscPartNumber(value.lcscPartNumber) ?? '',
			supplierId: normalizeInventoryText(value.supplierId),
			manufacturer: normalizeInventoryText(value.manufacturer),
			manufacturerPartNumber: normalizeInventoryText(value.manufacturerPartNumber),
			package: normalizeInventoryText(value.package),
			description: normalizeInventoryText(value.description),
		},
		quantity: depleted ? 0 : quantity,
		precision: depleted ? 'exact' : value.precision,
		location: normalizeInventoryText(value.location),
		note: normalizeInventoryText(value.note),
	};
}

function countChangedFields(initial: InventoryItemEditFormState, current: InventoryItemEditFormState): number {
	return (Object.keys(initial) as Array<keyof InventoryItemEditFormState>)
		.filter(key => initial[key] !== current[key])
		.length;
}

function normalizeLocationOptions(values: readonly string[] | undefined): string[] {
	const normalized = values
		?.map(value => normalizeInventoryText(value))
		.filter(Boolean) ?? [];
	return [...new Set(normalized)].slice(0, 200);
}

function panelTitle(mode: InventoryItemPanelMode, labels: InventoryItemPanelLabels): string {
	return mode === 'view' ? labels.viewTitle : mode === 'edit' ? labels.editTitle : labels.compareTitle;
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

function formatTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}
	const datePart = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
		.map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
		.join('-');
	const timePart = [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map(part => String(part).padStart(2, '0'))
		.join(':');
	return `${datePart} ${timePart}`;
}
