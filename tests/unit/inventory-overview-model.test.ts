import type {
	InventoryOverviewCategorySnapshot,
	InventoryOverviewItemSnapshot,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-protocol';
import type { InventoryOverviewViewState } from '../../src/platform/jlceda-v3/presentation/inventory-overview-panel';
import { describe, expect, it } from 'vitest';
import {
	captureInventoryOverviewScroll,
	filterAndSortInventory,
	inventoryCategoryCounts,
	inventoryItemsForCategoryDrop,
	inventoryItemsForDrag,
	inventoryOverviewLcscPartNumber,
	inventoryOverviewPackageLabel,
	paginateInventory,
	reorderCategorySiblings,
	reorderCategorySiblingsByDrop,
	resolveBulkCategoryTarget,
	resolveInventoryItemDropCategory,
	restoreInventoryOverviewScroll,
	selectInventoryOverviewCategory,
	shouldAutoHideInventoryOverview,
	shouldClearAppliedSearch,
	shouldSuppressAutoHideForWindowControl,
	updateFilteredInventorySelection,
} from '../../src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview-model';

const categories: InventoryOverviewCategorySnapshot[] = [
	{ id: 'passive', name: 'Passive', sortOrder: 0, revision: 1 },
	{ id: 'resistor', name: 'Resistor', parentId: 'passive', sortOrder: 0, revision: 2 },
	{ id: 'capacitor', name: 'Capacitor', parentId: 'passive', sortOrder: 1, revision: 3 },
	{ id: 'semiconductor', name: 'Semiconductor', sortOrder: 1, revision: 4 },
];

const items: InventoryOverviewItemSnapshot[] = [
	createItem('exact-depleted', 'Exact depleted', 'C100', 'resistor', 'depleted', '2026-07-21T00:00:00.000Z'),
	createItem('exact-stock', 'Exact stock', 'C100', 'capacitor', 'in-stock', '2026-07-20T00:00:00.000Z'),
	createItem('prefix', 'Prefix', 'C1000', 'semiconductor', 'in-stock', '2026-07-22T00:00:00.000Z'),
	createItem('contains', 'Contains C100 value', 'C999', undefined, 'in-stock', '2026-07-23T00:00:00.000Z'),
];

const defaultState: InventoryOverviewViewState = {
	query: '',
	searchScope: 'all',
	categoryId: 'all',
	stockFilter: 'all',
	modelFilter: 'all',
	sort: 'relevance',
	page: 1,
	pageSize: 50,
};

describe('inventory overview model', () => {
	it('uses shared marketplace-style exact, prefix, contains, and stock ranking', () => {
		const result = filterAndSortInventory(items, categories, { ...defaultState, query: 'c100' });
		expect(result.map(item => item.id)).toEqual(['exact-stock', 'exact-depleted', 'prefix', 'contains']);
	});

	it('defaults to in-stock records sorted globally by name', () => {
		const result = filterAndSortInventory(items, categories, defaultState);
		expect(result.map(item => item.id)).toEqual(['contains', 'exact-stock', 'prefix', 'exact-depleted']);
	});

	it('applies all five sort options to deliberately unordered records', () => {
		const sortableItems = items.map((item) => {
			const quantities: Record<string, number> = {
				'exact-stock': 20,
				'prefix': 30,
				'contains': 10,
				'exact-depleted': 0,
			};
			return { ...item, quantity: quantities[item.id] };
		});
		const order = (sort: InventoryOverviewViewState['sort']): string[] => filterAndSortInventory(
			sortableItems,
			categories,
			{ ...defaultState, sort },
		).map(item => item.id);

		expect(order('relevance')).toEqual(['contains', 'exact-stock', 'prefix', 'exact-depleted']);
		expect(order('name')).toEqual(['contains', 'exact-depleted', 'exact-stock', 'prefix']);
		expect(order('stock')).toEqual(['prefix', 'exact-stock', 'contains', 'exact-depleted']);
		expect(order('updated')).toEqual(['contains', 'prefix', 'exact-depleted', 'exact-stock']);
		expect(order('category')).toEqual(['exact-depleted', 'exact-stock', 'prefix', 'contains']);
	});

	it('uses the user-managed category order instead of alphabetical category names', () => {
		const reversedChildren = categories.map(category => category.parentId === 'passive'
			? { ...category, sortOrder: category.id === 'capacitor' ? 0 : 1 }
			: category);
		const result = filterAndSortInventory(items, reversedChildren, { ...defaultState, sort: 'category' });

		expect(result.map(item => item.id)).toEqual(['exact-stock', 'exact-depleted', 'prefix', 'contains']);
	});

	it('clears an applied search as soon as the search box becomes empty', () => {
		expect(shouldClearAppliedSearch('', 'C233991')).toBe(true);
		expect(shouldClearAppliedSearch('   ', 'C233991')).toBe(true);
		expect(shouldClearAppliedSearch('C', 'C233991')).toBe(false);
		expect(shouldClearAppliedSearch('', '')).toBe(false);
	});

	it('combines a parent category scope with stock and model filters', () => {
		const result = filterAndSortInventory(items, categories, {
			...defaultState,
			categoryId: 'passive',
			searchScope: 'current',
			stockFilter: 'in-stock',
			modelFilter: 'available',
		});
		expect(result.map(item => item.id)).toEqual(['exact-stock']);
	});

	it('searches all categories only when the explicit all-category scope is selected', () => {
		const current = filterAndSortInventory(items, categories, {
			...defaultState,
			query: 'c100',
			categoryId: 'resistor',
			searchScope: 'current',
		});
		const all = filterAndSortInventory(items, categories, {
			...defaultState,
			query: 'c100',
			categoryId: 'resistor',
			searchScope: 'all',
		});
		expect(current.map(item => item.id)).toEqual(['exact-depleted']);
		expect(all).toHaveLength(4);
	});

	it('switches from a child category to all using the currently displayed sort and resets pagination', () => {
		const childState: InventoryOverviewViewState = {
			...defaultState,
			categoryId: 'resistor',
			page: 4,
			sort: 'category',
		};
		const childResult = filterAndSortInventory(items, categories, childState);
		const allState = selectInventoryOverviewCategory(childState, 'all', 'updated');
		const allResult = filterAndSortInventory(items, categories, allState);

		expect(childResult.map(item => item.id)).toEqual(['exact-depleted']);
		expect(allState).toMatchObject({ categoryId: 'all', page: 1, sort: 'updated' });
		expect(allResult.map(item => item.id)).toEqual(['contains', 'prefix', 'exact-depleted', 'exact-stock']);
	});

	it('does not preserve a child category block at the start of All relevance results', () => {
		const interleaved = [
			createItem('child-a', 'Alpha', 'C1', 'resistor', 'in-stock', '2026-07-21T00:00:00.000Z'),
			createItem('other-b', 'Bravo', 'C2', 'semiconductor', 'in-stock', '2026-07-21T00:00:00.000Z'),
			createItem('child-c', 'Charlie', 'C3', 'resistor', 'in-stock', '2026-07-21T00:00:00.000Z'),
			createItem('other-d', 'Delta', 'C4', undefined, 'in-stock', '2026-07-21T00:00:00.000Z'),
		];

		const childResult = filterAndSortInventory(interleaved, categories, { ...defaultState, categoryId: 'resistor' });
		const allResult = filterAndSortInventory(interleaved, categories, defaultState);
		const categoryResult = filterAndSortInventory(interleaved, categories, { ...defaultState, sort: 'category' });

		expect(childResult.map(item => item.id)).toEqual(['child-a', 'child-c']);
		expect(allResult.map(item => item.id)).toEqual(['child-a', 'other-b', 'child-c', 'other-d']);
		expect(categoryResult.map(item => item.id)).toEqual(['child-a', 'child-c', 'other-b', 'other-d']);
	});

	it('counts parent descendants and unclassified items without summing stock quantities', () => {
		const counts = inventoryCategoryCounts(items, categories);
		expect(counts.get('all')).toBe(4);
		expect(counts.get('passive')).toBe(2);
		expect(counts.get('resistor')).toBe(1);
		expect(counts.get('unclassified')).toBe(1);
	});

	it('paginates without creating rows for the whole result and clamps stale pages', () => {
		const result = paginateInventory(items, 9, 3);
		expect(result).toMatchObject({ total: 4, page: 2, pageCount: 2 });
		expect(result.items.map(item => item.id)).toEqual(['contains']);
	});

	it('returns the complete reordered sibling list for stable category persistence', () => {
		const reordered = reorderCategorySiblings(categories, 'capacitor', -1);
		expect(reordered?.map(category => category.id)).toEqual(['capacitor', 'resistor']);
		expect(reorderCategorySiblings(categories, 'resistor', -1)).toBeUndefined();
	});

	it('reorders a dragged category only among siblings', () => {
		expect(reorderCategorySiblingsByDrop(categories, 'resistor', 'capacitor', 'after')
			?.map(category => category.id)).toEqual(['capacitor', 'resistor']);
		expect(reorderCategorySiblingsByDrop(categories, 'capacitor', 'resistor', 'before')
			?.map(category => category.id)).toEqual(['capacitor', 'resistor']);
		expect(reorderCategorySiblingsByDrop(categories, 'resistor', 'semiconductor', 'before')).toBeUndefined();
		expect(reorderCategorySiblingsByDrop(categories, 'resistor', 'capacitor', 'before')).toBeUndefined();
	});

	it('decodes pointer drop targets without writing when the category is unchanged', () => {
		expect(resolveInventoryItemDropCategory('resistor', 'resistor')).toEqual({ valid: false });
		expect(resolveInventoryItemDropCategory('resistor', '')).toEqual({ valid: true, categoryId: undefined });
		expect(resolveInventoryItemDropCategory(undefined, '')).toEqual({ valid: false });
		expect(resolveInventoryItemDropCategory(undefined, 'capacitor')).toEqual({ valid: true, categoryId: 'capacitor' });
	});

	it('drags one row directly or every selected row and skips records already in the drop category', () => {
		expect(inventoryItemsForDrag(items[0]!, new Set(['exact-stock']), items).map(item => item.id))
			.toEqual(['exact-depleted']);
		expect(inventoryItemsForDrag(items[0]!, new Set(['exact-depleted', 'contains']), items).map(item => item.id))
			.toEqual(['exact-depleted', 'contains']);
		expect(inventoryItemsForCategoryDrop([items[0]!, items[1]!], 'resistor').map(item => item.id))
			.toEqual(['exact-stock']);
		expect(inventoryItemsForCategoryDrop([items[0]!], 'resistor')).toEqual([]);
	});

	it('keeps primary and secondary bulk category fields structurally separate', () => {
		expect(resolveBulkCategoryTarget(categories, '', '')).toEqual({ valid: true, categoryId: undefined });
		expect(resolveBulkCategoryTarget(categories, 'passive', '')).toEqual({ valid: true, categoryId: 'passive' });
		expect(resolveBulkCategoryTarget(categories, 'passive', 'capacitor')).toEqual({ valid: true, categoryId: 'capacitor' });
		expect(resolveBulkCategoryTarget(categories, 'semiconductor', 'capacitor')).toEqual({ valid: false });
		expect(resolveBulkCategoryTarget(categories, 'missing', '')).toEqual({ valid: false });
	});

	it('restores both table scroll axes after selection rerenders replace the rows', () => {
		const container = { scrollLeft: 96, scrollTop: 734 };
		const position = captureInventoryOverviewScroll(container);
		container.scrollLeft = 0;
		container.scrollTop = 0;
		restoreInventoryOverviewScroll(container, position);

		expect(container).toEqual({ scrollLeft: 96, scrollTop: 734 });
		expect(captureInventoryOverviewScroll(undefined)).toBeUndefined();
		expect(() => restoreInventoryOverviewScroll(undefined, position)).not.toThrow();
	});

	it('auto-hides a visible overview after blur unless a host operation is in flight', () => {
		expect(shouldAutoHideInventoryOverview(true, false, true)).toBe(true);
		expect(shouldAutoHideInventoryOverview(false, false, true)).toBe(false);
		expect(shouldAutoHideInventoryOverview(true, true, true)).toBe(false);
		expect(shouldAutoHideInventoryOverview(true, false, false)).toBe(false);
	});

	it('keeps a native minimized title window visible after iframe blur', () => {
		expect(shouldSuppressAutoHideForWindowControl({
			action: 'minimize',
			requestId: 'request-1',
			timestamp: 1_000,
		}, 'request-1', 1_250)).toBe(true);
		expect(shouldSuppressAutoHideForWindowControl({
			action: 'maximize',
			requestId: 'request-1',
			timestamp: 1_000,
		}, 'request-1', 1_250)).toBe(true);
		expect(shouldSuppressAutoHideForWindowControl({
			action: 'minimize',
			requestId: 'stale-request',
			timestamp: 1_000,
		}, 'request-1', 1_250)).toBe(false);
		expect(shouldSuppressAutoHideForWindowControl({
			action: 'minimize',
			requestId: 'request-1',
			timestamp: 1_000,
		}, 'request-1', 2_001)).toBe(false);
	});

	it('uses inventory package, then EDA footprint, and an em dash only when both are absent', () => {
		expect(inventoryOverviewPackageLabel({ package: '0603', edaFootprint: 'R0603' })).toBe('0603');
		expect(inventoryOverviewPackageLabel({ package: '', edaFootprint: 'R0603' })).toBe('R0603');
		expect(inventoryOverviewPackageLabel({ package: '', edaFootprint: '' })).toBe('\u2014');
	});

	it('exposes only a normalized C-prefixed LCSC part number for details and copying', () => {
		expect(inventoryOverviewLcscPartNumber({ lcscPartNumber: ' c233991 ', supplierId: '' })).toBe('C233991');
		expect(inventoryOverviewLcscPartNumber({ lcscPartNumber: '233991', supplierId: '' })).toBe('C233991');
		expect(inventoryOverviewLcscPartNumber({ lcscPartNumber: 'MPN-1', supplierId: '' })).toBe('');
	});

	it('falls back to a valid supplier C number for legacy inventory records', () => {
		expect(inventoryOverviewLcscPartNumber({ lcscPartNumber: '', supplierId: ' c233991 ' })).toBe('C233991');
	});

	it('selects every filtered result independently from the current page and clears explicitly', () => {
		const selected = updateFilteredInventorySelection(new Set(['existing']), items, 'select-all');
		expect(Array.from(selected)).toEqual(['existing', ...items.map(item => item.id)]);
		expect(updateFilteredInventorySelection(selected, items, 'clear')).toEqual(new Set());
	});

	it('filters and paginates 5000 records without rendering the complete result set', () => {
		const largeInventory = Array.from({ length: 5000 }, (_, index) => createItem(
			`item-${index}`,
			`Component ${String(index).padStart(4, '0')}`,
			`C${10000 + index}`,
			index % 2 === 0 ? 'resistor' : 'capacitor',
			index % 9 === 0 ? 'depleted' : 'in-stock',
			`2026-07-21T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
		));
		const startedAt = performance.now();
		const filtered = filterAndSortInventory(largeInventory, categories, {
			...defaultState,
			query: 'component',
		});
		const page = paginateInventory(filtered, 1, 50);
		const elapsed = performance.now() - startedAt;

		expect(filtered).toHaveLength(5000);
		expect(page.items).toHaveLength(50);
		expect(page.pageCount).toBe(100);
		expect(elapsed).toBeLessThan(1000);
	});
});

function createItem(
	id: string,
	name: string,
	lcscPartNumber: string,
	categoryId: string | undefined,
	state: 'depleted' | 'in-stock',
	updatedAt: string,
): InventoryOverviewItemSnapshot {
	return {
		id,
		categoryId,
		name,
		lcscPartNumber,
		supplierId: '',
		manufacturerPartNumber: '',
		manufacturer: '',
		package: '0603',
		edaFootprint: 'R0603',
		edaSymbol: 'R',
		description: '',
		quantity: state === 'depleted' ? 0 : 10,
		precision: 'exact',
		state,
		location: '',
		note: '',
		marketplaceEvidence: 'user-confirmed',
		edaModelStatus: 'available',
		hasEdaModel: true,
		source: 'catalog',
		createdAt: updatedAt,
		createdAtLabel: updatedAt,
		updatedAt,
		updatedAtLabel: updatedAt,
		revision: 1,
	};
}
