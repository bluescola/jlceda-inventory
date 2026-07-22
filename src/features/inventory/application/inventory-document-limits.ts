import type { InventoryDocument } from '../domain/inventory-document';

export const MAX_INVENTORY_DOCUMENT_TEXT_LENGTH = 10 * 1024 * 1024;
export const MAX_INVENTORY_DOCUMENT_ITEMS = 10_000;
export const MAX_INVENTORY_DOCUMENT_CATEGORIES = 2_000;
export const MAX_INVENTORY_DOCUMENT_ORDER_IMPORT_BATCHES = 10_000;
export const MAX_INVENTORY_DOCUMENT_ORDER_IMPORT_FILES = 100_000;
export const MAX_INVENTORY_DOCUMENT_TRANSACTIONS = 20_000;
export const MAX_INVENTORY_DOCUMENT_STOCK_OUT_BATCHES = 5_000;
export const MAX_INVENTORY_DOCUMENT_PROJECT_SNAPSHOTS = 2_000;
export const MAX_INVENTORY_DOCUMENT_PURCHASE_RECORDS = 20_000;
export const MAX_INVENTORY_DOCUMENT_PROJECT_DEMAND_LINES = 20_000;
export const MAX_INVENTORY_DOCUMENT_SUBSTITUTE_LINKS = 100_000;

export class InventoryDocumentLimitError extends RangeError {
	public constructor(public readonly field: string, public readonly maximum: number) {
		super(`Inventory document ${field} exceeds the supported limit of ${maximum}.`);
		this.name = 'InventoryDocumentLimitError';
	}
}

export function assertInventoryDocumentWithinLimits(document: InventoryDocument): void {
	assertMaximum(document.items.length, MAX_INVENTORY_DOCUMENT_ITEMS, 'items');
	assertMaximum(document.categories.length, MAX_INVENTORY_DOCUMENT_CATEGORIES, 'categories');
	assertMaximum(document.orderImportBatches.length, MAX_INVENTORY_DOCUMENT_ORDER_IMPORT_BATCHES, 'orderImportBatches');
	assertMaximum(
		document.orderImportBatches.reduce((total, batch) => total + batch.files.length, 0),
		MAX_INVENTORY_DOCUMENT_ORDER_IMPORT_FILES,
		'orderImportFiles',
	);
	assertMaximum(document.transactions.length, MAX_INVENTORY_DOCUMENT_TRANSACTIONS, 'transactions');
	assertMaximum(document.stockOutBatches.length, MAX_INVENTORY_DOCUMENT_STOCK_OUT_BATCHES, 'stockOutBatches');
	assertMaximum(
		document.transactions.length + document.stockOutBatches
			.filter(batch => !batch.reversal)
			.reduce((total, batch) => total + batch.lines.length, 0),
		MAX_INVENTORY_DOCUMENT_TRANSACTIONS,
		'transactionsWithReversalReserve',
	);
	assertMaximum(document.projectSnapshots.length, MAX_INVENTORY_DOCUMENT_PROJECT_SNAPSHOTS, 'projectSnapshots');
	assertMaximum(document.purchaseRecords.length, MAX_INVENTORY_DOCUMENT_PURCHASE_RECORDS, 'purchaseRecords');
	assertMaximum(document.substituteLinks.length, MAX_INVENTORY_DOCUMENT_SUBSTITUTE_LINKS, 'substituteLinks');
	assertMaximum(
		document.projectSnapshots.reduce((total, snapshot) => total + snapshot.demands.length, 0),
		MAX_INVENTORY_DOCUMENT_PROJECT_DEMAND_LINES,
		'projectDemandLines',
	);
	assertMaximum(
		new TextEncoder().encode(JSON.stringify(document, undefined, 2)).byteLength,
		MAX_INVENTORY_DOCUMENT_TEXT_LENGTH,
		'serializedText',
	);
}

function assertMaximum(actual: number, maximum: number, field: string): void {
	if (!Number.isSafeInteger(actual) || actual > maximum) {
		throw new InventoryDocumentLimitError(field, maximum);
	}
}
