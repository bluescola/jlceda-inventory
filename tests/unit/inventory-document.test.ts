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

	it('sanitizes safe file metadata in schema v4 import history', () => {
		const migrated = migrateInventoryDocument({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
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
		});
	});
});
