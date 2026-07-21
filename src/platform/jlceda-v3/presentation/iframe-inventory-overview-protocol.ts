import type { EdaModelStatus, InventorySource, MarketplaceEvidence, QuantityPrecision, StockState } from '../../../features/inventory/domain/inventory-item';
import type {
	InventoryOverviewCategory,
	InventoryOverviewInput,
	InventoryOverviewIntent,
	InventoryOverviewOperation,
	InventoryOverviewOperationResult,
	InventoryOverviewRevisionRef,
	InventoryOverviewSnapshot,
	InventoryOverviewViewState,
} from './inventory-overview-panel';

export const INVENTORY_OVERVIEW_IFRAME_ID = 'jlceda-inventory-overview-panel';
export const INVENTORY_OVERVIEW_IFRAME_PATH = '/iframe/inventory-overview.html';
export const INVENTORY_OVERVIEW_REQUEST_KEY = 'inventory-overview-panel.v2.request';
export const INVENTORY_OVERVIEW_RESULT_KEY = 'inventory-overview-panel.v2.result';
export const INVENTORY_OVERVIEW_RESPONSE_KEY = 'inventory-overview-panel.v2.response';
export const INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY = 'inventory-overview-panel.v2.window-control';
export const INVENTORY_OVERVIEW_PROTOCOL_VERSION = 2;

export type InventoryOverviewPanelStage = 'panel-rendered' | 'request-read' | 'script-started';

const LABEL_KEYS = [
	'title',
	'searchLabel',
	'searchPlaceholder',
	'search',
	'clearSearch',
	'searchScope',
	'searchAllCategories',
	'searchCurrentCategory',
	'openCategories',
	'closeCategories',
	'allCategories',
	'unclassified',
	'systemCategories',
	'userCategories',
	'manageCategories',
	'importEdaCategories',
	'addRootCategory',
	'addChildCategory',
	'renameCategory',
	'moveCategoryUp',
	'moveCategoryDown',
	'dragCategory',
	'expandCategory',
	'collapseCategory',
	'deleteCategory',
	'categoryName',
	'categoryNamePlaceholder',
	'cancel',
	'confirm',
	'stockFilter',
	'stockAll',
	'stockInStock',
	'stockDepleted',
	'modelFilter',
	'modelAll',
	'modelAvailable',
	'modelMissing',
	'modelFailed',
	'modelUnchecked',
	'sortLabel',
	'sortRelevance',
	'sortName',
	'sortStock',
	'sortUpdated',
	'sortCategory',
	'clearFilters',
	'refresh',
	'itemsCount',
	'filteredCount',
	'selectedCount',
	'selectAllFiltered',
	'clearSelection',
	'moveToCategory',
	'primaryCategory',
	'secondaryCategory',
	'noSecondaryCategory',
	'dragItem',
	'dropItemToCategory',
	'applyMove',
	'selectAll',
	'columnName',
	'columnNumber',
	'columnCategory',
	'columnQuantity',
	'columnLocation',
	'columnModel',
	'columnUpdatedAt',
	'columnActions',
	'lcscPartNumber',
	'supplierId',
	'manufacturer',
	'manufacturerPartNumber',
	'package',
	'edaFootprint',
	'edaSymbol',
	'description',
	'precision',
	'exact',
	'estimated',
	'depleted',
	'inStock',
	'stockState',
	'note',
	'marketplace',
	'marketplaceFromOrder',
	'marketplaceUserConfirmed',
	'marketplaceUnconfirmed',
	'marketplaceNotLinked',
	'source',
	'sourceManual',
	'sourceMarketplace',
	'sourceCatalog',
	'sourceOrder',
	'createdAt',
	'revision',
	'copyLcscPartNumber',
	'copySucceeded',
	'copyFailed',
	'save',
	'nameRequired',
	'lcscInvalid',
	'quantityRequired',
	'quantityInteger',
	'quantityNonNegative',
	'existing',
	'candidate',
	'confirmMerge',
	'quantityUnknown',
	'quantityEstimated',
	'emptyValue',
	'viewItem',
	'editItem',
	'deleteItem',
	'openMarketplace',
	'retryModel',
	'copyCommon',
	'emptyResults',
	'pageSize',
	'pageStatus',
	'firstPage',
	'previousPage',
	'nextPage',
	'lastPage',
	'loading',
	'connectionError',
] as const;

export type InventoryOverviewLabelKey = typeof LABEL_KEYS[number];
export type InventoryOverviewLabels = Record<InventoryOverviewLabelKey, string>;

export interface InventoryOverviewCategorySnapshot {
	id: string;
	name: string;
	parentId?: string;
	sortOrder: number;
	revision: number;
}

export interface InventoryOverviewItemSnapshot {
	id: string;
	categoryId?: string;
	name: string;
	lcscPartNumber: string;
	supplierId: string;
	manufacturerPartNumber: string;
	manufacturer: string;
	package: string;
	edaFootprint: string;
	edaSymbol: string;
	description: string;
	quantity: number | null;
	precision: QuantityPrecision;
	state: StockState;
	location: string;
	note: string;
	marketplaceEvidence?: MarketplaceEvidence;
	edaModelStatus: EdaModelStatus;
	hasEdaModel: boolean;
	source: InventorySource;
	createdAt: string;
	createdAtLabel: string;
	updatedAt: string;
	updatedAtLabel: string;
	revision: number;
}

export interface IFrameInventoryOverviewRequest {
	protocolVersion: 2;
	requestId: string;
	labels: InventoryOverviewLabels;
	categories: InventoryOverviewCategorySnapshot[];
	items: InventoryOverviewItemSnapshot[];
	initialState?: InventoryOverviewViewState;
}

export type IFrameInventoryOverviewResult
	= | { protocolVersion: 2; requestId: string; status: 'ready' | 'cancelled' }
		| { protocolVersion: 2; requestId: string; status: 'progress'; stage: InventoryOverviewPanelStage }
		| { protocolVersion: 2; requestId: string; status: 'failed'; stage: InventoryOverviewPanelStage; errorName: string; error: string }
		| { protocolVersion: 2; requestId: string; status: 'operation'; operation: InventoryOverviewOperation };

export interface IFrameInventoryOverviewOperationResponse {
	protocolVersion: 2;
	requestId: string;
	operationId: string;
	status: 'operation-response';
	result: InventoryOverviewOperationResultSnapshot;
}

type InventoryOverviewOperationResultSnapshot
	= | { status: 'succeeded' | 'cancelled'; message?: string; snapshot?: InventoryOverviewSnapshotPayload }
		| { status: 'failed' | 'model-missing'; message: string; snapshot?: InventoryOverviewSnapshotPayload }
		| { status: 'model-match'; message: string; matchToken: string; item: InventoryOverviewRevisionRef }
		| {
			status: 'duplicate-match';
			matchToken: string;
			source: InventoryOverviewRevisionRef;
			target: InventoryOverviewRevisionRef;
			candidate: InventoryOverviewItemSnapshot;
			existing: InventoryOverviewItemSnapshot;
		};

interface InventoryOverviewSnapshotPayload {
	categories: InventoryOverviewCategorySnapshot[];
	items: InventoryOverviewItemSnapshot[];
}

export function createInventoryOverviewRequest(
	requestId: string,
	labels: InventoryOverviewLabels,
	input: InventoryOverviewInput,
): IFrameInventoryOverviewRequest {
	return {
		protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
		requestId,
		labels: { ...labels },
		categories: input.categories.map(createCategorySnapshot),
		initialState: input.initialState ? { ...input.initialState } : undefined,
		items: input.items.map(createItemSnapshot),
	};
}

export function createIFrameInventoryOverviewOperationResponse(
	requestId: string,
	operationId: string,
	result: InventoryOverviewOperationResult,
): IFrameInventoryOverviewOperationResponse {
	return {
		protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
		requestId,
		operationId,
		status: 'operation-response',
		result: createOperationResultSnapshot(result),
	};
}

export function parseIFrameInventoryOverviewRequest(value: unknown): IFrameInventoryOverviewRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_OVERVIEW_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isLabels(value.labels)
		|| !isCategories(value.categories)
		|| !isItems(value.items)
		|| (value.initialState !== undefined && !isViewState(value.initialState))) {
		return undefined;
	}
	return {
		protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
		requestId: value.requestId,
		labels: { ...value.labels },
		categories: value.categories.map(category => ({ ...category })),
		items: value.items.map(item => ({ ...item })),
		initialState: value.initialState ? { ...value.initialState } : undefined,
	};
}

export function parseIFrameInventoryOverviewResult(
	value: unknown,
	expectedRequestId: string,
): IFrameInventoryOverviewResult | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_OVERVIEW_PROTOCOL_VERSION
		|| value.requestId !== expectedRequestId) {
		return undefined;
	}
	const base = { protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION, requestId: expectedRequestId } as const;
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
	if (value.status === 'operation' && isOperation(value.operation)) {
		return {
			...base,
			status: 'operation',
			operation: {
				operationId: value.operation.operationId,
				intent: cloneIntent(value.operation.intent),
			},
		};
	}
	return undefined;
}

export function parseIFrameInventoryOverviewOperationResponse(
	value: unknown,
	expectedRequestId: string,
	expectedOperationId?: string,
): IFrameInventoryOverviewOperationResponse | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_OVERVIEW_PROTOCOL_VERSION
		|| value.requestId !== expectedRequestId
		|| value.status !== 'operation-response'
		|| !isNonEmptyText(value.operationId, 200)
		|| (expectedOperationId !== undefined && value.operationId !== expectedOperationId)
		|| !isOperationResultSnapshot(value.result)) {
		return undefined;
	}
	return {
		protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
		requestId: expectedRequestId,
		operationId: value.operationId,
		status: 'operation-response',
		result: cloneOperationResultSnapshot(value.result),
	};
}

function createCategorySnapshot(category: InventoryOverviewCategory): InventoryOverviewCategorySnapshot {
	return { ...category };
}

function createItemSnapshot(item: InventoryOverviewInput['items'][number]): InventoryOverviewItemSnapshot {
	return {
		id: item.id,
		categoryId: item.categoryId,
		name: item.identity.name,
		lcscPartNumber: item.identity.lcscPartNumber ?? '',
		supplierId: item.identity.supplierId ?? '',
		manufacturerPartNumber: item.identity.manufacturerPartNumber ?? '',
		manufacturer: item.identity.manufacturer ?? '',
		package: item.identity.package ?? '',
		edaFootprint: item.edaModelReference?.footprintName ?? '',
		edaSymbol: item.edaModelReference?.symbolName ?? '',
		description: item.identity.description ?? '',
		quantity: item.quantity,
		precision: item.precision,
		state: item.state,
		location: item.location ?? '',
		note: item.note ?? '',
		marketplaceEvidence: item.marketplaceReference?.evidence,
		edaModelStatus: item.edaModelStatus,
		hasEdaModel: Boolean(item.edaModelReference),
		source: item.source,
		createdAt: item.createdAt,
		createdAtLabel: formatTimestamp(item.createdAt),
		updatedAt: item.updatedAt,
		updatedAtLabel: formatTimestamp(item.updatedAt),
		revision: item.revision,
	};
}

function createOperationResultSnapshot(result: InventoryOverviewOperationResult): InventoryOverviewOperationResultSnapshot {
	if (result.status === 'model-match') {
		return { ...result, item: { ...result.item } };
	}
	if (result.status === 'duplicate-match') {
		return {
			...result,
			candidate: createItemSnapshot(result.candidate),
			existing: createItemSnapshot(result.existing),
			source: { ...result.source },
			target: { ...result.target },
		};
	}
	return {
		...result,
		snapshot: result.snapshot ? createSnapshotPayload(result.snapshot) : undefined,
	};
}

function createSnapshotPayload(snapshot: InventoryOverviewSnapshot): InventoryOverviewSnapshotPayload {
	return {
		categories: snapshot.categories.map(createCategorySnapshot),
		items: snapshot.items.map(createItemSnapshot),
	};
}

function cloneIntent(intent: InventoryOverviewIntent): InventoryOverviewIntent {
	if (intent.type === 'move-items') {
		return { ...intent, items: intent.items.map(item => ({ ...item })), viewState: { ...intent.viewState } };
	}
	if (intent.type === 'reorder-categories') {
		return { ...intent, categories: intent.categories.map(category => ({ ...category })), viewState: { ...intent.viewState } };
	}
	if (intent.type === 'view-item'
		|| intent.type === 'edit-item'
		|| intent.type === 'open-marketplace'
		|| intent.type === 'retry-model'
		|| intent.type === 'copy-common'
		|| intent.type === 'delete-item') {
		return { ...intent, item: { ...intent.item }, viewState: { ...intent.viewState } };
	}
	if (intent.type === 'update-item') {
		return {
			...intent,
			draft: { ...intent.draft, identity: { ...intent.draft.identity } },
			item: { ...intent.item },
			viewState: { ...intent.viewState },
		};
	}
	if (intent.type === 'merge-items') {
		return {
			...intent,
			source: { ...intent.source },
			target: { ...intent.target },
			viewState: { ...intent.viewState },
		};
	}
	if (intent.type === 'attach-model') {
		return { ...intent, item: { ...intent.item }, viewState: { ...intent.viewState } };
	}
	if (intent.type === 'rename-category' || intent.type === 'delete-category') {
		return { ...intent, category: { ...intent.category }, viewState: { ...intent.viewState } };
	}
	return { ...intent, viewState: { ...intent.viewState } };
}

function cloneOperationResultSnapshot(
	result: InventoryOverviewOperationResultSnapshot,
): InventoryOverviewOperationResultSnapshot {
	if (result.status === 'model-match') {
		return { ...result, item: { ...result.item } };
	}
	if (result.status === 'duplicate-match') {
		return {
			...result,
			candidate: { ...result.candidate },
			existing: { ...result.existing },
			source: { ...result.source },
			target: { ...result.target },
		};
	}
	return {
		...result,
		snapshot: result.snapshot
			? {
					categories: result.snapshot.categories.map(category => ({ ...category })),
					items: result.snapshot.items.map(item => ({ ...item })),
				}
			: undefined,
	};
}

function isOperation(value: unknown): value is InventoryOverviewOperation {
	return isRecord(value)
		&& isNonEmptyText(value.operationId, 200)
		&& isIntent(value.intent);
}

function isIntent(value: unknown): value is InventoryOverviewIntent {
	if (!isRecord(value) || !isText(value.type, 100) || !isViewState(value.viewState)) {
		return false;
	}
	if ((value.type === 'view-item'
		|| value.type === 'edit-item'
		|| value.type === 'open-marketplace'
		|| value.type === 'retry-model'
		|| value.type === 'copy-common')
	&& isRevisionRef(value.item)) {
		return true;
	}
	if (value.type === 'attach-model'
		&& isRevisionRef(value.item)
		&& isNonEmptyText(value.matchToken, 200)) {
		return true;
	}
	if (value.type === 'update-item'
		&& isRevisionRef(value.item)
		&& isEditDraft(value.draft)
		&& (value.categoryId === undefined || isNonEmptyText(value.categoryId, 500))) {
		return true;
	}
	if (value.type === 'merge-items'
		&& isRevisionRef(value.source)
		&& isRevisionRef(value.target)
		&& value.source.id !== value.target.id
		&& isNonEmptyText(value.matchToken, 200)
		&& (value.categoryId === undefined || isNonEmptyText(value.categoryId, 500))) {
		return true;
	}
	if (value.type === 'delete-item' && value.confirmed === true && isRevisionRef(value.item)) {
		return true;
	}
	if (value.type === 'move-items'
		&& isRevisionRefs(value.items, 5000)
		&& (value.categoryId === undefined || isNonEmptyText(value.categoryId, 500))) {
		return true;
	}
	if (value.type === 'create-category'
		&& isNonEmptyTrimmedText(value.name, 200)
		&& (value.parentId === undefined || isNonEmptyText(value.parentId, 500))) {
		return true;
	}
	if (value.type === 'rename-category'
		&& isRevisionRef(value.category)
		&& isNonEmptyTrimmedText(value.name, 200)) {
		return true;
	}
	if (value.type === 'delete-category' && value.confirmed === true && isRevisionRef(value.category)) {
		return true;
	}
	if (value.type === 'reorder-categories'
		&& (value.parentId === undefined || isNonEmptyText(value.parentId, 500))
		&& isRevisionRefs(value.categories, 2000)) {
		return true;
	}
	return value.type === 'import-eda-categories' || value.type === 'refresh';
}

function isOperationResultSnapshot(value: unknown): value is InventoryOverviewOperationResultSnapshot {
	if (!isRecord(value) || !isText(value.status, 100)) {
		return false;
	}
	if (value.status === 'model-match') {
		return isText(value.message, 1000)
			&& isNonEmptyText(value.matchToken, 200)
			&& isRevisionRef(value.item);
	}
	if (value.status === 'duplicate-match') {
		return isNonEmptyText(value.matchToken, 200)
			&& isRevisionRef(value.source)
			&& isRevisionRef(value.target)
			&& value.source.id !== value.target.id
			&& isItems([value.candidate, value.existing]);
	}
	if (value.status !== 'succeeded'
		&& value.status !== 'cancelled'
		&& value.status !== 'failed'
		&& value.status !== 'model-missing') {
		return false;
	}
	if ((value.status === 'failed' || value.status === 'model-missing') && !isText(value.message, 1000)) {
		return false;
	}
	return (value.message === undefined || isText(value.message, 1000))
		&& (value.snapshot === undefined || isSnapshotPayload(value.snapshot));
}

function isSnapshotPayload(value: unknown): value is InventoryOverviewSnapshotPayload {
	return isRecord(value) && isCategories(value.categories) && isItems(value.items);
}

function isViewState(value: unknown): value is InventoryOverviewViewState {
	return isRecord(value)
		&& isText(value.query, 500)
		&& (value.searchScope === 'all' || value.searchScope === 'current')
		&& isNonEmptyText(value.categoryId, 500)
		&& (value.stockFilter === 'all' || value.stockFilter === 'in-stock' || value.stockFilter === 'depleted')
		&& (value.modelFilter === 'all' || isModelStatus(value.modelFilter))
		&& (value.sort === 'relevance' || value.sort === 'name' || value.sort === 'stock' || value.sort === 'updated' || value.sort === 'category')
		&& isPositiveSafeInteger(value.page)
		&& (value.pageSize === 25 || value.pageSize === 50 || value.pageSize === 100);
}

function isCategories(value: unknown): value is InventoryOverviewCategorySnapshot[] {
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
			|| !isSafeNonNegativeInteger(category.sortOrder)
			|| !isSafeNonNegativeInteger(category.revision)) {
			return false;
		}
		ids.add(category.id);
	}
	const byId = new Map(value.map(category => [category.id, category]));
	return value.every((category) => {
		if (category.parentId === undefined) {
			return true;
		}
		const parent = byId.get(category.parentId);
		return parent !== undefined && parent.id !== category.id && parent.parentId === undefined;
	});
}

function isItems(value: unknown): value is InventoryOverviewItemSnapshot[] {
	if (!Array.isArray(value) || value.length > 10_000) {
		return false;
	}
	const ids = new Set<string>();
	return value.every((item) => {
		if (!isRecord(item)
			|| !isNonEmptyText(item.id, 500)
			|| ids.has(item.id)
			|| (item.categoryId !== undefined && !isNonEmptyText(item.categoryId, 500))
			|| !isText(item.name, 500)
			|| !isText(item.lcscPartNumber, 500)
			|| !isText(item.supplierId, 500)
			|| !isText(item.manufacturerPartNumber, 500)
			|| !isText(item.manufacturer, 500)
			|| !isText(item.package, 500)
			|| !isText(item.edaFootprint, 500)
			|| !isText(item.edaSymbol, 500)
			|| !isText(item.description, 4000)
			|| !(item.quantity === null || isSafeNonNegativeInteger(item.quantity))
			|| !isPrecision(item.precision)
			|| !isStockState(item.state)
			|| !isText(item.location, 1000)
			|| !isText(item.note, 4000)
			|| (item.marketplaceEvidence !== undefined
				&& item.marketplaceEvidence !== 'user-confirmed'
				&& item.marketplaceEvidence !== 'order-import')
			|| !isModelStatus(item.edaModelStatus)
			|| typeof item.hasEdaModel !== 'boolean'
			|| !isInventorySource(item.source)
			|| !isText(item.createdAt, 1000)
			|| !isText(item.createdAtLabel, 1000)
			|| !isText(item.updatedAt, 1000)
			|| !isText(item.updatedAtLabel, 1000)
			|| !isSafeNonNegativeInteger(item.revision)) {
			return false;
		}
		ids.add(item.id);
		return true;
	});
}

function isEditDraft(value: unknown): boolean {
	return isRecord(value)
		&& isRecord(value.identity)
		&& isNonEmptyTrimmedText(value.identity.name, 500)
		&& isText(value.identity.lcscPartNumber, 500)
		&& isText(value.identity.supplierId, 500)
		&& isText(value.identity.manufacturer, 500)
		&& isText(value.identity.manufacturerPartNumber, 500)
		&& isText(value.identity.package, 500)
		&& isText(value.identity.description, 4000)
		&& isSafeNonNegativeInteger(value.quantity)
		&& (value.precision === 'exact' || value.precision === 'estimated')
		&& isText(value.location, 1000)
		&& isText(value.note, 4000);
}

function isLabels(value: unknown): value is InventoryOverviewLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isText(value[key], 1000));
}

function isRevisionRefs(value: unknown, maximumLength: number): value is InventoryOverviewRevisionRef[] {
	return Array.isArray(value)
		&& value.length > 0
		&& value.length <= maximumLength
		&& value.every(isRevisionRef)
		&& new Set(value.map(reference => reference.id)).size === value.length;
}

function isRevisionRef(value: unknown): value is InventoryOverviewRevisionRef {
	return isRecord(value)
		&& isNonEmptyText(value.id, 500)
		&& isSafeNonNegativeInteger(value.expectedRevision);
}

function isStage(value: unknown): value is InventoryOverviewPanelStage {
	return value === 'script-started' || value === 'request-read' || value === 'panel-rendered';
}

function isPrecision(value: unknown): value is QuantityPrecision {
	return value === 'exact' || value === 'estimated' || value === 'unknown';
}

function isStockState(value: unknown): value is StockState {
	return value === 'in-stock' || value === 'depleted';
}

function isModelStatus(value: unknown): value is EdaModelStatus {
	return value === 'available' || value === 'missing' || value === 'failed' || value === 'unchecked';
}

function isInventorySource(value: unknown): value is InventorySource {
	return value === 'manual' || value === 'marketplace' || value === 'catalog' || value === 'order';
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

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
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
