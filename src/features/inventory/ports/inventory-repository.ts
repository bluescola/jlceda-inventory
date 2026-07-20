import type { InventoryDocument } from '../domain/inventory-document';

export interface InventoryRepository {
	load: () => Promise<InventoryDocument>;
	save: (document: InventoryDocument) => Promise<void>;
}
