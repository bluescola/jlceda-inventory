import { describe, expect, it } from 'vitest';
import { INVENTORY_SCHEMA_VERSION, migrateInventoryDocument } from '../../src/features/inventory/domain/inventory-document';

describe('inventoryDocument migration', () => {
	it('migrates v1 catalog references into explicit EDA model references', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 1,
			revision: 3,
			updatedAt: '2026-07-20T07:00:00.000Z',
			items: [{
				id: 'legacy-model',
				identity: { name: '10k resistor', lcscPartNumber: 'C25804' },
				catalogReference: { deviceUuid: 'device-1', libraryUuid: 'system-library' },
				quantity: 20,
				precision: 'exact',
				state: 'in-stock',
				source: 'catalog',
				createdAt: '2026-07-20T07:00:00.000Z',
				updatedAt: '2026-07-20T07:00:00.000Z',
				revision: 1,
			}],
		});

		expect(migrated?.schemaVersion).toBe(INVENTORY_SCHEMA_VERSION);
		expect(migrated?.items[0].edaModelReference).toEqual({ deviceUuid: 'device-1', libraryUuid: 'system-library' });
		expect(migrated?.items[0].edaModelStatus).toBe('available');
		expect(migrated?.items[0]).not.toHaveProperty('catalogReference');
	});

	it('keeps legacy inventory without a model and marks it unchecked', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 1,
			revision: 1,
			updatedAt: '2026-07-20T07:00:00.000Z',
			items: [{
				id: 'legacy-manual',
				identity: { name: 'Microphone', lcscPartNumber: 'C233991' },
				quantity: 5,
				precision: 'exact',
				state: 'in-stock',
				source: 'manual',
				createdAt: '2026-07-20T07:00:00.000Z',
				updatedAt: '2026-07-20T07:00:00.000Z',
				revision: 1,
			}],
		});

		expect(migrated?.items[0].identity.lcscPartNumber).toBe('C233991');
		expect(migrated?.items[0].edaModelReference).toBeUndefined();
		expect(migrated?.items[0].edaModelStatus).toBe('unchecked');
	});

	it('sanitizes invisible formatting when reading an existing schema-v2 backup', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 2,
			revision: 2,
			updatedAt: '2026-07-20T11:41:22.028Z',
			items: [{
				id: 'existing-product',
				identity: {
					name: 'GMI9745-64db',
					lcscPartNumber: 'C233991',
					package: 'SMD,D=9.7mm\u200B',
					description: 'Line 1\nLine\u200B 2',
				},
				edaModelStatus: 'missing',
				quantity: 34,
				precision: 'estimated',
				state: 'in-stock',
				source: 'marketplace',
				createdAt: '2026-07-20T10:44:30.106Z',
				updatedAt: '2026-07-20T11:41:22.028Z',
				revision: 2,
			}],
		});

		expect(migrated?.revision).toBe(2);
		expect(migrated?.items[0].id).toBe('existing-product');
		expect(migrated?.items[0].updatedAt).toBe('2026-07-20T11:41:22.028Z');
		expect(migrated?.items[0].identity.package).toBe('SMD,D=9.7mm');
		expect(migrated?.items[0].identity.description).toBe('Line 1\nLine 2');
	});

	it('migrates schema v3 categories without losing inventory data', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 3,
			revision: 7,
			updatedAt: '2026-07-21T07:00:00.000Z',
			categories: [{
				id: 'passives',
				name: 'Passives',
				sortOrder: 0,
				createdAt: '2026-07-21T07:00:00.000Z',
				updatedAt: '2026-07-21T07:00:00.000Z',
				revision: 1,
			}],
			items: [],
		});

		expect(migrated).toMatchObject({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: 7,
			categories: [{ id: 'passives', name: 'Passives' }],
			items: [],
			orderImportBatches: [],
		});
	});

	it('migrates schema v4 import history and activates legacy duplicate records', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 4,
			revision: 1,
			updatedAt: '2026-07-21T07:00:00.000Z',
			categories: [],
			items: [],
			orderImportBatches: [{
				id: 'batch-1',
				importedAt: '2026-07-21T07:00:00.000Z',
				strategy: 'add',
				files: [{
					fileName: ' order\u200B.xls ',
					orderNumber: ' so123 ',
					fingerprint: 'A'.repeat(64),
					rowCount: 2,
					totalQuantity: 30,
					status: 'imported',
					result: { added: 2, merged: 0, skipped: 0 },
				}],
				result: { added: 2, merged: 0, skipped: 0 },
			}],
		});

		expect(migrated?.orderImportBatches[0].files[0]).toMatchObject({
			fileName: 'order.xls',
			orderNumber: 'SO123',
			fingerprint: 'a'.repeat(64),
			deduplicationActive: true,
		});
		expect(migrated?.orderImportBatches[0].files[0].inventoryLinks).toBeUndefined();
	});

	it('migrates schema v5 inventory links and preserves valid user-maintained item fields', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 5,
			revision: 1,
			updatedAt: '2026-07-22T02:00:00.000Z',
			categories: [],
			items: [{
				id: 'stocked-part',
				identity: { name: 'Stocked part', lcscPartNumber: 'C1001' },
				minimumQuantity: 12,
				favorite: true,
				edaModelStatus: 'unchecked',
				quantity: 20,
				precision: 'exact',
				state: 'in-stock',
				source: 'manual',
				createdAt: '2026-07-22T02:00:00.000Z',
				updatedAt: '2026-07-22T02:00:00.000Z',
				revision: 1,
			}],
			orderImportBatches: [{
				id: 'batch-1',
				importedAt: '2026-07-22T02:00:00.000Z',
				strategy: 'add',
				files: [{
					fileName: 'order.xls',
					orderNumber: 'SO123',
					fingerprint: 'a'.repeat(64),
					rowCount: 1,
					totalQuantity: 10,
					status: 'imported',
					result: { added: 1, merged: 0, skipped: 0 },
					inventoryLinks: [
						{ identityKey: ' lcsc:c1001 ', inventoryItemId: ' old-id ' },
						{ identityKey: 'lcsc:c1001', inventoryItemId: 'current-id' },
					],
				}],
				result: { added: 1, merged: 0, skipped: 0 },
			}],
		});

		expect(migrated?.orderImportBatches[0].files[0].inventoryLinks).toEqual([{
			identityKey: 'lcsc:c1001',
			inventoryItemId: 'current-id',
		}]);
		expect(migrated?.items[0]).toMatchObject({ minimumQuantity: 12, favorite: true });
	});

	it('migrates schema v6 to an empty transaction ledger without changing inventory data', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 6,
			revision: 8,
			updatedAt: '2026-07-22T03:00:00.000Z',
			categories: [],
			items: [{
				id: 'v6-item',
				identity: { name: 'V6 item' },
				edaModelStatus: 'unchecked',
				quantity: 9,
				precision: 'exact',
				state: 'in-stock',
				source: 'manual',
				createdAt: '2026-07-22T02:00:00.000Z',
				updatedAt: '2026-07-22T03:00:00.000Z',
				revision: 2,
			}],
			orderImportBatches: [],
		});

		expect(migrated).toMatchObject({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: 8,
			items: [{ id: 'v6-item', quantity: 9, revision: 2 }],
			transactions: [],
			stockOutBatches: [],
		});
	});

	it('preserves and sanitizes a valid schema v7 stock-out audit trail', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 7,
			revision: 2,
			updatedAt: '2026-07-22T04:00:00.000Z',
			categories: [],
			items: [],
			orderImportBatches: [],
			transactions: [{
				id: 'transaction-1',
				itemId: 'removed-item',
				kind: 'bom-stock-out',
				source: 'bom',
				delta: -2,
				beforeQuantity: 5,
				afterQuantity: 3,
				createdAt: '2026-07-22T04:00:00.000Z',
				identity: { name: ' Resistor ', lcscPartNumber: '1001' },
				note: ' Assembly\u200B run ',
				batchId: 'batch-1',
			}],
			stockOutBatches: [{
				id: 'batch-1',
				fingerprint: 'A'.repeat(64),
				source: 'bom',
				sourceFingerprint: 'B'.repeat(64),
				sourceName: ' board.xlsx ',
				createdAt: '2026-07-22T04:00:00.000Z',
				lines: [{ itemId: 'removed-item', quantity: 2, transactionId: 'transaction-1' }],
			}],
		});

		expect(migrated?.transactions[0]).toMatchObject({
			identity: { name: 'Resistor', lcscPartNumber: 'C1001' },
			note: 'Assembly run',
		});
		expect(migrated?.stockOutBatches[0]).toMatchObject({
			fingerprint: 'a'.repeat(64),
			sourceFingerprint: 'b'.repeat(64),
			sourceName: 'board.xlsx',
		});
		expect(migrated).toMatchObject({ projectSnapshots: [], purchaseRecords: [] });
	});

	it('migrates v7 item metadata without replacing the legacy free-text location', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 7,
			revision: 3,
			updatedAt: '2026-07-22T05:00:00.000Z',
			categories: [],
			items: [{
				id: 'metadata-item',
				identity: { name: 'Metadata item' },
				edaModelStatus: 'unchecked',
				quantity: 1,
				precision: 'exact',
				state: 'in-stock',
				location: 'Legacy drawer A-1',
				datasheetUrl: ' https://example.com/data.pdf ',
				structuredLocation: { cabinet: ' Cabinet A ', box: 'Box 1' },
				source: 'manual',
				createdAt: '2026-07-22T05:00:00.000Z',
				updatedAt: '2026-07-22T05:00:00.000Z',
				revision: 1,
			}],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
		});

		expect(migrated?.items[0]).toMatchObject({
			location: 'Legacy drawer A-1',
			datasheetUrl: 'https://example.com/data.pdf',
			structuredLocation: { cabinet: 'Cabinet A', box: 'Box 1' },
		});
		expect(migrated).toMatchObject({ projectSnapshots: [], purchaseRecords: [] });
	});

	it('strictly sanitizes schema v8 project snapshots and purchase records', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: 8,
			revision: 1,
			updatedAt: '2026-07-22T06:00:00.000Z',
			categories: [],
			items: [],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [{
				id: 'snapshot-1',
				projectUuid: ' project-1 ',
				documentUuid: 'pcb-1',
				documentKind: 'pcb',
				label: ' Controller ',
				boardQuantity: 2,
				demands: [{
					key: 'lcsc:c1',
					identity: { name: ' Resistor ', lcscPartNumber: '1' },
					designators: ['R1'],
					unitQuantity: 1,
				}],
				sourceFingerprint: 'A'.repeat(64),
				capturedAt: '2026-07-22T06:00:00.000Z',
				revision: 1,
			}],
			purchaseRecords: [{
				id: 'purchase-1',
				lcscPartNumber: '1',
				name: ' Resistor ',
				quantity: 2,
				unitPriceMinor: 10,
				currency: 'cny',
				purchasedAt: '2026-07-22T06:00:00.000Z',
				projectSnapshotIds: ['snapshot-1'],
				createdAt: '2026-07-22T06:00:00.000Z',
				revision: 1,
			}],
		});

		expect(migrated?.projectSnapshots[0]).toMatchObject({
			projectUuid: 'project-1',
			label: 'Controller',
			sourceFingerprint: 'a'.repeat(64),
			demands: [{ identity: { name: 'Resistor', lcscPartNumber: 'C1' } }],
		});
		expect(migrated?.purchaseRecords[0]).toMatchObject({
			lcscPartNumber: 'C1',
			name: 'Resistor',
			currency: 'CNY',
			purchasedAt: '2026-07-22',
		});
		expect(migrated?.substituteLinks).toEqual([]);
	});

	it('preserves valid current-schema substitute links and rejects dangling or duplicate pairs', () => {
		const baseDocument = {
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: 2,
			updatedAt: '2026-07-22T07:00:00.000Z',
			categories: [],
			items: ['item-a', 'item-b'].map(id => ({
				id,
				identity: { name: id },
				edaModelStatus: 'unchecked',
				quantity: 1,
				precision: 'exact',
				state: 'in-stock',
				source: 'manual',
				createdAt: '2026-07-22T07:00:00.000Z',
				updatedAt: '2026-07-22T07:00:00.000Z',
				revision: 1,
			})),
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [{
				id: 'link-1',
				itemIdA: 'item-a',
				itemIdB: 'item-b',
				note: ' confirmed ',
				createdAt: '2026-07-22T07:00:00.000Z',
				updatedAt: '2026-07-22T07:00:00.000Z',
				revision: 1,
			}],
		};

		expect(migrateInventoryDocument(baseDocument)?.substituteLinks).toEqual([
			expect.objectContaining({ id: 'link-1', itemIdA: 'item-a', itemIdB: 'item-b', note: 'confirmed' }),
		]);
		expect(migrateInventoryDocument({
			...baseDocument,
			substituteLinks: [{ ...baseDocument.substituteLinks[0], itemIdB: 'missing' }],
		})).toBeUndefined();
		expect(migrateInventoryDocument({
			...baseDocument,
			substituteLinks: [
				baseDocument.substituteLinks[0],
				{ ...baseDocument.substituteLinks[0], id: 'link-2' },
			],
		})).toBeUndefined();
	});

	it('removes invalid replenishment and false favorite fields from the current schema', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: 1,
			updatedAt: '2026-07-22T03:00:00.000Z',
			categories: [],
			items: [{
				id: 'invalid-preferences',
				identity: { name: 'Invalid preferences' },
				minimumQuantity: 0,
				favorite: false,
				edaModelStatus: 'unchecked',
				quantity: 20,
				precision: 'exact',
				state: 'in-stock',
				source: 'manual',
				createdAt: '2026-07-22T03:00:00.000Z',
				updatedAt: '2026-07-22T03:00:00.000Z',
				revision: 1,
			}],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [],
		});

		expect(migrated?.items[0]).not.toHaveProperty('minimumQuantity');
		expect(migrated?.items[0]).not.toHaveProperty('favorite');
	});
});
