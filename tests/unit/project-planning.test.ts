import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { NewPurchaseRecord, ProjectDemandSnapshot } from '../../src/features/project-planning/domain/project-planning';
import { describe, expect, it } from 'vitest';
import { analyzeProjectDemand, createProcurementSuggestions } from '../../src/features/project-planning/application/analyze-project-demand';
import { createProjectSnapshot } from '../../src/features/project-planning/application/create-project-snapshot';
import { diffProjectSnapshots } from '../../src/features/project-planning/application/diff-project-snapshots';
import { createProcurementCsv } from '../../src/features/project-planning/application/export-procurement-csv';
import { normalizePurchaseRecord, summarizePurchaseCosts } from '../../src/features/project-planning/application/purchase-cost';
import { sanitizeProjectDemandSnapshot, sanitizePurchaseRecord } from '../../src/features/project-planning/domain/project-planning';

describe('project planning', () => {
	it('captures stable single-board demand with project and document UUIDs', async () => {
		const snapshot = await createProjectSnapshot({
			id: 'snapshot-1',
			label: 'Controller board',
			boardQuantity: 3,
			capturedAt: '2026-07-22T01:00:00Z',
			source: {
				document: { kind: 'pcb', uuid: 'pcb-1', projectUuid: 'project-1' },
				components: [
					{ primitiveId: 'r1', designator: 'R1', lcscPartNumber: 'C1', name: 'Resistor' },
					{ primitiveId: 'r2', designator: 'R2', lcscPartNumber: '1', name: 'Resistor' },
				],
			},
		});

		expect(snapshot).toMatchObject({
			projectUuid: 'project-1',
			documentUuid: 'pcb-1',
			documentKind: 'pcb',
			boardQuantity: 3,
			demands: [{ identity: { lcscPartNumber: 'C1' }, unitQuantity: 2, designators: ['R1', 'R2'] }],
		});
		expect(snapshot.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
	});

	it('aggregates board quantities without treating estimated or unknown inventory as exact', () => {
		const analysis = analyzeProjectDemand([
			snapshot('a', 2, 'C1', 3),
			snapshot('b', 5, 'C1', 1),
			snapshot('c', 1, 'C2', 2),
			snapshot('d', 1, 'C3', 1),
		], [
			inventoryItem('exact', 'C1', 8, 'exact'),
			inventoryItem('estimated', 'C2', 100, 'estimated'),
			inventoryItem('unknown', 'C3', null, 'unknown'),
		]);

		expect(analysis.rows.map(row => [row.identity.lcscPartNumber, row.requiredQuantity, row.status, row.shortageQuantity])).toEqual([
			['C1', 11, 'insufficient', 3],
			['C2', 2, 'review-required', null],
			['C3', 1, 'stocktake-required', null],
		]);
		expect(analysis.rows[0].sources.map(source => source.snapshotId)).toEqual(['a', 'b']);
		expect(createProcurementSuggestions(analysis).map(row => [row.identity.lcscPartNumber, row.suggestedQuantity])).toEqual([
			['C1', 3],
			['C2', null],
			['C3', null],
		]);
	});

	it('normalizes purchase records and totals costs per currency in minor units', () => {
		const cny = normalizePurchaseRecord(purchase({ currency: 'cny', quantity: 3, unitPriceMinor: 125 }), 'purchase-1', '2026-07-22T02:00:00Z');
		const usd = normalizePurchaseRecord(purchase({ currency: 'USD', quantity: 2, unitPriceMinor: 50 }), 'purchase-2', '2026-07-22T02:00:00Z');

		expect(cny).toMatchObject({ currency: 'CNY', lcscPartNumber: 'C1', projectSnapshotIds: ['snapshot-1'] });
		expect(summarizePurchaseCosts([usd, cny])).toEqual([
			{ currency: 'CNY', recordCount: 1, totalQuantity: 3, totalMinor: 375 },
			{ currency: 'USD', recordCount: 1, totalQuantity: 2, totalMinor: 100 },
		]);
	});

	it('keeps board-count changes separate from single-board BOM differences', () => {
		const before = snapshot('a', 1, 'C1', 2);
		const after = {
			...snapshot('a', 5, 'C1', 3),
			documentUuid: before.documentUuid,
			sourceFingerprint: 'changed'.padEnd(64, '0'),
		};

		const result = diffProjectSnapshots(before, after);

		expect(result).toMatchObject({
			sameDocument: true,
			sourceChanged: true,
			boardQuantityChanged: true,
			beforeBoardQuantity: 1,
			afterBoardQuantity: 5,
		});
		expect(result.demand.entries).toMatchObject([{
			type: 'quantity-increased',
			lcscPartNumber: 'C1',
			quantityDelta: 1,
		}]);
	});

	it('exports deterministic procurement suggestions while preserving review-only rows', () => {
		const analysis = analyzeProjectDemand([
			snapshot('=unsafe-source', 2, 'C1', 3),
			snapshot('review', 1, 'C2', 1),
		], [
			inventoryItem('exact', 'C1', 1, 'exact'),
			inventoryItem('estimated', 'C2', 2, 'estimated'),
		]);
		const csv = createProcurementCsv(createProcurementSuggestions(analysis), {
			lcscPartNumber: 'C number',
			name: 'Name',
			manufacturerPartNumber: 'MPN',
			package: 'Package',
			requiredQuantity: 'Required',
			availableQuantity: 'Available',
			suggestedQuantity: 'Suggested',
			status: 'Status',
			sources: 'Sources',
			emptyValue: '-',
			boardQuantityPrefix: 'x',
			statuses: {
				'sufficient': 'Sufficient',
				'insufficient': 'Insufficient',
				'review-required': 'Review',
				'stocktake-required': 'Stocktake',
				'inventory-missing': 'Missing',
				'identity-unmatched': 'Unmatched',
			},
		});

		expect(csv).toContain('"C1","C1","-","-","6","1","5","Insufficient"');
		expect(csv).toContain('"C2","C2","-","-","1","2","-","Review"');
		expect(csv).toContain('"\'=unsafe-source (x2)"');
	});

	it('strictly sanitizes persisted snapshots and purchase records', () => {
		const persistedSnapshot = snapshot('persisted', 2, '1', 3);
		persistedSnapshot.sourceFingerprint = 'A'.repeat(64);
		expect(sanitizeProjectDemandSnapshot(persistedSnapshot)).toMatchObject({
			sourceFingerprint: 'a'.repeat(64),
			demands: [{ identity: { lcscPartNumber: 'C1' } }],
		});
		expect(() => sanitizeProjectDemandSnapshot({ ...persistedSnapshot, sourceFingerprint: 'bad' })).toThrow('SHA-256');

		const persistedPurchase = normalizePurchaseRecord(purchase({}), 'purchase-1', '2026-07-22T02:00:00Z');
		expect(sanitizePurchaseRecord(persistedPurchase)).toEqual(persistedPurchase);
		expect(() => sanitizePurchaseRecord({ ...persistedPurchase, productUrl: 'file:///tmp/a.pdf' })).toThrow('HTTP or HTTPS');
	});
});

function snapshot(id: string, boardQuantity: number, lcscPartNumber: string, unitQuantity: number): ProjectDemandSnapshot {
	return {
		id,
		documentUuid: `document-${id}`,
		documentKind: 'pcb',
		label: id,
		boardQuantity,
		demands: [{
			key: `lcsc:${lcscPartNumber.toLowerCase()}`,
			identity: { lcscPartNumber, name: lcscPartNumber },
			designators: ['R1'],
			unitQuantity,
		}],
		sourceFingerprint: id.repeat(64).slice(0, 64),
		capturedAt: '2026-07-22T00:00:00.000Z',
		revision: 1,
	};
}

function inventoryItem(id: string, lcscPartNumber: string, quantity: number | null, precision: InventoryItem['precision']): InventoryItem {
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

function purchase(overrides: Partial<NewPurchaseRecord>): NewPurchaseRecord {
	return {
		lcscPartNumber: '1',
		name: 'Resistor',
		quantity: 1,
		unitPriceMinor: 1,
		currency: 'CNY',
		purchasedAt: '2026-07-22',
		projectSnapshotIds: ['snapshot-1', 'snapshot-1'],
		...overrides,
	};
}
