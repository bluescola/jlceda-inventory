import type { InventoryOverviewColumnPreferences } from '../../src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview-model';
import type {
	InventoryOverviewCategorySnapshot,
	InventoryOverviewItemSnapshot,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-protocol';
import type { InventoryOverviewViewState } from '../../src/platform/jlceda-v3/presentation/inventory-overview-panel';
import { describe, expect, it } from 'vitest';
import {
	canHideInventoryOverviewColumn,
	captureInventoryOverviewScroll,
	defaultInventoryOverviewColumnPreferences,
	filterAndSortInventory,
	INVENTORY_OVERVIEW_COLUMN_PREFERENCE_KEY,
	inventoryCategoryCounts,
	inventoryItemsForCategoryDrop,
	inventoryItemsForDrag,
	inventoryOverviewFocusPage,
	inventoryOverviewLcscPartNumber,
	inventoryOverviewLocationLabel,
	inventoryOverviewPackageLabel,
	loadInventoryOverviewColumnPreferences,
	paginateInventory,
	parseInventoryOverviewColumnPreferences,
	reorderCategorySiblings,
	reorderCategorySiblingsByDrop,
	resolveBulkCategoryTarget,
	resolveInventoryItemDropCategory,
	restoreInventoryOverviewScroll,
	revealInventoryOverviewFocus,
	saveInventoryOverviewColumnPreferences,
	selectInventoryOverviewCategory,
	setInventoryOverviewColumnVisibility,
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
	it('prefers structured storage while retaining the legacy free-text location', () => {
		expect(inventoryOverviewLocationLabel({
			location: 'Legacy shelf',
			structuredLocation: { cabinet: 'A', box: '2', row: '3', column: '4' },
		})).toBe('A / 2 / 3 / 4\nLegacy shelf');
		expect(inventoryOverviewLocationLabel({ location: 'Legacy shelf' })).toBe('Legacy shelf');
	});

	it('parses versioned column preferences through a strict whitelist and safe defaults', () => {
		const defaults = defaultInventoryOverviewColumnPreferences();
		expect(parseInventoryOverviewColumnPreferences(undefined)).toEqual(defaults);
		expect(parseInventoryOverviewColumnPreferences('{broken')).toEqual(defaults);
		expect(parseInventoryOverviewColumnPreferences(JSON.stringify({ version: 2, visibleColumns: ['quantity'] }))).toEqual(defaults);
		expect(parseInventoryOverviewColumnPreferences(JSON.stringify({ version: 1, visibleColumns: ['number'] }))).toEqual(defaults);
		expect(parseInventoryOverviewColumnPreferences(JSON.stringify({
			version: 1,
			visibleColumns: ['number', 'unknown-column', 'quantity', 'quantity'],
		}))).toEqual({ version: 1, visibleColumns: ['number', 'quantity'] });
	});

	it('never hides the last stock-information column', () => {
		let preferences: InventoryOverviewColumnPreferences = { version: 1, visibleColumns: ['number', 'quantity', 'replenishment'] };
		preferences = setInventoryOverviewColumnVisibility(preferences, 'quantity', false);
		expect(preferences.visibleColumns).toEqual(['number', 'replenishment']);
		expect(canHideInventoryOverviewColumn(preferences, 'replenishment')).toBe(false);
		expect(setInventoryOverviewColumnVisibility(preferences, 'replenishment', false)).toEqual(preferences);
		expect(setInventoryOverviewColumnVisibility(preferences, 'location', true).visibleColumns)
			.toEqual(['number', 'replenishment', 'location']);
	});

	it('degrades local column preference storage failures without affecting the inventory', () => {
		const throwingStorage = {
			getItem: () => { throw new Error('blocked'); },
			setItem: () => { throw new Error('blocked'); },
		};
		expect(loadInventoryOverviewColumnPreferences(throwingStorage)).toEqual(defaultInventoryOverviewColumnPreferences());
		expect(saveInventoryOverviewColumnPreferences(throwingStorage, defaultInventoryOverviewColumnPreferences())).toBe(false);

		const values = new Map<string, string>();
		const storage = {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => { values.set(key, value); },
		};
		const preferences: InventoryOverviewColumnPreferences = { version: 1, visibleColumns: ['minimum-quantity'] };
		expect(saveInventoryOverviewColumnPreferences(storage, preferences)).toBe(true);
		expect(values.has(INVENTORY_OVERVIEW_COLUMN_PREFERENCE_KEY)).toBe(true);
		expect(loadInventoryOverviewColumnPreferences(storage)).toEqual(preferences);
	});

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

	it('filters replenishment and favorite states independently', () => {
		const replenishmentItems: InventoryOverviewItemSnapshot[] = [
			{ ...items[0]!, replenishmentStatus: 'depleted' },
			{ ...items[1]!, replenishmentStatus: 'low', minimumQuantity: 20, favorite: true },
			{ ...items[2]!, replenishmentStatus: 'needs-count', minimumQuantity: 5 },
			{ ...items[3]!, replenishmentStatus: 'sufficient', minimumQuantity: 5, favorite: true },
		];

		expect(filterAndSortInventory(replenishmentItems, categories, {
			...defaultState,
			replenishmentFilter: 'needs-replenishment',
		}).map(item => item.id)).toEqual(['exact-stock', 'exact-depleted']);
		expect(filterAndSortInventory(replenishmentItems, categories, {
			...defaultState,
			replenishmentFilter: 'stocktake-required',
		}).map(item => item.id)).toEqual(['prefix']);
		expect(filterAndSortInventory(replenishmentItems, categories, {
			...defaultState,
			favoriteFilter: 'favorites',
		}).map(item => item.id)).toEqual(['contains', 'exact-stock']);
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

	it('resolves the page containing an exact focused item without changing result filters', () => {
		const result = Array.from({ length: 60 }, (_, index) => ({ id: `item-${index}` }));

		expect(inventoryOverviewFocusPage(result, 'item-52', 25)).toBe(3);
		expect(inventoryOverviewFocusPage(result, 'missing', 25)).toBeUndefined();
		expect(inventoryOverviewFocusPage(result, undefined, 25)).toBeUndefined();
		expect(result).toHaveLength(60);
	});

	it('scrolls a focused row into view and removes its explicit highlight after the timeout', () => {
		const classes = new Set<string>();
		const attributes = new Map<string, string>();
		let cleanup: (() => void) | undefined;
		let scheduledDelay: number | undefined;
		let scrollOptions: ScrollIntoViewOptions | undefined;
		const target = {
			classList: {
				add: (...tokens: string[]) => tokens.forEach(token => classes.add(token)),
				remove: (...tokens: string[]) => tokens.forEach(token => classes.delete(token)),
			},
			setAttribute: (name: string, value: string) => attributes.set(name, value),
			removeAttribute: (name: string) => attributes.delete(name),
			scrollIntoView: (options?: ScrollIntoViewOptions) => { scrollOptions = options; },
		};

		revealInventoryOverviewFocus(target, (callback, delay) => {
			cleanup = callback;
			scheduledDelay = delay;
		});

		expect(classes.has('inventory-row-focused')).toBe(true);
		expect(attributes.get('aria-current')).toBe('true');
		expect(scrollOptions).toEqual({ behavior: 'auto', block: 'center', inline: 'nearest' });
		expect(scheduledDelay).toBe(2600);
		expect(cleanup).toBeTypeOf('function');
		cleanup?.();
		expect(classes.has('inventory-row-focused')).toBe(false);
		expect(attributes.has('aria-current')).toBe(false);
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

	it('auto-hides only when blur returns focus to the EDA window', () => {
		expect(shouldAutoHideInventoryOverview(true, false, true, true)).toBe(true);
		expect(shouldAutoHideInventoryOverview(true, false, true, false)).toBe(false);
		expect(shouldAutoHideInventoryOverview(false, false, true, true)).toBe(false);
		expect(shouldAutoHideInventoryOverview(true, true, true, true)).toBe(false);
		expect(shouldAutoHideInventoryOverview(true, false, false, true)).toBe(false);
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
		favorite: false,
		replenishmentStatus: state === 'depleted' ? 'depleted' : 'not-configured',
		location: '',
		datasheetUrl: '',
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
