import type { Translate } from '../eda/i18n-client';
import type {
	IFrameInventoryCreateRequest,
	IFrameInventoryCreateResponse,
	InventoryCreateLabels,
	InventoryCreateOperationType,
} from './iframe-inventory-create-protocol';
import type {
	InventoryCreateActionHandler,
	InventoryCreateActionOutcome,
	InventoryCreateDraft,
	InventoryCreateFormState,
	InventoryCreatePanel,
	InventoryCreatePanelAction,
	InventoryCreatePanelInput,
	InventoryCreatePanelOutcome,
} from './inventory-create-panel';
import type { DiagnosticTrace } from './native-diagnostics';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../../features/inventory/domain/inventory-item';
import {
	defaultInventoryCreateFormState,
	INVENTORY_CREATE_EVENT_KEY,
	INVENTORY_CREATE_IFRAME_ID,
	INVENTORY_CREATE_IFRAME_PATH,
	INVENTORY_CREATE_PROTOCOL_VERSION,
	INVENTORY_CREATE_REQUEST_KEY,
	INVENTORY_CREATE_RESPONSE_KEY,
	parseIFrameInventoryCreateEvent,
	parseIFrameInventoryCreateRequest,
	parseIFrameInventoryCreateResponse,
} from './iframe-inventory-create-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 1000;
const PANEL_HEIGHT = 780;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions {
	title: string;
	onClose: () => void;
}

export interface InventoryCreateIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

export class InventoryCreatePanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`Inventory create panel unavailable: ${status}`, options);
		this.name = 'InventoryCreatePanelUnavailableError';
	}
}

export class InventoryCreateValidationError extends TypeError {
	public constructor(public readonly code: InventoryCreateValidationCode) {
		super(`Invalid inventory create form: ${code}`);
		this.name = 'InventoryCreateValidationError';
	}
}

export type InventoryCreateValidationCode
	= | 'lcsc-invalid'
		| 'lcsc-required'
		| 'name-required'
		| 'quantity-integer'
		| 'quantity-negative'
		| 'quantity-required'
		| 'quantity-too-large';

type PanelResult
	= InventoryCreatePanelOutcome
		| { status: 'failed'; error: unknown; ready: boolean };

export class IFrameInventoryCreatePanel implements InventoryCreatePanel {
	private queue: Promise<void> = Promise.resolve();

	public constructor(
		private readonly t: Translate,
		private readonly host: InventoryCreateIFrameHost = new EdaInventoryCreateIFrameHost(),
	) {}

	public open(
		input: InventoryCreatePanelInput,
		handleAction: InventoryCreateActionHandler,
		trace?: DiagnosticTrace,
	): Promise<InventoryCreatePanelOutcome> {
		return this.enqueue(() => this.openExclusive(createInventoryCreateRequest(createRequestId(), this.labels(), input), handleAction, trace));
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async openExclusive(
		request: IFrameInventoryCreateRequest,
		handleAction: InventoryCreateActionHandler,
		trace?: DiagnosticTrace,
	): Promise<InventoryCreatePanelOutcome> {
		const timerId = `${INVENTORY_CREATE_IFRAME_ID}.${request.requestId}`;
		const processedOperationIds = new Set<string>();
		const pendingTerminalActions = new Map<string, Extract<InventoryCreatePanelAction, { type: 'confirm-merge' | 'save' }>>();
		let opened = false;
		let pollStarted = false;
		let ready = false;
		let settled = false;
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
			operationId: string,
			actionType: InventoryCreateOperationType,
			form: InventoryCreateFormState,
			duplicateToken?: string,
			modelToken?: string,
			existing?: { id: string; expectedRevision: number },
		): Promise<void> => {
			let action: InventoryCreatePanelAction;
			try {
				action = createPanelAction(operationId, actionType, form, request.mode, duplicateToken, modelToken, existing);
			}
			catch (error) {
				await this.writeResponse(request.requestId, operationId, actionType, {
					stage: 'failed',
					message: validationMessage(error, request.labels),
				}, trace);
				return;
			}
			trace?.info('inventory-create-panel.action.started', { action: action.type });
			let outcome: InventoryCreateActionOutcome;
			try {
				outcome = await handleAction(action);
			}
			catch (error) {
				trace?.error('inventory-create-panel.action.failed', { action: action.type, errorName: errorName(error) });
				outcome = { stage: 'failed', message: request.labels.operationError };
			}
			if (settled) {
				return;
			}
			const written = await this.writeResponse(request.requestId, operationId, actionType, outcome, trace);
			trace?.info('inventory-create-panel.action.completed', { action: action.type, stage: outcome.stage });
			if (!written || outcome.stage !== 'succeeded' || (action.type !== 'save' && action.type !== 'confirm-merge')) {
				return;
			}
			pendingTerminalActions.set(operationId, action);
		};
		const readEvent = (): void => {
			try {
				const event = parseIFrameInventoryCreateEvent(this.host.read(INVENTORY_CREATE_EVENT_KEY), request.requestId);
				if (!event) {
					return;
				}
				if (event.status === 'ready') {
					if (!ready) {
						ready = true;
						trace?.info('inventory-create-panel.iframe.ready', { mode: request.mode });
					}
					return;
				}
				if (event.status === 'progress') {
					trace?.info('inventory-create-panel.iframe.stage', { mode: request.mode, stage: event.stage });
					return;
				}
				if (event.status === 'failed') {
					resolveResult({ status: 'failed', error: new Error('The inventory create IFrame failed.'), ready });
					return;
				}
				if (event.status === 'completed') {
					const action = pendingTerminalActions.get(event.operationId);
					if (action?.type === event.action) {
						pendingTerminalActions.delete(event.operationId);
						resolveResult({ status: 'saved', draft: action.draft, merged: action.type === 'confirm-merge' });
					}
					return;
				}
				if (processedOperationIds.has(event.operationId)) {
					return;
				}
				processedOperationIds.add(event.operationId);
				if (event.status === 'cancelled') {
					resolveResult({ status: 'cancelled' });
					return;
				}
				void processAction(event.operationId, event.action, event.form, event.duplicateToken, event.modelToken, event.existing);
			}
			catch (error) {
				resolveResult({ status: 'failed', error, ready });
			}
		};
		const poll = (): void => {
			readEvent();
			if (!settled && !ready && readyDeadline !== undefined && Date.now() >= readyDeadline) {
				resolveResult({ status: 'failed', error: new Error('The inventory create IFrame did not become ready.'), ready: false });
			}
		};

		try {
			await Promise.all([
				this.removeBridgeValue(INVENTORY_CREATE_EVENT_KEY, trace),
				this.removeBridgeValue(INVENTORY_CREATE_RESPONSE_KEY, trace),
			]);
			if (!await this.host.write(INVENTORY_CREATE_REQUEST_KEY, request)) {
				throw new InventoryCreatePanelUnavailableError('init-failed');
			}
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted) {
				throw new InventoryCreatePanelUnavailableError('api-missing');
			}
			trace?.info('inventory-create-panel.iframe.open.request', {
				categoryCount: request.categories.length,
				height: PANEL_HEIGHT,
				locationCount: request.locationOptions.length,
				mode: request.mode,
				path: INVENTORY_CREATE_IFRAME_PATH,
				width: PANEL_WIDTH,
			});
			opened = await this.host.open({
				title: request.mode === 'lcsc' ? request.labels.titleLcsc : request.labels.titleCustom,
				onClose: () => {
					readEvent();
					resolveResult({ status: 'cancelled' });
				},
			});
			if (!opened) {
				throw new InventoryCreatePanelUnavailableError('init-failed');
			}
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			poll();
			const result = await resultPromise;
			if (result.status === 'failed') {
				if (result.ready) {
					throw result.error;
				}
				throw new InventoryCreatePanelUnavailableError('render-failed', { cause: result.error });
			}
			return result;
		}
		catch (error) {
			if (error instanceof InventoryCreatePanelUnavailableError || ready) {
				throw error;
			}
			throw new InventoryCreatePanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			if (pollStarted) {
				this.host.stopPolling(timerId);
			}
			await Promise.all([
				this.removeBridgeValue(INVENTORY_CREATE_REQUEST_KEY, trace),
				this.removeBridgeValue(INVENTORY_CREATE_EVENT_KEY, trace),
				this.removeBridgeValue(INVENTORY_CREATE_RESPONSE_KEY, trace),
			]);
			if (opened) {
				try {
					await this.host.close();
				}
				catch (error) {
					trace?.warn('inventory-create-panel.iframe.close.failed', { errorName: errorName(error) });
				}
			}
			await delay(DIALOG_SETTLE_DELAY_MS);
		}
	}

	private async writeResponse(
		requestId: string,
		operationId: string,
		action: InventoryCreateOperationType,
		outcome: InventoryCreateActionOutcome,
		trace?: DiagnosticTrace,
	): Promise<boolean> {
		const candidate: IFrameInventoryCreateResponse = {
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId,
			operationId,
			action,
			...outcome,
		};
		const response = parseIFrameInventoryCreateResponse(candidate, requestId, operationId);
		if (!response) {
			trace?.error('inventory-create-panel.response.invalid', { action, stage: outcome.stage });
			return this.host.write(INVENTORY_CREATE_RESPONSE_KEY, {
				protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
				requestId,
				operationId,
				action,
				stage: 'failed',
				message: this.t('inventoryCreate.operationError'),
			} satisfies IFrameInventoryCreateResponse);
		}
		return this.host.write(INVENTORY_CREATE_RESPONSE_KEY, response);
	}

	private async removeBridgeValue(key: string, trace?: DiagnosticTrace): Promise<void> {
		try {
			await this.host.remove(key);
		}
		catch (error) {
			trace?.warn('inventory-create-panel.iframe.cleanup.failed', { errorName: errorName(error) });
		}
	}

	private labels(): InventoryCreateLabels {
		return {
			titleCustom: this.t('inventoryCreate.titleCustom'),
			titleLcsc: this.t('inventoryCreate.titleLcsc'),
			identitySection: this.t('inventoryCreate.identitySection'),
			stockSection: this.t('inventoryCreate.stockSection'),
			lcscPartNumber: this.t('part.lcscLabel'),
			supplierId: this.t('inventoryItem.supplierId'),
			name: this.t('part.nameLabel'),
			manufacturer: this.t('part.manufacturerLabel'),
			manufacturerPartNumber: this.t('part.manufacturerPartLabel'),
			package: this.t('part.packageLabel'),
			description: this.t('part.descriptionLabel'),
			quantityMode: this.t('inventoryCreate.quantityMode'),
			quantity: this.t('inventory.quantityLabel'),
			exact: this.t('inventory.exact'),
			estimated: this.t('inventory.estimated'),
			unknown: this.t('inventory.unknown'),
			depleted: this.t('inventory.depleted'),
			primaryCategory: this.t('inventoryCreate.primaryCategory'),
			secondaryCategory: this.t('inventoryCreate.secondaryCategory'),
			unclassified: this.t('inventoryOverview.unclassified'),
			noSecondaryCategory: this.t('inventoryCreate.noSecondaryCategory'),
			location: this.t('inventory.locationLabel'),
			chooseLocation: this.t('inventoryItem.chooseLocation'),
			note: this.t('inventory.noteLabel'),
			queryEda: this.t('inventoryCreate.queryEda'),
			openMarketplace: this.t('marketplace.open'),
			marketplaceConfirmed: this.t('inventoryCreate.marketplaceConfirmed'),
			queryIdle: this.t('inventoryCreate.queryIdle'),
			queryRunning: this.t('inventoryCreate.queryRunning'),
			queryAvailable: this.t('inventoryCreate.queryAvailable'),
			queryMissing: this.t('inventoryCreate.queryMissing'),
			queryFailed: this.t('inventoryCreate.queryFailed'),
			suggestionTitle: this.t('inventoryItem.suggestionTitle'),
			currentValue: this.t('inventoryCreate.currentValue'),
			suggestedValue: this.t('inventoryCreate.suggestedValue'),
			useSuggestion: this.t('inventoryItem.useSuggestion'),
			closeSuggestion: this.t('inventoryCreate.closeSuggestion'),
			duplicateTitle: this.t('inventoryCreate.duplicateTitle'),
			existingItem: this.t('inventoryItem.existing'),
			pendingItem: this.t('inventoryItem.candidate'),
			confirmMerge: this.t('inventoryItem.confirmMerge'),
			continueEditing: this.t('inventoryCreate.continueEditing'),
			cancel: this.t('dialog.cancel'),
			save: this.t('inventoryCreate.save'),
			nameRequired: this.t('inventoryItem.nameRequired'),
			lcscRequired: this.t('inventoryCreate.lcscRequired'),
			lcscInvalid: this.t('part.lcscInvalid'),
			quantityRequired: this.t('inventoryItem.quantityRequired'),
			quantityInteger: this.t('inventoryItem.quantityInteger'),
			quantityNonNegative: this.t('inventoryItem.quantityNonNegative'),
			quantityTooLarge: this.t('inventoryCreate.quantityTooLarge'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
			operationError: this.t('inventoryCreate.operationError'),
			emptyValue: this.t('inventoryItem.emptyValue'),
		};
	}
}

export function createInventoryCreateRequest(
	requestId: string,
	labels: InventoryCreateLabels,
	input: InventoryCreatePanelInput,
): IFrameInventoryCreateRequest {
	const candidate: IFrameInventoryCreateRequest = {
		protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
		requestId,
		mode: input.mode,
		labels: { ...labels },
		initial: defaultInventoryCreateFormState(input.initial),
		categories: normalizeCategories(input.categories),
		locationOptions: normalizeLocationOptions(input.locationOptions),
	};
	const request = parseIFrameInventoryCreateRequest(candidate);
	if (!request) {
		throw new TypeError('Invalid inventory create panel request.');
	}
	return request;
}

export function normalizeInventoryCreateForm(value: InventoryCreateFormState): InventoryCreateFormState {
	return {
		lcscPartNumber: normalizeLcscPartNumber(value.lcscPartNumber) ?? '',
		marketplaceConfirmed: value.marketplaceConfirmed,
		supplierId: normalizeInventoryText(value.supplierId),
		name: normalizeInventoryText(value.name),
		manufacturer: normalizeInventoryText(value.manufacturer),
		manufacturerPartNumber: normalizeInventoryText(value.manufacturerPartNumber),
		package: normalizeInventoryText(value.package),
		description: normalizeInventoryText(value.description),
		quantityMode: value.quantityMode,
		quantity: value.quantity.trim(),
		categoryId: normalizeInventoryText(value.categoryId),
		location: normalizeInventoryText(value.location),
		note: normalizeInventoryText(value.note),
	};
}

export function normalizeInventoryCreateDraft(
	value: InventoryCreateFormState,
	mode: InventoryCreatePanelInput['mode'],
): InventoryCreateDraft {
	const form = normalizeInventoryCreateForm(value);
	if (mode === 'lcsc' && !form.lcscPartNumber) {
		throw new InventoryCreateValidationError('lcsc-required');
	}
	if (form.lcscPartNumber && !/^C\d+$/.test(form.lcscPartNumber)) {
		throw new InventoryCreateValidationError('lcsc-invalid');
	}
	if (!form.name) {
		throw new InventoryCreateValidationError('name-required');
	}
	const quantity = normalizeQuantity(form);
	const depleted = form.quantityMode === 'depleted' || quantity === 0;
	return {
		identity: {
			name: form.name,
			lcscPartNumber: form.lcscPartNumber || undefined,
			supplierId: form.supplierId || undefined,
			manufacturer: form.manufacturer || undefined,
			manufacturerPartNumber: form.manufacturerPartNumber || undefined,
			package: form.package || undefined,
			description: form.description || undefined,
		},
		quantity: depleted ? 0 : quantity,
		precision: depleted
			? 'exact'
			: form.quantityMode === 'estimated'
				? 'estimated'
				: form.quantityMode === 'unknown' ? 'unknown' : 'exact',
		state: depleted ? 'depleted' : 'in-stock',
		categoryId: form.categoryId || undefined,
		location: form.location || undefined,
		note: form.note || undefined,
	};
}

function createPanelAction(
	operationId: string,
	type: InventoryCreateOperationType,
	value: InventoryCreateFormState,
	mode: InventoryCreatePanelInput['mode'],
	duplicateToken?: string,
	modelToken?: string,
	existing?: { id: string; expectedRevision: number },
): InventoryCreatePanelAction {
	const form = normalizeInventoryCreateForm(value);
	if (type === 'query-eda') {
		if (!form.lcscPartNumber || !/^C\d+$/.test(form.lcscPartNumber)) {
			throw new InventoryCreateValidationError('lcsc-invalid');
		}
		return { type, operationId, form, lcscPartNumber: form.lcscPartNumber };
	}
	if (type === 'open-marketplace') {
		return { type, operationId, form, lcscPartNumber: form.lcscPartNumber || undefined };
	}
	const draft = normalizeInventoryCreateDraft(form, mode);
	if (type === 'confirm-merge') {
		if (!existing || !duplicateToken) {
			throw new TypeError('The duplicate revision reference is required.');
		}
		return { type, operationId, form, draft, duplicateToken, modelToken, existing };
	}
	return { type, operationId, form, draft, modelToken };
}

function normalizeQuantity(form: InventoryCreateFormState): number | null {
	if (form.quantityMode === 'unknown') {
		return null;
	}
	if (form.quantityMode === 'depleted') {
		return 0;
	}
	if (!form.quantity) {
		throw new InventoryCreateValidationError('quantity-required');
	}
	if (form.quantity.startsWith('-')) {
		throw new InventoryCreateValidationError('quantity-negative');
	}
	if (!/^\d+$/.test(form.quantity)) {
		throw new InventoryCreateValidationError('quantity-integer');
	}
	const quantity = Number(form.quantity);
	if (!Number.isSafeInteger(quantity)) {
		throw new InventoryCreateValidationError('quantity-too-large');
	}
	return quantity;
}

function normalizeCategories(values: InventoryCreatePanelInput['categories']) {
	const normalized = values?.map(category => ({
		...category,
		name: normalizeInventoryText(category.name),
	})).filter(category => category.name) ?? [];
	return normalized.slice(0, 2000);
}

function normalizeLocationOptions(values: InventoryCreatePanelInput['locationOptions']): string[] {
	const normalized = values?.map(value => normalizeInventoryText(value)).filter(Boolean) ?? [];
	return [...new Set(normalized)].slice(0, 200);
}

function validationMessage(error: unknown, labels: InventoryCreateLabels): string {
	if (!(error instanceof InventoryCreateValidationError)) {
		return labels.operationError;
	}
	const messages: Record<InventoryCreateValidationCode, string> = {
		'lcsc-invalid': labels.lcscInvalid,
		'lcsc-required': labels.lcscRequired,
		'name-required': labels.nameRequired,
		'quantity-integer': labels.quantityInteger,
		'quantity-negative': labels.quantityNonNegative,
		'quantity-required': labels.quantityRequired,
		'quantity-too-large': labels.quantityTooLarge,
	};
	return messages[error.code];
}

class EdaInventoryCreateIFrameHost implements InventoryCreateIFrameHost {
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
			throw new InventoryCreatePanelUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(
			INVENTORY_CREATE_IFRAME_PATH,
			PANEL_WIDTH,
			PANEL_HEIGHT,
			INVENTORY_CREATE_IFRAME_ID,
			{
				grayscaleMask: true,
				maximizeButton: true,
				title: options.title,
				buttonCallbackFn: button => button === 'close' ? options.onClose() : undefined,
			},
		);
	}

	public close(): Promise<boolean> {
		return eda.sys_IFrame.closeIFrame(INVENTORY_CREATE_IFRAME_ID);
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
	return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}
