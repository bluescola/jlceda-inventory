import type { InventoryDocument } from '../domain/inventory-document';
import type { InventoryItem } from '../domain/inventory-item';
import type {
	InventoryTransaction,
	StockOutBatchLineRecord,
	StockOutBatchRecord,
} from '../domain/inventory-transaction';
import { cloneInventoryDocument } from '../domain/inventory-document';
import { normalizeInventoryText } from '../domain/inventory-item';
import {
	createInventoryTransactionIdentity,
	sanitizeInventoryTransaction,
	sanitizeStockOutBatchRecord,
} from '../domain/inventory-transaction';

export const MAX_BOM_STOCK_OUT_LINES = 10_000;

export interface BomStockOutLineInput {
	itemId: string;
	quantity: number;
	sourceReference?: string;
}

export interface BomStockOutInput {
	sourceFingerprint: string;
	sourceName?: string;
	productionRunId?: string;
	note?: string;
	lines: readonly BomStockOutLineInput[];
}

export interface NormalizedBomStockOutInput {
	sourceFingerprint: string;
	sourceName?: string;
	productionRunId?: string;
	note?: string;
	lines: BomStockOutLineInput[];
}

export type BomStockOutIssueCode
	= | 'duplicate-batch'
		| 'item-missing'
		| 'quantity-not-exact'
		| 'insufficient-stock';

export interface BomStockOutIssue {
	code: BomStockOutIssueCode;
	lineIndex?: number;
	itemId?: string;
	requestedQuantity?: number;
	availableQuantity?: number | null;
	existingBatchId?: string;
}

export interface BomStockOutPreviewLine {
	lineIndex: number;
	itemId: string;
	itemRevision: number;
	requestedQuantity: number;
	beforeQuantity: number;
	afterQuantity: number;
	sourceReference?: string;
}

export interface BomStockOutPreview {
	status: 'ready' | 'blocked' | 'duplicate';
	documentRevision: number;
	batchFingerprint: string;
	lines: BomStockOutPreviewLine[];
	issues: BomStockOutIssue[];
}

export interface AppliedBomStockOut {
	document: InventoryDocument;
	batch: StockOutBatchRecord;
	transactions: InventoryTransaction[];
	items: InventoryItem[];
}

export type StockOutReversalIssueCode
	= | 'batch-missing'
		| 'batch-already-reversed'
		| 'item-missing'
		| 'quantity-not-exact'
		| 'quantity-overflow'
		| 'ledger-inconsistent';

export interface StockOutReversalIssue {
	code: StockOutReversalIssueCode;
	batchId: string;
	itemId?: string;
	transactionId?: string;
	reversalId?: string;
}

export interface StockOutReversalPreviewLine {
	itemId: string;
	itemRevision: number;
	quantity: number;
	beforeQuantity: number;
	afterQuantity: number;
	originalTransactionId: string;
}

export interface StockOutReversalPreview {
	status: 'ready' | 'blocked' | 'already-reversed';
	documentRevision: number;
	batchId: string;
	lines: StockOutReversalPreviewLine[];
	issues: StockOutReversalIssue[];
}

export interface AppliedStockOutReversal {
	document: InventoryDocument;
	batch: StockOutBatchRecord;
	transactions: InventoryTransaction[];
	items: InventoryItem[];
	reversalId: string;
}

export class BomStockOutInputError extends TypeError {
	public constructor(
		public readonly code:
			| 'invalid-source-fingerprint'
			| 'empty-lines'
			| 'too-many-lines'
			| 'invalid-item-id'
			| 'invalid-quantity'
			| 'duplicate-item'
			| 'invalid-text',
		public readonly lineIndex?: number,
		message?: string,
	) {
		super(message ?? code);
		this.name = 'BomStockOutInputError';
	}
}

export function normalizeBomStockOutInput(input: BomStockOutInput): NormalizedBomStockOutInput {
	if (!input || typeof input !== 'object') {
		throw new BomStockOutInputError('empty-lines', undefined, 'BOM stock-out input must be an object.');
	}
	const sourceFingerprint = normalizeFingerprint(input.sourceFingerprint);
	if (!Array.isArray(input.lines) || input.lines.length === 0) {
		throw new BomStockOutInputError('empty-lines', undefined, 'BOM stock-out must contain at least one line.');
	}
	if (input.lines.length > MAX_BOM_STOCK_OUT_LINES) {
		throw new BomStockOutInputError(
			'too-many-lines',
			undefined,
			`BOM stock-out must not contain more than ${MAX_BOM_STOCK_OUT_LINES} lines.`,
		);
	}

	const itemIds = new Set<string>();
	const lines = input.lines.map((line, lineIndex) => {
		if (!line || typeof line !== 'object') {
			throw new BomStockOutInputError('invalid-item-id', lineIndex, 'BOM stock-out line must be an object.');
		}
		const itemId = normalizeIdentifier(line.itemId, lineIndex);
		if (itemIds.has(itemId)) {
			throw new BomStockOutInputError(
				'duplicate-item',
				lineIndex,
				`BOM stock-out contains duplicate inventory item mapping: ${itemId}.`,
			);
		}
		itemIds.add(itemId);
		if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
			throw new BomStockOutInputError(
				'invalid-quantity',
				lineIndex,
				'BOM stock-out quantity must be a positive safe integer.',
			);
		}
		return {
			itemId,
			quantity: line.quantity,
			sourceReference: normalizeOptionalText(line.sourceReference, 16_384, lineIndex),
		};
	});

	return {
		sourceFingerprint,
		sourceName: normalizeOptionalText(input.sourceName, 16_384),
		productionRunId: normalizeOptionalText(input.productionRunId, 4_096),
		note: normalizeOptionalText(input.note, 65_536),
		lines,
	};
}

export function canonicalizeBomStockOut(input: NormalizedBomStockOutInput): string {
	return JSON.stringify({
		version: 2,
		productionRunId: input.productionRunId,
		lines: input.lines
			.map(line => [line.itemId, line.quantity] as const)
			.toSorted(([leftId, leftQuantity], [rightId, rightQuantity]) => (
				leftId.localeCompare(rightId) || leftQuantity - rightQuantity
			)),
	});
}

export function evaluateBomStockOut(
	document: InventoryDocument,
	input: NormalizedBomStockOutInput,
	batchFingerprint: string,
): BomStockOutPreview {
	const existing = document.stockOutBatches.find(batch => batch.fingerprint === batchFingerprint);
	if (existing) {
		return {
			status: 'duplicate',
			documentRevision: document.revision,
			batchFingerprint,
			lines: [],
			issues: [{ code: 'duplicate-batch', existingBatchId: existing.id }],
		};
	}

	const issues: BomStockOutIssue[] = [];
	const lines: BomStockOutPreviewLine[] = [];
	for (const [lineIndex, line] of input.lines.entries()) {
		const item = document.items.find(candidate => candidate.id === line.itemId);
		if (!item) {
			issues.push({ code: 'item-missing', lineIndex, itemId: line.itemId, requestedQuantity: line.quantity });
			continue;
		}
		if (item.precision !== 'exact' || item.quantity === null) {
			issues.push({
				code: 'quantity-not-exact',
				lineIndex,
				itemId: item.id,
				requestedQuantity: line.quantity,
				availableQuantity: item.quantity,
			});
			continue;
		}
		if (item.quantity < line.quantity) {
			issues.push({
				code: 'insufficient-stock',
				lineIndex,
				itemId: item.id,
				requestedQuantity: line.quantity,
				availableQuantity: item.quantity,
			});
			continue;
		}
		lines.push({
			lineIndex,
			itemId: item.id,
			itemRevision: item.revision,
			requestedQuantity: line.quantity,
			beforeQuantity: item.quantity,
			afterQuantity: item.quantity - line.quantity,
			sourceReference: line.sourceReference,
		});
	}

	return {
		status: issues.length === 0 ? 'ready' : 'blocked',
		documentRevision: document.revision,
		batchFingerprint,
		lines,
		issues,
	};
}

export function applyBomStockOut(
	document: InventoryDocument,
	input: NormalizedBomStockOutInput,
	preview: BomStockOutPreview,
	timestamp: string,
	createId: () => string,
): AppliedBomStockOut {
	if (preview.status !== 'ready' || preview.documentRevision !== document.revision) {
		throw new Error('Only a current, ready BOM stock-out preview can be applied.');
	}
	const next = cloneInventoryDocument(document);
	const usedBatchIds = new Set(next.stockOutBatches.map(batch => batch.id));
	const usedTransactionIds = new Set(next.transactions.map(transaction => transaction.id));
	const batchId = createUniqueId(createId, usedBatchIds, 'stock-out batch');
	const transactions: InventoryTransaction[] = [];
	const updatedItems: InventoryItem[] = [];
	const lines: StockOutBatchLineRecord[] = [];

	for (const previewLine of preview.lines) {
		const itemIndex = next.items.findIndex(item => item.id === previewLine.itemId);
		const current = next.items[itemIndex];
		if (!current
			|| current.revision !== previewLine.itemRevision
			|| current.precision !== 'exact'
			|| current.quantity !== previewLine.beforeQuantity) {
			throw new Error(`Inventory item changed after BOM stock-out preview: ${previewLine.itemId}.`);
		}
		const transactionId = createUniqueId(createId, usedTransactionIds, 'inventory transaction');
		const transaction = sanitizeInventoryTransaction({
			id: transactionId,
			itemId: current.id,
			kind: 'bom-stock-out',
			source: 'bom',
			delta: -previewLine.requestedQuantity,
			beforeQuantity: previewLine.beforeQuantity,
			afterQuantity: previewLine.afterQuantity,
			createdAt: timestamp,
			identity: createInventoryTransactionIdentity(current),
			note: input.note,
			batchId,
		});
		const updated: InventoryItem = {
			...current,
			quantity: previewLine.afterQuantity,
			precision: 'exact',
			state: previewLine.afterQuantity === 0 ? 'depleted' : 'in-stock',
			updatedAt: timestamp,
			revision: current.revision + 1,
		};
		next.items[itemIndex] = updated;
		next.transactions.push(transaction);
		transactions.push(transaction);
		updatedItems.push(updated);
		lines.push({
			itemId: current.id,
			quantity: previewLine.requestedQuantity,
			transactionId,
			sourceReference: previewLine.sourceReference,
		});
	}

	const batch = sanitizeStockOutBatchRecord({
		id: batchId,
		fingerprint: preview.batchFingerprint,
		source: 'bom',
		sourceFingerprint: input.sourceFingerprint,
		sourceName: input.sourceName,
		productionRunId: input.productionRunId,
		createdAt: timestamp,
		note: input.note,
		lines,
	});
	next.stockOutBatches.push(batch);
	return { document: next, batch, transactions, items: updatedItems };
}

export function evaluateStockOutReversal(
	document: InventoryDocument,
	batchId: string,
): StockOutReversalPreview {
	const batch = document.stockOutBatches.find(candidate => candidate.id === batchId);
	if (!batch) {
		return {
			status: 'blocked',
			documentRevision: document.revision,
			batchId,
			lines: [],
			issues: [{ code: 'batch-missing', batchId }],
		};
	}
	if (batch.reversal) {
		return {
			status: 'already-reversed',
			documentRevision: document.revision,
			batchId,
			lines: [],
			issues: [{ code: 'batch-already-reversed', batchId, reversalId: batch.reversal.id }],
		};
	}

	const issues: StockOutReversalIssue[] = [];
	const lines: StockOutReversalPreviewLine[] = [];
	for (const line of batch.lines) {
		const original = document.transactions.find(transaction => transaction.id === line.transactionId);
		if (!original
			|| original.kind !== 'bom-stock-out'
			|| original.batchId !== batch.id
			|| original.itemId !== line.itemId
			|| original.delta !== -line.quantity) {
			issues.push({
				code: 'ledger-inconsistent',
				batchId,
				itemId: line.itemId,
				transactionId: line.transactionId,
			});
			continue;
		}
		if (document.transactions.some(transaction => transaction.reversesTransactionId === original.id)) {
			issues.push({
				code: 'ledger-inconsistent',
				batchId,
				itemId: line.itemId,
				transactionId: original.id,
			});
			continue;
		}
		const item = document.items.find(candidate => candidate.id === line.itemId);
		if (!item) {
			issues.push({ code: 'item-missing', batchId, itemId: line.itemId });
			continue;
		}
		if (item.precision !== 'exact' || item.quantity === null) {
			issues.push({ code: 'quantity-not-exact', batchId, itemId: item.id });
			continue;
		}
		const afterQuantity = item.quantity + line.quantity;
		if (!Number.isSafeInteger(afterQuantity)) {
			issues.push({ code: 'quantity-overflow', batchId, itemId: item.id });
			continue;
		}
		lines.push({
			itemId: item.id,
			itemRevision: item.revision,
			quantity: line.quantity,
			beforeQuantity: item.quantity,
			afterQuantity,
			originalTransactionId: original.id,
		});
	}

	return {
		status: issues.length === 0 ? 'ready' : 'blocked',
		documentRevision: document.revision,
		batchId,
		lines,
		issues,
	};
}

export function applyStockOutReversal(
	document: InventoryDocument,
	preview: StockOutReversalPreview,
	timestamp: string,
	note: string | undefined,
	createId: () => string,
): AppliedStockOutReversal {
	if (preview.status !== 'ready' || preview.documentRevision !== document.revision) {
		throw new Error('Only a current, ready stock-out reversal preview can be applied.');
	}
	const next = cloneInventoryDocument(document);
	const batchIndex = next.stockOutBatches.findIndex(batch => batch.id === preview.batchId);
	const batch = next.stockOutBatches[batchIndex];
	if (!batch || batch.reversal) {
		throw new Error('Stock-out batch changed after reversal preview.');
	}
	const usedReversalIds = new Set(
		next.stockOutBatches.flatMap(candidate => candidate.reversal ? [candidate.reversal.id] : []),
	);
	const usedTransactionIds = new Set(next.transactions.map(transaction => transaction.id));
	const reversalId = createUniqueId(createId, usedReversalIds, 'stock-out reversal');
	const transactions: InventoryTransaction[] = [];
	const updatedItems: InventoryItem[] = [];

	for (const previewLine of preview.lines) {
		const itemIndex = next.items.findIndex(item => item.id === previewLine.itemId);
		const current = next.items[itemIndex];
		if (!current
			|| current.revision !== previewLine.itemRevision
			|| current.precision !== 'exact'
			|| current.quantity !== previewLine.beforeQuantity) {
			throw new Error(`Inventory item changed after stock-out reversal preview: ${previewLine.itemId}.`);
		}
		const transactionId = createUniqueId(createId, usedTransactionIds, 'inventory transaction');
		const transaction = sanitizeInventoryTransaction({
			id: transactionId,
			itemId: current.id,
			kind: 'bom-stock-out-reversal',
			source: 'bom',
			delta: previewLine.quantity,
			beforeQuantity: previewLine.beforeQuantity,
			afterQuantity: previewLine.afterQuantity,
			createdAt: timestamp,
			identity: createInventoryTransactionIdentity(current),
			note,
			batchId: batch.id,
			reversalId,
			reversesTransactionId: previewLine.originalTransactionId,
		});
		const updated: InventoryItem = {
			...current,
			quantity: previewLine.afterQuantity,
			precision: 'exact',
			state: previewLine.afterQuantity === 0 ? 'depleted' : 'in-stock',
			updatedAt: timestamp,
			revision: current.revision + 1,
		};
		next.items[itemIndex] = updated;
		next.transactions.push(transaction);
		transactions.push(transaction);
		updatedItems.push(updated);
	}

	batch.reversal = {
		id: reversalId,
		createdAt: timestamp,
		transactionIds: transactions.map(transaction => transaction.id),
		note,
	};
	next.stockOutBatches[batchIndex] = sanitizeStockOutBatchRecord(batch);
	return {
		document: next,
		batch: next.stockOutBatches[batchIndex],
		transactions,
		items: updatedItems,
		reversalId,
	};
}

function normalizeFingerprint(value: string): string {
	if (typeof value !== 'string') {
		throw new BomStockOutInputError('invalid-source-fingerprint', undefined, 'BOM source fingerprint must be text.');
	}
	const fingerprint = value.trim().toLowerCase();
	if (!/^[a-f\d]{64}$/.test(fingerprint)) {
		throw new BomStockOutInputError(
			'invalid-source-fingerprint',
			undefined,
			'BOM source fingerprint must be a SHA-256 hexadecimal value.',
		);
	}
	return fingerprint;
}

function normalizeIdentifier(value: string, lineIndex: number): string {
	if (typeof value !== 'string'
		|| value.length === 0
		|| value.length > 4096
		|| normalizeInventoryText(value) !== value) {
		throw new BomStockOutInputError('invalid-item-id', lineIndex, 'Inventory item ID must be non-empty, normalized text.');
	}
	return value;
}

function normalizeOptionalText(
	value: string | undefined,
	maximumLength: number,
	lineIndex?: number,
): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new BomStockOutInputError('invalid-text', lineIndex, 'BOM stock-out text field must be text.');
	}
	const normalized = normalizeInventoryText(value);
	if (normalized.length > maximumLength) {
		throw new BomStockOutInputError(
			'invalid-text',
			lineIndex,
			`BOM stock-out text field must not exceed ${maximumLength} characters.`,
		);
	}
	return normalized || undefined;
}

function createUniqueId(createId: () => string, usedIds: Set<string>, label: string): string {
	const id = createId();
	if (typeof id !== 'string'
		|| id.length === 0
		|| id.length > 4096
		|| normalizeInventoryText(id) !== id
		|| usedIds.has(id)) {
		throw new Error(`Unable to create a unique, normalized ${label} ID.`);
	}
	usedIds.add(id);
	return id;
}
