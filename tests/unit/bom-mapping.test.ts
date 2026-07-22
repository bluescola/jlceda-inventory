import type { BomSheet } from '../../src/features/bom-analysis/domain/bom-analysis';
import { describe, expect, it } from 'vitest';
import { mapBomRows } from '../../src/features/bom-analysis/application/map-bom-rows';

describe('mapBomRows', () => {
	it('normalizes mapped rows, derives quantity from designators, and skips excluded parts', () => {
		const result = mapBomRows(sheet([
			['立创编号', '位号', '数量', '名称', '厂家型号', '制造商', '封装', '不加入BOM'],
			['25804', 'R1, R2', '', '10k 电阻', '0603WAF1002T5E', 'UNI-ROYAL', '0603', '否'],
			['C12345', 'C1 C2', '3', '电容', 'CAP-10U', 'Brand', '0805', '0'],
			['C99999', 'D1', '1', '不装器件', '', '', 'SOD-123', '是'],
		]), 0, {
			lcscPartNumber: 0,
			designators: 1,
			quantity: 2,
			name: 3,
			manufacturerPartNumber: 4,
			manufacturer: 5,
			package: 6,
			excludeFromBom: 7,
		});

		expect(result.demands).toHaveLength(2);
		expect(result.demands[0]).toEqual({
			sheetName: 'Main',
			rowNumber: 2,
			lcscPartNumber: 'C25804',
			designators: ['R1', 'R2'],
			quantity: 2,
			identity: {
				name: '10k 电阻',
				manufacturerPartNumber: '0603WAF1002T5E',
				manufacturer: 'UNI-ROYAL',
				package: '0603',
			},
		});
		expect(result.issues).toEqual([
			expect.objectContaining({ code: 'quantity-designator-mismatch', rowNumber: 3 }),
		]);
	});

	it('retains rows without a valid C number and reports invalid rows independently', () => {
		const result = mapBomRows(sheet([
			['LCSC', 'Qty', 'Name', 'DNP'],
			['X100', '1', 'Custom part', 'maybe'],
			['', 'bad', 'Invalid quantity', ''],
			['', '2', 'No C number', ''],
		]), 0, { lcscPartNumber: 0, quantity: 1, name: 2, excludeFromBom: 3 });

		expect(result.demands).toHaveLength(2);
		expect(result.demands.map(demand => demand.lcscPartNumber)).toEqual([undefined, undefined]);
		expect(result.issues.map(issue => [issue.rowNumber, issue.code])).toEqual([
			[2, 'invalid-exclusion'],
			[2, 'invalid-lcsc-part-number'],
			[3, 'invalid-quantity'],
			[4, 'missing-lcsc-part-number'],
		]);
	});

	it('allows a designator-only quantity source and deduplicates repeated references', () => {
		const result = mapBomRows(sheet([
			['References', 'Comment'],
			['R1, R1; R2', 'Resistors'],
		]), 0, { designators: 0, name: 1 });

		expect(result.demands[0]).toMatchObject({ designators: ['R1', 'R2'], quantity: 2 });
		expect(result.issues).toEqual([
			expect.objectContaining({ code: 'missing-lcsc-part-number', rowNumber: 2 }),
		]);
	});

	it('rejects invalid, duplicate, and incomplete column mappings before reading rows', () => {
		const source = sheet([['LCSC', 'Qty'], ['C1', '1']]);

		expect(() => mapBomRows(source, -1, { lcscPartNumber: 0, quantity: 1 })).toThrow('header row index');
		expect(() => mapBomRows(source, 0, { lcscPartNumber: 0, quantity: 0 })).toThrow('mapped more than once');
		expect(() => mapBomRows(source, 0, { lcscPartNumber: 0 })).toThrow('requires quantity or designators');
		expect(() => mapBomRows(source, 0, { quantity: 1 })).toThrow('requires an identity or designator');
		expect(() => mapBomRows(source, 0, { lcscPartNumber: 0, quantity: 2 })).toThrow('out of range');
	});
});

function sheet(rows: string[][]): BomSheet {
	return { name: 'Main', rows, headerCandidates: [] };
}
