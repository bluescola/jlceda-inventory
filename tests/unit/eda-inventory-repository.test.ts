import type { InventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INVENTORY_SCHEMA_VERSION } from '../../src/features/inventory/domain/inventory-document';
import { EdaInventoryRepository, INVENTORY_STORAGE_KEY } from '../../src/platform/jlceda-v3/persistence/eda-inventory-repository';

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
});

function createDocument(): InventoryDocument {
	return {
		schemaVersion: INVENTORY_SCHEMA_VERSION,
		revision: 1,
		updatedAt: '2026-07-20T07:00:00.000Z',
		categories: [],
		orderImportBatches: [],
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
