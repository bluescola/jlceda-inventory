import type { InventoryItem } from '../../../../features/inventory/domain/inventory-item';
import type {
	InventoryOverviewCategorySnapshot,
	InventoryOverviewItemSnapshot,
} from '../../presentation/iframe-inventory-overview-protocol';
import type { InventoryOverviewViewState } from '../../presentation/inventory-overview-panel';
import { searchInventory } from '../../../../features/inventory-search/application/search-inventory';

export const DEFAULT_INVENTORY_OVERVIEW_VIEW_STATE: InventoryOverviewViewState = {
	query: '',
	searchScope: 'all',
	categoryId: 'all',
	stockFilter: 'all',
	modelFilter: 'all',
	sort: 'relevance',
	page: 1,
	pageSize: 50,
};

export interface InventoryOverviewResultSet {
	items: InventoryOverviewItemSnapshot[];
	total: number;
	page: number;
	pageCount: number;
}

export interface InventoryOverviewScrollPosition {
	left: number;
	top: number;
}

export interface InventoryOverviewScrollContainer {
	scrollLeft: number;
	scrollTop: number;
}

export type InventoryOverviewCategoryTarget
	= | { valid: false }
		| { valid: true; categoryId?: string };

export function captureInventoryOverviewScroll(
	container: InventoryOverviewScrollContainer | null | undefined,
): InventoryOverviewScrollPosition | undefined {
	return container ? { left: container.scrollLeft, top: container.scrollTop } : undefined;
}

export function restoreInventoryOverviewScroll(
	container: InventoryOverviewScrollContainer | null | undefined,
	position: InventoryOverviewScrollPosition | undefined,
): void {
	if (!container || !position) {
		return;
	}
	container.scrollLeft = position.left;
	container.scrollTop = position.top;
}

export function shouldAutoHideInventoryOverview(
	autoHideArmed: boolean,
	operationPending: boolean,
	documentVisible: boolean,
): boolean {
	return autoHideArmed && !operationPending && documentVisible;
}

export function shouldSuppressAutoHideForWindowControl(
	value: unknown,
	requestId: string,
	now: number,
): boolean {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const signal = value as Partial<{ action: string; requestId: string; timestamp: number }>;
	return signal.requestId === requestId
		&& (signal.action === 'maximize' || signal.action === 'minimize')
		&& typeof signal.timestamp === 'number'
		&& now >= signal.timestamp
		&& now - signal.timestamp <= 1_000;
}

export function inventoryOverviewPackageLabel(item: Pick<InventoryOverviewItemSnapshot, 'edaFootprint' | 'package'>): string {
	return item.package || item.edaFootprint || '\u2014';
}

export function inventoryOverviewLcscPartNumber(
	item: Pick<InventoryOverviewItemSnapshot, 'lcscPartNumber' | 'supplierId'>,
): string {
	for (const candidate of [item.lcscPartNumber, item.supplierId]) {
		const normalized = candidate.trim().toUpperCase();
		const cNumber = /^\d+$/.test(normalized) ? `C${normalized}` : normalized;
		if (/^C\d+$/.test(cNumber)) {
			return cNumber;
		}
	}
	return '';
}

export function resolveInventoryItemDropCategory(
	currentCategoryId: string | undefined,
	targetCategoryValue: string,
): InventoryOverviewCategoryTarget {
	const categoryId = targetCategoryValue || undefined;
	return currentCategoryId === categoryId ? { valid: false } : { valid: true, categoryId };
}

export function inventoryItemsForDrag(
	source: InventoryOverviewItemSnapshot,
	selectedIds: ReadonlySet<string>,
	items: readonly InventoryOverviewItemSnapshot[],
): InventoryOverviewItemSnapshot[] {
	if (!selectedIds.has(source.id)) {
		return [source];
	}
	return [source, ...items.filter(item => item.id !== source.id && selectedIds.has(item.id))];
}

export function inventoryItemsForCategoryDrop(
	items: readonly InventoryOverviewItemSnapshot[],
	targetCategoryValue: string,
): InventoryOverviewItemSnapshot[] {
	const categoryId = targetCategoryValue || undefined;
	return items.filter(item => item.categoryId !== categoryId);
}

export function resolveBulkCategoryTarget(
	categories: readonly InventoryOverviewCategorySnapshot[],
	rootCategoryValue: string,
	childCategoryValue: string,
): InventoryOverviewCategoryTarget {
	if (!rootCategoryValue) {
		return { valid: true, categoryId: undefined };
	}
	const root = categories.find(category => category.id === rootCategoryValue && category.parentId === undefined);
	if (!root) {
		return { valid: false };
	}
	if (!childCategoryValue) {
		return { valid: true, categoryId: root.id };
	}
	const child = categories.find(category => category.id === childCategoryValue && category.parentId === root.id);
	return child ? { valid: true, categoryId: child.id } : { valid: false };
}

export function updateFilteredInventorySelection(
	selectedIds: ReadonlySet<string>,
	filteredItems: readonly InventoryOverviewItemSnapshot[],
	mode: 'clear' | 'select-all',
): Set<string> {
	if (mode === 'clear') {
		return new Set();
	}
	return new Set([...selectedIds, ...filteredItems.map(item => item.id)]);
}

export function shouldClearAppliedSearch(draftQuery: string, appliedQuery: string): boolean {
	return draftQuery.trim().length === 0 && appliedQuery.length > 0;
}

export function normalizeOverviewViewState(
	value: InventoryOverviewViewState | undefined,
	categories: readonly InventoryOverviewCategorySnapshot[],
): InventoryOverviewViewState {
	const state = value ? { ...value } : { ...DEFAULT_INVENTORY_OVERVIEW_VIEW_STATE };
	if (state.categoryId !== 'all'
		&& state.categoryId !== 'unclassified'
		&& !categories.some(category => category.id === state.categoryId)) {
		state.categoryId = 'all';
	}
	return state;
}

export function selectInventoryOverviewCategory(
	state: InventoryOverviewViewState,
	categoryId: InventoryOverviewViewState['categoryId'],
	currentSort: InventoryOverviewViewState['sort'],
): InventoryOverviewViewState {
	return {
		...state,
		categoryId,
		page: 1,
		sort: currentSort,
	};
}

export function filterAndSortInventory(
	items: readonly InventoryOverviewItemSnapshot[],
	categories: readonly InventoryOverviewCategorySnapshot[],
	state: InventoryOverviewViewState,
): InventoryOverviewItemSnapshot[] {
	const categoryIds = selectedCategoryIds(state.categoryId, categories);
	const knownCategoryIds = new Set(categories.map(category => category.id));
	const searchAcrossAllCategories = state.query.trim().length > 0 && state.searchScope === 'all';
	const candidates = items.filter(item => (searchAcrossAllCategories || matchesCategory(item, state.categoryId, categoryIds, knownCategoryIds))
		&& (state.stockFilter === 'all' || item.state === state.stockFilter)
		&& (state.modelFilter === 'all' || item.edaModelStatus === state.modelFilter));
	const candidatesById = new Map(candidates.map(item => [item.id, item]));
	const searched = searchInventory(candidates.map(toSearchInventoryItem), state.query)
		.map(item => candidatesById.get(item.id))
		.filter((item): item is InventoryOverviewItemSnapshot => item !== undefined);
	if (state.sort === 'relevance') {
		if (state.query.trim()) {
			return searched;
		}
		return searched.sort(compareOverviewDefault);
	}
	const categoryRanks = inventoryCategoryRanks(categories);
	return searched.sort((left, right) => compareItems(left, right, state, categoryRanks));
}

export function paginateInventory(
	items: readonly InventoryOverviewItemSnapshot[],
	requestedPage: number,
	pageSize: number,
): InventoryOverviewResultSet {
	const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
	const page = Math.min(Math.max(1, requestedPage), pageCount);
	const offset = (page - 1) * pageSize;
	return {
		items: items.slice(offset, offset + pageSize),
		total: items.length,
		page,
		pageCount,
	};
}

export function inventoryCategoryCounts(
	items: readonly InventoryOverviewItemSnapshot[],
	categories: readonly InventoryOverviewCategorySnapshot[],
): Map<string, number> {
	const counts = new Map<string, number>([
		['all', items.length],
		['unclassified', 0],
	]);
	const byId = new Map(categories.map(category => [category.id, category]));
	for (const category of categories) {
		counts.set(category.id, 0);
	}
	for (const item of items) {
		const category = item.categoryId ? byId.get(item.categoryId) : undefined;
		if (!category) {
			counts.set('unclassified', (counts.get('unclassified') ?? 0) + 1);
			continue;
		}
		counts.set(category.id, (counts.get(category.id) ?? 0) + 1);
		if (category.parentId) {
			counts.set(category.parentId, (counts.get(category.parentId) ?? 0) + 1);
		}
	}
	return counts;
}

export function orderedCategorySiblings(
	categories: readonly InventoryOverviewCategorySnapshot[],
	parentId?: string,
): InventoryOverviewCategorySnapshot[] {
	return categories
		.filter(category => category.parentId === parentId)
		.sort(compareCategories);
}

export function reorderCategorySiblings(
	categories: readonly InventoryOverviewCategorySnapshot[],
	categoryId: string,
	direction: -1 | 1,
): InventoryOverviewCategorySnapshot[] | undefined {
	const category = categories.find(entry => entry.id === categoryId);
	if (!category) {
		return undefined;
	}
	const siblings = orderedCategorySiblings(categories, category.parentId);
	const currentIndex = siblings.findIndex(entry => entry.id === categoryId);
	const targetIndex = currentIndex + direction;
	if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
		return undefined;
	}
	const reordered = [...siblings];
	[reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex]!, reordered[currentIndex]!];
	return reordered;
}

export function reorderCategorySiblingsByDrop(
	categories: readonly InventoryOverviewCategorySnapshot[],
	draggedCategoryId: string,
	targetCategoryId: string,
	placement: 'after' | 'before',
): InventoryOverviewCategorySnapshot[] | undefined {
	if (draggedCategoryId === targetCategoryId) {
		return undefined;
	}
	const dragged = categories.find(category => category.id === draggedCategoryId);
	const target = categories.find(category => category.id === targetCategoryId);
	if (!dragged || !target || dragged.parentId !== target.parentId) {
		return undefined;
	}
	const siblings = orderedCategorySiblings(categories, dragged.parentId);
	const withoutDragged = siblings.filter(category => category.id !== draggedCategoryId);
	const targetIndex = withoutDragged.findIndex(category => category.id === targetCategoryId);
	if (targetIndex < 0) {
		return undefined;
	}
	const reordered = [...withoutDragged];
	reordered.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, dragged);
	return reordered.every((category, index) => category.id === siblings[index]?.id)
		? undefined
		: reordered;
}

function selectedCategoryIds(
	selectedCategoryId: string,
	categories: readonly InventoryOverviewCategorySnapshot[],
): Set<string> {
	if (selectedCategoryId === 'all' || selectedCategoryId === 'unclassified') {
		return new Set();
	}
	const ids = new Set([selectedCategoryId]);
	for (const category of categories) {
		if (category.parentId === selectedCategoryId) {
			ids.add(category.id);
		}
	}
	return ids;
}

function matchesCategory(
	item: InventoryOverviewItemSnapshot,
	selectedCategoryId: string,
	categoryIds: ReadonlySet<string>,
	knownCategoryIds: ReadonlySet<string>,
): boolean {
	if (selectedCategoryId === 'all') {
		return true;
	}
	if (selectedCategoryId === 'unclassified') {
		return !item.categoryId || !knownCategoryIds.has(item.categoryId);
	}
	return Boolean(item.categoryId && categoryIds.has(item.categoryId));
}

function compareItems(
	left: InventoryOverviewItemSnapshot,
	right: InventoryOverviewItemSnapshot,
	state: InventoryOverviewViewState,
	categoryRanks: ReadonlyMap<string, number>,
): number {
	if (state.sort === 'stock') {
		const stateDifference = stockRank(left) - stockRank(right);
		if (stateDifference !== 0) {
			return stateDifference;
		}
		const quantityDifference = comparableQuantity(right) - comparableQuantity(left);
		if (quantityDifference !== 0) {
			return quantityDifference;
		}
	}
	else if (state.sort === 'updated') {
		const difference = timestamp(right.updatedAt) - timestamp(left.updatedAt);
		if (difference !== 0) {
			return difference;
		}
	}
	else if (state.sort === 'category') {
		const difference = categoryRank(left, categoryRanks) - categoryRank(right, categoryRanks);
		if (difference !== 0) {
			return difference;
		}
	}
	const nameDifference = compareText(left.name, right.name);
	return nameDifference !== 0 ? nameDifference : compareText(left.id, right.id);
}

function compareOverviewDefault(
	left: InventoryOverviewItemSnapshot,
	right: InventoryOverviewItemSnapshot,
): number {
	const stockDifference = stockRank(left) - stockRank(right);
	if (stockDifference !== 0) {
		return stockDifference;
	}
	const nameDifference = compareText(left.name, right.name);
	return nameDifference !== 0 ? nameDifference : compareText(left.id, right.id);
}

function inventoryCategoryRanks(
	categories: readonly InventoryOverviewCategorySnapshot[],
): Map<string, number> {
	const ranks = new Map<string, number>();
	let rank = 0;
	for (const parent of orderedCategorySiblings(categories)) {
		ranks.set(parent.id, rank++);
		for (const child of orderedCategorySiblings(categories, parent.id)) {
			ranks.set(child.id, rank++);
		}
	}
	return ranks;
}

function categoryRank(
	item: InventoryOverviewItemSnapshot,
	ranks: ReadonlyMap<string, number>,
): number {
	return ranks.get(item.categoryId ?? '') ?? Number.MAX_SAFE_INTEGER;
}

function compareCategories(left: InventoryOverviewCategorySnapshot, right: InventoryOverviewCategorySnapshot): number {
	return left.sortOrder - right.sortOrder || compareText(left.name, right.name) || compareText(left.id, right.id);
}

function stockRank(item: InventoryOverviewItemSnapshot): number {
	return item.state === 'in-stock' ? 0 : 1;
}

function comparableQuantity(item: InventoryOverviewItemSnapshot): number {
	return item.quantity ?? -1;
}

function timestamp(value: string): number {
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? 0 : parsed;
}

function compareText(left: string, right: string): number {
	return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

function toSearchInventoryItem(item: InventoryOverviewItemSnapshot): InventoryItem {
	return {
		id: item.id,
		categoryId: item.categoryId,
		identity: {
			name: item.name,
			lcscPartNumber: item.lcscPartNumber || undefined,
			supplierId: item.supplierId || undefined,
			manufacturerPartNumber: item.manufacturerPartNumber || undefined,
			manufacturer: item.manufacturer || undefined,
			package: item.package || undefined,
		},
		edaModelStatus: item.edaModelStatus,
		quantity: item.quantity,
		precision: item.precision,
		state: item.state,
		location: item.location || undefined,
		source: 'manual',
		createdAt: item.updatedAt,
		updatedAt: item.updatedAt,
		revision: item.revision,
	};
}
