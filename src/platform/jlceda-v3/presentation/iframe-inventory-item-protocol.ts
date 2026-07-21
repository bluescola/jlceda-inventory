import type { InventoryItem, PartIdentity, QuantityPrecision, StockState } from '../../../features/inventory/domain/inventory-item';

export const INVENTORY_ITEM_IFRAME_ID = 'jlceda-inventory-item-panel';
export const INVENTORY_ITEM_IFRAME_PATH = '/iframe/inventory-item.html';
export const INVENTORY_ITEM_REQUEST_KEY = 'inventory-item-panel.v1.request';
export const INVENTORY_ITEM_RESULT_KEY = 'inventory-item-panel.v1.result';
export const INVENTORY_ITEM_PROTOCOL_VERSION = 1;

export type InventoryItemPanelMode = 'compare' | 'edit' | 'view';
export type InventoryItemPanelStage = 'panel-rendered' | 'request-read' | 'script-started';

const LABEL_KEYS = [
	'viewTitle',
	'editTitle',
	'compareTitle',
	'lcscPartNumber',
	'supplierId',
	'name',
	'manufacturer',
	'manufacturerPartNumber',
	'package',
	'description',
	'quantity',
	'precision',
	'exact',
	'estimated',
	'unknown',
	'stockState',
	'depleted',
	'inStock',
	'location',
	'chooseLocation',
	'note',
	'marketplace',
	'edaModel',
	'edaSymbol',
	'edaFootprint',
	'source',
	'createdAt',
	'updatedAt',
	'revision',
	'close',
	'fullEdit',
	'cancel',
	'save',
	'confirmMerge',
	'existing',
	'candidate',
	'suggestionTitle',
	'useSuggestion',
	'emptyValue',
	'nameRequired',
	'lcscInvalid',
	'quantityRequired',
	'quantityInteger',
	'quantityNonNegative',
	'loading',
	'connectionError',
	'saveError',
] as const;

export type InventoryItemPanelLabelKey = typeof LABEL_KEYS[number];
export type InventoryItemPanelLabels = Record<InventoryItemPanelLabelKey, string>;

export interface InventoryItemPanelSnapshot {
	identity: {
		name: string;
		lcscPartNumber: string;
		supplierId: string;
		manufacturer: string;
		manufacturerPartNumber: string;
		package: string;
		description: string;
	};
	quantity: number | null;
	precision: QuantityPrecision;
	state: StockState;
	location: string;
	note: string;
	marketplaceStatus: string;
	edaModelStatus: string;
	edaSymbol: string;
	edaFootprint: string;
	source: string;
	createdAt: string;
	updatedAt: string;
	revision: number;
}

export interface InventoryItemEditFormState {
	lcscPartNumber: string;
	supplierId: string;
	name: string;
	manufacturer: string;
	manufacturerPartNumber: string;
	package: string;
	description: string;
	quantity: string;
	precision: 'exact' | 'estimated';
	depleted: boolean;
	location: string;
	note: string;
}

export type InventoryItemSuggestion = Partial<InventoryItemPanelSnapshot['identity']>;

interface InventoryItemPanelRequestBase {
	protocolVersion: 1;
	requestId: string;
	labels: InventoryItemPanelLabels;
}

export type IFrameInventoryItemRequest
	= | InventoryItemPanelRequestBase & {
		mode: 'view';
		item: InventoryItemPanelSnapshot;
	}
	| InventoryItemPanelRequestBase & {
		mode: 'edit';
		item: InventoryItemPanelSnapshot;
		initial: InventoryItemEditFormState;
		locationOptions: string[];
		suggestion?: InventoryItemSuggestion;
	}
	| InventoryItemPanelRequestBase & {
		mode: 'compare';
		existing: InventoryItemPanelSnapshot;
		candidate: InventoryItemPanelSnapshot;
	};

export type IFrameInventoryItemResult
	= | {
		protocolVersion: 1;
		requestId: string;
		status: 'ready';
	}
	| {
		protocolVersion: 1;
		requestId: string;
		status: 'cancelled';
	}
	| {
		protocolVersion: 1;
		requestId: string;
		status: 'progress';
		stage: InventoryItemPanelStage;
	}
	| {
		protocolVersion: 1;
		requestId: string;
		status: 'failed';
		stage: InventoryItemPanelStage;
		errorName: string;
		error: string;
	}
	| {
		protocolVersion: 1;
		requestId: string;
		status: 'edit';
	}
	| {
		protocolVersion: 1;
		requestId: string;
		status: 'submitted';
		value: InventoryItemEditFormState;
	}
	| {
		protocolVersion: 1;
		requestId: string;
		status: 'confirmed';
	};

export function createInventoryItemSnapshot(item: InventoryItem): InventoryItemPanelSnapshot {
	return {
		identity: {
			name: item.identity.name,
			lcscPartNumber: item.identity.lcscPartNumber ?? '',
			supplierId: item.identity.supplierId ?? '',
			manufacturer: item.identity.manufacturer ?? '',
			manufacturerPartNumber: item.identity.manufacturerPartNumber ?? '',
			package: item.identity.package ?? '',
			description: item.identity.description ?? '',
		},
		quantity: item.quantity,
		precision: item.precision,
		state: item.state,
		location: item.location ?? '',
		note: item.note ?? '',
		marketplaceStatus: item.marketplaceReference?.evidence ?? '',
		edaModelStatus: item.edaModelStatus,
		edaSymbol: item.edaModelReference?.symbolName ?? '',
		edaFootprint: item.edaModelReference?.footprintName ?? '',
		source: item.source,
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
		revision: item.revision,
	};
}

export function createInventoryItemSuggestion(value?: PartIdentity): InventoryItemSuggestion | undefined {
	if (!value) {
		return undefined;
	}
	const suggestion: InventoryItemSuggestion = {
		name: value.name,
		lcscPartNumber: value.lcscPartNumber,
		supplierId: value.supplierId,
		manufacturer: value.manufacturer,
		manufacturerPartNumber: value.manufacturerPartNumber,
		package: value.package,
		description: value.description,
	};
	const present = Object.fromEntries(
		Object.entries(suggestion).filter((entry): entry is [keyof InventoryItemSuggestion, string] => typeof entry[1] === 'string'),
	) as InventoryItemSuggestion;
	return Object.keys(present).length > 0 ? present : undefined;
}

export function parseIFrameInventoryItemRequest(value: unknown): IFrameInventoryItemRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_ITEM_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isLabels(value.labels)
		|| !isMode(value.mode)) {
		return undefined;
	}
	const base: InventoryItemPanelRequestBase = {
		protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
		requestId: value.requestId,
		labels: { ...value.labels },
	};
	if (value.mode === 'view' && isSnapshot(value.item)) {
		return { ...base, mode: 'view', item: cloneSnapshot(value.item) };
	}
	if (value.mode === 'edit'
		&& isSnapshot(value.item)
		&& isEditState(value.initial)
		&& (value.locationOptions === undefined || isLocationOptions(value.locationOptions))
		&& (value.suggestion === undefined || isSuggestion(value.suggestion))) {
		return {
			...base,
			mode: 'edit',
			item: cloneSnapshot(value.item),
			initial: { ...value.initial },
			locationOptions: value.locationOptions ? [...value.locationOptions] : [],
			suggestion: value.suggestion ? { ...value.suggestion } : undefined,
		};
	}
	if (value.mode === 'compare' && isSnapshot(value.existing) && isSnapshot(value.candidate)) {
		return {
			...base,
			mode: 'compare',
			existing: cloneSnapshot(value.existing),
			candidate: cloneSnapshot(value.candidate),
		};
	}
	return undefined;
}

export function parseIFrameInventoryItemResult(
	value: unknown,
	expectedRequestId: string,
	expectedMode: InventoryItemPanelMode,
): IFrameInventoryItemResult | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_ITEM_PROTOCOL_VERSION
		|| value.requestId !== expectedRequestId) {
		return undefined;
	}
	const base = { protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION, requestId: expectedRequestId } as const;
	if (value.status === 'ready' || value.status === 'cancelled') {
		return { ...base, status: value.status };
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
	if (expectedMode === 'view' && value.status === 'edit') {
		return { ...base, status: 'edit' };
	}
	if (expectedMode === 'edit' && value.status === 'submitted' && isEditState(value.value)) {
		return { ...base, status: 'submitted', value: { ...value.value } };
	}
	if (expectedMode === 'compare' && value.status === 'confirmed') {
		return { ...base, status: 'confirmed' };
	}
	return undefined;
}

function cloneSnapshot(value: InventoryItemPanelSnapshot): InventoryItemPanelSnapshot {
	return { ...value, identity: { ...value.identity } };
}

function isSnapshot(value: unknown): value is InventoryItemPanelSnapshot {
	return isRecord(value)
		&& isIdentity(value.identity)
		&& (value.quantity === null || (typeof value.quantity === 'number' && Number.isSafeInteger(value.quantity) && value.quantity >= 0))
		&& isPrecision(value.precision)
		&& (value.state === 'in-stock' || value.state === 'depleted')
		&& isText(value.location, 1000)
		&& isText(value.note, 4000)
		&& isText(value.marketplaceStatus, 1000)
		&& isText(value.edaModelStatus, 1000)
		&& isText(value.edaSymbol, 500)
		&& isText(value.edaFootprint, 500)
		&& isText(value.source, 1000)
		&& isText(value.createdAt, 1000)
		&& isText(value.updatedAt, 1000)
		&& typeof value.revision === 'number'
		&& Number.isSafeInteger(value.revision)
		&& value.revision >= 0;
}

function isIdentity(value: unknown): value is InventoryItemPanelSnapshot['identity'] {
	return isRecord(value)
		&& isText(value.name, 500)
		&& isText(value.lcscPartNumber, 500)
		&& isText(value.supplierId, 500)
		&& isText(value.manufacturer, 500)
		&& isText(value.manufacturerPartNumber, 500)
		&& isText(value.package, 500)
		&& isText(value.description, 4000);
}

function isEditState(value: unknown): value is InventoryItemEditFormState {
	return isRecord(value)
		&& isText(value.lcscPartNumber, 500)
		&& isText(value.supplierId, 500)
		&& isText(value.name, 500)
		&& isText(value.manufacturer, 500)
		&& isText(value.manufacturerPartNumber, 500)
		&& isText(value.package, 500)
		&& isText(value.description, 4000)
		&& isText(value.quantity, 100)
		&& (value.precision === 'exact' || value.precision === 'estimated')
		&& typeof value.depleted === 'boolean'
		&& isText(value.location, 1000)
		&& isText(value.note, 4000);
}

function isSuggestion(value: unknown): value is InventoryItemSuggestion {
	if (!isRecord(value)) {
		return false;
	}
	const allowed = new Set(['name', 'lcscPartNumber', 'supplierId', 'manufacturer', 'manufacturerPartNumber', 'package', 'description']);
	return Object.entries(value).every(([key, entry]) => allowed.has(key) && isText(entry, key === 'description' ? 4000 : 500));
}

function isLocationOptions(value: unknown): value is string[] {
	return Array.isArray(value)
		&& value.length <= 200
		&& value.every(option => isText(option, 1000));
}

function isLabels(value: unknown): value is InventoryItemPanelLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isText(value[key], 1000));
}

function isMode(value: unknown): value is InventoryItemPanelMode {
	return value === 'view' || value === 'edit' || value === 'compare';
}

function isStage(value: unknown): value is InventoryItemPanelStage {
	return value === 'script-started' || value === 'request-read' || value === 'panel-rendered';
}

function isPrecision(value: unknown): value is QuantityPrecision {
	return value === 'exact' || value === 'estimated' || value === 'unknown';
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
