import type { BomDesignDemand, BomPartIdentity } from '../../src/features/bom-analysis/domain/bom-analysis';
import { describe, expect, it } from 'vitest';
import { aggregateBomDemands, diffNormalizedBoms } from '../../src/features/bom-analysis/domain/diff-boms';

describe('diffNormalizedBoms', () => {
	it('reports additions, removals, quantity changes, identity changes, and unmatched rows', () => {
		const before = [
			demand('C1', 1, { name: 'Resistor', package: '0603' }, ['R1']),
			demand('1', 2, { name: 'RESISTOR', package: '0603' }, ['R2', 'R3'], 3),
			demand('C2', 4, { name: 'Capacitor' }),
			demand(undefined, 1, { name: 'Unmatched before' }),
		];
		const after = [
			demand('C1', 5, { name: 'resistor', package: '0805' }, ['R1', 'R2', 'R3', 'R4', 'R5']),
			demand('C3', 2, { name: 'Diode' }),
			demand(undefined, 3, { manufacturerPartNumber: 'CUSTOM-1' }),
		];

		const result = diffNormalizedBoms(before, after);

		expect(result.entries.map(entry => [entry.lcscPartNumber, entry.type, entry.quantityDelta])).toEqual([
			['C1', 'quantity-increased', 2],
			['C1', 'identity-changed', undefined],
			['C2', 'removed', -4],
			['C3', 'added', 2],
		]);
		expect(result.entries[1].identityChanges).toEqual([{
			field: 'package',
			before: ['0603'],
			after: ['0805'],
		}]);
		expect(result.entries[0].before).toMatchObject({
			quantity: 3,
			designators: ['R1', 'R2', 'R3'],
			sourceRows: [{ sheetName: 'Main', rowNumber: 2 }, { sheetName: 'Main', rowNumber: 3 }],
		});
		expect(result.unmatchedBefore[0].identity.name).toBe('Unmatched before');
		expect(result.unmatchedAfter[0].identity.manufacturerPartNumber).toBe('CUSTOM-1');
	});

	it('does not report case-only identity changes or reordered duplicate identity values', () => {
		const before = [
			demand('C10', 1, { name: 'Part', manufacturer: 'Brand' }),
			demand('C10', 1, { name: 'Alternate' }),
		];
		const after = [
			demand('C10', 1, { name: 'alternate' }),
			demand('C10', 1, { name: 'PART', manufacturer: 'brand' }),
		];

		expect(diffNormalizedBoms(before, after).entries).toEqual([]);
	});

	it('rejects non-positive and overflowing aggregate quantities', () => {
		expect(() => aggregateBomDemands([demand('C1', 0)])).toThrow('safe integer range');
		expect(() => aggregateBomDemands([demand(undefined, 0)])).toThrow('safe integer range');
		expect(() => aggregateBomDemands([
			demand('C1', Number.MAX_SAFE_INTEGER),
			demand('C1', 1),
		])).toThrow('safe integer range');
	});
});

function demand(
	lcscPartNumber: string | undefined,
	quantity: number,
	identity: BomPartIdentity = {},
	designators: string[] = [],
	rowNumber = 2,
): BomDesignDemand {
	return { sheetName: 'Main', rowNumber, lcscPartNumber, quantity, designators, identity };
}
