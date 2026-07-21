import type { InventoryEditInput } from '../../src/features/inventory/application/inventory-service';
import type { InventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { OrderImportFileInput } from '../../src/features/inventory/domain/order-import-batch';
import type { InventoryRepository } from '../../src/features/inventory/ports/inventory-repository';
import { describe, expect, it } from 'vitest';
import { InventoryRevisionConflictError, InventoryService } from '../../src/features/inventory/application/inventory-service';
import { cloneInventoryDocument, createEmptyInventoryDocument } from '../../src/features/inventory/domain/inventory-document';

class MemoryInventoryRepository implements InventoryRepository {
	private document = createEmptyInventoryDocument('2026-01-01T00:00:00.000Z');
	public saveCount = 0;

	public load = async (): Promise<InventoryDocument> => cloneInventoryDocument(this.document);

	public save = async (document: InventoryDocument): Promise<void> => {
		this.saveCount += 1;
		this.document = cloneInventoryDocument(document);
	};

	public snapshot(): InventoryDocument {
		return cloneInventoryDocument(this.document);
	}
}

function createServiceHarness(): { repository: MemoryInventoryRepository; service: InventoryService } {
	let id = 0;
	let second = 0;
	const repository = new MemoryInventoryRepository();
	const service = new InventoryService(
		repository,
		() => `2026-01-01T00:00:${String(second++).padStart(2, '0')}.000Z`,
		() => `item-${++id}`,
	);
	return { repository, service };
}

function createService(): InventoryService {
	return createServiceHarness().service;
}

function createEditInput(item: InventoryItem, overrides: Partial<InventoryEditInput> = {}): InventoryEditInput {
	return {
		identity: item.identity,
		marketplaceReference: item.marketplaceReference,
		edaModelReference: item.edaModelReference,
		edaModelStatus: item.edaModelStatus,
		quantity: item.quantity ?? 0,
		precision: item.precision === 'estimated' ? 'estimated' : 'exact',
		location: item.location,
		note: item.note,
		...overrides,
	};
}

const FILE_FINGERPRINT_A = 'a'.repeat(64);
const FILE_FINGERPRINT_B = 'b'.repeat(64);
const FILE_FINGERPRINT_C = 'c'.repeat(64);

function createOrderFile(overrides: Partial<OrderImportFileInput> = {}): OrderImportFileInput {
	return {
		fileName: 'order-SO1.xls',
		orderNumber: 'SO1',
		fingerprint: FILE_FINGERPRINT_A,
		items: [{
			identity: { name: 'Order part', lcscPartNumber: 'C1001' },
			quantity: 5,
			precision: 'exact',
			source: 'order',
		}],
		rowCount: 1,
		totalQuantity: 5,
		...overrides,
	};
}

describe('inventoryService', () => {
	it('previews batch item results without writing inventory or history', async () => {
		const { repository, service } = createServiceHarness();
		await service.add({
			identity: { name: 'Existing part', lcscPartNumber: 'C1001' },
			quantity: 10,
			precision: 'exact',
			source: 'manual',
		});
		const before = repository.snapshot();
		const saveCount = repository.saveCount;

		const preview = await service.previewOrderImportBatch({ files: [createOrderFile({
			items: [
				{
					identity: { name: 'Existing order part', lcscPartNumber: 'C1001' },
					quantity: 5,
					precision: 'exact',
					source: 'order',
				},
				{
					identity: { name: 'New order part', lcscPartNumber: 'C1002' },
					quantity: 3,
					precision: 'exact',
					source: 'order',
				},
			],
			rowCount: 2,
			totalQuantity: 8,
		})] }, 'add');

		expect(preview).toMatchObject({
			files: [{ status: 'ready', result: { added: 1, merged: 1, skipped: 0 } }],
			result: { added: 1, merged: 1, skipped: 0 },
		});
		expect(repository.saveCount).toBe(saveCount);
		expect(repository.snapshot()).toEqual(before);
	});

	it('marks repeated fingerprints and repeated order numbers with historical batch details', async () => {
		const { repository, service } = createServiceHarness();
		const imported = await service.importOrderBatch({ files: [createOrderFile()] }, 'add');

		const preview = await service.previewOrderImportBatch({ files: [
			createOrderFile({ fileName: 'same-content.xls', orderNumber: 'SO2' }),
			createOrderFile({ fileName: 're-export.xls', fingerprint: FILE_FINGERPRINT_B }),
		] }, 'add');

		expect(preview.files[0]).toMatchObject({
			status: 'duplicate',
			duplicateReason: 'historical-fingerprint',
			duplicateOfBatchId: imported.batchId,
			duplicateImportedAt: imported.record.importedAt,
		});
		expect(preview.files[1]).toMatchObject({
			status: 'duplicate',
			duplicateReason: 'historical-order-number',
			duplicateOfBatchId: imported.batchId,
		});
		expect(repository.snapshot().items[0].quantity).toBe(5);
	});

	it('detects fingerprint and order-number duplicates inside one batch', async () => {
		const { repository, service } = createServiceHarness();
		const result = await service.importOrderBatch({ files: [
			createOrderFile(),
			createOrderFile({ fileName: 'copy.xls', orderNumber: 'SO2' }),
			createOrderFile({ fileName: 'same-order.xls', fingerprint: FILE_FINGERPRINT_B }),
		] }, 'add');

		expect(result.files.map(file => ({ status: file.status, reason: file.duplicateReason }))).toEqual([
			{ status: 'imported', reason: undefined },
			{ status: 'duplicate', reason: 'batch-fingerprint' },
			{ status: 'duplicate', reason: 'batch-order-number' },
		]);
		expect(result.result).toEqual({ added: 1, merged: 0, skipped: 2 });
		expect(repository.snapshot().items).toHaveLength(1);
		expect(repository.snapshot().items[0].quantity).toBe(5);
		expect(repository.saveCount).toBe(1);
	});

	it('rechecks duplicates at import time and records an idempotent repeated attempt atomically', async () => {
		const { repository, service } = createServiceHarness();
		const pending = { files: [createOrderFile({ fingerprint: FILE_FINGERPRINT_C })] };
		const preview = await service.previewOrderImportBatch(pending, 'add');
		expect(preview.files[0].status).toBe('ready');

		const first = await service.importOrderBatch({ files: [createOrderFile()] }, 'add');
		const saveCount = repository.saveCount;
		const repeated = await service.importOrderBatch(pending, 'add');

		expect(repeated.files[0]).toMatchObject({
			status: 'duplicate',
			duplicateReason: 'historical-order-number',
			duplicateOfBatchId: first.batchId,
		});
		expect(repeated.result).toEqual({ added: 0, merged: 0, skipped: 1 });
		expect(repository.snapshot().items[0].quantity).toBe(5);
		expect(repository.snapshot().orderImportBatches).toHaveLength(2);
		expect(repository.saveCount).toBe(saveCount + 1);
		expect(repeated.record.files[0]).not.toHaveProperty('items');
	});

	it('sanitizes stored batch metadata without retaining imported rows', async () => {
		const { repository, service } = createServiceHarness();
		await service.importOrderBatch({ files: [createOrderFile({
			fileName: ' order\u200B.xls ',
			orderNumber: ' so1 ',
			fingerprint: FILE_FINGERPRINT_A.toUpperCase(),
		})] }, 'skip');

		const storedFile = repository.snapshot().orderImportBatches[0].files[0];
		expect(storedFile).toMatchObject({
			fileName: 'order.xls',
			orderNumber: 'SO1',
			fingerprint: FILE_FINGERPRINT_A,
		});
		expect(storedFile).not.toHaveProperty('items');
	});

	it('previews a duplicate create without writing and merges only after revision-confirmed approval', async () => {
		const { repository, service } = createServiceHarness();
		const existing = await service.add({
			identity: { name: '10k resistor', lcscPartNumber: 'C25804' },
			quantity: 10,
			precision: 'exact',
			source: 'manual',
		});
		const writesBeforePreview = repository.saveCount;
		const input = {
			identity: { name: '10k resistor order line', lcscPartNumber: 'C25804' },
			quantity: 5,
			precision: 'exact' as const,
			source: 'order' as const,
		};

		const preview = await service.createItem(input);

		expect(preview).toMatchObject({ status: 'duplicate', existing: { id: existing.id, quantity: 10 } });
		expect(repository.saveCount).toBe(writesBeforePreview);
		expect(repository.snapshot().items).toHaveLength(1);

		const merged = await service.createItem(input, { id: existing.id, expectedRevision: existing.revision });

		expect(merged).toMatchObject({ status: 'merged', item: { id: existing.id, quantity: 15 } });
		expect(repository.snapshot().items).toHaveLength(1);
	});

	it('rejects duplicate create approval after the target revision changes', async () => {
		const service = createService();
		const existing = await service.add({
			identity: { name: '10k resistor', lcscPartNumber: 'C25804' },
			quantity: 10,
			precision: 'exact',
			source: 'manual',
		});
		await service.updateQuantity(existing.id, 11, 'exact');

		await expect(service.createItem({
			identity: { name: 'duplicate', lcscPartNumber: 'C25804' },
			quantity: 1,
			precision: 'exact',
			source: 'manual',
		}, { id: existing.id, expectedRevision: existing.revision }))
			.rejects
			.toBeInstanceOf(InventoryRevisionConflictError);
	});

	it('stores exact and estimated quantities and can mark a part depleted', async () => {
		const service = createService();
		const exact = await service.add({
			identity: { name: '10k resistor', lcscPartNumber: '25804' },
			quantity: 100,
			precision: 'exact',
			source: 'manual',
		});

		expect(exact.identity.lcscPartNumber).toBe('C25804');
		expect(exact.quantity).toBe(100);
		expect(exact.state).toBe('in-stock');

		const depleted = await service.markDepleted(exact.id);
		expect(depleted.quantity).toBe(0);
		expect(depleted.precision).toBe('exact');
		expect(depleted.state).toBe('depleted');

		const restored = await service.updateQuantity(exact.id, 40, 'estimated');
		expect(restored.quantity).toBe(40);
		expect(restored.precision).toBe('estimated');
		expect(restored.state).toBe('in-stock');
	});

	it('merges duplicate LCSC parts using the selected strategy', async () => {
		const service = createService();
		await service.add({
			identity: { name: 'Resistor', lcscPartNumber: 'C25804' },
			quantity: 50,
			precision: 'exact',
			source: 'catalog',
		});

		const added = await service.add({
			identity: { name: 'Resistor 0603', lcscPartNumber: '25804', package: '0603' },
			quantity: 20,
			precision: 'estimated',
			source: 'order',
		}, 'add');

		expect(added.quantity).toBe(70);
		expect(added.precision).toBe('estimated');
		expect(added.identity.package).toBe('0603');
		expect(await service.list()).toHaveLength(1);

		const replaced = await service.add({
			identity: { name: 'Resistor', lcscPartNumber: 'C25804' },
			quantity: 8,
			precision: 'exact',
			source: 'order',
		}, 'replace');
		expect(replaced.quantity).toBe(8);
		expect(replaced.precision).toBe('exact');
	});

	it('rejects negative and fractional quantities', async () => {
		const service = createService();
		await expect(service.add({
			identity: { name: 'Invalid part' },
			quantity: -1,
			precision: 'exact',
			source: 'manual',
		})).rejects.toThrow('non-negative integer');
	});

	it('updates a complete item and persists its location and note', async () => {
		const service = createService();
		const item = await service.add({
			identity: { name: 'Capacitor', lcscPartNumber: 'C1001' },
			quantity: 20,
			precision: 'exact',
			source: 'manual',
		});

		const result = await service.updateItem(item.id, item.revision, createEditInput(item, {
			quantity: 18,
			precision: 'estimated',
			location: 'Drawer A3',
			note: 'Opened reel',
		}));

		expect(result.status).toBe('updated');
		if (result.status !== 'updated') {
			throw new Error('Expected the inventory item to be updated.');
		}
		expect(result.item).toMatchObject({
			quantity: 18,
			precision: 'estimated',
			location: 'Drawer A3',
			note: 'Opened reel',
			state: 'in-stock',
			revision: 2,
		});
		expect(await service.get(item.id)).toEqual(result.item);
	});

	it('forces zero quantity edits to exact and depleted', async () => {
		const service = createService();
		const item = await service.add({
			identity: { name: 'Header', lcscPartNumber: 'C1002' },
			quantity: 6,
			precision: 'estimated',
			source: 'manual',
		});

		const result = await service.updateItem(item.id, item.revision, createEditInput(item, {
			quantity: 0,
			precision: 'estimated',
		}));

		expect(result).toMatchObject({
			status: 'updated',
			item: { quantity: 0, precision: 'exact', state: 'depleted' },
		});
	});

	it.each([-1, 1.5])('rejects invalid complete-edit quantity %s without saving', async (quantity) => {
		const { repository, service } = createServiceHarness();
		const item = await service.add({
			identity: { name: 'Diode', lcscPartNumber: 'C1003' },
			quantity: 3,
			precision: 'exact',
			source: 'manual',
		});
		const saveCount = repository.saveCount;
		const update = service.updateItem(item.id, item.revision, createEditInput(item, { quantity }));

		await expect(update).rejects.toThrow('non-negative integer');
		expect(repository.saveCount).toBe(saveCount);
	});

	it('returns duplicate comparison data without persisting an identity collision', async () => {
		const { repository, service } = createServiceHarness();
		const existing = await service.add({
			identity: { name: 'Existing resistor', lcscPartNumber: 'C2001' },
			quantity: 10,
			precision: 'exact',
			source: 'catalog',
		});
		const editing = await service.add({
			identity: { name: 'Editing resistor', lcscPartNumber: 'C2002' },
			quantity: 4,
			precision: 'exact',
			source: 'manual',
		});
		const before = repository.snapshot();
		const saveCount = repository.saveCount;

		const result = await service.updateItem(editing.id, editing.revision, createEditInput(editing, {
			identity: { name: 'Same resistor', lcscPartNumber: existing.identity.lcscPartNumber },
			quantity: 7,
		}));

		expect(result).toMatchObject({
			status: 'duplicate',
			candidate: { id: editing.id, quantity: 7 },
			existing: { id: existing.id, quantity: 10 },
		});
		expect(repository.saveCount).toBe(saveCount);
		expect(repository.snapshot()).toEqual(before);
	});

	it('merges a confirmed duplicate using add quantities and retains the target record', async () => {
		const service = createService();
		const existing = await service.add({
			identity: { name: 'Existing resistor', lcscPartNumber: 'C3001' },
			quantity: 10,
			precision: 'exact',
			source: 'catalog',
		});
		const editing = await service.add({
			identity: { name: 'Editing resistor', lcscPartNumber: 'C3002' },
			quantity: 4,
			precision: 'exact',
			source: 'manual',
		});

		const result = await service.updateItem(editing.id, editing.revision, createEditInput(editing, {
			identity: { name: 'Merged resistor', lcscPartNumber: existing.identity.lcscPartNumber },
			quantity: 7,
			location: 'Drawer B2',
		}), {
			id: existing.id,
			expectedRevision: existing.revision,
		});

		expect(result).toMatchObject({
			status: 'merged',
			item: {
				id: existing.id,
				quantity: 17,
				precision: 'exact',
				location: 'Drawer B2',
				revision: 2,
			},
		});
		expect(await service.list()).toEqual([expect.objectContaining({ id: existing.id, quantity: 17 })]);
		expect(await service.get(editing.id)).toBeUndefined();
	});

	it('checks the edited item revision before validating edit fields', async () => {
		const { repository, service } = createServiceHarness();
		const stale = await service.add({
			identity: { name: 'Fuse', lcscPartNumber: 'C4001' },
			quantity: 2,
			precision: 'exact',
			source: 'manual',
		});
		await service.updateQuantity(stale.id, 1, 'exact');
		const saveCount = repository.saveCount;
		const update = service.updateItem(stale.id, stale.revision, createEditInput(stale, { quantity: -1 }));

		await expect(update).rejects.toBeInstanceOf(InventoryRevisionConflictError);
		expect(repository.saveCount).toBe(saveCount);
	});

	it('removes unsafe invisible formatting from stored text while preserving multilingual joiners and newlines', async () => {
		const service = createService();
		const product = await service.add({
			identity: {
				name: 'Micro\u200Bphone',
				lcscPartNumber: 'C23\uFEFF3991',
				manufacturer: 'ING\u200CHAi',
				manufacturerPartNumber: 'GMI\u20609745',
				package: 'SMD,D=9.7mm\u200B',
				description: 'Line 1\nLine\u200B 2',
			},
			quantity: 34,
			precision: 'estimated',
			location: 'A-\u200B01',
			note: 'checked\u0000',
			source: 'marketplace',
		});

		expect(product.identity).toMatchObject({
			name: 'Microphone',
			lcscPartNumber: 'C233991',
			manufacturer: 'ING\u200CHAi',
			manufacturerPartNumber: 'GMI9745',
			package: 'SMD,D=9.7mm',
			description: 'Line 1\nLine 2',
		});
		expect(product.location).toBe('A-01');
		expect(product.note).toBe('checked');
	});

	it('stores marketplace products without an EDA model and can attach one later', async () => {
		const service = createService();
		const product = await service.add({
			identity: {
				name: 'GMI9745-64db microphone',
				lcscPartNumber: 'C233991',
				manufacturer: 'INGHAi',
				manufacturerPartNumber: 'GMI9745-64db',
			},
			marketplaceReference: {
				provider: 'lcsc',
				productUrl: 'https://item.szlcsc.com/233991.html',
				evidence: 'user-confirmed',
				confirmedAt: '2026-07-20T07:00:00.000Z',
			},
			edaModelStatus: 'missing',
			quantity: 5,
			precision: 'exact',
			source: 'marketplace',
		});

		expect(product.edaModelReference).toBeUndefined();
		expect(product.edaModelStatus).toBe('missing');
		expect(product.quantity).toBe(5);

		const linked = await service.attachEdaModel(product.id, {
			deviceUuid: 'device-233991',
			libraryUuid: 'system-library',
			symbolName: 'Microphone',
			footprintName: 'SMD-D9.7mm\u200B',
		});
		expect(linked.edaModelStatus).toBe('available');
		expect(linked.edaModelReference?.deviceUuid).toBe('device-233991');
		expect(linked.edaModelReference?.footprintName).toBe('SMD-D9.7mm');

		const reimported = await service.add({
			identity: { name: 'Order microphone', lcscPartNumber: 'C233991' },
			marketplaceReference: {
				provider: 'lcsc',
				productUrl: 'https://item.szlcsc.com/233991.html',
				evidence: 'order-import',
				confirmedAt: '2026-07-21T07:00:00.000Z',
			},
			quantity: 5,
			precision: 'exact',
			source: 'order',
		}, 'add');
		expect(reimported.marketplaceReference?.evidence).toBe('user-confirmed');
	});

	it('uses revision checks when attaching an EDA model from an interactive match', async () => {
		const service = createService();
		const product = await service.add({
			identity: { name: 'Microphone', lcscPartNumber: 'C233991' },
			quantity: 5,
			precision: 'exact',
			source: 'marketplace',
		});
		await service.updateQuantity(product.id, 4, 'exact');

		await expect(service.attachEdaModel(product.id, product.revision, {
			deviceUuid: 'device-233991',
			libraryUuid: 'system-library',
		}))
			.rejects
			.toBeInstanceOf(InventoryRevisionConflictError);
	});
});
