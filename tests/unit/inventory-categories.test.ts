import type { InventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import type { InventoryRepository } from '../../src/features/inventory/ports/inventory-repository';
import { describe, expect, it } from 'vitest';
import {
	InventoryCategoryRevisionConflictError,
	InventoryRevisionConflictError,
	InventoryService,
} from '../../src/features/inventory/application/inventory-service';
import {
	cloneInventoryDocument,
	createEmptyInventoryDocument,
	INVENTORY_SCHEMA_VERSION,
	migrateInventoryDocument,
} from '../../src/features/inventory/domain/inventory-document';

class MemoryInventoryRepository implements InventoryRepository {
	private document = createEmptyInventoryDocument('2026-07-21T00:00:00.000Z');
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

function createHarness(): { repository: MemoryInventoryRepository; service: InventoryService } {
	let id = 0;
	let second = 0;
	const repository = new MemoryInventoryRepository();
	const service = new InventoryService(
		repository,
		() => `2026-07-21T00:00:${String(second++).padStart(2, '0')}.000Z`,
		() => `inventory-id-${++id}`,
	);
	return { repository, service };
}

describe('inventory category document migration', () => {
	it('migrates schema v2 to v4 without changing inventory data or revisions', () => {
		const v2Document = {
			schemaVersion: 2,
			revision: 7,
			updatedAt: '2026-07-20T08:30:00.000Z',
			items: [{
				id: 'legacy-item',
				identity: {
					name: '10k resistor',
					lcscPartNumber: 'C25804',
					manufacturer: 'UniOhm',
				},
				edaModelStatus: 'unchecked',
				quantity: 25,
				precision: 'exact',
				state: 'in-stock',
				location: 'A-1',
				note: 'sealed',
				source: 'manual',
				createdAt: '2026-07-20T08:00:00.000Z',
				updatedAt: '2026-07-20T08:30:00.000Z',
				revision: 4,
			}],
		};

		const migrated = migrateInventoryDocument(v2Document);

		expect(migrated).toEqual({
			...v2Document,
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			categories: [],
			orderImportBatches: [],
		});
	});

	it('preserves category links and sanitizes category names when reading v3', () => {
		const document = createEmptyInventoryDocument('2026-07-21T00:00:00.000Z');
		document.categories.push({
			id: 'passive',
			name: ' Passive\u200B ',
			sortOrder: 0,
			createdAt: document.updatedAt,
			updatedAt: document.updatedAt,
			revision: 1,
		});
		document.items.push({
			id: 'resistor',
			categoryId: 'passive',
			identity: { name: 'Resistor' },
			edaModelStatus: 'unchecked',
			quantity: 1,
			precision: 'exact',
			state: 'in-stock',
			source: 'manual',
			createdAt: document.updatedAt,
			updatedAt: document.updatedAt,
			revision: 1,
		});

		const migrated = migrateInventoryDocument(document);

		expect(migrated?.categories[0].name).toBe('Passive');
		expect(migrated?.items[0].categoryId).toBe('passive');
		expect(migrated?.revision).toBe(0);
	});
});

describe('inventory category service', () => {
	it('creates unique two-level categories and rejects missing or third-level parents', async () => {
		const { repository, service } = createHarness();
		const root = await service.createCategory({ name: ' Passive ' });
		const child = await service.createCategory({ name: 'Resistors', parentId: root.id });

		expect(await service.listCategories()).toEqual([root, child]);
		await expect(service.createCategory({ name: 'Duplicate', parentId: 'missing' }))
			.rejects
			.toThrow('Inventory category not found');
		await expect(service.createCategory({ name: 'SMD', parentId: child.id }))
			.rejects
			.toThrow('at most two levels');
		await expect(service.createCategory({ name: 'passive' }))
			.rejects
			.toThrow('already exists');
		expect(repository.saveCount).toBe(2);
	});

	it('renames and reorders siblings with category revision checks', async () => {
		const { repository, service } = createHarness();
		const first = await service.createCategory({ name: 'Passive' });
		const second = await service.createCategory({ name: 'Connectors' });
		const renamed = await service.renameCategory(first.id, first.revision, 'Passives');

		expect(renamed).toMatchObject({ name: 'Passives', revision: 2 });
		const reordered = await service.reorderCategories(undefined, [
			{ id: second.id, expectedRevision: second.revision },
			{ id: renamed.id, expectedRevision: renamed.revision },
		]);
		expect(reordered).toMatchObject([
			{ id: second.id, sortOrder: 0, revision: 2 },
			{ id: renamed.id, sortOrder: 1, revision: 3 },
		]);
		expect(repository.snapshot().revision).toBe(4);

		const saveCount = repository.saveCount;
		await expect(service.renameCategory(renamed.id, renamed.revision, 'Stale'))
			.rejects
			.toBeInstanceOf(InventoryCategoryRevisionConflictError);
		await expect(service.reorderCategories(undefined, [{ id: second.id, expectedRevision: second.revision }]))
			.rejects
			.toThrow('every sibling');
		expect(repository.saveCount).toBe(saveCount);
	});

	it('cascades root deletion and moves items from the whole branch to uncategorized', async () => {
		const { repository, service } = createHarness();
		const root = await service.createCategory({ name: 'Passive' });
		const child = await service.createCategory({ name: 'Resistors', parentId: root.id });
		const retained = await service.createCategory({ name: 'Connectors' });
		const rootItem = await service.add({
			categoryId: root.id,
			identity: { name: 'Assortment' },
			quantity: 1,
			precision: 'exact',
			source: 'manual',
		});
		const childItem = await service.add({
			categoryId: child.id,
			identity: { name: '10k resistor' },
			quantity: 10,
			precision: 'exact',
			source: 'manual',
		});
		const retainedItem = await service.add({
			categoryId: retained.id,
			identity: { name: 'Header' },
			quantity: 3,
			precision: 'exact',
			source: 'manual',
		});

		const result = await service.deleteCategory(root.id, root.revision);

		expect(result).toEqual({
			deletedCategoryIds: [root.id, child.id],
			uncategorizedItemIds: [rootItem.id, childItem.id],
		});
		expect(repository.snapshot().categories).toEqual([retained]);
		expect(repository.snapshot().revision).toBe(7);
		expect(await service.get(rootItem.id)).toMatchObject({ revision: rootItem.revision + 1 });
		expect(await service.get(rootItem.id)).not.toHaveProperty('categoryId');
		expect(await service.get(childItem.id)).not.toHaveProperty('categoryId');
		expect(await service.get(retainedItem.id)).toEqual(retainedItem);
	});

	it('moves multiple items atomically and rejects stale revisions or missing categories', async () => {
		const { repository, service } = createHarness();
		const category = await service.createCategory({ name: 'ICs' });
		const first = await service.add({
			identity: { name: 'MCU' },
			quantity: 2,
			precision: 'exact',
			source: 'manual',
		});
		const second = await service.add({
			identity: { name: 'Op amp' },
			quantity: 4,
			precision: 'exact',
			source: 'manual',
		});

		const moved = await service.moveItemsToCategory([
			{ id: first.id, expectedRevision: first.revision },
			{ id: second.id, expectedRevision: second.revision },
		], category.id);
		expect(moved).toMatchObject([
			{ id: first.id, categoryId: category.id, revision: 2 },
			{ id: second.id, categoryId: category.id, revision: 2 },
		]);
		expect(repository.snapshot().revision).toBe(4);

		const beforeConflict = repository.snapshot();
		const saveCount = repository.saveCount;
		await expect(service.moveItemsToCategory([
			{ id: first.id, expectedRevision: moved[0].revision },
			{ id: second.id, expectedRevision: second.revision },
		], undefined)).rejects.toBeInstanceOf(InventoryRevisionConflictError);
		await expect(service.moveItemsToCategory([
			{ id: first.id, expectedRevision: moved[0].revision },
		], 'missing')).rejects.toThrow('Inventory category not found');
		expect(repository.snapshot()).toEqual(beforeConflict);
		expect(repository.saveCount).toBe(saveCount);

		const uncategorized = await service.moveItemsToCategory([
			{ id: first.id, expectedRevision: moved[0].revision },
		], undefined);
		expect(uncategorized[0]).not.toHaveProperty('categoryId');
		expect(uncategorized[0].revision).toBe(3);
	});

	it('does not include category assignment in duplicate identity matching', async () => {
		const { repository, service } = createHarness();
		const firstCategory = await service.createCategory({ name: 'Passives' });
		const secondCategory = await service.createCategory({ name: 'Favorites' });
		const original = await service.add({
			categoryId: firstCategory.id,
			identity: { name: 'Resistor', lcscPartNumber: 'C25804' },
			quantity: 5,
			precision: 'exact',
			source: 'manual',
		});
		const merged = await service.add({
			categoryId: secondCategory.id,
			identity: { name: 'Same resistor', lcscPartNumber: '25804' },
			quantity: 2,
			precision: 'exact',
			source: 'manual',
		}, 'add');

		expect(merged).toMatchObject({ id: original.id, categoryId: firstCategory.id, quantity: 7 });
		expect(await service.list()).toHaveLength(1);
		const saveCount = repository.saveCount;
		await expect(service.add({
			categoryId: 'missing',
			identity: { name: 'Invalid category reference' },
			quantity: 1,
			precision: 'exact',
			source: 'manual',
		})).rejects.toThrow('Inventory category not found');
		await expect(service.import([{
			categoryId: 'missing',
			identity: { name: 'Invalid imported reference' },
			quantity: 1,
			precision: 'exact',
			source: 'order',
		}], 'add')).rejects.toThrow('Inventory category not found');
		expect(repository.saveCount).toBe(saveCount);
	});
});
