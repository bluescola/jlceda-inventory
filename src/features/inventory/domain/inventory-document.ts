import type { ProjectDemandSnapshot, PurchaseRecord } from '../../project-planning/domain/project-planning';
import type { InventoryCategory } from './inventory-category';
import type { EdaModelReference, InventoryItem } from './inventory-item';
import type { InventoryTransaction, StockOutBatchRecord } from './inventory-transaction';
import type { OrderImportBatchRecord } from './order-import-batch';
import type { SubstituteLink } from './substitute-link';
import { sanitizeProjectDemandSnapshot, sanitizePurchaseRecord } from '../../project-planning/domain/project-planning';
import { sanitizeInventoryCategoryText } from './inventory-category';
import { sanitizeInventoryItemText } from './inventory-item';
import { sanitizeInventoryTransaction, sanitizeStockOutBatchRecord } from './inventory-transaction';
import { sanitizeOrderImportBatchRecord } from './order-import-batch';
import { sanitizeSubstituteLink, substitutePairKey } from './substitute-link';

export const INVENTORY_SCHEMA_VERSION = 9 as const;

export interface InventoryDocument {
	schemaVersion: typeof INVENTORY_SCHEMA_VERSION;
	revision: number;
	updatedAt: string;
	categories: InventoryCategory[];
	items: InventoryItem[];
	orderImportBatches: OrderImportBatchRecord[];
	transactions: InventoryTransaction[];
	stockOutBatches: StockOutBatchRecord[];
	projectSnapshots: ProjectDemandSnapshot[];
	purchaseRecords: PurchaseRecord[];
	substituteLinks: SubstituteLink[];
}

export function createEmptyInventoryDocument(now = new Date().toISOString()): InventoryDocument {
	return {
		schemaVersion: INVENTORY_SCHEMA_VERSION,
		revision: 0,
		updatedAt: now,
		categories: [],
		items: [],
		orderImportBatches: [],
		transactions: [],
		stockOutBatches: [],
		projectSnapshots: [],
		purchaseRecords: [],
		substituteLinks: [],
	};
}

export function isInventoryDocument(value: unknown): value is InventoryDocument {
	return isDocumentShape(value)
		&& value.schemaVersion === INVENTORY_SCHEMA_VERSION
		&& Array.isArray((value as Partial<InventoryDocument>).categories)
		&& Array.isArray((value as Partial<InventoryDocument>).orderImportBatches)
		&& Array.isArray((value as Partial<InventoryDocument>).transactions)
		&& Array.isArray((value as Partial<InventoryDocument>).stockOutBatches)
		&& Array.isArray((value as Partial<InventoryDocument>).projectSnapshots)
		&& Array.isArray((value as Partial<InventoryDocument>).purchaseRecords)
		&& Array.isArray((value as Partial<InventoryDocument>).substituteLinks);
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
			|| !Array.isArray((value as Partial<InventoryDocument>).orderImportBatches)
			|| !Array.isArray((value as Partial<InventoryDocument>).transactions)
			|| !Array.isArray((value as Partial<InventoryDocument>).stockOutBatches)
			|| !Array.isArray((value as Partial<InventoryDocument>).projectSnapshots)
			|| !Array.isArray((value as Partial<InventoryDocument>).purchaseRecords)
			|| !Array.isArray((value as Partial<InventoryDocument>).substituteLinks)) {
			return undefined;
		}
		const document = cloneInventoryDocument(value as InventoryDocument);
		document.categories = document.categories.map(sanitizeInventoryCategoryText);
		document.items = document.items.map(sanitizeInventoryItemText);
		document.orderImportBatches = document.orderImportBatches.map(sanitizeOrderImportBatchRecord);
		document.transactions = document.transactions.map(sanitizeInventoryTransaction);
		document.stockOutBatches = document.stockOutBatches.map(sanitizeStockOutBatchRecord);
		document.projectSnapshots = document.projectSnapshots.map(sanitizeProjectDemandSnapshot);
		document.purchaseRecords = document.purchaseRecords.map(sanitizePurchaseRecord);
		document.substituteLinks = document.substituteLinks.map(sanitizeSubstituteLink);
		return hasValidSubstituteLinks(document) ? document : undefined;
	}
	if (value.schemaVersion === 8) {
		if (!Array.isArray((value as Partial<InventoryDocument>).categories)
			|| !Array.isArray((value as Partial<InventoryDocument>).orderImportBatches)
			|| !Array.isArray((value as Partial<InventoryDocument>).transactions)
			|| !Array.isArray((value as Partial<InventoryDocument>).stockOutBatches)
			|| !Array.isArray((value as Partial<InventoryDocument>).projectSnapshots)
			|| !Array.isArray((value as Partial<InventoryDocument>).purchaseRecords)) {
			return undefined;
		}
		return cloneInventoryDocument({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: value.revision,
			updatedAt: value.updatedAt,
			categories: (value as Partial<InventoryDocument>).categories!.map(sanitizeInventoryCategoryText),
			items: value.items.map(item => sanitizeInventoryItemText(item as InventoryItem)),
			orderImportBatches: (value as Partial<InventoryDocument>).orderImportBatches!.map(sanitizeOrderImportBatchRecord),
			transactions: (value as Partial<InventoryDocument>).transactions!.map(sanitizeInventoryTransaction),
			stockOutBatches: (value as Partial<InventoryDocument>).stockOutBatches!.map(sanitizeStockOutBatchRecord),
			projectSnapshots: (value as Partial<InventoryDocument>).projectSnapshots!.map(sanitizeProjectDemandSnapshot),
			purchaseRecords: (value as Partial<InventoryDocument>).purchaseRecords!.map(sanitizePurchaseRecord),
			substituteLinks: [],
		});
	}
	if (value.schemaVersion === 7) {
		if (!Array.isArray((value as Partial<InventoryDocument>).categories)
			|| !Array.isArray((value as Partial<InventoryDocument>).orderImportBatches)
			|| !Array.isArray((value as Partial<InventoryDocument>).transactions)
			|| !Array.isArray((value as Partial<InventoryDocument>).stockOutBatches)) {
			return undefined;
		}
		return cloneInventoryDocument({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: value.revision,
			updatedAt: value.updatedAt,
			categories: (value as Partial<InventoryDocument>).categories!.map(sanitizeInventoryCategoryText),
			items: value.items.map(item => sanitizeInventoryItemText(item as InventoryItem)),
			orderImportBatches: (value as Partial<InventoryDocument>).orderImportBatches!.map(sanitizeOrderImportBatchRecord),
			transactions: (value as Partial<InventoryDocument>).transactions!.map(sanitizeInventoryTransaction),
			stockOutBatches: (value as Partial<InventoryDocument>).stockOutBatches!.map(sanitizeStockOutBatchRecord),
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [],
		});
	}
	if (value.schemaVersion === 6) {
		if (!Array.isArray((value as Partial<InventoryDocument>).categories)
			|| !Array.isArray((value as Partial<InventoryDocument>).orderImportBatches)) {
			return undefined;
		}
		return cloneInventoryDocument({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: value.revision,
			updatedAt: value.updatedAt,
			categories: (value as Partial<InventoryDocument>).categories!.map(sanitizeInventoryCategoryText),
			items: value.items.map(item => sanitizeInventoryItemText(item as InventoryItem)),
			orderImportBatches: (value as Partial<InventoryDocument>).orderImportBatches!.map(sanitizeOrderImportBatchRecord),
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [],
		});
	}
	if (value.schemaVersion === 5) {
		if (!Array.isArray((value as Partial<InventoryDocument>).categories)
			|| !Array.isArray((value as Partial<InventoryDocument>).orderImportBatches)) {
			return undefined;
		}
		return cloneInventoryDocument({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: value.revision,
			updatedAt: value.updatedAt,
			categories: (value as Partial<InventoryDocument>).categories!.map(sanitizeInventoryCategoryText),
			items: value.items.map(item => sanitizeInventoryItemText(item as InventoryItem)),
			orderImportBatches: (value as Partial<InventoryDocument>).orderImportBatches!.map(sanitizeOrderImportBatchRecord),
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [],
		});
	}
	if (value.schemaVersion === 4) {
		if (!Array.isArray((value as Partial<InventoryDocument>).categories)
			|| !Array.isArray((value as Partial<InventoryDocument>).orderImportBatches)) {
			return undefined;
		}
		return cloneInventoryDocument({
			schemaVersion: INVENTORY_SCHEMA_VERSION,
			revision: value.revision,
			updatedAt: value.updatedAt,
			categories: (value as Partial<InventoryDocument>).categories!.map(sanitizeInventoryCategoryText),
			items: value.items.map(item => sanitizeInventoryItemText(item as InventoryItem)),
			orderImportBatches: (value as Partial<InventoryDocument>).orderImportBatches!.map(sanitizeOrderImportBatchRecord),
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [],
		});
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
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [],
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
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [],
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
		transactions: [],
		stockOutBatches: [],
		projectSnapshots: [],
		purchaseRecords: [],
		substituteLinks: [],
	});
}

function hasValidSubstituteLinks(document: InventoryDocument): boolean {
	const itemIds = new Set(document.items.map(item => item.id));
	const linkIds = new Set<string>();
	const pairKeys = new Set<string>();
	for (const link of document.substituteLinks) {
		const pairKey = substitutePairKey(link.itemIdA, link.itemIdB);
		if (linkIds.has(link.id)
			|| pairKeys.has(pairKey)
			|| !itemIds.has(link.itemIdA)
			|| !itemIds.has(link.itemIdB)) {
			return false;
		}
		linkIds.add(link.id);
		pairKeys.add(pairKey);
	}
	return true;
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
