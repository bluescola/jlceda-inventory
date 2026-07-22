import type { InventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import { describe, expect, it } from 'vitest';
import {
	assertInventoryDocumentWithinLimits,
	InventoryDocumentLimitError,
	MAX_INVENTORY_DOCUMENT_PROJECT_DEMAND_LINES,
	MAX_INVENTORY_DOCUMENT_STOCK_OUT_BATCHES,
	MAX_INVENTORY_DOCUMENT_SUBSTITUTE_LINKS,
	MAX_INVENTORY_DOCUMENT_TEXT_LENGTH,
	MAX_INVENTORY_DOCUMENT_TRANSACTIONS,
} from '../../src/features/inventory/application/inventory-document-limits';
import { createEmptyInventoryDocument } from '../../src/features/inventory/domain/inventory-document';

describe('inventory document limits', () => {
	it('uses the same transaction and batch budgets as the long-session panels', () => {
		const transactions = createEmptyInventoryDocument();
		transactions.transactions = Array.from(
			{ length: MAX_INVENTORY_DOCUMENT_TRANSACTIONS + 1 },
			() => ({}) as never,
		);
		expect(() => assertInventoryDocumentWithinLimits(transactions))
			.toThrowError(InventoryDocumentLimitError);

		const batches = createEmptyInventoryDocument();
		batches.stockOutBatches = Array.from(
			{ length: MAX_INVENTORY_DOCUMENT_STOCK_OUT_BATCHES + 1 },
			() => ({}) as never,
		);
		expect(() => assertInventoryDocumentWithinLimits(batches))
			.toThrowError(InventoryDocumentLimitError);
	});

	it('rejects aggregate project demands beyond the procurement bridge budget', () => {
		const document = createEmptyInventoryDocument();
		document.projectSnapshots = [{
			id: 'snapshot-1',
			label: 'Large project',
			documentUuid: 'document-1',
			documentKind: 'schematic',
			capturedAt: '2026-07-22T00:00:00.000Z',
			boardQuantity: 1,
			revision: 1,
			demands: Array.from(
				{ length: MAX_INVENTORY_DOCUMENT_PROJECT_DEMAND_LINES + 1 },
				() => ({}) as never,
			),
		}];

		expect(() => assertInventoryDocumentWithinLimits(document))
			.toThrowError(expect.objectContaining({ field: 'projectDemandLines' }));
	});

	it('rejects substitute links beyond the document relationship budget', () => {
		const document = createEmptyInventoryDocument();
		document.substituteLinks = Array.from(
			{ length: MAX_INVENTORY_DOCUMENT_SUBSTITUTE_LINKS + 1 },
			() => ({}) as never,
		);

		expect(() => assertInventoryDocumentWithinLimits(document))
			.toThrowError(expect.objectContaining({ field: 'substituteLinks' }));
	});

	it('keeps persisted documents within the JSON backup text budget', () => {
		const document = createEmptyInventoryDocument() as InventoryDocument;
		document.items = [{
			id: 'large-item',
			identity: { name: 'Large item' },
			quantity: 1,
			precision: 'exact',
			state: 'in-stock',
			source: 'manual',
			createdAt: '2026-07-22T00:00:00.000Z',
			updatedAt: '2026-07-22T00:00:00.000Z',
			revision: 1,
			note: 'x'.repeat(MAX_INVENTORY_DOCUMENT_TEXT_LENGTH),
		}];

		expect(() => assertInventoryDocumentWithinLimits(document))
			.toThrowError(expect.objectContaining({ field: 'serializedText' }));
	});

	it('measures serialized capacity in UTF-8 bytes and reserves every active batch reversal', () => {
		const unicode = createEmptyInventoryDocument();
		unicode.updatedAt = '中'.repeat(Math.floor(MAX_INVENTORY_DOCUMENT_TEXT_LENGTH / 3) + 1);
		expect(JSON.stringify(unicode).length).toBeLessThan(MAX_INVENTORY_DOCUMENT_TEXT_LENGTH);
		expect(() => assertInventoryDocumentWithinLimits(unicode))
			.toThrowError(expect.objectContaining({ field: 'serializedText' }));

		const activeBatch = createEmptyInventoryDocument();
		activeBatch.transactions = Array.from(
			{ length: MAX_INVENTORY_DOCUMENT_TRANSACTIONS },
			() => ({}) as never,
		);
		activeBatch.stockOutBatches = [{ lines: [{}], reversal: undefined } as never];
		expect(() => assertInventoryDocumentWithinLimits(activeBatch))
			.toThrowError(expect.objectContaining({ field: 'transactionsWithReversalReserve' }));
	});
});
