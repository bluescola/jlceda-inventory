import type { StructuredInventoryLocation } from '../../../features/inventory/domain/inventory-metadata';
import type {
	InventoryCreateCategory,
	InventoryCreateDuplicateSnapshot,
	InventoryCreateFormState,
	InventoryCreateIdentitySuggestion,
	InventoryCreateMode,
	InventoryCreateModelSummary,
	InventoryCreateQuantityMode,
} from './inventory-create-panel';

export const INVENTORY_CREATE_IFRAME_ID = 'jlceda-inventory-create-panel';
export const INVENTORY_CREATE_IFRAME_PATH = '/iframe/inventory-create.html';
export const INVENTORY_CREATE_REQUEST_KEY = 'inventory-create-panel.v1.request';
export const INVENTORY_CREATE_EVENT_KEY = 'inventory-create-panel.v1.event';
export const INVENTORY_CREATE_RESPONSE_KEY = 'inventory-create-panel.v1.response';
export const INVENTORY_CREATE_PROTOCOL_VERSION = 1;

export type InventoryCreatePanelStage = 'panel-rendered' | 'request-read' | 'script-started';
export type InventoryCreateOperationType = 'confirm-merge' | 'open-marketplace' | 'query-eda' | 'save';
export type InventoryCreateResponseStage = 'cancelled' | 'duplicate' | 'failed' | 'not-found' | 'succeeded';

const LABEL_KEYS = [
	'titleCustom',
	'titleLcsc',
	'identitySection',
	'stockSection',
	'lcscPartNumber',
	'supplierId',
	'name',
	'manufacturer',
	'manufacturerPartNumber',
	'package',
	'description',
	'quantityMode',
	'quantity',
	'minimumQuantity',
	'favorite',
	'exact',
	'estimated',
	'unknown',
	'depleted',
	'primaryCategory',
	'secondaryCategory',
	'unclassified',
	'noSecondaryCategory',
	'location',
	'chooseLocation',
	'datasheet',
	'structuredLocation',
	'locationCabinet',
	'locationBox',
	'locationRow',
	'locationColumn',
	'note',
	'queryEda',
	'openMarketplace',
	'marketplaceConfirmed',
	'queryIdle',
	'queryRunning',
	'queryAvailable',
	'queryMissing',
	'queryFailed',
	'suggestionTitle',
	'currentValue',
	'suggestedValue',
	'useSuggestion',
	'closeSuggestion',
	'duplicateTitle',
	'existingItem',
	'pendingItem',
	'confirmMerge',
	'continueEditing',
	'cancel',
	'save',
	'nameRequired',
	'lcscRequired',
	'lcscInvalid',
	'quantityRequired',
	'quantityInteger',
	'quantityNonNegative',
	'quantityTooLarge',
	'minimumQuantityPositive',
	'datasheetInvalid',
	'loading',
	'connectionError',
	'operationError',
	'emptyValue',
] as const;

export type InventoryCreateLabelKey = typeof LABEL_KEYS[number];
export type InventoryCreateLabels = Record<InventoryCreateLabelKey, string>;

export interface IFrameInventoryCreateRequest {
	protocolVersion: 1;
	requestId: string;
	mode: InventoryCreateMode;
	labels: InventoryCreateLabels;
	initial: InventoryCreateFormState;
	categories: InventoryCreateCategory[];
	locationOptions: string[];
}

interface IFrameInventoryCreateEventBase {
	protocolVersion: 1;
	requestId: string;
}

export type IFrameInventoryCreateEvent
	= | IFrameInventoryCreateEventBase & { status: 'ready' }
		| IFrameInventoryCreateEventBase & { status: 'progress'; stage: InventoryCreatePanelStage }
		| IFrameInventoryCreateEventBase & {
			status: 'failed';
			stage: InventoryCreatePanelStage;
			errorName: string;
			error: string;
		}
		| IFrameInventoryCreateEventBase & { status: 'cancelled'; operationId: string }
		| IFrameInventoryCreateEventBase & {
			status: 'completed';
			operationId: string;
			action: 'confirm-merge' | 'save';
		}
		| IFrameInventoryCreateEventBase & {
			status: 'action';
			operationId: string;
			action: InventoryCreateOperationType;
			form: InventoryCreateFormState;
			duplicateToken?: string;
			modelToken?: string;
			existing?: { id: string; expectedRevision: number };
		};

export interface IFrameInventoryCreateResponse {
	protocolVersion: 1;
	requestId: string;
	operationId: string;
	action: InventoryCreateOperationType;
	stage: InventoryCreateResponseStage;
	message?: string;
	suggestion?: InventoryCreateIdentitySuggestion;
	model?: InventoryCreateModelSummary;
	duplicateToken?: string;
	modelToken?: string;
	existing?: InventoryCreateDuplicateSnapshot;
}

export function parseIFrameInventoryCreateRequest(value: unknown): IFrameInventoryCreateRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_CREATE_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isMode(value.mode)
		|| !isLabels(value.labels)
		|| !isFormState(value.initial)
		|| !isCategories(value.categories)
		|| !isLocationOptions(value.locationOptions)) {
		return undefined;
	}
	return {
		protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
		requestId: value.requestId,
		mode: value.mode,
		labels: { ...value.labels },
		initial: { ...value.initial },
		categories: value.categories.map(category => ({ ...category })),
		locationOptions: [...value.locationOptions],
	};
}

export function parseIFrameInventoryCreateEvent(
	value: unknown,
	expectedRequestId: string,
): IFrameInventoryCreateEvent | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_CREATE_PROTOCOL_VERSION
		|| value.requestId !== expectedRequestId) {
		return undefined;
	}
	const base = { protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION, requestId: expectedRequestId } as const;
	if (value.status === 'ready') {
		return { ...base, status: 'ready' };
	}
	if (value.status === 'progress' && isStage(value.stage)) {
		return { ...base, status: 'progress', stage: value.stage };
	}
	if (value.status === 'failed'
		&& isStage(value.stage)
		&& isText(value.errorName, 100)
		&& isText(value.error, 500)) {
		return { ...base, status: 'failed', stage: value.stage, errorName: value.errorName, error: value.error };
	}
	if (value.status === 'cancelled' && isNonEmptyText(value.operationId, 200)) {
		return { ...base, status: 'cancelled', operationId: value.operationId };
	}
	if (value.status === 'completed'
		&& isNonEmptyText(value.operationId, 200)
		&& (value.action === 'save' || value.action === 'confirm-merge')) {
		return { ...base, status: 'completed', operationId: value.operationId, action: value.action };
	}
	if (value.status === 'action'
		&& isNonEmptyText(value.operationId, 200)
		&& isOperationType(value.action)
		&& isFormState(value.form)
		&& (value.duplicateToken === undefined || isNonEmptyText(value.duplicateToken, 500))
		&& (value.modelToken === undefined || isNonEmptyText(value.modelToken, 500))
		&& (value.existing === undefined || isRevisionRef(value.existing))
		&& (value.action === 'confirm-merge'
			? isRevisionRef(value.existing) && isNonEmptyText(value.duplicateToken, 500)
			: value.existing === undefined && value.duplicateToken === undefined)
		&& ((value.action === 'save' || value.action === 'confirm-merge') || value.modelToken === undefined)) {
		return {
			...base,
			status: 'action',
			operationId: value.operationId,
			action: value.action,
			form: { ...value.form },
			duplicateToken: value.duplicateToken,
			modelToken: value.modelToken,
			existing: value.existing ? { ...value.existing } : undefined,
		};
	}
	return undefined;
}

export function parseIFrameInventoryCreateResponse(
	value: unknown,
	expectedRequestId: string,
	expectedOperationId?: string,
): IFrameInventoryCreateResponse | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_CREATE_PROTOCOL_VERSION
		|| value.requestId !== expectedRequestId
		|| !isNonEmptyText(value.operationId, 200)
		|| (expectedOperationId !== undefined && value.operationId !== expectedOperationId)
		|| !isOperationType(value.action)
		|| !isResponseStage(value.stage)
		|| (value.message !== undefined && !isText(value.message, 1000))
		|| (value.suggestion !== undefined && !isSuggestion(value.suggestion))
		|| (value.model !== undefined && !isModelSummary(value.model))
		|| (value.duplicateToken !== undefined && !isNonEmptyText(value.duplicateToken, 500))
		|| (value.modelToken !== undefined && !isNonEmptyText(value.modelToken, 500))
		|| (value.existing !== undefined && !isDuplicate(value.existing))) {
		return undefined;
	}
	if (value.stage === 'duplicate'
		&& (value.action !== 'save'
			|| !isDuplicate(value.existing)
			|| !isNonEmptyText(value.duplicateToken, 500))) {
		return undefined;
	}
	if (value.stage !== 'duplicate' && (value.existing !== undefined || value.duplicateToken !== undefined)) {
		return undefined;
	}
	if (value.action !== 'query-eda' && (value.suggestion !== undefined || value.model !== undefined)) {
		return undefined;
	}
	if ((value.action !== 'query-eda' || value.stage !== 'succeeded') && value.modelToken !== undefined) {
		return undefined;
	}
	return {
		protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
		requestId: expectedRequestId,
		operationId: value.operationId,
		action: value.action,
		stage: value.stage,
		message: value.message,
		suggestion: value.suggestion ? { ...value.suggestion } : undefined,
		model: value.model ? cloneModel(value.model) : undefined,
		duplicateToken: value.duplicateToken,
		modelToken: value.modelToken,
		existing: value.existing ? cloneDuplicate(value.existing) : undefined,
	};
}

export function defaultInventoryCreateFormState(
	initial?: Partial<InventoryCreateFormState>,
): InventoryCreateFormState {
	return {
		lcscPartNumber: initial?.lcscPartNumber ?? '',
		marketplaceConfirmed: initial?.marketplaceConfirmed ?? false,
		supplierId: initial?.supplierId ?? '',
		name: initial?.name ?? '',
		manufacturer: initial?.manufacturer ?? '',
		manufacturerPartNumber: initial?.manufacturerPartNumber ?? '',
		package: initial?.package ?? '',
		description: initial?.description ?? '',
		quantityMode: initial?.quantityMode ?? 'exact',
		quantity: initial?.quantity ?? '1',
		minimumQuantity: initial?.minimumQuantity ?? '',
		favorite: initial?.favorite ?? false,
		categoryId: initial?.categoryId ?? '',
		location: initial?.location ?? '',
		datasheetUrl: initial?.datasheetUrl ?? '',
		locationCabinet: initial?.locationCabinet ?? '',
		locationBox: initial?.locationBox ?? '',
		locationRow: initial?.locationRow ?? '',
		locationColumn: initial?.locationColumn ?? '',
		note: initial?.note ?? '',
	};
}

function isLabels(value: unknown): value is InventoryCreateLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isText(value[key], 1000));
}

function isFormState(value: unknown): value is InventoryCreateFormState {
	return isRecord(value)
		&& isText(value.lcscPartNumber, 500)
		&& typeof value.marketplaceConfirmed === 'boolean'
		&& isText(value.supplierId, 500)
		&& isText(value.name, 500)
		&& isText(value.manufacturer, 500)
		&& isText(value.manufacturerPartNumber, 500)
		&& isText(value.package, 500)
		&& isText(value.description, 4000)
		&& isQuantityMode(value.quantityMode)
		&& isText(value.quantity, 100)
		&& (value.minimumQuantity === undefined || isText(value.minimumQuantity, 100))
		&& (value.favorite === undefined || typeof value.favorite === 'boolean')
		&& isText(value.categoryId, 500)
		&& isText(value.location, 1000)
		&& isText(value.datasheetUrl, 2048)
		&& isText(value.locationCabinet, 64)
		&& isText(value.locationBox, 64)
		&& isText(value.locationRow, 64)
		&& isText(value.locationColumn, 64)
		&& isText(value.note, 4000);
}

function isCategories(value: unknown): value is InventoryCreateCategory[] {
	if (!Array.isArray(value) || value.length > 2000) {
		return false;
	}
	const ids = new Set<string>();
	for (const category of value) {
		if (!isRecord(category)
			|| !isNonEmptyText(category.id, 500)
			|| ids.has(category.id)
			|| !isNonEmptyTrimmedText(category.name, 200)
			|| (category.parentId !== undefined && !isNonEmptyText(category.parentId, 500))
			|| !isSafeNonNegativeInteger(category.sortOrder)) {
			return false;
		}
		ids.add(category.id);
	}
	const byId = new Map(value.map(category => [category.id, category]));
	return value.every((category) => {
		if (!category.parentId) {
			return true;
		}
		const parent = byId.get(category.parentId);
		return parent !== undefined && parent.id !== category.id && parent.parentId === undefined;
	});
}

function isLocationOptions(value: unknown): value is string[] {
	return Array.isArray(value) && value.length <= 200 && value.every(entry => isNonEmptyTrimmedText(entry, 1000));
}

function isSuggestion(value: unknown): value is InventoryCreateIdentitySuggestion {
	if (!isRecord(value)) {
		return false;
	}
	const keys = ['name', 'lcscPartNumber', 'supplierId', 'manufacturer', 'manufacturerPartNumber', 'package', 'description'];
	return Object.keys(value).every(key => keys.includes(key))
		&& keys.every(key => value[key] === undefined || isText(value[key], key === 'description' ? 4000 : 500));
}

function isModelSummary(value: unknown): value is InventoryCreateModelSummary {
	return isRecord(value)
		&& (value.status === 'available' || value.status === 'failed' || value.status === 'missing' || value.status === 'unchecked')
		&& (value.reference === undefined || isEdaReference(value.reference));
}

function isEdaReference(value: unknown): boolean {
	return isRecord(value)
		&& isNonEmptyText(value.deviceUuid, 500)
		&& isNonEmptyText(value.libraryUuid, 500)
		&& (value.symbolName === undefined || isText(value.symbolName, 500))
		&& (value.footprintName === undefined || isText(value.footprintName, 500));
}

function isDuplicate(value: unknown): value is InventoryCreateDuplicateSnapshot {
	return isRecord(value)
		&& isNonEmptyText(value.id, 500)
		&& isSafeNonNegativeInteger(value.revision)
		&& isIdentity(value.identity)
		&& (value.quantity === null || isSafeNonNegativeInteger(value.quantity))
		&& (value.precision === 'exact' || value.precision === 'estimated' || value.precision === 'unknown')
		&& (value.state === 'in-stock' || value.state === 'depleted')
		&& (value.categoryName === undefined || isText(value.categoryName, 500))
		&& (value.location === undefined || isText(value.location, 1000))
		&& (value.datasheetUrl === undefined || isText(value.datasheetUrl, 2048))
		&& (value.structuredLocation === undefined || isStructuredLocation(value.structuredLocation))
		&& (value.note === undefined || isText(value.note, 4000));
}

function isIdentity(value: unknown): boolean {
	return isRecord(value)
		&& isNonEmptyText(value.name, 500)
		&& ['lcscPartNumber', 'supplierId', 'manufacturerPartNumber', 'manufacturer', 'package'].every(
			key => value[key] === undefined || isText(value[key], 500),
		)
		&& (value.description === undefined || isText(value.description, 4000));
}

function isRevisionRef(value: unknown): value is { id: string; expectedRevision: number } {
	return isRecord(value) && isNonEmptyText(value.id, 500) && isSafeNonNegativeInteger(value.expectedRevision);
}

function cloneModel(model: InventoryCreateModelSummary): InventoryCreateModelSummary {
	return { ...model, reference: model.reference ? { ...model.reference } : undefined };
}

function cloneDuplicate(value: InventoryCreateDuplicateSnapshot): InventoryCreateDuplicateSnapshot {
	return {
		...value,
		identity: { ...value.identity },
		structuredLocation: value.structuredLocation ? { ...value.structuredLocation } : undefined,
	};
}

function isStructuredLocation(value: unknown): value is StructuredInventoryLocation {
	if (!isRecord(value)) {
		return false;
	}
	const fields = ['cabinet', 'box', 'row', 'column'] as const;
	return Object.keys(value).every(key => fields.includes(key as typeof fields[number]))
		&& fields.every(field => value[field] === undefined || isNonEmptyText(value[field], 64))
		&& fields.some(field => value[field] !== undefined);
}

function isMode(value: unknown): value is InventoryCreateMode {
	return value === 'custom' || value === 'lcsc';
}

function isQuantityMode(value: unknown): value is InventoryCreateQuantityMode {
	return value === 'exact' || value === 'estimated' || value === 'unknown' || value === 'depleted';
}

function isOperationType(value: unknown): value is InventoryCreateOperationType {
	return value === 'query-eda' || value === 'open-marketplace' || value === 'save' || value === 'confirm-merge';
}

function isResponseStage(value: unknown): value is InventoryCreateResponseStage {
	return value === 'succeeded' || value === 'not-found' || value === 'duplicate' || value === 'failed' || value === 'cancelled';
}

function isStage(value: unknown): value is InventoryCreatePanelStage {
	return value === 'script-started' || value === 'request-read' || value === 'panel-rendered';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown, maximumLength: number): value is string {
	return typeof value === 'string' && value.length <= maximumLength;
}

function isNonEmptyText(value: unknown, maximumLength: number): value is string {
	return isText(value, maximumLength) && value.length > 0;
}

function isNonEmptyTrimmedText(value: unknown, maximumLength: number): value is string {
	return isNonEmptyText(value, maximumLength) && value.trim().length > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
