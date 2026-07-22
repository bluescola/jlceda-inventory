import type { InventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INVENTORY_SCHEMA_VERSION } from '../../src/features/inventory/domain/inventory-document';
import { InventoryDocumentRevisionConflictError } from '../../src/features/inventory/ports/inventory-repository';
import { EdaInventoryRepository, INVENTORY_RECOVERY_STORAGE_KEY, INVENTORY_STORAGE_KEY } from '../../src/platform/jlceda-v3/persistence/eda-inventory-repository';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('edaInventoryRepository', () => {
	it('saves JSON-safe inventory when structuredClone is unavailable', async () => {
		const setExtensionUserConfig = vi.fn(async (_key: string, _value: unknown) => true);
		vi.stubGlobal('structuredClone', undefined);
		vi.stubGlobal('eda', {
			sys_Storage: {
				getExtensionUserConfig: vi.fn(),
				setExtensionUserConfig,
			},
		});
		const document = createDocument();

		await new EdaInventoryRepository().save(document);

		expect(setExtensionUserConfig).toHaveBeenCalledOnce();
		expect(setExtensionUserConfig).toHaveBeenCalledWith(INVENTORY_STORAGE_KEY, expect.any(Object));
		const saved = setExtensionUserConfig.mock.calls[0]?.[1] as InventoryDocument;
		expect(saved).not.toBe(document);
		expect(saved.items[0]?.quantity).toBe(99);
		expect(Object.hasOwn(saved.items[0]!, 'location')).toBe(false);
		expect(Object.hasOwn(saved.items[0]!.identity, 'manufacturer')).toBe(false);
	});

	it('loads a detached document when structuredClone is unavailable', async () => {
		const stored = createDocument();
		vi.stubGlobal('structuredClone', undefined);
		vi.stubGlobal('eda', {
			sys_Storage: {
				getExtensionUserConfig: vi.fn(() => stored),
				setExtensionUserConfig: vi.fn(),
			},
		});

		const loaded = await new EdaInventoryRepository().load();
		loaded.items[0]!.identity.name = 'Changed';

		expect(stored.items[0]?.identity.name).toBe('C307423');
	});

	it('serializes saves and rejects a stale whole-document write', async () => {
		let stored = createDocument();
		const setExtensionUserConfig = vi.fn(async (_key: string, value: InventoryDocument) => {
			stored = value;
			return true;
		});
		vi.stubGlobal('eda', {
			sys_Storage: {
				getExtensionUserConfig: vi.fn(() => stored),
				setExtensionUserConfig,
			},
		});
		const repository = new EdaInventoryRepository();
		const first = { ...createDocument(), revision: 2, updatedAt: '2026-07-20T08:00:00.000Z' };
		const stale = { ...createDocument(), revision: 2, updatedAt: '2026-07-20T09:00:00.000Z' };

		const results = await Promise.allSettled([
			repository.save(first, 1),
			repository.save(stale, 1),
		]);

		expect(results[0].status).toBe('fulfilled');
		expect(results[1]).toMatchObject({
			status: 'rejected',
			reason: expect.any(InventoryDocumentRevisionConflictError),
		});
		expect(stored.updatedAt).toBe(first.updatedAt);
		expect(setExtensionUserConfig).toHaveBeenCalledOnce();
	});

	it('stores and reloads a detached pre-restore recovery snapshot', async () => {
		let recovery: unknown;
		const setExtensionUserConfig = vi.fn(async (key: string, value: unknown) => {
			if (key === INVENTORY_RECOVERY_STORAGE_KEY) {
				recovery = value;
			}
			return true;
		});
		const deleteExtensionUserConfig = vi.fn(async (key: string) => {
			if (key === INVENTORY_RECOVERY_STORAGE_KEY) {
				recovery = undefined;
			}
			return true;
		});
		vi.stubGlobal('eda', {
			sys_Storage: {
				getExtensionUserConfig: vi.fn((key: string) => key === INVENTORY_RECOVERY_STORAGE_KEY ? recovery : undefined),
				setExtensionUserConfig,
				deleteExtensionUserConfig,
			},
		});
		const repository = new EdaInventoryRepository();
		const document = createDocument();

		await repository.saveRecoverySnapshot(document);
		const loaded = await repository.loadRecoverySnapshot();
		loaded!.items[0].identity.name = 'Changed';

		expect((recovery as InventoryDocument).items[0].identity.name).toBe('C307423');
		await repository.clearRecoverySnapshot();
		await expect(repository.loadRecoverySnapshot()).resolves.toBeUndefined();
		expect(deleteExtensionUserConfig).toHaveBeenCalledWith(INVENTORY_RECOVERY_STORAGE_KEY);
	});
});

function createDocument(): InventoryDocument {
	return {
		schemaVersion: INVENTORY_SCHEMA_VERSION,
		revision: 1,
		updatedAt: '2026-07-20T07:00:00.000Z',
		categories: [],
		orderImportBatches: [],
		transactions: [],
		stockOutBatches: [],
		projectSnapshots: [],
		purchaseRecords: [],
		substituteLinks: [],
		items: [{
			id: 'item-c307423',
			identity: {
				name: 'C307423',
				lcscPartNumber: 'C307423',
				manufacturer: undefined,
			},
			edaModelStatus: 'unchecked',
			quantity: 99,
			precision: 'exact',
			state: 'in-stock',
			location: undefined,
			source: 'catalog',
			createdAt: '2026-07-20T07:00:00.000Z',
			updatedAt: '2026-07-20T07:00:00.000Z',
			revision: 1,
		}],
	};
}
