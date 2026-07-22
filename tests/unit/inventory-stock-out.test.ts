import type { InventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import type { InventoryRepository } from '../../src/features/inventory/ports/inventory-repository';
import { describe, expect, it } from 'vitest';
import { BomStockOutInputError } from '../../src/features/inventory/application/bom-stock-out';
import {
	BomStockOutBlockedError,
	InventoryItemActiveStockOutReferenceError,
	InventoryService,
	StockOutReversalBlockedError,
} from '../../src/features/inventory/application/inventory-service';
import { cloneInventoryDocument, createEmptyInventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import { InventoryDocumentRevisionConflictError } from '../../src/features/inventory/ports/inventory-repository';

const SOURCE_FINGERPRINT = 'a'.repeat(64);

class CasMemoryInventoryRepository implements InventoryRepository {
	private document = createEmptyInventoryDocument('2026-07-22T00:00:00.000Z');
	public saveCount = 0;
	public raceBeforeNextSave = false;

	public load = async (): Promise<InventoryDocument> => cloneInventoryDocument(this.document);

	public save = async (document: InventoryDocument, expectedRevision?: number): Promise<void> => {
		if (this.raceBeforeNextSave) {
			this.raceBeforeNextSave = false;
			this.document.revision += 1;
			this.document.updatedAt = '2026-07-22T00:59:00.000Z';
		}
		if (expectedRevision !== undefined && this.document.revision !== expectedRevision) {
			throw new InventoryDocumentRevisionConflictError(expectedRevision, this.document.revision);
		}
		this.saveCount += 1;
		this.document = cloneInventoryDocument(document);
	};

	public snapshot(): InventoryDocument {
		return cloneInventoryDocument(this.document);
	}
}

function createHarness(): { repository: CasMemoryInventoryRepository; service: InventoryService } {
	let id = 0;
	let second = 0;
	const repository = new CasMemoryInventoryRepository();
	const service = new InventoryService(
		repository,
		() => `2026-07-22T00:00:${String(second++).padStart(2, '0')}.000Z`,
		() => `audit-id-${++id}`,
	);
	return { repository, service };
}

describe('inventory BOM stock-out', () => {
	it('previews an exact, explicitly mapped batch without writing and fingerprints line order canonically', async () => {
		const { repository, service } = createHarness();
		const first = await addExact(service, 'First', 10);
		const second = await addExact(service, 'Second', 7);
		const saveCount = repository.saveCount;

		const preview = await service.previewBomStockOut({
			sourceFingerprint: SOURCE_FINGERPRINT.toUpperCase(),
			sourceName: ' board.xlsx ',
			lines: [
				{ itemId: second.id, quantity: 2, sourceReference: ' R1 ' },
				{ itemId: first.id, quantity: 4 },
			],
		});
		const reordered = await service.previewBomStockOut({
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [
				{ itemId: first.id, quantity: 4 },
				{ itemId: second.id, quantity: 2 },
			],
		});
		const correctedMapping = await service.previewBomStockOut({
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [
				{ itemId: first.id, quantity: 2 },
				{ itemId: second.id, quantity: 4 },
			],
		});

		expect(preview).toMatchObject({
			status: 'ready',
			documentRevision: 2,
			lines: [
				{ itemId: second.id, beforeQuantity: 7, afterQuantity: 5, sourceReference: 'R1' },
				{ itemId: first.id, beforeQuantity: 10, afterQuantity: 6 },
			],
			issues: [],
		});
		expect(preview.batchFingerprint).toMatch(/^[a-f\d]{64}$/);
		expect(reordered.batchFingerprint).toBe(preview.batchFingerprint);
		expect(correctedMapping.batchFingerprint).not.toBe(preview.batchFingerprint);
		expect(repository.saveCount).toBe(saveCount);
	});

	it('rejects ambiguous mappings and invalid quantities before reading or writing inventory', async () => {
		const { repository, service } = createHarness();
		const item = await addExact(service, 'Mapped once', 10);
		const before = repository.snapshot();
		const saveCount = repository.saveCount;

		await expect(service.previewBomStockOut({
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [
				{ itemId: item.id, quantity: 1 },
				{ itemId: item.id, quantity: 2 },
			],
		})).rejects.toMatchObject({ code: 'duplicate-item', lineIndex: 1 });
		await expect(service.previewBomStockOut({
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [{ itemId: item.id, quantity: 0 }],
		})).rejects.toBeInstanceOf(BomStockOutInputError);

		expect(repository.snapshot()).toEqual(before);
		expect(repository.saveCount).toBe(saveCount);
	});

	it('reports every missing, non-exact, and insufficient line without changing the document', async () => {
		const { repository, service } = createHarness();
		const estimated = await service.add({
			identity: { name: 'Estimated' },
			quantity: 10,
			precision: 'estimated',
			source: 'manual',
		});
		const insufficient = await addExact(service, 'Insufficient', 2);
		const before = repository.snapshot();
		const saveCount = repository.saveCount;

		const preview = await service.previewBomStockOut({
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [
				{ itemId: 'missing-item', quantity: 1 },
				{ itemId: estimated.id, quantity: 3 },
				{ itemId: insufficient.id, quantity: 3 },
			],
		});

		expect(preview.status).toBe('blocked');
		expect(preview.issues.map(issue => issue.code)).toEqual([
			'item-missing',
			'quantity-not-exact',
			'insufficient-stock',
		]);
		expect(repository.snapshot()).toEqual(before);
		expect(repository.saveCount).toBe(saveCount);
	});

	it('commits all mapped lines with one document revision and one atomic save', async () => {
		const { repository, service } = createHarness();
		const first = await addExact(service, 'First', 10, 'C1001');
		const second = await addExact(service, 'Second', 7, 'C1002');
		const input = {
			sourceFingerprint: SOURCE_FINGERPRINT,
			sourceName: 'board.xlsx',
			note: 'Assembly run 1',
			lines: [
				{ itemId: first.id, quantity: 4, sourceReference: 'R1,R2,R3,R4' },
				{ itemId: second.id, quantity: 7, sourceReference: 'C1-C7' },
			],
		};
		const preview = await service.previewBomStockOut(input);
		const saveCount = repository.saveCount;

		const result = await service.commitBomStockOut(input, preview.documentRevision);
		const stored = repository.snapshot();

		expect(result.documentRevision).toBe(preview.documentRevision + 1);
		expect(repository.saveCount).toBe(saveCount + 1);
		expect(stored.revision).toBe(preview.documentRevision + 1);
		expect(stored.items.map(item => ({ quantity: item.quantity, state: item.state, revision: item.revision }))).toEqual([
			{ quantity: 6, state: 'in-stock', revision: 2 },
			{ quantity: 0, state: 'depleted', revision: 2 },
		]);
		expect(stored.transactions).toHaveLength(2);
		expect(stored.transactions[0]).toMatchObject({
			itemId: first.id,
			kind: 'bom-stock-out',
			source: 'bom',
			delta: -4,
			beforeQuantity: 10,
			afterQuantity: 6,
			identity: { name: 'First', lcscPartNumber: 'C1001' },
			note: 'Assembly run 1',
			batchId: result.batch.id,
		});
		expect(stored.stockOutBatches).toEqual([result.batch]);
		expect(result.batch.lines.map(line => line.transactionId)).toEqual(
			stored.transactions.map(transaction => transaction.id),
		);
	});

	it('blocks a repeated batch fingerprint without deducting stock twice', async () => {
		const { repository, service } = createHarness();
		const item = await addExact(service, 'Idempotent', 10);
		const input = {
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [{ itemId: item.id, quantity: 3 }],
		};
		const preview = await service.previewBomStockOut(input);
		await service.commitBomStockOut(input, preview.documentRevision);
		const beforeRepeat = repository.snapshot();
		const saveCount = repository.saveCount;

		const reExportedInput = { ...input, sourceFingerprint: 'b'.repeat(64) };
		await expect(service.commitBomStockOut(reExportedInput, beforeRepeat.revision))
			.rejects
			.toMatchObject({
				preview: {
					status: 'duplicate',
					issues: [{ code: 'duplicate-batch', existingBatchId: beforeRepeat.stockOutBatches[0].id }],
				},
			});

		expect(repository.snapshot()).toEqual(beforeRepeat);
		expect(repository.saveCount).toBe(saveCount);
	});

	it('allows an identical semantic BOM only with an explicit new production run ID', async () => {
		const { repository, service } = createHarness();
		const item = await addExact(service, 'Repeated production', 10);
		const input = {
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [{ itemId: item.id, quantity: 3 }],
		};
		const firstPreview = await service.previewBomStockOut(input);
		await service.commitBomStockOut(input, firstPreview.documentRevision);
		const duplicate = await service.previewBomStockOut({ ...input, sourceFingerprint: 'b'.repeat(64) });
		expect(duplicate.status).toBe('duplicate');

		const nextRunInput = {
			...input,
			sourceFingerprint: 'b'.repeat(64),
			productionRunId: 'production-run-2',
		};
		const nextPreview = await service.previewBomStockOut(nextRunInput);
		expect(nextPreview.status).toBe('ready');
		await service.commitBomStockOut(nextRunInput, nextPreview.documentRevision);

		expect(repository.snapshot().items[0].quantity).toBe(4);
		expect(repository.snapshot().stockOutBatches).toHaveLength(2);
		expect(repository.snapshot().stockOutBatches[1].productionRunId).toBe('production-run-2');
	});

	it('keeps the full batch unchanged when one line fails or the preview revision is stale', async () => {
		const { repository, service } = createHarness();
		const first = await addExact(service, 'Enough', 10);
		const second = await addExact(service, 'Not enough', 1);
		const blockedInput = {
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [
				{ itemId: first.id, quantity: 2 },
				{ itemId: second.id, quantity: 2 },
			],
		};
		const beforeBlocked = repository.snapshot();
		const saveCount = repository.saveCount;

		await expect(service.commitBomStockOut(blockedInput, beforeBlocked.revision))
			.rejects
			.toBeInstanceOf(BomStockOutBlockedError);
		expect(repository.snapshot()).toEqual(beforeBlocked);
		expect(repository.saveCount).toBe(saveCount);

		const readyInput = {
			sourceFingerprint: 'b'.repeat(64),
			lines: [{ itemId: first.id, quantity: 2 }],
		};
		const preview = await service.previewBomStockOut(readyInput);
		await service.updateQuantity(second.id, 1, 'exact');
		const beforeStale = repository.snapshot();
		await expect(service.commitBomStockOut(readyInput, preview.documentRevision))
			.rejects
			.toBeInstanceOf(InventoryDocumentRevisionConflictError);
		expect(repository.snapshot()).toEqual(beforeStale);
	});

	it('relies on repository CAS to reject a race after validation without a partial deduction', async () => {
		const { repository, service } = createHarness();
		const item = await addExact(service, 'Raced', 10);
		const input = {
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [{ itemId: item.id, quantity: 4 }],
		};
		const preview = await service.previewBomStockOut(input);
		const saveCount = repository.saveCount;
		repository.raceBeforeNextSave = true;

		await expect(service.commitBomStockOut(input, preview.documentRevision))
			.rejects
			.toBeInstanceOf(InventoryDocumentRevisionConflictError);

		const stored = repository.snapshot();
		expect(stored.items[0].quantity).toBe(10);
		expect(stored.transactions).toEqual([]);
		expect(stored.stockOutBatches).toEqual([]);
		expect(repository.saveCount).toBe(saveCount);
	});

	it('reverses a whole batch atomically by appending linked inverse transactions', async () => {
		const { repository, service } = createHarness();
		const first = await addExact(service, 'First', 10);
		const second = await addExact(service, 'Second', 7);
		const input = {
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [
				{ itemId: first.id, quantity: 4 },
				{ itemId: second.id, quantity: 7 },
			],
		};
		const preview = await service.previewBomStockOut(input);
		const committed = await service.commitBomStockOut(input, preview.documentRevision);
		const reversalPreview = await service.previewStockOutReversal(committed.batch.id);
		const saveCount = repository.saveCount;

		const reversal = await service.reverseStockOutBatch(
			committed.batch.id,
			reversalPreview.documentRevision,
			'Assembly cancelled',
		);
		const stored = repository.snapshot();

		expect(repository.saveCount).toBe(saveCount + 1);
		expect(reversal.documentRevision).toBe(reversalPreview.documentRevision + 1);
		expect(stored.items.map(item => item.quantity)).toEqual([10, 7]);
		expect(stored.transactions).toHaveLength(4);
		expect(stored.transactions.slice(0, 2)).toEqual(committed.transactions);
		expect(reversal.transactions.map(transaction => ({
			kind: transaction.kind,
			delta: transaction.delta,
			batchId: transaction.batchId,
			reversalId: transaction.reversalId,
			reversesTransactionId: transaction.reversesTransactionId,
		}))).toEqual(committed.transactions.map(transaction => ({
			kind: 'bom-stock-out-reversal',
			delta: -transaction.delta,
			batchId: committed.batch.id,
			reversalId: reversal.reversalId,
			reversesTransactionId: transaction.id,
		})));
		expect(stored.stockOutBatches[0].reversal).toMatchObject({
			id: reversal.reversalId,
			note: 'Assembly cancelled',
			transactionIds: reversal.transactions.map(transaction => transaction.id),
		});
	});

	it('protects active batch item IDs from deletion or merge until the batch is reversed', async () => {
		const { repository, service } = createHarness();
		const target = await addExact(service, 'Merge target', 5, 'C2001');
		const source = await addExact(service, 'Merge source', 10, 'C2002');
		const removable = await addExact(service, 'Removable later', 8, 'C2003');
		const input = {
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [
				{ itemId: source.id, quantity: 3 },
				{ itemId: removable.id, quantity: 2 },
			],
		};
		const preview = await service.previewBomStockOut(input);
		const committed = await service.commitBomStockOut(input, preview.documentRevision);
		const activeSource = await service.get(source.id);
		const activeRemovable = await service.get(removable.id);
		const mergeInput = {
			identity: target.identity,
			edaModelStatus: activeSource.edaModelStatus,
			quantity: activeSource.quantity!,
			precision: 'exact' as const,
		};

		await expect(service.remove(activeSource.id)).rejects.toBeInstanceOf(InventoryItemActiveStockOutReferenceError);
		await expect(service.removeItems([{
			id: activeRemovable.id,
			expectedRevision: activeRemovable.revision,
		}])).rejects.toBeInstanceOf(InventoryItemActiveStockOutReferenceError);
		await expect(service.updateItem(
			activeSource.id,
			activeSource.revision,
			mergeInput,
			{ id: target.id, expectedRevision: target.revision },
		)).rejects.toBeInstanceOf(InventoryItemActiveStockOutReferenceError);

		const beforeReversal = repository.snapshot();
		expect(beforeReversal.items).toHaveLength(3);
		const reversal = await service.previewStockOutReversal(committed.batch.id);
		await service.reverseStockOutBatch(committed.batch.id, reversal.documentRevision);
		const restoredSource = await service.get(source.id);
		const restoredRemovable = await service.get(removable.id);
		await expect(service.updateItem(
			restoredSource.id,
			restoredSource.revision,
			{ ...mergeInput, quantity: restoredSource.quantity! },
			{ id: target.id, expectedRevision: target.revision },
		)).resolves.toMatchObject({ status: 'merged', item: { id: target.id, quantity: 15 } });
		await expect(service.removeItems([{
			id: restoredRemovable.id,
			expectedRevision: restoredRemovable.revision,
		}])).resolves.toEqual([restoredRemovable.id]);
	});

	it('blocks a repeated or no-longer-exact reversal without changing history', async () => {
		const { repository, service } = createHarness();
		const item = await addExact(service, 'Reversal guard', 10);
		const input = {
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [{ itemId: item.id, quantity: 3 }],
		};
		const preview = await service.previewBomStockOut(input);
		const committed = await service.commitBomStockOut(input, preview.documentRevision);
		await service.updateQuantity(item.id, 7, 'estimated');
		const beforeBlocked = repository.snapshot();
		const saveCount = repository.saveCount;

		await expect(service.reverseStockOutBatch(committed.batch.id, beforeBlocked.revision))
			.rejects
			.toMatchObject({ preview: { issues: [{ code: 'quantity-not-exact' }] } });
		expect(repository.snapshot()).toEqual(beforeBlocked);
		expect(repository.saveCount).toBe(saveCount);

		await service.updateQuantity(item.id, 7, 'exact');
		const ready = await service.previewStockOutReversal(committed.batch.id);
		await service.reverseStockOutBatch(committed.batch.id, ready.documentRevision);
		const afterReversal = repository.snapshot();
		const savesAfterReversal = repository.saveCount;
		await expect(service.reverseStockOutBatch(committed.batch.id, afterReversal.revision))
			.rejects
			.toBeInstanceOf(StockOutReversalBlockedError);
		expect(repository.snapshot()).toEqual(afterReversal);
		expect(repository.saveCount).toBe(savesAfterReversal);
	});

	it('lists batch and item transaction history newest first', async () => {
		const { service } = createHarness();
		const item = await addExact(service, 'History', 10);
		const input = {
			sourceFingerprint: SOURCE_FINGERPRINT,
			lines: [{ itemId: item.id, quantity: 3 }],
		};
		const preview = await service.previewBomStockOut(input);
		const committed = await service.commitBomStockOut(input, preview.documentRevision);
		const reversalPreview = await service.previewStockOutReversal(committed.batch.id);
		await service.reverseStockOutBatch(committed.batch.id, reversalPreview.documentRevision);

		await expect(service.listTransactions(item.id)).resolves.toMatchObject([
			{ kind: 'bom-stock-out-reversal' },
			{ kind: 'bom-stock-out' },
		]);
		await expect(service.listStockOutBatches()).resolves.toMatchObject([{
			id: committed.batch.id,
			reversal: expect.any(Object),
		}]);
	});
});

async function addExact(
	service: InventoryService,
	name: string,
	quantity: number,
	lcscPartNumber?: string,
) {
	return service.add({
		identity: { name, lcscPartNumber },
		quantity,
		precision: 'exact',
		source: 'manual',
	});
}
