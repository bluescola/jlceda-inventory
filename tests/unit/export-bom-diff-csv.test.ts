import type { BomDiffCsvLabels } from '../../src/features/bom-analysis/application/export-bom-diff-csv';
import type { BomDiffResult } from '../../src/features/bom-analysis/domain/bom-analysis';
import { describe, expect, it } from 'vitest';
import { createBomDiffCsv } from '../../src/features/bom-analysis/application/export-bom-diff-csv';

const labels: BomDiffCsvLabels = {
	type: 'Type',
	lcscPartNumber: 'C number',
	beforeQuantity: 'Before quantity',
	afterQuantity: 'After quantity',
	quantityDelta: 'Delta',
	beforeDesignators: 'Before designators',
	afterDesignators: 'After designators',
	beforeName: 'Before name',
	afterName: 'After name',
	beforeManufacturerPartNumber: 'Before MPN',
	afterManufacturerPartNumber: 'After MPN',
	beforeManufacturer: 'Before manufacturer',
	afterManufacturer: 'After manufacturer',
	beforePackage: 'Before package',
	afterPackage: 'After package',
	identityChanges: 'Identity changes',
	sourceSheet: 'Source sheet',
	sourceRow: 'Source row',
	emptyValue: '-',
	types: {
		'added': 'Added',
		'removed': 'Removed',
		'quantity-increased': 'Quantity increased',
		'quantity-decreased': 'Quantity decreased',
		'identity-changed': 'Identity changed',
		'unmatched-before': 'Unmatched before',
		'unmatched-after': 'Unmatched after',
	},
	identityFields: {
		name: 'Name',
		manufacturerPartNumber: 'MPN',
		manufacturer: 'Manufacturer',
		package: 'Package',
	},
};

describe('createBomDiffCsv', () => {
	it('exports matched changes and unmatched rows from both files', () => {
		const result: BomDiffResult = {
			entries: [{
				type: 'quantity-increased',
				lcscPartNumber: 'C1',
				before: aggregate('C1', 1, ['R1'], 'Part', '0603'),
				after: aggregate('C1', 3, ['R1', 'R2', 'R3'], 'Part', '0805'),
				quantityDelta: 2,
			}],
			unmatchedBefore: [{
				sheetName: 'Old',
				rowNumber: 4,
				designators: ['U1'],
				quantity: 1,
				identity: { manufacturerPartNumber: 'OLD-1' },
			}],
			unmatchedAfter: [{
				sheetName: 'New',
				rowNumber: 7,
				designators: ['U2'],
				quantity: 2,
				identity: { manufacturerPartNumber: 'NEW-1' },
			}],
		};

		const csv = createBomDiffCsv(result, labels);

		expect(csv).toContain('"Quantity increased","C1","1","3","2"');
		expect(csv).toContain('"Unmatched before","-","1"');
		expect(csv).toContain('"OLD-1"');
		expect(csv).toContain('"Old","4"');
		expect(csv).toContain('"Unmatched after","-","-","2"');
		expect(csv).toContain('"NEW-1"');
		expect(csv).toContain('"New","7"');
		expect(csv.split('\r\n')).toHaveLength(4);
	});

	it('neutralizes formulas in user-controlled fields', () => {
		const result: BomDiffResult = {
			entries: [],
			unmatchedBefore: [],
			unmatchedAfter: [{
				sheetName: '=HYPERLINK("bad")',
				rowNumber: 2,
				designators: ['+CMD'],
				quantity: 1,
				identity: { name: '@SUM(1,1)' },
			}],
		};

		const csv = createBomDiffCsv(result, labels);

		expect(csv).toContain('"\'+CMD"');
		expect(csv).toContain('"\'@SUM(1,1)"');
		expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
	});
});

function aggregate(
	lcscPartNumber: string,
	quantity: number,
	designators: string[],
	name: string,
	packageName: string,
): NonNullable<BomDiffResult['entries'][number]['before']> {
	return {
		lcscPartNumber,
		quantity,
		designators,
		identity: {
			name: [name],
			manufacturerPartNumber: [],
			manufacturer: [],
			package: [packageName],
		},
		sourceRows: [{ sheetName: 'Main', rowNumber: 2 }],
	};
}
