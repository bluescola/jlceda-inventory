import type { ReplenishmentInventoryState, ReplenishmentStatus } from '../../src/features/inventory/domain/replenishment';
import { describe, expect, it } from 'vitest';
import { normalizeInventoryItem } from '../../src/features/inventory/domain/inventory-item';
import { classifyReplenishment } from '../../src/features/inventory/domain/replenishment';

describe('inventory replenishment fields', () => {
	it('stores only valid thresholds and an explicitly enabled favorite', () => {
		const item = normalizeInventoryItem({
			identity: { name: 'Favorite part' },
			quantity: 20,
			precision: 'exact',
			minimumQuantity: 5,
			favorite: true,
			source: 'manual',
		}, '2026-07-22T00:00:00.000Z', 'item-1');
		const ordinary = normalizeInventoryItem({
			identity: { name: 'Ordinary part' },
			quantity: 20,
			precision: 'exact',
			favorite: false,
			source: 'manual',
		}, '2026-07-22T00:00:00.000Z', 'item-2');

		expect(item).toMatchObject({ minimumQuantity: 5, favorite: true });
		expect(ordinary).not.toHaveProperty('minimumQuantity');
		expect(ordinary).not.toHaveProperty('favorite');
	});

	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.POSITIVE_INFINITY])(
		'rejects invalid normalized threshold %s',
		(minimumQuantity) => {
			expect(() => normalizeInventoryItem({
				identity: { name: 'Invalid threshold' },
				quantity: 20,
				precision: 'exact',
				minimumQuantity,
				source: 'manual',
			}, '2026-07-22T00:00:00.000Z', 'item-invalid')).toThrow('positive safe integer');
		},
	);
});

describe('classifyReplenishment', () => {
	it.each<Array<[ReplenishmentInventoryState, ReplenishmentStatus]>>([
		[{ state: 'depleted', precision: 'exact', quantity: 0 }, 'depleted'],
		[{ state: 'in-stock', precision: 'exact', quantity: 10 }, 'not-configured'],
		[{ state: 'in-stock', precision: 'exact', quantity: 5, minimumQuantity: 5 }, 'sufficient'],
		[{ state: 'in-stock', precision: 'exact', quantity: 4, minimumQuantity: 5 }, 'low'],
		[{ state: 'in-stock', precision: 'estimated', quantity: 4, minimumQuantity: 5 }, 'possibly-low'],
		[{ state: 'in-stock', precision: 'estimated', quantity: 5, minimumQuantity: 5 }, 'sufficient'],
		[{ state: 'in-stock', precision: 'unknown', quantity: null, minimumQuantity: 5 }, 'needs-count'],
	])('classifies %o as %s', (item, expected) => {
		expect(classifyReplenishment(item)).toBe(expected);
	});
});
