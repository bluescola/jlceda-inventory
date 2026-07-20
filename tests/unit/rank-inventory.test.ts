import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import { describe, expect, it } from 'vitest';
import { rankInventory } from '../../src/features/stock-recommendation/application/rank-inventory';

function item(id: string, lcscPartNumber: string, state: InventoryItem['state'], updatedAt = '2026-01-01T00:00:00.000Z'): InventoryItem {
	return {
		id,
		identity: { name: `Part ${id}`, lcscPartNumber },
		quantity: state === 'in-stock' ? 10 : 0,
		precision: 'exact',
		state,
		source: 'manual',
		createdAt: updatedAt,
		updatedAt,
		revision: 1,
	};
}

describe('rankInventory', () => {
	it('ranks an in-stock exact match ahead of a depleted exact match and partial matches', () => {
		const ranked = rankInventory([
			item('partial', 'C12345', 'in-stock'),
			item('depleted', 'C123', 'depleted'),
			item('available', 'C123', 'in-stock'),
		], 'C123');

		expect(ranked.map(result => result.id)).toEqual(['available', 'partial', 'depleted']);
	});
});
