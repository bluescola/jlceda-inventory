import type { InventoryItem, PartIdentity } from './inventory-item';
import { normalizeInventoryText, normalizeLcscPartNumber } from './inventory-item';

export type InventoryTransactionKind = 'bom-stock-out' | 'bom-stock-out-reversal';
export type InventoryTransactionSource = 'bom';

export interface InventoryTransactionIdentity {
	name: string;
	lcscPartNumber?: string;
	manufacturerPartNumber?: string;
	manufacturer?: string;
	package?: string;
}

export interface InventoryTransaction {
	id: string;
	itemId: string;
	kind: InventoryTransactionKind;
	source: InventoryTransactionSource;
	delta: number;
	beforeQuantity: number;
	afterQuantity: number;
	createdAt: string;
	identity: InventoryTransactionIdentity;
	note?: string;
	batchId: string;
	reversalId?: string;
	reversesTransactionId?: string;
}

export interface StockOutBatchLineRecord {
	itemId: string;
	quantity: number;
	transactionId: string;
	sourceReference?: string;
}

export interface StockOutBatchReversalRecord {
	id: string;
	createdAt: string;
	transactionIds: string[];
	note?: string;
}

export interface StockOutBatchRecord {
	id: string;
	fingerprint: string;
	source: 'bom';
	sourceFingerprint: string;
	sourceName?: string;
	productionRunId?: string;
	createdAt: string;
	note?: string;
	lines: StockOutBatchLineRecord[];
	reversal?: StockOutBatchReversalRecord;
}

const SHA_256_HEX = /^[a-f\d]{64}$/;
const MAX_IDENTIFIER_LENGTH = 4096;
const MAX_LABEL_LENGTH = 16_384;
const MAX_NOTE_LENGTH = 65_536;

export function createInventoryTransactionIdentity(item: InventoryItem): InventoryTransactionIdentity {
	return sanitizeTransactionIdentity(item.identity);
}

export function sanitizeInventoryTransaction(transaction: InventoryTransaction): InventoryTransaction {
	const id = sanitizeIdentifier(transaction.id, 'Inventory transaction ID');
	const itemId = sanitizeIdentifier(transaction.itemId, 'Inventory transaction item ID');
	const batchId = sanitizeIdentifier(transaction.batchId, 'Inventory transaction batch ID');
	assertEnum(transaction.kind, ['bom-stock-out', 'bom-stock-out-reversal'], 'Inventory transaction kind');
	assertEnum(transaction.source, ['bom'], 'Inventory transaction source');
	assertSafeInteger(transaction.delta, 'Inventory transaction delta');
	assertNonNegativeSafeInteger(transaction.beforeQuantity, 'Inventory transaction before quantity');
	assertNonNegativeSafeInteger(transaction.afterQuantity, 'Inventory transaction after quantity');
	if (transaction.delta === 0 || transaction.beforeQuantity + transaction.delta !== transaction.afterQuantity) {
		throw new Error('Inventory transaction quantities and delta are inconsistent.');
	}
	assertTimestamp(transaction.createdAt, 'Inventory transaction creation time');

	const reversalId = transaction.reversalId === undefined
		? undefined
		: sanitizeIdentifier(transaction.reversalId, 'Inventory transaction reversal ID');
	const reversesTransactionId = transaction.reversesTransactionId === undefined
		? undefined
		: sanitizeIdentifier(transaction.reversesTransactionId, 'Reversed inventory transaction ID');
	if (transaction.kind === 'bom-stock-out') {
		if (transaction.delta >= 0 || reversalId !== undefined || reversesTransactionId !== undefined) {
			throw new Error('BOM stock-out transaction must have a negative delta and no reversal reference.');
		}
	}
	else if (transaction.delta <= 0 || reversalId === undefined || reversesTransactionId === undefined) {
		throw new Error('BOM stock-out reversal must have a positive delta and complete reversal references.');
	}

	return {
		id,
		itemId,
		kind: transaction.kind,
		source: transaction.source,
		delta: transaction.delta,
		beforeQuantity: transaction.beforeQuantity,
		afterQuantity: transaction.afterQuantity,
		createdAt: transaction.createdAt,
		identity: sanitizeTransactionIdentity(transaction.identity),
		note: cleanOptional(transaction.note, MAX_NOTE_LENGTH, 'Inventory transaction note'),
		batchId,
		reversalId,
		reversesTransactionId,
	};
}

export function sanitizeStockOutBatchRecord(batch: StockOutBatchRecord): StockOutBatchRecord {
	const id = sanitizeIdentifier(batch.id, 'Stock-out batch ID');
	assertEnum(batch.source, ['bom'], 'Stock-out batch source');
	const fingerprint = sanitizeFingerprint(batch.fingerprint, 'Stock-out batch fingerprint');
	const sourceFingerprint = sanitizeFingerprint(batch.sourceFingerprint, 'Stock-out source fingerprint');
	assertTimestamp(batch.createdAt, 'Stock-out batch creation time');
	if (!Array.isArray(batch.lines) || batch.lines.length === 0) {
		throw new Error('Stock-out batch must contain at least one line.');
	}
	const itemIds = new Set<string>();
	const transactionIds = new Set<string>();
	const lines = batch.lines.map((line) => {
		const itemId = sanitizeIdentifier(line.itemId, 'Stock-out line item ID');
		const transactionId = sanitizeIdentifier(line.transactionId, 'Stock-out line transaction ID');
		if (itemIds.has(itemId)) {
			throw new Error(`Stock-out batch contains duplicate item ID: ${itemId}.`);
		}
		if (transactionIds.has(transactionId)) {
			throw new Error(`Stock-out batch contains duplicate transaction ID: ${transactionId}.`);
		}
		itemIds.add(itemId);
		transactionIds.add(transactionId);
		assertPositiveSafeInteger(line.quantity, 'Stock-out line quantity');
		return {
			itemId,
			quantity: line.quantity,
			transactionId,
			sourceReference: cleanOptional(line.sourceReference, MAX_LABEL_LENGTH, 'Stock-out line source reference'),
		};
	});

	let reversal: StockOutBatchReversalRecord | undefined;
	if (batch.reversal !== undefined) {
		if (!batch.reversal || typeof batch.reversal !== 'object') {
			throw new TypeError('Stock-out batch reversal must be an object.');
		}
		if (!Array.isArray(batch.reversal.transactionIds)
			|| batch.reversal.transactionIds.length !== lines.length) {
			throw new Error('Stock-out batch reversal must reference every line exactly once.');
		}
		const reversalTransactionIds = batch.reversal.transactionIds.map(transactionId => (
			sanitizeIdentifier(transactionId, 'Stock-out reversal transaction ID')
		));
		if (new Set(reversalTransactionIds).size !== reversalTransactionIds.length) {
			throw new Error('Stock-out batch reversal contains duplicate transaction IDs.');
		}
		assertTimestamp(batch.reversal.createdAt, 'Stock-out batch reversal time');
		reversal = {
			id: sanitizeIdentifier(batch.reversal.id, 'Stock-out batch reversal ID'),
			createdAt: batch.reversal.createdAt,
			transactionIds: reversalTransactionIds,
			note: cleanOptional(batch.reversal.note, MAX_NOTE_LENGTH, 'Stock-out batch reversal note'),
		};
	}

	return {
		id,
		fingerprint,
		source: batch.source,
		sourceFingerprint,
		sourceName: cleanOptional(batch.sourceName, MAX_LABEL_LENGTH, 'Stock-out source name'),
		productionRunId: batch.productionRunId === undefined
			? undefined
			: sanitizeIdentifier(batch.productionRunId, 'Stock-out production run ID'),
		createdAt: batch.createdAt,
		note: cleanOptional(batch.note, MAX_NOTE_LENGTH, 'Stock-out batch note'),
		lines,
		reversal,
	};
}

function sanitizeTransactionIdentity(identity: PartIdentity | InventoryTransactionIdentity): InventoryTransactionIdentity {
	if (!identity || typeof identity !== 'object') {
		throw new TypeError('Inventory transaction identity must be an object.');
	}
	const name = normalizeInventoryText(identity.name);
	if (!name || name.length > MAX_LABEL_LENGTH) {
		throw new Error('Inventory transaction item name is required and must have a safe length.');
	}
	return {
		name,
		lcscPartNumber: normalizeLcscPartNumber(cleanOptional(identity.lcscPartNumber, MAX_LABEL_LENGTH, 'LCSC part number')),
		manufacturerPartNumber: cleanOptional(identity.manufacturerPartNumber, MAX_LABEL_LENGTH, 'Manufacturer part number'),
		manufacturer: cleanOptional(identity.manufacturer, MAX_LABEL_LENGTH, 'Manufacturer'),
		package: cleanOptional(identity.package, MAX_LABEL_LENGTH, 'Package'),
	};
}

function sanitizeFingerprint(value: string, label: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be text.`);
	}
	const fingerprint = value.trim().toLowerCase();
	if (!SHA_256_HEX.test(fingerprint)) {
		throw new Error(`${label} must be a SHA-256 hexadecimal value.`);
	}
	return fingerprint;
}

function sanitizeIdentifier(value: string, label: string): string {
	if (typeof value !== 'string'
		|| value.length === 0
		|| value.length > MAX_IDENTIFIER_LENGTH
		|| normalizeInventoryText(value) !== value) {
		throw new Error(`${label} must be non-empty, normalized text.`);
	}
	return value;
}

function cleanOptional(value: string | undefined, maximumLength: number, label: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be text.`);
	}
	const normalized = normalizeInventoryText(value);
	if (normalized.length > maximumLength) {
		throw new Error(`${label} must not exceed ${maximumLength} characters.`);
	}
	return normalized || undefined;
}

function assertTimestamp(value: string, label: string): void {
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be an ISO timestamp.`);
	}
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
		throw new Error(`${label} must be a canonical UTC ISO timestamp.`);
	}
}

function assertSafeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value)) {
		throw new TypeError(`${label} must be a safe integer.`);
	}
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer.`);
	}
}

function assertPositiveSafeInteger(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive safe integer.`);
	}
}

function assertEnum<Value extends string>(value: Value, accepted: readonly Value[], label: string): void {
	if (!accepted.includes(value)) {
		throw new TypeError(`${label} is unsupported.`);
	}
}
