import type {
	InventoryEditInput,
	ProjectSnapshotCaptureInput,
	ProjectSnapshotReplacementInput,
} from '../../src/features/inventory/application/inventory-service';
import type { InventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { InventoryRepository } from '../../src/features/inventory/ports/inventory-repository';
import type { NewPurchaseRecord } from '../../src/features/project-planning/domain/project-planning';
import { describe, expect, it } from 'vitest';
import {
	InventoryService,
	ProjectSnapshotIdentityConflictError,
	ProjectSnapshotRevisionConflictError,
	PurchaseRecordRevisionConflictError,
} from '../../src/features/inventory/application/inventory-service';
import { cloneInventoryDocument, createEmptyInventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import { InventoryDocumentRevisionConflictError } from '../../src/features/inventory/ports/inventory-repository';

class PlanningMemoryRepository implements InventoryRepository {
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
		if (expectedRevision !== undefined && expectedRevision !== this.document.revision) {
			throw new InventoryDocumentRevisionConflictError(expectedRevision, this.document.revision);
		}
		this.saveCount += 1;
		this.document = cloneInventoryDocument(document);
	};

	public snapshot(): InventoryDocument {
		return cloneInventoryDocument(this.document);
	}
}

function createHarness(): { repository: PlanningMemoryRepository; service: InventoryService } {
	let id = 0;
	let second = 0;
	const repository = new PlanningMemoryRepository();
	const service = new InventoryService(
		repository,
		() => `2026-07-22T00:00:${String(second++).padStart(2, '0')}.000Z`,
		() => `planning-id-${++id}`,
	);
	return { repository, service };
}

describe('inventory project planning persistence', () => {
	it('captures and lists a detached snapshot with one document save', async () => {
		const { repository, service } = createHarness();
		const input = snapshotInput('snapshot-1');

		const captured = await service.captureProjectSnapshot(input);

		expect(captured).toMatchObject({ id: 'snapshot-1', revision: 1, boardQuantity: 2 });
		expect(repository.saveCount).toBe(1);
		expect(repository.snapshot()).toMatchObject({ revision: 1, projectSnapshots: [captured] });
		captured.label = 'Mutated caller value';
		const listed = await service.listProjectSnapshots();
		expect(listed[0].label).toBe('Controller board');
		listed[0].demands[0].identity.name = 'Mutated list value';
		expect(repository.snapshot().projectSnapshots[0].demands[0].identity.name).toBe('Resistor');
	});

	it('refuses duplicate IDs and same-project document captures without silent replacement', async () => {
		const { repository, service } = createHarness();
		await service.captureProjectSnapshot(snapshotInput('snapshot-1'));
		const before = repository.snapshot();
		const saveCount = repository.saveCount;

		await expect(service.captureProjectSnapshot(snapshotInput('snapshot-1', 'project-2', 'pcb-2')))
			.rejects
			.toThrow('ID already exists');
		await expect(service.captureProjectSnapshot(snapshotInput('snapshot-2')))
			.rejects
			.toBeInstanceOf(ProjectSnapshotIdentityConflictError);

		expect(repository.snapshot()).toEqual(before);
		expect(repository.saveCount).toBe(saveCount);
	});

	it('replaces a snapshot only with its explicit current revision', async () => {
		const { repository, service } = createHarness();
		const captured = await service.captureProjectSnapshot(snapshotInput('snapshot-1'));
		const replacement = replacementInput({ label: 'Controller board rev B', sourceFingerprint: 'b'.repeat(64) });
		const saveCount = repository.saveCount;

		const replaced = await service.replaceProjectSnapshot(captured.id, captured.revision, replacement);

		expect(replaced).toMatchObject({ id: captured.id, revision: 2, label: 'Controller board rev B' });
		expect(repository.saveCount).toBe(saveCount + 1);
		const beforeStale = repository.snapshot();
		await expect(service.replaceProjectSnapshot(captured.id, captured.revision, replacement))
			.rejects
			.toBeInstanceOf(ProjectSnapshotRevisionConflictError);
		expect(repository.snapshot()).toEqual(beforeStale);
	});

	it('updates board quantity with revision validation and avoids a no-op save', async () => {
		const { repository, service } = createHarness();
		const captured = await service.captureProjectSnapshot(snapshotInput('snapshot-1'));
		const saveCount = repository.saveCount;

		const unchanged = await service.setProjectSnapshotBoardQuantity(captured.id, captured.revision, 2);
		expect(unchanged).toEqual(captured);
		expect(repository.saveCount).toBe(saveCount);

		const updated = await service.setProjectSnapshotBoardQuantity(captured.id, captured.revision, 5);
		expect(updated).toMatchObject({ boardQuantity: 5, revision: 2 });
		expect(repository.saveCount).toBe(saveCount + 1);
		const beforeInvalid = repository.snapshot();
		await expect(service.setProjectSnapshotBoardQuantity(captured.id, updated.revision, 0))
			.rejects
			.toThrow('positive safe integer');
		expect(repository.snapshot()).toEqual(beforeInvalid);
	});

	it('removes a snapshot atomically and rejects stale removal revisions', async () => {
		const { repository, service } = createHarness();
		const captured = await service.captureProjectSnapshot(snapshotInput('snapshot-1'));
		const before = repository.snapshot();

		await expect(service.removeProjectSnapshot(captured.id, captured.revision + 1))
			.rejects
			.toBeInstanceOf(ProjectSnapshotRevisionConflictError);
		expect(repository.snapshot()).toEqual(before);

		const removed = await service.removeProjectSnapshot(captured.id, captured.revision);
		expect(removed).toEqual(captured);
		expect(repository.snapshot().projectSnapshots).toEqual([]);
	});

	it('adds and removes detached purchase records with snapshot and revision checks', async () => {
		const { repository, service } = createHarness();
		const snapshot = await service.captureProjectSnapshot(snapshotInput('snapshot-1'));
		const draft = purchaseInput([snapshot.id, snapshot.id]);
		const saveCount = repository.saveCount;

		const purchase = await service.addPurchaseRecord(draft);
		expect(purchase).toMatchObject({
			id: 'planning-id-1',
			revision: 1,
			currency: 'CNY',
			projectSnapshotIds: [snapshot.id],
		});
		expect(repository.saveCount).toBe(saveCount + 1);
		purchase.name = 'Mutated caller value';
		expect((await service.listPurchaseRecords())[0].name).toBe('Resistor');

		const beforeStale = repository.snapshot();
		await expect(service.removePurchaseRecord(purchase.id, 2))
			.rejects
			.toBeInstanceOf(PurchaseRecordRevisionConflictError);
		expect(repository.snapshot()).toEqual(beforeStale);

		const removed = await service.removePurchaseRecord(purchase.id, 1);
		expect(removed.id).toBe(purchase.id);
		expect(repository.snapshot().purchaseRecords).toEqual([]);
	});

	it('rejects purchase references to unknown snapshots without saving', async () => {
		const { repository, service } = createHarness();
		const before = repository.snapshot();

		await expect(service.addPurchaseRecord(purchaseInput(['missing-snapshot'])))
			.rejects
			.toThrow('Project snapshot not found');

		expect(repository.snapshot()).toEqual(before);
		expect(repository.saveCount).toBe(0);
	});

	it('lets repository CAS reject a concurrent project write without partial persistence', async () => {
		const { repository, service } = createHarness();
		repository.raceBeforeNextSave = true;

		await expect(service.captureProjectSnapshot(snapshotInput('snapshot-1')))
			.rejects
			.toBeInstanceOf(InventoryDocumentRevisionConflictError);

		const stored = repository.snapshot();
		expect(stored.projectSnapshots).toEqual([]);
		expect(stored.purchaseRecords).toEqual([]);
		expect(repository.saveCount).toBe(0);
	});

	it('normalizes, preserves, clears, and merges inventory metadata without touching legacy location', async () => {
		const { service } = createHarness();
		const item = await service.add({
			identity: { name: 'Metadata resistor', lcscPartNumber: 'C1001' },
			quantity: 10,
			precision: 'exact',
			location: 'Legacy drawer A-1',
			datasheetUrl: ' https://example.com/resistor.pdf ',
			structuredLocation: { cabinet: ' Cabinet A ', box: 'Box 1' },
			source: 'manual',
		});
		expect(item).toMatchObject({
			location: 'Legacy drawer A-1',
			datasheetUrl: 'https://example.com/resistor.pdf',
			structuredLocation: { cabinet: 'Cabinet A', box: 'Box 1' },
		});

		const preserved = await service.updateItem(item.id, item.revision, editInput(item, { quantity: 9 }));
		expect(preserved).toMatchObject({
			status: 'updated',
			item: {
				location: 'Legacy drawer A-1',
				datasheetUrl: 'https://example.com/resistor.pdf',
				structuredLocation: { cabinet: 'Cabinet A', box: 'Box 1' },
			},
		});
		if (preserved.status !== 'updated') {
			throw new Error('Expected metadata inventory item update.');
		}

		const cleared = await service.updateItem(preserved.item.id, preserved.item.revision, editInput(preserved.item, {
			datasheetUrl: null,
			structuredLocation: null,
		}));
		expect(cleared).toMatchObject({ status: 'updated', item: { location: 'Legacy drawer A-1' } });
		if (cleared.status !== 'updated') {
			throw new Error('Expected metadata inventory item clear.');
		}
		expect(cleared.item).not.toHaveProperty('datasheetUrl');
		expect(cleared.item).not.toHaveProperty('structuredLocation');

		await service.add({
			identity: { name: 'Imported metadata', lcscPartNumber: 'C1001' },
			quantity: 1,
			precision: 'exact',
			datasheetUrl: 'https://example.com/new.pdf',
			structuredLocation: { row: '2', column: '3' },
			source: 'order',
		}, 'add');
		await expect(service.get(item.id)).resolves.toMatchObject({
			location: 'Legacy drawer A-1',
			datasheetUrl: 'https://example.com/new.pdf',
			structuredLocation: { row: '2', column: '3' },
		});
	});
});

function snapshotInput(
	id: string,
	projectUuid = 'project-1',
	documentUuid = 'pcb-1',
): ProjectSnapshotCaptureInput {
	return {
		id,
		projectUuid,
		documentUuid,
		documentKind: 'pcb',
		label: 'Controller board',
		boardQuantity: 2,
		demands: [{
			key: 'lcsc:c1',
			identity: { name: 'Resistor', lcscPartNumber: 'C1' },
			designators: ['R1'],
			unitQuantity: 1,
		}],
		sourceFingerprint: 'a'.repeat(64),
		capturedAt: '2026-07-22T00:00:00.000Z',
	};
}

function replacementInput(
	overrides: Partial<ProjectSnapshotReplacementInput> = {},
): ProjectSnapshotReplacementInput {
	const { id: _id, ...input } = snapshotInput('replacement');
	return { ...input, ...overrides };
}

function purchaseInput(projectSnapshotIds: string[]): NewPurchaseRecord {
	return {
		lcscPartNumber: '1',
		name: ' Resistor ',
		quantity: 4,
		unitPriceMinor: 25,
		currency: 'cny',
		purchasedAt: '2026-07-22',
		projectSnapshotIds,
	};
}

function editInput(
	item: InventoryItem,
	overrides: Partial<InventoryEditInput>,
): InventoryEditInput {
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
