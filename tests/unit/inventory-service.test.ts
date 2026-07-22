import type { InventoryEditInput } from '../../src/features/inventory/application/inventory-service';
import type { InventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { OrderImportFileInput } from '../../src/features/inventory/domain/order-import-batch';
import type { InventoryRepository } from '../../src/features/inventory/ports/inventory-repository';
import { describe, expect, it } from 'vitest';
import { MAX_INVENTORY_DOCUMENT_ITEMS } from '../../src/features/inventory/application/inventory-document-limits';
import { InventoryItemSubstituteReferenceError, InventoryRevisionConflictError, InventoryService, SubstituteLinkDuplicateError, SubstituteLinkRevisionConflictError } from '../../src/features/inventory/application/inventory-service';
import { cloneInventoryDocument, createEmptyInventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import { InventoryDocumentRevisionConflictError } from '../../src/features/inventory/ports/inventory-repository';

class MemoryInventoryRepository implements InventoryRepository {
	private document = createEmptyInventoryDocument('2026-01-01T00:00:00.000Z');
	private recoverySnapshot?: InventoryDocument;
	public saveCount = 0;
	public failNextSave = false;

	public load = async (): Promise<InventoryDocument> => cloneInventoryDocument(this.document);

	public save = async (document: InventoryDocument): Promise<void> => {
		if (this.failNextSave) {
			this.failNextSave = false;
			throw new Error('simulated primary save failure');
		}
		this.saveCount += 1;
		this.document = cloneInventoryDocument(document);
	};

	public loadRecoverySnapshot = async (): Promise<InventoryDocument | undefined> => this.recoverySnapshot
		? cloneInventoryDocument(this.recoverySnapshot)
		: undefined;

	public saveRecoverySnapshot = async (document: InventoryDocument): Promise<void> => {
		this.recoverySnapshot = cloneInventoryDocument(document);
	};

	public clearRecoverySnapshot = async (): Promise<void> => {
		this.recoverySnapshot = undefined;
	};

	public snapshot(): InventoryDocument {
		return cloneInventoryDocument(this.document);
	}

	public seed(document: InventoryDocument): void {
		this.document = cloneInventoryDocument(document);
	}

	public recovery(): InventoryDocument | undefined {
		return this.recoverySnapshot ? cloneInventoryDocument(this.recoverySnapshot) : undefined;
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
	it('creates one canonical substitute link with item and document revision checks', async () => {
		const { repository, service } = createServiceHarness();
		const first = await service.add({ identity: { name: 'First' }, quantity: 10, precision: 'exact', source: 'manual' });
		const second = await service.add({ identity: { name: 'Second' }, quantity: 8, precision: 'exact', source: 'manual' });
		const document = repository.snapshot();

		const link = await service.createSubstituteLink({
			itemA: { id: second.id, expectedRevision: second.revision },
			itemB: { id: first.id, expectedRevision: first.revision },
			expectedDocumentRevision: document.revision,
			note: ' user confirmed ',
		});

		expect(link).toMatchObject({
			itemIdA: first.id,
			itemIdB: second.id,
			note: 'user confirmed',
			revision: 1,
		});
		expect(await service.listSubstituteLinks(first.id)).toEqual([link]);
		await expect(service.createSubstituteLink({
			itemA: { id: first.id, expectedRevision: first.revision },
			itemB: { id: second.id, expectedRevision: second.revision },
			expectedDocumentRevision: repository.snapshot().revision,
		})).rejects.toBeInstanceOf(SubstituteLinkDuplicateError);
	});

	it('rejects stale item or document revisions when confirming a substitute link', async () => {
		const { repository, service } = createServiceHarness();
		const first = await service.add({ identity: { name: 'First' }, quantity: 10, precision: 'exact', source: 'manual' });
		const second = await service.add({ identity: { name: 'Second' }, quantity: 8, precision: 'exact', source: 'manual' });
		const staleDocumentRevision = repository.snapshot().revision;
		const updatedFirst = await service.updateQuantity(first.id, 9, 'exact');

		await expect(service.createSubstituteLink({
			itemA: { id: first.id, expectedRevision: first.revision },
			itemB: { id: second.id, expectedRevision: second.revision },
			expectedDocumentRevision: repository.snapshot().revision,
		})).rejects.toBeInstanceOf(InventoryRevisionConflictError);
		await expect(service.createSubstituteLink({
			itemA: { id: first.id, expectedRevision: updatedFirst.revision },
			itemB: { id: second.id, expectedRevision: second.revision },
			expectedDocumentRevision: staleDocumentRevision,
		})).rejects.toBeInstanceOf(InventoryDocumentRevisionConflictError);
	});

	it('validates substitute link revision when removing a relation', async () => {
		const { repository, service } = createServiceHarness();
		const first = await service.add({ identity: { name: 'First' }, quantity: 10, precision: 'exact', source: 'manual' });
		const second = await service.add({ identity: { name: 'Second' }, quantity: 8, precision: 'exact', source: 'manual' });
		const link = await service.createSubstituteLink({
			itemA: { id: first.id, expectedRevision: first.revision },
			itemB: { id: second.id, expectedRevision: second.revision },
			expectedDocumentRevision: repository.snapshot().revision,
		});

		await expect(service.removeSubstituteLink(link.id, link.revision + 1))
			.rejects
			.toBeInstanceOf(SubstituteLinkRevisionConflictError);
		await expect(service.removeSubstituteLink(link.id, link.revision))
			.resolves
			.toEqual(link);
		expect(await service.listSubstituteLinks()).toEqual([]);
	});

	it('blocks removal of a linked merge source but allows replenishing a linked target in place', async () => {
		const { repository, service } = createServiceHarness();
		const first = await service.add({ identity: { name: 'First', lcscPartNumber: 'C101' }, quantity: 10, precision: 'exact', source: 'manual' });
		const second = await service.add({ identity: { name: 'Second', lcscPartNumber: 'C102' }, quantity: 8, precision: 'exact', source: 'manual' });
		const third = await service.add({ identity: { name: 'Third', lcscPartNumber: 'C103' }, quantity: 4, precision: 'exact', source: 'manual' });
		await service.createSubstituteLink({
			itemA: { id: first.id, expectedRevision: first.revision },
			itemB: { id: second.id, expectedRevision: second.revision },
			expectedDocumentRevision: repository.snapshot().revision,
		});

		await expect(service.remove(first.id)).rejects.toBeInstanceOf(InventoryItemSubstituteReferenceError);
		await expect(service.updateItem(
			first.id,
			first.revision,
			createEditInput(first, { identity: { ...first.identity, lcscPartNumber: third.identity.lcscPartNumber } }),
			{ id: third.id, expectedRevision: third.revision },
		)).rejects.toBeInstanceOf(InventoryItemSubstituteReferenceError);
		await expect(service.updateItem(
			third.id,
			third.revision,
			createEditInput(third, { identity: { ...third.identity, lcscPartNumber: first.identity.lcscPartNumber } }),
			{ id: first.id, expectedRevision: first.revision },
		)).resolves.toMatchObject({ status: 'merged', item: { id: first.id, quantity: 14 } });
		expect(repository.snapshot().items).toHaveLength(2);
		expect(repository.snapshot().substituteLinks).toHaveLength(1);
	});

	it('stores a recovery snapshot before replacing inventory and keeps document revision monotonic', async () => {
		const { repository, service } = createServiceHarness();
		await service.add({
			identity: { name: 'Current inventory' },
			quantity: 3,
			precision: 'exact',
			source: 'manual',
		});
		const current = repository.snapshot();
		const backup = cloneInventoryDocument(current);
		backup.revision = 99;
		backup.updatedAt = '2025-01-01T00:00:00.000Z';
		backup.items[0].identity.name = 'Restored inventory';

		const restored = await service.restoreDocument(backup, current.revision);

		expect(repository.recovery()).toEqual(current);
		expect(restored).toMatchObject({
			revision: current.revision + 1,
			items: [{ identity: { name: 'Restored inventory' } }],
		});
		expect(repository.snapshot()).toEqual(restored);
	});

	it('restores the previous recovery point when the primary restore write fails', async () => {
		const { repository, service } = createServiceHarness();
		await service.add({
			identity: { name: 'Current inventory' },
			quantity: 3,
			precision: 'exact',
			source: 'manual',
		});
		const current = repository.snapshot();
		const previousRecovery = createEmptyInventoryDocument('2025-01-01T00:00:00.000Z');
		previousRecovery.revision = 7;
		await repository.saveRecoverySnapshot(previousRecovery);
		repository.failNextSave = true;

		await expect(service.restoreDocument(createEmptyInventoryDocument(), current.revision))
			.rejects
			.toThrow('simulated primary save failure');

		expect(repository.snapshot()).toEqual(current);
		expect(repository.recovery()).toEqual(previousRecovery);
	});

	it('clears a newly staged recovery point after a failed first restore attempt', async () => {
		const { repository, service } = createServiceHarness();
		const current = repository.snapshot();
		repository.failNextSave = true;

		await expect(service.restoreDocument(createEmptyInventoryDocument(), current.revision)).rejects.toThrow();

		expect(repository.snapshot()).toEqual(current);
		expect(repository.recovery()).toBeUndefined();
	});

	it('validates restore capacity before replacing an existing recovery point', async () => {
		const { repository, service } = createServiceHarness();
		const current = repository.snapshot();
		const previousRecovery = createEmptyInventoryDocument('2025-01-01T00:00:00.000Z');
		previousRecovery.revision = 7;
		await repository.saveRecoverySnapshot(previousRecovery);
		const oversized = createEmptyInventoryDocument();
		oversized.items = Array.from(
			{ length: MAX_INVENTORY_DOCUMENT_ITEMS + 1 },
			() => ({}) as never,
		);

		await expect(service.restoreDocument(oversized, current.revision)).rejects.toThrow('items');

		expect(repository.snapshot()).toEqual(current);
		expect(repository.recovery()).toEqual(previousRecovery);
	});

	it('removes multiple revision-matched items with one atomic save', async () => {
		const { repository, service } = createServiceHarness();
		const first = await service.add({ identity: { name: 'First' }, quantity: 1, precision: 'exact', source: 'manual' });
		const second = await service.add({ identity: { name: 'Second' }, quantity: 2, precision: 'exact', source: 'manual' });
		const retained = await service.add({ identity: { name: 'Retained' }, quantity: 3, precision: 'exact', source: 'manual' });
		const saveCount = repository.saveCount;

		const removed = await service.removeItems([
			{ id: first.id, expectedRevision: first.revision },
			{ id: second.id, expectedRevision: second.revision },
		]);

		expect(removed).toEqual([first.id, second.id]);
		expect(repository.snapshot().items).toEqual([retained]);
		expect(repository.saveCount).toBe(saveCount + 1);
	});

	it('keeps the entire batch when one selected item has a stale revision', async () => {
		const { repository, service } = createServiceHarness();
		const first = await service.add({ identity: { name: 'First' }, quantity: 1, precision: 'exact', source: 'manual' });
		const stale = await service.add({ identity: { name: 'Stale' }, quantity: 2, precision: 'exact', source: 'manual' });
		await service.updateQuantity(stale.id, 3, 'exact');
		const before = repository.snapshot();
		const saveCount = repository.saveCount;

		await expect(service.removeItems([
			{ id: first.id, expectedRevision: first.revision },
			{ id: stale.id, expectedRevision: stale.revision },
		])).rejects.toBeInstanceOf(InventoryRevisionConflictError);

		expect(repository.snapshot()).toEqual(before);
		expect(repository.saveCount).toBe(saveCount);
	});

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

	it('restores only deleted rows from an imported file without adding retained quantities again', async () => {
		const { repository, service } = createServiceHarness();
		const file = createOrderFile({
			items: [
				{
					identity: { name: 'Retained order part', lcscPartNumber: 'C1001' },
					quantity: 5,
					precision: 'exact',
					source: 'order',
				},
				{
					identity: { name: 'Deleted order part', lcscPartNumber: 'C1002' },
					quantity: 3,
					precision: 'exact',
					source: 'order',
				},
			],
			rowCount: 2,
			totalQuantity: 8,
		});
		await service.importOrderBatch({ files: [file] }, 'add');
		const deleted = repository.snapshot().items.find(item => item.identity.lcscPartNumber === 'C1002')!;

		await service.removeItems([{ id: deleted.id, expectedRevision: deleted.revision }]);

		const preview = await service.previewOrderImportBatch({ files: [file] }, 'add');
		expect(preview.files[0]).toMatchObject({
			status: 'ready',
			result: { added: 1, merged: 0, skipped: 1 },
		});

		await service.importOrderBatch({ files: [file] }, 'add');

		const restored = repository.snapshot();
		expect(restored.items.find(item => item.identity.lcscPartNumber === 'C1001')?.quantity).toBe(5);
		expect(restored.items.find(item => item.identity.lcscPartNumber === 'C1002')?.quantity).toBe(3);
		expect(restored.orderImportBatches[0].files[0].deduplicationActive).toBe(false);
		expect(restored.orderImportBatches[1].files[0].inventoryLinks).toHaveLength(2);
		await expect(service.previewOrderImportBatch({ files: [file] }, 'add')).resolves.toMatchObject({
			files: [{ status: 'duplicate', duplicateReason: 'historical-fingerprint' }],
		});
	});

	it('restores shared quantities from separately reimported linked order files after deletion', async () => {
		const { repository, service } = createServiceHarness();
		const firstFile = createOrderFile();
		const secondFile = createOrderFile({
			fileName: 'order-SO2.xls',
			orderNumber: 'SO2',
			fingerprint: FILE_FINGERPRINT_B,
			items: [{
				identity: { name: 'Order part', lcscPartNumber: 'C1001' },
				quantity: 7,
				precision: 'exact',
				source: 'order',
			}],
			totalQuantity: 7,
		});
		await service.importOrderBatch({ files: [firstFile, secondFile] }, 'add');
		const shared = repository.snapshot().items[0];
		await service.removeItems([{ id: shared.id, expectedRevision: shared.revision }]);

		await service.importOrderBatch({ files: [firstFile] }, 'add');
		expect(repository.snapshot().items[0].quantity).toBe(5);
		expect((await service.previewOrderImportBatch({ files: [secondFile] }, 'add')).files[0].status).toBe('ready');

		await service.importOrderBatch({ files: [secondFile] }, 'add');
		expect(repository.snapshot().items[0].quantity).toBe(12);
	});

	it('restores all files from legacy history when inventory was deleted by an older version', async () => {
		const { repository, service } = createServiceHarness();
		const firstFile = createOrderFile();
		const secondFile = createOrderFile({
			fileName: 'order-SO2.xls',
			orderNumber: 'SO2',
			fingerprint: FILE_FINGERPRINT_B,
			items: [{
				identity: { name: 'Order part', lcscPartNumber: 'C1001' },
				quantity: 7,
				precision: 'exact',
				source: 'order',
			}],
			totalQuantity: 7,
		});
		await service.importOrderBatch({ files: [firstFile, secondFile] }, 'add');
		const legacy = repository.snapshot();
		legacy.items = [];
		legacy.orderImportBatches = legacy.orderImportBatches.map(batch => ({
			...batch,
			files: batch.files.map((file) => {
				const { deduplicationActive: _deduplicationActive, inventoryLinks: _inventoryLinks, ...legacyFile } = file;
				return legacyFile;
			}),
		}));
		repository.seed(legacy);

		const preview = await service.previewOrderImportBatch({ files: [firstFile, secondFile] }, 'add');
		expect(preview.files.map(file => file.status)).toEqual(['ready', 'ready']);
		expect(preview.result).toEqual({ added: 1, merged: 1, skipped: 0 });

		await service.importOrderBatch({ files: [firstFile, secondFile] }, 'add');
		expect(repository.snapshot().items[0].quantity).toBe(12);
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
		expect(storedFile.inventoryLinks).toEqual([{
			identityKey: 'lcsc:c1001',
			inventoryItemId: expect.any(String),
		}]);
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

	it('updates minimum quantity and favorite with revision checks and omits disabled fields', async () => {
		const { repository, service } = createServiceHarness();
		const item = await service.add({
			identity: { name: 'Frequently used resistor' },
			quantity: 100,
			precision: 'exact',
			source: 'manual',
		});

		const threshold = await service.updateMinimumQuantity(item.id, item.revision, 25);
		expect(threshold).toMatchObject({ minimumQuantity: 25, revision: 2 });
		const saveCount = repository.saveCount;
		await expect(service.updateMinimumQuantity(item.id, threshold.revision, 25)).resolves.toEqual(threshold);
		expect(repository.saveCount).toBe(saveCount);

		const favorite = await service.toggleFavorite(item.id, threshold.revision);
		expect(favorite).toMatchObject({ favorite: true, revision: 3 });
		const notFavorite = await service.toggleFavorite(item.id, favorite.revision);
		expect(notFavorite).not.toHaveProperty('favorite');
		expect(notFavorite.revision).toBe(4);

		const cleared = await service.updateMinimumQuantity(item.id, notFavorite.revision);
		expect(cleared).not.toHaveProperty('minimumQuantity');
		expect(cleared.revision).toBe(5);
	});

	it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
		'rejects invalid minimum quantity %s without saving',
		async (minimumQuantity) => {
			const { repository, service } = createServiceHarness();
			const item = await service.add({
				identity: { name: 'Threshold validation part' },
				quantity: 10,
				precision: 'exact',
				source: 'manual',
			});
			const saveCount = repository.saveCount;

			await expect(service.updateMinimumQuantity(item.id, item.revision, minimumQuantity))
				.rejects
				.toThrow('positive safe integer');
			expect(repository.saveCount).toBe(saveCount);
		},
	);

	it('rejects stale revisions when updating replenishment preferences', async () => {
		const service = createService();
		const item = await service.add({
			identity: { name: 'Revision checked part' },
			quantity: 10,
			precision: 'exact',
			source: 'manual',
		});
		await service.updateMinimumQuantity(item.id, item.revision, 5);

		await expect(service.toggleFavorite(item.id, item.revision))
			.rejects
			.toBeInstanceOf(InventoryRevisionConflictError);
	});

	it('preserves minimum quantity and favorite during a normal complete edit', async () => {
		const service = createService();
		const item = await service.add({
			identity: { name: 'Editable favorite' },
			quantity: 10,
			precision: 'exact',
			minimumQuantity: 4,
			favorite: true,
			source: 'manual',
		});

		const result = await service.updateItem(item.id, item.revision, createEditInput(item, {
			quantity: 9,
			note: 'Edited without preference controls',
		}));

		expect(result).toMatchObject({
			status: 'updated',
			item: { minimumQuantity: 4, favorite: true },
		});
	});

	it('updates or clears replenishment preferences in the same revision-checked edit', async () => {
		const { repository, service } = createServiceHarness();
		const item = await service.add({
			identity: { name: 'Editable replenishment settings' },
			quantity: 10,
			precision: 'exact',
			minimumQuantity: 4,
			favorite: true,
			source: 'manual',
		});
		const saveCount = repository.saveCount;

		const cleared = await service.updateItem(item.id, item.revision, createEditInput(item, {
			minimumQuantity: null,
			favorite: false,
		}));

		expect(cleared.status).toBe('updated');
		if (cleared.status !== 'updated') {
			throw new Error('Expected the item to be updated.');
		}
		expect(cleared.item).not.toHaveProperty('minimumQuantity');
		expect(cleared.item).not.toHaveProperty('favorite');
		expect(cleared.item.revision).toBe(item.revision + 1);
		expect(repository.saveCount).toBe(saveCount + 1);
	});

	it('updates the item category and fields with one document save', async () => {
		const { repository, service } = createServiceHarness();
		const category = await service.createCategory({ name: 'Passives' });
		const item = await service.add({
			identity: { name: 'Categorized part' },
			quantity: 10,
			precision: 'exact',
			source: 'manual',
		});
		const saveCount = repository.saveCount;

		const result = await service.updateItem(item.id, item.revision, createEditInput(item, {
			categoryId: category.id,
			note: 'Moved during edit',
		}));

		expect(result).toMatchObject({
			status: 'updated',
			item: { categoryId: category.id, note: 'Moved during edit' },
		});
		expect(repository.saveCount).toBe(saveCount + 1);
	});

	it('preserves user-maintained fields and substitute links when an order replenishes an existing item', async () => {
		const { repository, service } = createServiceHarness();
		const existing = await service.add({
			identity: { name: 'Existing order part', lcscPartNumber: 'C1001' },
			quantity: 10,
			precision: 'exact',
			minimumQuantity: 6,
			favorite: true,
			source: 'manual',
		});
		const substitute = await service.add({
			identity: { name: 'Confirmed substitute', lcscPartNumber: 'C1002' },
			quantity: 3,
			precision: 'exact',
			source: 'manual',
		});
		const link = await service.createSubstituteLink({
			itemA: { id: existing.id, expectedRevision: existing.revision },
			itemB: { id: substitute.id, expectedRevision: substitute.revision },
			expectedDocumentRevision: repository.snapshot().revision,
		});

		await service.importOrderBatch({ files: [createOrderFile()] }, 'add');

		const document = repository.snapshot();
		expect(document.items.find(item => item.id === existing.id)).toMatchObject({
			quantity: 15,
			minimumQuantity: 6,
			favorite: true,
		});
		expect(document.substituteLinks).toEqual([link]);
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
