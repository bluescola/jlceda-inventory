import type { InventoryTransactionKind } from '../../../features/inventory/domain/inventory-transaction';
import type {
	InventoryTransactionsPanelActionOutcome,
	InventoryTransactionsPanelInput,
} from './inventory-transactions-panel';
import { MAX_INVENTORY_DOCUMENT_STOCK_OUT_BATCHES, MAX_INVENTORY_DOCUMENT_TRANSACTIONS } from '../../../features/inventory/application/inventory-document-limits';

export const INVENTORY_TRANSACTIONS_IFRAME_ID = 'jlceda-inventory-transactions-panel';
export const INVENTORY_TRANSACTIONS_IFRAME_PATH = '/iframe/inventory-transactions.html';
export const INVENTORY_TRANSACTIONS_REQUEST_KEY = 'inventory-transactions-panel.v1.request';
export const INVENTORY_TRANSACTIONS_EVENT_KEY = 'inventory-transactions-panel.v1.event';
export const INVENTORY_TRANSACTIONS_RESPONSE_KEY = 'inventory-transactions-panel.v1.response';
export const INVENTORY_TRANSACTIONS_PROTOCOL_VERSION = 1;

const MAX_BATCHES = MAX_INVENTORY_DOCUMENT_STOCK_OUT_BATCHES;
const MAX_BATCH_LINES = 10_000;
const MAX_TRANSACTIONS = MAX_INVENTORY_DOCUMENT_TRANSACTIONS;
const MAX_IDENTIFIER_LENGTH = 4096;
const MAX_TEXT_LENGTH = 500;
const MAX_NOTE_LENGTH = 1_000;
const MAX_BRIDGE_TEXT = 5_000_000;

const TRANSACTION_KINDS: readonly InventoryTransactionKind[] = ['bom-stock-out', 'bom-stock-out-reversal'];

const LABEL_KEYS = [
	'title',
	'batchesTitle',
	'transactionsTitle',
	'batchCount',
	'transactionCount',
	'filterType',
	'filterBatch',
	'filterAll',
	'typeStockOut',
	'typeReversal',
	'statusActive',
	'statusReversed',
	'columnSource',
	'columnFingerprint',
	'columnCreatedAt',
	'columnStatus',
	'columnLineCount',
	'columnTotalQuantity',
	'columnActions',
	'columnType',
	'columnPartNumber',
	'columnName',
	'columnManufacturerPartNumber',
	'columnPackage',
	'columnDelta',
	'columnBeforeQuantity',
	'columnAfterQuantity',
	'columnBatch',
	'columnNote',
	'emptyValue',
	'emptyBatches',
	'emptyTransactions',
	'emptyFiltered',
	'previousPage',
	'nextPage',
	'pageStatus',
	'undoBatch',
	'confirmUndoBatch',
	'undoing',
	'undoSucceeded',
	'refresh',
	'refreshing',
	'refreshSucceeded',
	'cancel',
	'close',
	'operationError',
	'loading',
	'connectionError',
] as const;

export type InventoryTransactionsLabels = Record<typeof LABEL_KEYS[number], string>;
export type InventoryTransactionsPanelStage = 'panel-rendered' | 'request-read' | 'script-started';

export interface InventoryTransactionsBatchPayload {
	id: string;
	sourceName?: string;
	fingerprintShort: string;
	sourceFingerprintShort: string;
	createdAt: string;
	lineCount: number;
	totalQuantity: number;
	status: 'active' | 'reversed';
	reversedAt?: string;
}

export interface InventoryTransactionsEntryPayload {
	kind: InventoryTransactionKind;
	batchId: string;
	delta: number;
	beforeQuantity: number;
	afterQuantity: number;
	createdAt: string;
	name: string;
	lcscPartNumber?: string;
	manufacturerPartNumber?: string;
	package?: string;
	note?: string;
}

export interface InventoryTransactionsSnapshotPayload {
	batches: InventoryTransactionsBatchPayload[];
	transactions: InventoryTransactionsEntryPayload[];
}

export interface IFrameInventoryTransactionsRequest {
	protocolVersion: 1;
	requestId: string;
	labels: InventoryTransactionsLabels;
	snapshot: InventoryTransactionsSnapshotPayload;
}

export type IFrameInventoryTransactionsEvent
	= | { protocolVersion: 1; requestId: string; status: 'ready' }
		| { protocolVersion: 1; requestId: string; status: 'progress'; stage: InventoryTransactionsPanelStage }
		| { protocolVersion: 1; requestId: string; status: 'failed'; stage: InventoryTransactionsPanelStage; errorName: string; error: string }
		| {
			protocolVersion: 1;
			requestId: string;
			status: 'action';
			operationId: string;
			action: 'close' | 'refresh';
		}
		| {
			protocolVersion: 1;
			requestId: string;
			status: 'action';
			operationId: string;
			action: 'undo-batch';
			batchId: string;
		};

export interface IFrameInventoryTransactionsResponse {
	protocolVersion: 1;
	requestId: string;
	operationId: string;
	status: 'failed' | 'succeeded';
	message?: string;
	snapshot?: InventoryTransactionsSnapshotPayload;
}

export function createIFrameInventoryTransactionsRequest(
	requestId: string,
	labels: InventoryTransactionsLabels,
	input: InventoryTransactionsPanelInput,
): IFrameInventoryTransactionsRequest {
	if (!isNonEmptyText(requestId, 200) || !isLabels(labels)) {
		throw new TypeError('Invalid inventory transactions request metadata.');
	}
	return {
		protocolVersion: INVENTORY_TRANSACTIONS_PROTOCOL_VERSION,
		requestId,
		labels: { ...labels },
		snapshot: createInventoryTransactionsSnapshot(input),
	};
}

export function createInventoryTransactionsSnapshot(
	input: InventoryTransactionsPanelInput,
): InventoryTransactionsSnapshotPayload {
	if (!Array.isArray(input.batches) || input.batches.length > MAX_BATCHES
		|| !Array.isArray(input.transactions) || input.transactions.length > MAX_TRANSACTIONS) {
		throw new RangeError('Inventory transaction history exceeds the panel row limit.');
	}
	const budget = { text: 0 };
	const batches = input.batches.map((batch): InventoryTransactionsBatchPayload => {
		if (!isNonEmptyText(batch.id, MAX_IDENTIFIER_LENGTH)
			|| !/^[a-f\d]{64}$/.test(batch.fingerprint)
			|| !/^[a-f\d]{64}$/.test(batch.sourceFingerprint)
			|| !isCanonicalTimestamp(batch.createdAt)
			|| !Array.isArray(batch.lines)
			|| batch.lines.length < 1
			|| batch.lines.length > MAX_BATCH_LINES) {
			throw new TypeError('Invalid stock-out batch history record.');
		}
		const totalQuantity = batch.lines.reduce((sum: number, line: { quantity: number }) => {
			if (!isPositiveSafeInteger(line.quantity) || !Number.isSafeInteger(sum + line.quantity)) {
				throw new TypeError('Invalid stock-out batch quantity.');
			}
			return sum + line.quantity;
		}, 0);
		addBudget(budget, batch.id.length);
		const sourceName = cloneOptionalText(batch.sourceName, MAX_TEXT_LENGTH, budget);
		const result: InventoryTransactionsBatchPayload = {
			id: batch.id,
			sourceName,
			fingerprintShort: batch.fingerprint.slice(0, 12),
			sourceFingerprintShort: batch.sourceFingerprint.slice(0, 12),
			createdAt: batch.createdAt,
			lineCount: batch.lines.length,
			totalQuantity,
			status: batch.reversal ? 'reversed' : 'active',
			reversedAt: batch.reversal?.createdAt,
		};
		if (!isBatchPayload(result, { text: 0 })) {
			throw new TypeError('Invalid stock-out batch display record.');
		}
		return result;
	}).toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
	const batchIds = new Set(batches.map(batch => batch.id));
	if (batchIds.size !== batches.length) {
		throw new TypeError('Inventory transaction history contains duplicate batch IDs.');
	}
	const transactions = input.transactions.map((transaction): InventoryTransactionsEntryPayload => {
		if (!TRANSACTION_KINDS.includes(transaction.kind)
			|| !batchIds.has(transaction.batchId)
			|| !Number.isSafeInteger(transaction.delta)
			|| transaction.delta === 0
			|| (transaction.kind === 'bom-stock-out' && transaction.delta >= 0)
			|| (transaction.kind === 'bom-stock-out-reversal' && transaction.delta <= 0)
			|| !isSafeNonNegativeInteger(transaction.beforeQuantity)
			|| !isSafeNonNegativeInteger(transaction.afterQuantity)
			|| transaction.beforeQuantity + transaction.delta !== transaction.afterQuantity
			|| !isCanonicalTimestamp(transaction.createdAt)) {
			throw new TypeError('Invalid inventory transaction history record.');
		}
		addBudget(budget, transaction.batchId.length);
		return {
			kind: transaction.kind,
			batchId: transaction.batchId,
			delta: transaction.delta,
			beforeQuantity: transaction.beforeQuantity,
			afterQuantity: transaction.afterQuantity,
			createdAt: transaction.createdAt,
			name: cloneRequiredText(transaction.identity.name, MAX_TEXT_LENGTH, budget),
			lcscPartNumber: cloneOptionalText(transaction.identity.lcscPartNumber, MAX_TEXT_LENGTH, budget),
			manufacturerPartNumber: cloneOptionalText(
				transaction.identity.manufacturerPartNumber,
				MAX_TEXT_LENGTH,
				budget,
			),
			package: cloneOptionalText(transaction.identity.package, MAX_TEXT_LENGTH, budget),
			note: cloneOptionalText(transaction.note, MAX_NOTE_LENGTH, budget),
		};
	}).toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
	return { batches, transactions };
}

export function parseIFrameInventoryTransactionsRequest(
	value: unknown,
): IFrameInventoryTransactionsRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_TRANSACTIONS_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isLabels(value.labels)) {
		return undefined;
	}
	const snapshot = parseInventoryTransactionsSnapshot(value.snapshot);
	return snapshot
		? { protocolVersion: 1, requestId: value.requestId, labels: { ...value.labels }, snapshot }
		: undefined;
}

export function parseIFrameInventoryTransactionsEvent(
	value: unknown,
	requestId: string,
): IFrameInventoryTransactionsEvent | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_TRANSACTIONS_PROTOCOL_VERSION
		|| value.requestId !== requestId) {
		return undefined;
	}
	const base = { protocolVersion: INVENTORY_TRANSACTIONS_PROTOCOL_VERSION, requestId } as const;
	if (value.status === 'ready')
		return { ...base, status: 'ready' };
	if (value.status === 'progress' && isPanelStage(value.stage)) {
		return { ...base, status: 'progress', stage: value.stage };
	}
	if (value.status === 'failed' && isPanelStage(value.stage)
		&& isText(value.errorName, 100) && isText(value.error, 500)) {
		return { ...base, status: 'failed', stage: value.stage, errorName: value.errorName, error: value.error };
	}
	if (value.status !== 'action' || !isNonEmptyText(value.operationId, 200))
		return undefined;
	if (value.action === 'close' || value.action === 'refresh') {
		return { ...base, status: 'action', operationId: value.operationId, action: value.action };
	}
	if (value.action === 'undo-batch' && isNonEmptyText(value.batchId, MAX_IDENTIFIER_LENGTH)) {
		return { ...base, status: 'action', operationId: value.operationId, action: 'undo-batch', batchId: value.batchId };
	}
	return undefined;
}

export function createIFrameInventoryTransactionsResponse(
	requestId: string,
	operationId: string,
	outcome: InventoryTransactionsPanelActionOutcome,
): IFrameInventoryTransactionsResponse {
	return {
		protocolVersion: INVENTORY_TRANSACTIONS_PROTOCOL_VERSION,
		requestId,
		operationId,
		status: outcome.status,
		message: outcome.message?.slice(0, 1000),
		snapshot: outcome.status === 'succeeded' && outcome.snapshot
			? createInventoryTransactionsSnapshot(outcome.snapshot)
			: undefined,
	};
}

export function parseIFrameInventoryTransactionsResponse(
	value: unknown,
	requestId: string,
	operationId: string,
): IFrameInventoryTransactionsResponse | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== INVENTORY_TRANSACTIONS_PROTOCOL_VERSION
		|| value.requestId !== requestId
		|| value.operationId !== operationId
		|| (value.status !== 'failed' && value.status !== 'succeeded')
		|| (value.message !== undefined && !isText(value.message, 1000))
		|| (value.status === 'failed' && !isNonEmptyText(value.message, 1000))) {
		return undefined;
	}
	const snapshot = value.snapshot === undefined ? undefined : parseInventoryTransactionsSnapshot(value.snapshot);
	if ((value.snapshot !== undefined && !snapshot) || (value.status === 'failed' && value.snapshot !== undefined))
		return undefined;
	return {
		protocolVersion: 1,
		requestId,
		operationId,
		status: value.status,
		message: value.message,
		snapshot,
	};
}

export function parseInventoryTransactionsSnapshot(value: unknown): InventoryTransactionsSnapshotPayload | undefined {
	if (!isRecord(value)
		|| !Array.isArray(value.batches)
		|| value.batches.length > MAX_BATCHES
		|| !Array.isArray(value.transactions)
		|| value.transactions.length > MAX_TRANSACTIONS) {
		return undefined;
	}
	try {
		const budget = { text: 0 };
		if (!value.batches.every(batch => isBatchPayload(batch, budget))
			|| !value.transactions.every(transaction => isTransactionPayload(transaction, budget))) {
			return undefined;
		}
		const batches = value.batches.map(batch => ({ ...batch }));
		if (new Set(batches.map(batch => batch.id)).size !== batches.length)
			return undefined;
		const batchIds = new Set(batches.map(batch => batch.id));
		if (!value.transactions.every(transaction => isRecord(transaction) && batchIds.has(String(transaction.batchId)))) {
			return undefined;
		}
		return { batches, transactions: value.transactions.map(transaction => ({ ...transaction })) };
	}
	catch {
		return undefined;
	}
}

function isBatchPayload(value: unknown, budget: { text: number }): value is InventoryTransactionsBatchPayload {
	if (!isRecord(value)
		|| !isNonEmptyText(value.id, MAX_IDENTIFIER_LENGTH)
		|| !isOptionalText(value.sourceName, MAX_TEXT_LENGTH)
		|| !/^[a-f\d]{12}$/.test(String(value.fingerprintShort))
		|| !/^[a-f\d]{12}$/.test(String(value.sourceFingerprintShort))
		|| !isCanonicalTimestamp(value.createdAt)
		|| !isPositiveSafeInteger(value.lineCount)
		|| !isPositiveSafeInteger(value.totalQuantity)
		|| (value.status !== 'active' && value.status !== 'reversed')
		|| !isOptionalTimestamp(value.reversedAt)
		|| (value.status === 'active' && value.reversedAt !== undefined)
		|| (value.status === 'reversed' && value.reversedAt === undefined)) {
		return false;
	}
	addBudget(budget, (value.id as string).length + ((value.sourceName as string | undefined)?.length ?? 0));
	return true;
}

function isTransactionPayload(value: unknown, budget: { text: number }): value is InventoryTransactionsEntryPayload {
	if (!isRecord(value)
		|| !TRANSACTION_KINDS.includes(value.kind as InventoryTransactionKind)
		|| !isNonEmptyText(value.batchId, MAX_IDENTIFIER_LENGTH)
		|| !Number.isSafeInteger(value.delta)
		|| value.delta === 0
		|| (value.kind === 'bom-stock-out' && (value.delta as number) >= 0)
		|| (value.kind === 'bom-stock-out-reversal' && (value.delta as number) <= 0)
		|| !isSafeNonNegativeInteger(value.beforeQuantity)
		|| !isSafeNonNegativeInteger(value.afterQuantity)
		|| (value.beforeQuantity as number) + (value.delta as number) !== value.afterQuantity
		|| !isCanonicalTimestamp(value.createdAt)
		|| !isNonEmptyText(value.name, MAX_TEXT_LENGTH)
		|| !isOptionalText(value.lcscPartNumber, MAX_TEXT_LENGTH)
		|| !isOptionalText(value.manufacturerPartNumber, MAX_TEXT_LENGTH)
		|| !isOptionalText(value.package, MAX_TEXT_LENGTH)
		|| !isOptionalText(value.note, MAX_NOTE_LENGTH)) {
		return false;
	}
	addBudget(budget, (value.batchId as string).length
	+ value.name.length
	+ ((value.lcscPartNumber as string | undefined)?.length ?? 0)
	+ ((value.manufacturerPartNumber as string | undefined)?.length ?? 0)
	+ ((value.package as string | undefined)?.length ?? 0)
	+ ((value.note as string | undefined)?.length ?? 0));
	return true;
}

function cloneRequiredText(value: unknown, maximumLength: number, budget: { text: number }): string {
	if (!isNonEmptyTrimmedText(value, 16_384))
		throw new TypeError('Invalid inventory transaction identity.');
	const result = value.trim().slice(0, maximumLength);
	addBudget(budget, result.length);
	return result;
}

function cloneOptionalText(value: unknown, maximumLength: number, budget: { text: number }): string | undefined {
	if (value === undefined)
		return undefined;
	if (typeof value !== 'string')
		throw new TypeError('Invalid inventory transaction text.');
	const result = value.trim().slice(0, maximumLength) || undefined;
	addBudget(budget, result?.length ?? 0);
	return result;
}

function addBudget(budget: { text: number }, length: number): void {
	budget.text += length;
	if (budget.text > MAX_BRIDGE_TEXT)
		throw new RangeError('Inventory transaction history exceeds the bridge text limit.');
}

function isCanonicalTimestamp(value: unknown): value is string {
	return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isOptionalTimestamp(value: unknown): value is string | undefined {
	return value === undefined || isCanonicalTimestamp(value);
}

function isLabels(value: unknown): value is InventoryTransactionsLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isNonEmptyText(value[key], 2000));
}

function isPanelStage(value: unknown): value is InventoryTransactionsPanelStage {
	return value === 'script-started' || value === 'request-read' || value === 'panel-rendered';
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOptionalText(value: unknown, maximumLength: number): value is string | undefined {
	return value === undefined || isText(value, maximumLength);
}

function isNonEmptyTrimmedText(value: unknown, maximumLength: number): value is string {
	return isNonEmptyText(value, maximumLength) && value.trim().length > 0;
}

function isNonEmptyText(value: unknown, maximumLength: number): value is string {
	return isText(value, maximumLength) && value.length > 0;
}

function isText(value: unknown, maximumLength: number): value is string {
	return typeof value === 'string' && value.length <= maximumLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
