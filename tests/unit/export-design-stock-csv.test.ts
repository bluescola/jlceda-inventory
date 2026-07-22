import type { DesignStockCheckReport } from '../../src/features/design-stock-check/application/check-design-stock';
import type { DesignStockCsvLabels } from '../../src/features/design-stock-check/application/export-design-stock-csv';
import { describe, expect, it } from 'vitest';
import { createDesignStockShortageCsv } from '../../src/features/design-stock-check/application/export-design-stock-csv';

const labels: DesignStockCsvLabels = {
	partNumber: 'C number',
	name: 'Name',
	manufacturerPartNumber: 'MPN',
	package: 'Package',
	designators: 'Designators',
	unitQuantity: 'Unit quantity',
	boardQuantity: 'Board quantity',
	requiredQuantity: 'Required',
	availableQuantity: 'Available',
	shortageQuantity: 'Shortage',
	status: 'Status',
	emptyValue: '-',
	statuses: {
		'sufficient': 'Sufficient',
		'insufficient': 'Insufficient',
		'review-required': 'Review required',
		'stocktake-required': 'Stocktake required',
		'inventory-missing': 'Missing',
		'identity-unmatched': 'Identity unmatched',
	},
};

describe('createDesignStockShortageCsv', () => {
	it('exports only shortage and review rows with stable report quantities', () => {
		const report: DesignStockCheckReport = {
			boardQuantity: 2,
			rows: [
				createRow('sufficient', 'C1', 4, 10, 0),
				createRow('insufficient', 'C2', 6, 1, 5),
				createRow('stocktake-required', 'C3', 2, null, null),
			],
		};

		const csv = createDesignStockShortageCsv(report, labels);

		expect(csv).not.toContain('C1');
		expect(csv).toContain('"C2"');
		expect(csv).toContain('"C3"');
		expect(csv).toContain('"Stocktake required"');
		expect(csv.split('\r\n')).toHaveLength(3);
	});

	it('quotes user-controlled cells and neutralizes spreadsheet formulas', () => {
		const report: DesignStockCheckReport = {
			boardQuantity: 1,
			rows: [{
				...createRow('identity-unmatched', undefined, 1, null, null),
				identity: { name: '=HYPERLINK("bad")', manufacturerPartNumber: '+1,2' },
			}],
		};

		const csv = createDesignStockShortageCsv(report, labels);

		expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
		expect(csv).toContain('"\'+1,2"');
	});
});

function createRow(
	status: DesignStockCheckReport['rows'][number]['status'],
	lcscPartNumber: string | undefined,
	requiredQuantity: number,
	availableQuantity: number | null,
	shortageQuantity: number | null,
): DesignStockCheckReport['rows'][number] {
	return {
		key: lcscPartNumber ?? 'unmatched',
		identity: { lcscPartNumber, name: 'Part' },
		designators: ['R1'],
		unitQuantity: requiredQuantity,
		firstSourceIndex: 0,
		boardQuantity: 1,
		requiredQuantity,
		inventoryItemIds: [],
		inventoryState: status === 'identity-unmatched' ? 'identity-unmatched' : 'exact',
		availableQuantity,
		shortageQuantity,
		status,
	};
}
