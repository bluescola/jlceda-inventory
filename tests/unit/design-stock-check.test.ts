import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import { describe, expect, it } from 'vitest';
import { checkDesignStock } from '../../src/features/design-stock-check/application/check-design-stock';

function inventoryItem(
	id: string,
	lcscPartNumber: string,
	quantity: number | null,
	precision: InventoryItem['precision'] = 'exact',
	state: InventoryItem['state'] = quantity === 0 ? 'depleted' : 'in-stock',
): InventoryItem {
	return {
		id,
		identity: { name: id, lcscPartNumber },
		edaModelStatus: 'unchecked',
		quantity,
		precision,
		state,
		source: 'manual',
		createdAt: '2026-07-22T00:00:00.000Z',
		updatedAt: '2026-07-22T00:00:00.000Z',
		revision: 1,
	};
}

describe('checkDesignStock', () => {
	it('normalizes and aggregates C numbers, applies the board multiplier, and sorts naturally', () => {
		const report = checkDesignStock({
			boardQuantity: 3,
			components: [
				{ designator: 'R10', identity: { name: '10k', lcscPartNumber: ' c 10 ' } },
				{ designator: 'R2', identity: { name: '1k', lcscPartNumber: '2' } },
				{ designator: 'R11', identity: { lcscPartNumber: 'C10', package: '0603' }, quantity: 2 },
			],
			inventory: [
				inventoryItem('stock-c2', 'C2', 3),
				inventoryItem('stock-c10', 'C10', 20),
			],
		});

		expect(report.boardQuantity).toBe(3);
		expect(report.rows.map(row => row.identity.lcscPartNumber)).toEqual(['C2', 'C10']);
		expect(report.rows[0]).toMatchObject({
			designators: ['R2'],
			unitQuantity: 1,
			requiredQuantity: 3,
			availableQuantity: 3,
			shortageQuantity: 0,
			inventoryState: 'exact',
			status: 'sufficient',
		});
		expect(report.rows[1]).toMatchObject({
			designators: ['R10', 'R11'],
			identity: { name: '10k', lcscPartNumber: 'C10', package: '0603' },
			unitQuantity: 3,
			requiredQuantity: 9,
			availableQuantity: 20,
		});
	});

	it('calculates definitive shortages for exact, depleted, and missing inventory', () => {
		const report = checkDesignStock({
			components: [
				{ designator: 'R1', identity: { lcscPartNumber: 'C1' }, quantity: 5 },
				{ designator: 'R2', identity: { lcscPartNumber: 'C2' }, quantity: 2 },
				{ designator: 'R3', identity: { lcscPartNumber: 'C3' } },
			],
			inventory: [
				inventoryItem('exact', 'C1', 3),
				inventoryItem('empty', 'C2', 0, 'exact', 'depleted'),
			],
		});

		expect(report.rows.map(row => ({
			part: row.identity.lcscPartNumber,
			state: row.inventoryState,
			status: row.status,
			shortage: row.shortageQuantity,
		}))).toEqual([
			{ part: 'C1', state: 'exact', status: 'insufficient', shortage: 2 },
			{ part: 'C2', state: 'depleted', status: 'insufficient', shortage: 2 },
			{ part: 'C3', state: 'missing', status: 'inventory-missing', shortage: 1 },
		]);
	});

	it('keeps estimated and unknown quantities non-definitive', () => {
		const report = checkDesignStock({
			components: [
				{ identity: { lcscPartNumber: 'C20' }, quantity: 4 },
				{ identity: { lcscPartNumber: 'C21' }, quantity: 4 },
			],
			inventory: [
				inventoryItem('estimated', 'C20', 2, 'estimated'),
				inventoryItem('unknown', 'C21', null, 'unknown'),
			],
		});

		expect(report.rows[0]).toMatchObject({
			inventoryState: 'estimated',
			availableQuantity: 2,
			shortageQuantity: null,
			status: 'review-required',
		});
		expect(report.rows[1]).toMatchObject({
			inventoryState: 'unknown',
			availableQuantity: null,
			shortageQuantity: null,
			status: 'stocktake-required',
		});
	});

	it('retains every component without a C number and does not match it by name or MPN', () => {
		const components = [
			{ designator: 'U1', identity: { name: 'Custom IC', manufacturerPartNumber: 'ABC-1' } },
			{ designator: 'U2', identity: { name: 'Custom IC', manufacturerPartNumber: 'ABC-1' }, quantity: 2 },
			{ designator: 'U3', identity: { name: 'Non-LCSC supplier part', supplierId: 'ABC-123' } },
			{ designator: 'DNP1', identity: { name: 'Not fitted' }, includeInBom: false },
		] as const;
		const inventory = [inventoryItem('same-mpn-stock', 'C900', 100)];
		inventory[0].identity.manufacturerPartNumber = 'ABC-1';
		const before = JSON.stringify({ components, inventory });

		const report = checkDesignStock({ components, inventory, boardQuantity: 2 });

		expect(report.rows).toHaveLength(3);
		expect(report.rows.map(row => ({
			designators: row.designators,
			requiredQuantity: row.requiredQuantity,
			state: row.inventoryState,
			status: row.status,
		}))).toEqual([
			{ designators: ['U1'], requiredQuantity: 2, state: 'identity-unmatched', status: 'identity-unmatched' },
			{ designators: ['U2'], requiredQuantity: 4, state: 'identity-unmatched', status: 'identity-unmatched' },
			{ designators: ['U3'], requiredQuantity: 2, state: 'identity-unmatched', status: 'identity-unmatched' },
		]);
		expect(JSON.stringify({ components, inventory })).toBe(before);
	});

	it('combines duplicate inventory records conservatively', () => {
		const exact = checkDesignStock({
			components: [{ identity: { lcscPartNumber: 'C30' }, quantity: 5 }],
			inventory: [inventoryItem('one', 'C30', 2), inventoryItem('two', '30', 3)],
		});
		expect(exact.rows[0]).toMatchObject({
			inventoryItemIds: ['one', 'two'],
			inventoryState: 'exact',
			availableQuantity: 5,
			status: 'sufficient',
		});

		const mixed = checkDesignStock({
			components: [{ identity: { lcscPartNumber: 'C30' }, quantity: 5 }],
			inventory: [inventoryItem('known', 'C30', 20), inventoryItem('uncertain', 'C30', null, 'unknown')],
		});
		expect(mixed.rows[0]).toMatchObject({
			inventoryState: 'unknown',
			availableQuantity: null,
			shortageQuantity: null,
			status: 'stocktake-required',
		});
	});

	it('rejects invalid quantities and unsafe multiplication', () => {
		expect(() => checkDesignStock({ components: [], inventory: [], boardQuantity: 0 })).toThrow(
			'Board quantity must be a positive safe integer.',
		);
		expect(() => checkDesignStock({
			components: [{ identity: { lcscPartNumber: 'C1' }, quantity: -1 }],
			inventory: [],
		})).toThrow('Design component quantity at index 0 must be a positive safe integer.');
		expect(() => checkDesignStock({
			components: [{ identity: { lcscPartNumber: 'C1' }, quantity: Number.MAX_SAFE_INTEGER }],
			inventory: [],
			boardQuantity: 2,
		})).toThrow('Required design quantity exceeds the safe integer range.');
	});
});
