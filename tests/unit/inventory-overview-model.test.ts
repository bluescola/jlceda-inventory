import type {
	InventoryOverviewCategorySnapshot,
	InventoryOverviewItemSnapshot,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-protocol';
import type { InventoryOverviewViewState } from '../../src/platform/jlceda-v3/presentation/inventory-overview-panel';
import { describe, expect, it } from 'vitest';
import {
	filterAndSortInventory,
	inventoryCategoryCounts,
	paginateInventory,
	reorderCategorySiblings,
	reorderCategorySiblingsByDrop,
	resolveBulkCategoryTarget,
	resolveInventoryItemDropCategory,
	shouldClearAppliedSearch,
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

	it('defaults to in-stock records grouped by category and then name', () => {
		const result = filterAndSortInventory(items, categories, defaultState);
		expect(result.map(item => item.id)).toEqual(['exact-stock', 'prefix', 'contains', 'exact-depleted']);
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

		expect(order('relevance')).toEqual(['exact-stock', 'prefix', 'contains', 'exact-depleted']);
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

	it('keeps primary and secondary bulk category fields structurally separate', () => {
		expect(resolveBulkCategoryTarget(categories, '', '')).toEqual({ valid: true, categoryId: undefined });
		expect(resolveBulkCategoryTarget(categories, 'passive', '')).toEqual({ valid: true, categoryId: 'passive' });
		expect(resolveBulkCategoryTarget(categories, 'passive', 'capacitor')).toEqual({ valid: true, categoryId: 'capacitor' });
		expect(resolveBulkCategoryTarget(categories, 'semiconductor', 'capacitor')).toEqual({ valid: false });
		expect(resolveBulkCategoryTarget(categories, 'missing', '')).toEqual({ valid: false });
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
		quantity: state === 'depleted' ? 0 : 10,
		precision: 'exact',
		state,
		location: '',
		edaModelStatus: 'available',
		hasEdaModel: true,
		updatedAt,
		updatedAtLabel: updatedAt,
		revision: 1,
	};
}
