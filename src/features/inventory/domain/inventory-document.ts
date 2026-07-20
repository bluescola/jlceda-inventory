import type { InventoryItem } from './inventory-item';

export const INVENTORY_SCHEMA_VERSION = 1 as const;

export interface InventoryDocument {
	schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
	revision: number;
	updatedAt: string;
	items: InventoryItem[];
}

export function createEmptyInventoryDocument(now = new Date().toISOString()): InventoryDocument {
	return {
		schemaVersion: INVENTORY_SCHEMA_VERSION,
		revision: 0,
		updatedAt: now,
		items: [],
	};
}

export function isInventoryDocument(value: unknown): value is InventoryDocument {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const document = value as Partial<InventoryDocument>;
	return document.schemaVersion === INVENTORY_SCHEMA_VERSION
		&& typeof document.revision === 'number'
		&& typeof document.updatedAt === 'string'
		&& Array.isArray(document.items);
}
