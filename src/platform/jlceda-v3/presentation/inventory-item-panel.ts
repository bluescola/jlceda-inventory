import type { InventoryItem, PartIdentity } from '../../../features/inventory/domain/inventory-item';
import type { StructuredInventoryLocation } from '../../../features/inventory/domain/inventory-metadata';

export interface InventoryItemEditDraft {
	identity: {
		name: string;
		lcscPartNumber: string;
		supplierId: string;
		manufacturer: string;
		manufacturerPartNumber: string;
		package: string;
		description: string;
	};
	quantity: number;
	precision: 'exact' | 'estimated';
	minimumQuantity?: number;
	favorite?: boolean;
	location: string;
	datasheetUrl?: string | null;
	structuredLocation?: StructuredInventoryLocation | null;
	note: string;
}

export interface InventoryItemEditOptions {
	initial?: InventoryItemEditDraft;
	suggestion?: PartIdentity;
	locationOptions?: readonly string[];
}

export interface InventoryItemPanel {
	view: (item: InventoryItem) => Promise<'edit' | undefined>;
	edit: (item: InventoryItem, options?: InventoryItemEditOptions) => Promise<InventoryItemEditDraft | undefined>;
	compare: (existing: InventoryItem, candidate: InventoryItem) => Promise<boolean>;
}
