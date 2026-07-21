import type { InventoryCategory } from './inventory-category';
import type { EdaModelReference, InventoryItem } from './inventory-item';
import type { OrderImportBatchRecord } from './order-import-batch';
import { sanitizeInventoryCategoryText } from './inventory-category';
import { sanitizeInventoryItemText } from './inventory-item';
import { sanitizeOrderImportBatchRecord } from './order-import-batch';

export const INVENTORY_SCHEMA_VERSION = 4 as const;

export interface InventoryDocument {
	schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
	revision: number;
	updatedAt: string;
	categories: InventoryCategory[];
	items: InventoryItem[];
	orderImportBatches: OrderImportBatchRecord[];
}

export function createEmptyInventoryDocument(now = new Date().toISOString()): InventoryDocument {
	return {
		schemaVersion: INVENTORY_SCHEMA_VERSION,
		revision: 0,
		updatedAt: now,
		categories: [],
		items: [],
		orderImportBatches: [],
	};
}

export function isInventoryDocument(value: unknown): value is InventoryDocument {
	return isDocumentShape(value)
		&& value.schemaVersion === INVENTORY_SCHEMA_VERSION
		&& Array.isArray((value as Partial<InventoryDocument>).categories)
		&& Array.isArray((value as Partial<InventoryDocument>).orderImportBatches);
}

export function cloneInventoryDocument(document: InventoryDocument): InventoryDocument {
	return JSON.parse(JSON.stringify(document)) as InventoryDocument;
}

export function migrateInventoryDocument(value: unknown): InventoryDocument | undefined {
	if (!isDocumentShape(value)) {
		return undefined;
	}
	if (value.schemaVersion === INVENTORY_SCHEMA_VERSION) {
		if (!Array.isArray((value as Partial<InventoryDocument>).categories)
			|| !Array.isArray((value as Partial<InventoryDocument>).orderImportBatches)) {
			return undefined;
		}
		const document = cloneInventoryDocument(value as InventoryDocument);
		document.categories = document.categories.map(sanitizeInventoryCategoryText);
		document.items = document.items.map(sanitizeInventoryItemText);
		document.orderImportBatches = document.orderImportBatches.map(sanitizeOrderImportBatchRecord);
		return document;
	}
	if (value.schemaVersion === 3) {
		if (!Array.isArray((value as Partial<InventoryDocument>).categories)) {
			return undefined;
		}
		return cloneInventoryDocument({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: value.revision,
			updatedAt: value.updatedAt,
			categories: (value as Partial<InventoryDocument>).categories!.map(sanitizeInventoryCategoryText),
			items: value.items.map(item => sanitizeInventoryItemText(item as InventoryItem)),
			orderImportBatches: [],
		});
	}
	if (value.schemaVersion === 2) {
		return cloneInventoryDocument({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: value.revision,
			updatedAt: value.updatedAt,
			categories: [],
			items: value.items.map(item => sanitizeInventoryItemText(item as InventoryItem)),
			orderImportBatches: [],
		});
	}
	if (value.schemaVersion !== 1) {
		return undefined;
	}
	return cloneInventoryDocument({
		schemaVersion: INVENTORY_SCHEMA_VERSION,
		revision: value.revision,
		updatedAt: value.updatedAt,
		categories: [],
		items: value.items.map((item) => {
			const legacy = item as Omit<InventoryItem, 'edaModelStatus'> & { catalogReference?: EdaModelReference; edaModelStatus?: InventoryItem['edaModelStatus'] };
			const { catalogReference, ...current } = legacy;
			const edaModelReference = current.edaModelReference ?? catalogReference;
			return sanitizeInventoryItemText({
				...current,
				edaModelReference,
				edaModelStatus: edaModelReference ? 'available' : current.edaModelStatus ?? 'unchecked',
			});
		}),
		orderImportBatches: [],
	});
}

function isDocumentShape(value: unknown): value is { schemaVersion: number; revision: number; updatedAt: string; items: unknown[] } {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const document = value as Partial<InventoryDocument>;
	return typeof document.schemaVersion === 'number'
		&& typeof document.revision === 'number'
		&& typeof document.updatedAt === 'string'
		&& Array.isArray(document.items);
}
