import type { BomDesignDemand } from '../../src/features/bom-analysis/domain/bom-analysis';
import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import { describe, expect, it } from 'vitest';
import { fingerprintBomSource, prepareBomStockOut } from '../../src/features/bom-analysis/application/prepare-bom-stock-out';

describe('prepareBomStockOut', () => {
	it('aggregates board demand and maps each C number to exactly one exact inventory item', async () => {
		const content = new TextEncoder().encode('bom').buffer;
		const result = prepareBomStockOut({
			demands: [demand('C1', 2, ['R1', 'R2']), demand('1', 1, ['R3'])],
			inventory: [item('item-1', 'C1', 10, 'exact')],
			boardQuantity: 2,
			sourceFingerprint: await fingerprintBomSource(content),
			sourceName: 'assembly.csv',
		});

		expect(result).toMatchObject({
			status: 'ready',
			lines: [{
				itemId: 'item-1',
				unitQuantity: 3,
				boardQuantity: 2,
				requiredQuantity: 6,
				beforeQuantity: 10,
				afterQuantity: 4,
			}],
			input: {
				sourceName: 'assembly.csv',
				lines: [{ itemId: 'item-1', quantity: 6, sourceReference: 'R1, R2, R3' }],
			},
		});
		expect(result.input.sourceFingerprint).toMatch(/^[a-f\d]{64}$/);
	});

	it('blocks the whole batch for unmatched, missing, ambiguous, estimated, and insufficient lines', () => {
		const result = prepareBomStockOut({
			demands: [
				demand(undefined, 1),
				demand('C1', 1),
				demand('C2', 1),
				demand('C3', 1),
				demand('C4', 5),
			],
			inventory: [
				item('two-a', 'C2', 3, 'exact'),
				item('two-b', 'C2', 2, 'exact'),
				item('three', 'C3', 10, 'estimated'),
				item('four', 'C4', 2, 'exact'),
			],
			boardQuantity: 1,
			sourceFingerprint: 'a'.repeat(64),
		});

		expect(result.status).toBe('blocked');
		expect(result.issues.map(issue => issue.code)).toEqual([
			'identity-unmatched',
			'inventory-missing',
			'inventory-ambiguous',
			'quantity-not-exact',
			'insufficient-stock',
		]);
		expect(result.input.lines).toEqual([]);
	});

	it('rejects an unsafe board multiplier before preparing any writes', () => {
		expect(() => prepareBomStockOut({
			demands: [demand('C1', Number.MAX_SAFE_INTEGER)],
			inventory: [item('item-1', 'C1', 1, 'exact')],
			boardQuantity: 2,
			sourceFingerprint: 'a'.repeat(64),
		})).toThrow('safe integer range');
	});
});

function demand(lcscPartNumber: string | undefined, quantity: number, designators: string[] = []): BomDesignDemand {
	return {
		sheetName: 'BOM',
		rowNumber: 2,
		lcscPartNumber,
		designators,
		quantity,
		identity: { name: lcscPartNumber ?? 'Custom' },
	};
}

function item(
	id: string,
	lcscPartNumber: string,
	quantity: number | null,
	precision: InventoryItem['precision'],
): InventoryItem {
	return {
		id,
		identity: { name: id, lcscPartNumber },
		edaModelStatus: 'unchecked',
		quantity,
		precision,
		state: quantity === 0 ? 'depleted' : 'in-stock',
		source: 'manual',
		createdAt: '2026-07-22T00:00:00.000Z',
		updatedAt: '2026-07-22T00:00:00.000Z',
		revision: 1,
	};
}
