import type { InventoryDocument } from '../../../features/inventory/domain/inventory-document';
import type { InventoryRepository } from '../../../features/inventory/ports/inventory-repository';
import { createEmptyInventoryDocument, isInventoryDocument } from '../../../features/inventory/domain/inventory-document';

export const INVENTORY_STORAGE_KEY = 'inventory.v1.document';

export class EdaInventoryRepository implements InventoryRepository {
	public async load(): Promise<InventoryDocument> {
		let stored: unknown;
		try {
			stored = eda.sys_Storage.getExtensionUserConfig(INVENTORY_STORAGE_KEY);
		}
		catch (error) {
			throw new Error('Unable to read extension inventory configuration.', { cause: error });
		}
		if (stored === undefined) {
			return createEmptyInventoryDocument();
		}
		if (!isInventoryDocument(stored)) {
			throw new TypeError('Unsupported or invalid inventory document.');
		}
		return structuredClone(stored);
	}

	public async save(document: InventoryDocument): Promise<void> {
		try {
			const saved = await eda.sys_Storage.setExtensionUserConfig(INVENTORY_STORAGE_KEY, structuredClone(document));
			if (!saved) {
				throw new Error('The host rejected the inventory configuration write.');
			}
		}
		catch (error) {
			throw new Error('Unable to save extension inventory configuration.', { cause: error });
		}
	}
}
