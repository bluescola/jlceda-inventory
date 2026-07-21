import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import { describe, expect, it } from 'vitest';
import { searchInventory } from '../../src/features/inventory-search/application/search-inventory';

function item(
	id: string,
	identity: Partial<InventoryItem['identity']> = {},
	state: InventoryItem['state'] = 'in-stock',
	updatedAt = '2026-01-01T00:00:00.000Z',
): InventoryItem {
	return {
		id,
		identity: { name: `Part ${id}`, ...identity },
		quantity: state === 'in-stock' ? 10 : 0,
		precision: 'exact',
		state,
		edaModelStatus: 'unchecked',
		source: 'manual',
		createdAt: updatedAt,
		updatedAt,
		revision: 1,
	};
}

describe('searchInventory', () => {
	it.each([
		['C number', { lcscPartNumber: 'C25804' }],
		['supplier number', { supplierId: 'SUP-25804' }],
		['manufacturer part number', { manufacturerPartNumber: '0603WAF1002T5E' }],
		['name', { name: 'Precision resistor' }],
		['manufacturer', { manufacturer: 'UNI-ROYAL' }],
		['package', { package: '0603' }],
	] satisfies [string, Partial<InventoryItem['identity']>][])('searches by %s', (_, identity) => {
		expect(searchInventory([item('matched', identity)], Object.values(identity)[0]!).map(result => result.id)).toEqual(['matched']);
	});

	it('ranks exact matches ahead of prefix matches and prefix matches ahead of contains matches', () => {
		const ranked = searchInventory([
			item('contains', { lcscPartNumber: 'ABC123XYZ' }),
			item('prefix', { lcscPartNumber: 'C12345' }),
			item('exact', { lcscPartNumber: 'C123' }),
		], 'C123');

		expect(ranked.map(result => result.id)).toEqual(['exact', 'prefix', 'contains']);
	});

	it('prefers stock at the same match rank, then sorts by most recent update', () => {
		const ranked = searchInventory([
			item('older-stock', { manufacturer: 'Maker' }, 'in-stock', '2026-01-01T00:00:00.000Z'),
			item('newer-depleted', { manufacturer: 'Maker' }, 'depleted', '2026-04-01T00:00:00.000Z'),
			item('newer-stock', { manufacturer: 'Maker' }, 'in-stock', '2026-03-01T00:00:00.000Z'),
		], 'Maker');

		expect(ranked.map(result => result.id)).toEqual(['newer-stock', 'older-stock', 'newer-depleted']);
	});

	it('shows all inventory for a whitespace-only query with stock first and recent updates first', () => {
		const ranked = searchInventory([
			item('older-depleted', {}, 'depleted', '2026-01-01T00:00:00.000Z'),
			item('newer-stock', {}, 'in-stock', '2026-04-01T00:00:00.000Z'),
			item('newer-depleted', {}, 'depleted', '2026-03-01T00:00:00.000Z'),
			item('older-stock', {}, 'in-stock', '2026-02-01T00:00:00.000Z'),
		], '  \t\n ');

		expect(ranked.map(result => result.id)).toEqual(['newer-stock', 'older-stock', 'newer-depleted', 'older-depleted']);
	});

	it('normalizes case and surrounding or repeated whitespace', () => {
		const ranked = searchInventory([
			item('matched', { name: '  Precision   RESISTOR  ' }),
			item('other', { name: 'Ceramic capacitor' }),
		], ' precision resistor ');

		expect(ranked.map(result => result.id)).toEqual(['matched']);
	});

	it('returns no results when no searchable field matches', () => {
		const ranked = searchInventory([
			item('resistor', { lcscPartNumber: 'C25804', manufacturer: 'UNI-ROYAL' }),
			item('capacitor', { package: '0402', manufacturerPartNumber: 'CL05B104KO5NNNC' }),
		], 'not-present');

		expect(ranked).toEqual([]);
	});
});
