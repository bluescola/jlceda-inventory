import type { NewInventoryItem } from './inventory-item';
import { normalizeInventoryText } from './inventory-item';

export type OrderImportStrategy = 'add' | 'replace' | 'skip';

export interface OrderImportResultSummary {
	added: number;
	merged: number;
	skipped: number;
}

export interface OrderImportFileInput {
	fileName: string;
	orderNumber?: string;
	fingerprint: string;
	items: NewInventoryItem[];
	rowCount: number;
	totalQuantity: number;
}

export interface OrderImportBatchInput {
	files: OrderImportFileInput[];
}

export interface OrderImportFileSummary {
	fileName: string;
	orderNumber?: string;
	fingerprint: string;
	rowCount: number;
	totalQuantity: number;
}

export interface OrderImportInventoryLink {
	identityKey: string;
	inventoryItemId: string;
}

export type OrderImportDuplicateReason
	= | 'historical-fingerprint'
		| 'historical-order-number'
		| 'batch-fingerprint'
		| 'batch-order-number';

export interface OrderImportDuplicateReference {
	duplicateReason: OrderImportDuplicateReason;
	duplicateOfBatchId?: string;
	duplicateImportedAt?: string;
}

export interface OrderImportFilePreview extends OrderImportFileSummary, Partial<OrderImportDuplicateReference> {
	status: 'ready' | 'duplicate';
	result: OrderImportResultSummary;
}

export interface OrderImportBatchPreview {
	files: OrderImportFilePreview[];
	result: OrderImportResultSummary;
}

export interface OrderImportFileRecord extends OrderImportFileSummary, Partial<OrderImportDuplicateReference> {
	status: 'imported' | 'duplicate';
	result: OrderImportResultSummary;
	inventoryLinks?: OrderImportInventoryLink[];
	deduplicationActive?: boolean;
}

export interface OrderImportBatchRecord {
	id: string;
	importedAt: string;
	strategy: OrderImportStrategy;
	files: OrderImportFileRecord[];
	result: OrderImportResultSummary;
}

export interface OrderImportBatchResult {
	batchId: string;
	files: OrderImportFileRecord[];
	result: OrderImportResultSummary;
	record: OrderImportBatchRecord;
}

const MAX_FILE_NAME_LENGTH = 255;
const MAX_ORDER_NUMBER_LENGTH = 64;
const MAX_INVENTORY_LINK_TEXT_LENGTH = 4096;
const SHA_256_HEX = /^[a-f\d]{64}$/;

export function sanitizeOrderImportFileSummary(input: OrderImportFileSummary): OrderImportFileSummary {
	const fileName = sanitizeRequiredText(input.fileName, MAX_FILE_NAME_LENGTH, 'Order import file name');
	const orderNumber = input.orderNumber === undefined
		? undefined
		: sanitizeRequiredText(input.orderNumber, MAX_ORDER_NUMBER_LENGTH, 'Order number').toUpperCase();
	const fingerprint = input.fingerprint.trim().toLowerCase();
	if (!SHA_256_HEX.test(fingerprint)) {
		throw new Error('Order import fingerprint must be a SHA-256 hexadecimal value.');
	}
	assertNonNegativeInteger(input.rowCount, 'Order import row count');
	assertNonNegativeInteger(input.totalQuantity, 'Order import total quantity');
	return {
		fileName,
		orderNumber,
		fingerprint,
		rowCount: input.rowCount,
		totalQuantity: input.totalQuantity,
	};
}

export function sanitizeOrderImportBatchRecord(record: OrderImportBatchRecord): OrderImportBatchRecord {
	return {
		...record,
		files: record.files.map((file) => {
			const inventoryLinks = sanitizeOrderImportInventoryLinks(file.inventoryLinks);
			return {
				...file,
				...sanitizeOrderImportFileSummary(file),
				inventoryLinks,
				deduplicationActive: file.status === 'imported'
					? file.deduplicationActive !== false
					: undefined,
			};
		}),
	};
}

function sanitizeOrderImportInventoryLinks(
	links: OrderImportInventoryLink[] | undefined,
): OrderImportInventoryLink[] | undefined {
	if (links === undefined) {
		return undefined;
	}
	if (!Array.isArray(links)) {
		throw new TypeError('Order import inventory links must be an array.');
	}
	const sanitized = new Map<string, OrderImportInventoryLink>();
	for (const link of links) {
		const identityKey = sanitizeRequiredText(
			link.identityKey,
			MAX_INVENTORY_LINK_TEXT_LENGTH,
			'Order import inventory identity key',
		).toLowerCase();
		const inventoryItemId = sanitizeRequiredText(
			link.inventoryItemId,
			MAX_INVENTORY_LINK_TEXT_LENGTH,
			'Order import inventory item ID',
		);
		sanitized.set(identityKey, { identityKey, inventoryItemId });
	}
	return [...sanitized.values()];
}

function sanitizeRequiredText(value: string, maximumLength: number, label: string): string {
	const normalized = normalizeInventoryText(value);
	if (!normalized) {
		throw new Error(`${label} is required.`);
	}
	if (normalized.length > maximumLength) {
		throw new Error(`${label} must not exceed ${maximumLength} characters.`);
	}
	return normalized;
}

function assertNonNegativeInteger(value: number, label: string): void {
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${label} must be a non-negative integer.`);
	}
}
