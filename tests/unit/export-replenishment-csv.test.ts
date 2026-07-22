import type { ReplenishmentCsvLabels } from '../../src/features/inventory/application/export-replenishment-csv';
import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import { describe, expect, it } from 'vitest';
import { createReplenishmentCsv } from '../../src/features/inventory/application/export-replenishment-csv';

const labels: ReplenishmentCsvLabels = {
	partNumber: 'C number',
	name: 'Name',
	manufacturerPartNumber: 'MPN',
	package: 'Package',
	quantity: 'Quantity',
	precision: 'Precision',
	minimumQuantity: 'Minimum',
	status: 'Status',
	location: 'Location',
	note: 'Note',
	emptyValue: '-',
	precisions: {
		exact: 'Exact',
		estimated: 'Estimated',
		unknown: 'Unknown',
	},
	statuses: {
		'depleted': 'Depleted',
		'low': 'Low',
		'needs-count': 'Needs count',
		'not-configured': 'Not configured',
		'possibly-low': 'Possibly low',
		'sufficient': 'Sufficient',
	},
};

describe('createReplenishmentCsv', () => {
	it('exports only depleted, low, possibly-low and needs-count items', () => {
		const csv = createReplenishmentCsv([
			item('depleted', { state: 'depleted', quantity: 0, minimumQuantity: undefined }),
			item('low', { quantity: 2, minimumQuantity: 5 }),
			item('possibly-low', { quantity: 2, minimumQuantity: 5, precision: 'estimated' }),
			item('needs-count', { quantity: null, minimumQuantity: 5, precision: 'unknown' }),
			item('sufficient', { quantity: 5, minimumQuantity: 5 }),
			item('not-configured', { quantity: 2, minimumQuantity: undefined }),
		], labels);

		expect(csv).toContain('"Cdepleted"');
		expect(csv).toContain('"Clow"');
		expect(csv).toContain('"Cpossibly-low"');
		expect(csv).toContain('"Cneeds-count"');
		expect(csv).not.toContain('"Csufficient"');
		expect(csv).not.toContain('"Cnot-configured"');
		expect(csv.split('\r\n')).toHaveLength(5);
	});

	it('quotes free text, neutralizes spreadsheet formulas and renders unknown values', () => {
		const candidate = item('unsafe', {
			quantity: null,
			minimumQuantity: 5,
			precision: 'unknown',
		});
		candidate.identity.name = '=HYPERLINK("bad")';
		candidate.identity.manufacturerPartNumber = '+1,2';
		candidate.location = '@A1';
		candidate.note = '-2+3';

		const csv = createReplenishmentCsv([candidate], labels);

		expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
		expect(csv).toContain('"\'+1,2"');
		expect(csv).toContain('"\'@A1"');
		expect(csv).toContain('"\'-2+3"');
		expect(csv).toContain('"-","Unknown","5","Needs count"');
	});
});

function item(id: string, overrides: Partial<InventoryItem>): InventoryItem {
	return {
		id,
		identity: { name: id, lcscPartNumber: `C${id}` },
		edaModelStatus: 'unchecked',
		quantity: 1,
		precision: 'exact',
		state: 'in-stock',
		source: 'manual',
		createdAt: '2026-07-22T00:00:00.000Z',
		updatedAt: '2026-07-22T00:00:00.000Z',
		revision: 1,
		...overrides,
	};
}
