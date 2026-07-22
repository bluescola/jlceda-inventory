import type { ProjectDemandSnapshot, PurchaseRecord } from '../../project-planning/domain/project-planning';
import type { InventoryDocument } from '../domain/inventory-document';
import type { InventoryTransaction, StockOutBatchRecord } from '../domain/inventory-transaction';
import { sanitizeProjectDemandSnapshot, sanitizePurchaseRecord } from '../../project-planning/domain/project-planning';
import { INVENTORY_SCHEMA_VERSION, migrateInventoryDocument } from '../domain/inventory-document';
import { normalizeInventoryText } from '../domain/inventory-item';
import { normalizeDatasheetUrl, normalizeStructuredLocation } from '../domain/inventory-metadata';
import { sanitizeInventoryTransaction, sanitizeStockOutBatchRecord } from '../domain/inventory-transaction';
import {
	MAX_INVENTORY_DOCUMENT_CATEGORIES,
	MAX_INVENTORY_DOCUMENT_ITEMS,
	MAX_INVENTORY_DOCUMENT_ORDER_IMPORT_BATCHES,
	MAX_INVENTORY_DOCUMENT_ORDER_IMPORT_FILES,
	MAX_INVENTORY_DOCUMENT_PROJECT_DEMAND_LINES,
	MAX_INVENTORY_DOCUMENT_PROJECT_SNAPSHOTS,
	MAX_INVENTORY_DOCUMENT_PURCHASE_RECORDS,
	MAX_INVENTORY_DOCUMENT_STOCK_OUT_BATCHES,
	MAX_INVENTORY_DOCUMENT_SUBSTITUTE_LINKS,
	MAX_INVENTORY_DOCUMENT_TEXT_LENGTH,
	MAX_INVENTORY_DOCUMENT_TRANSACTIONS,
} from './inventory-document-limits';

export const MAX_INVENTORY_BACKUP_TEXT_LENGTH = MAX_INVENTORY_DOCUMENT_TEXT_LENGTH;
export const MAX_INVENTORY_BACKUP_ITEMS = MAX_INVENTORY_DOCUMENT_ITEMS;
export const MAX_INVENTORY_BACKUP_CATEGORIES = MAX_INVENTORY_DOCUMENT_CATEGORIES;
export const MAX_INVENTORY_BACKUP_ORDER_IMPORT_BATCHES = MAX_INVENTORY_DOCUMENT_ORDER_IMPORT_BATCHES;
export const MAX_INVENTORY_BACKUP_ORDER_IMPORT_FILES = MAX_INVENTORY_DOCUMENT_ORDER_IMPORT_FILES;
export const MAX_INVENTORY_BACKUP_TRANSACTIONS = MAX_INVENTORY_DOCUMENT_TRANSACTIONS;
export const MAX_INVENTORY_BACKUP_STOCK_OUT_BATCHES = MAX_INVENTORY_DOCUMENT_STOCK_OUT_BATCHES;
export const MAX_INVENTORY_BACKUP_PROJECT_SNAPSHOTS = MAX_INVENTORY_DOCUMENT_PROJECT_SNAPSHOTS;
export const MAX_INVENTORY_BACKUP_PURCHASE_RECORDS = MAX_INVENTORY_DOCUMENT_PURCHASE_RECORDS;
export const MAX_INVENTORY_BACKUP_PROJECT_DEMAND_LINES = MAX_INVENTORY_DOCUMENT_PROJECT_DEMAND_LINES;
export const MAX_INVENTORY_BACKUP_SUBSTITUTE_LINKS = MAX_INVENTORY_DOCUMENT_SUBSTITUTE_LINKS;

export type InventoryBackupSchemaVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | typeof INVENTORY_SCHEMA_VERSION;

export type InventoryBackupValidationCode
	= | 'invalid-json'
		| 'text-too-large'
		| 'invalid-root'
		| 'invalid-schema-version'
		| 'future-schema-version'
		| 'items-limit-exceeded'
		| 'categories-limit-exceeded'
		| 'order-import-batches-limit-exceeded'
		| 'order-import-files-limit-exceeded'
		| 'transactions-limit-exceeded'
		| 'stock-out-batches-limit-exceeded'
		| 'project-snapshots-limit-exceeded'
		| 'purchase-records-limit-exceeded'
		| 'project-demand-lines-limit-exceeded'
		| 'substitute-links-limit-exceeded'
		| 'invalid-field'
		| 'duplicate-id'
		| 'dangling-category-reference'
		| 'dangling-stock-out-item-reference'
		| 'dangling-transaction-reference'
		| 'dangling-substitute-reference'
		| 'duplicate-substitute-pair'
		| 'invalid-category-hierarchy'
		| 'invalid-transaction-ledger'
		| 'invalid-project-planning'
		| 'migration-failed';

export interface InventoryBackupMetadata {
	sourceSchemaVersion: InventoryBackupSchemaVersion;
	itemCount: number;
	categoryCount: number;
	orderImportBatchCount: number;
	transactionCount: number;
	stockOutBatchCount: number;
	projectSnapshotCount: number;
	purchaseRecordCount: number;
	substituteLinkCount: number;
	updatedAt: string;
	revision: number;
}

export interface ValidatedInventoryBackup {
	document: InventoryDocument;
	metadata: InventoryBackupMetadata;
}

export class InventoryBackupValidationError extends TypeError {
	public constructor(
		public readonly code: InventoryBackupValidationCode,
		public readonly path: string,
		message: string,
	) {
		super(path ? `${message} (${path})` : message);
		this.name = 'InventoryBackupValidationError';
	}
}

/**
 * Parses a JSON backup string or validates an already materialized JSON value.
 * The returned document is always migrated to the current inventory schema.
 */
export function validateInventoryBackup(input: unknown): ValidatedInventoryBackup {
	const value = materializeJsonValue(input);
	const source = validateDocument(value);

	let document: InventoryDocument | undefined;
	try {
		document = migrateInventoryDocument(value);
	}
	catch {
		fail('migration-failed', '', 'Inventory backup migration failed.');
	}
	if (!document) {
		fail('migration-failed', '', 'Inventory backup cannot be migrated.');
	}

	// Migration sanitizes legacy text and fills version-specific defaults. Validate
	// its output again so callers only ever receive a complete current document.
	validateDocument(document);
	if (utf8ByteLength(JSON.stringify(document, undefined, 2)) > MAX_INVENTORY_BACKUP_TEXT_LENGTH) {
		fail('text-too-large', '', 'Inventory backup exceeds the supported serialized size.');
	}

	return {
		document,
		metadata: {
			sourceSchemaVersion: source.schemaVersion,
			itemCount: source.items.length,
			categoryCount: source.categories.length,
			orderImportBatchCount: source.orderImportBatches.length,
			transactionCount: source.transactions.length,
			stockOutBatchCount: source.stockOutBatches.length,
			projectSnapshotCount: source.projectSnapshots.length,
			purchaseRecordCount: source.purchaseRecords.length,
			substituteLinkCount: source.substituteLinks.length,
			updatedAt: source.updatedAt,
			revision: source.revision,
		},
	};
}

interface ValidatedSourceDocument {
	schemaVersion: InventoryBackupSchemaVersion;
	revision: number;
	updatedAt: string;
	items: JsonRecord[];
	categories: JsonRecord[];
	orderImportBatches: JsonRecord[];
	transactions: JsonRecord[];
	stockOutBatches: JsonRecord[];
	projectSnapshots: JsonRecord[];
	purchaseRecords: JsonRecord[];
	substituteLinks: JsonRecord[];
}

type JsonRecord = Record<string, unknown>;

function materializeJsonValue(input: unknown): unknown {
	if (typeof input === 'string') {
		assertTextLength(input);
		try {
			return JSON.parse(input) as unknown;
		}
		catch {
			fail('invalid-json', '', 'Inventory backup is not valid JSON.');
		}
	}

	let serialized: string | undefined;
	try {
		serialized = JSON.stringify(input);
	}
	catch {
		fail('invalid-json', '', 'Inventory backup is not a JSON-compatible value.');
	}
	if (serialized === undefined) {
		fail('invalid-root', '', 'Inventory backup root must be an object.');
	}
	assertTextLength(serialized);
	return JSON.parse(serialized) as unknown;
}

function assertTextLength(value: string): void {
	if (utf8ByteLength(value) > MAX_INVENTORY_BACKUP_TEXT_LENGTH) {
		fail('text-too-large', '', `Inventory backup must not exceed ${MAX_INVENTORY_BACKUP_TEXT_LENGTH} UTF-8 bytes.`);
	}
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function validateDocument(value: unknown): ValidatedSourceDocument {
	const document = assertRecord(value, '', 'Inventory backup root must be an object.', 'invalid-root');
	const schemaVersion = assertSchemaVersion(document.schemaVersion);
	const revision = assertRevision(document.revision, 'revision', true);
	const updatedAt = assertTimestamp(document.updatedAt, 'updatedAt');
	const items = assertRecordArray(document.items, 'items');
	if (items.length > MAX_INVENTORY_BACKUP_ITEMS) {
		fail('items-limit-exceeded', 'items', `Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_ITEMS} items.`);
	}

	const categories = schemaVersion >= 3
		? assertRecordArray(document.categories, 'categories')
		: [];
	if (categories.length > MAX_INVENTORY_BACKUP_CATEGORIES) {
		fail('categories-limit-exceeded', 'categories', `Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_CATEGORIES} categories.`);
	}

	const orderImportBatches = schemaVersion >= 4
		? assertRecordArray(document.orderImportBatches, 'orderImportBatches')
		: [];
	if (orderImportBatches.length > MAX_INVENTORY_BACKUP_ORDER_IMPORT_BATCHES) {
		fail(
			'order-import-batches-limit-exceeded',
			'orderImportBatches',
			`Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_ORDER_IMPORT_BATCHES} order import batches.`,
		);
	}
	const transactions = schemaVersion >= 7
		? assertRecordArray(document.transactions, 'transactions')
		: [];
	if (transactions.length > MAX_INVENTORY_BACKUP_TRANSACTIONS) {
		fail(
			'transactions-limit-exceeded',
			'transactions',
			`Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_TRANSACTIONS} transactions.`,
		);
	}
	const stockOutBatches = schemaVersion >= 7
		? assertRecordArray(document.stockOutBatches, 'stockOutBatches')
		: [];
	if (stockOutBatches.length > MAX_INVENTORY_BACKUP_STOCK_OUT_BATCHES) {
		fail(
			'stock-out-batches-limit-exceeded',
			'stockOutBatches',
			`Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_STOCK_OUT_BATCHES} stock-out batches.`,
		);
	}
	const projectSnapshots = schemaVersion >= 8
		? assertRecordArray(document.projectSnapshots, 'projectSnapshots')
		: [];
	if (projectSnapshots.length > MAX_INVENTORY_BACKUP_PROJECT_SNAPSHOTS) {
		fail(
			'project-snapshots-limit-exceeded',
			'projectSnapshots',
			`Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_PROJECT_SNAPSHOTS} project snapshots.`,
		);
	}
	const purchaseRecords = schemaVersion >= 8
		? assertRecordArray(document.purchaseRecords, 'purchaseRecords')
		: [];
	if (purchaseRecords.length > MAX_INVENTORY_BACKUP_PURCHASE_RECORDS) {
		fail(
			'purchase-records-limit-exceeded',
			'purchaseRecords',
			`Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_PURCHASE_RECORDS} purchase records.`,
		);
	}
	const substituteLinks = schemaVersion >= 9
		? assertRecordArray(document.substituteLinks, 'substituteLinks')
		: [];
	if (substituteLinks.length > MAX_INVENTORY_BACKUP_SUBSTITUTE_LINKS) {
		fail(
			'substitute-links-limit-exceeded',
			'substituteLinks',
			`Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_SUBSTITUTE_LINKS} substitute links.`,
		);
	}
	assertProjectDemandLineLimit(projectSnapshots);

	validateCategories(categories);
	const itemIds = validateItems(items, schemaVersion, new Set(categories.map(category => category.id as string)));
	validateOrderImportBatches(orderImportBatches);
	validateTransactionLedger(transactions, stockOutBatches, itemIds);
	validateProjectPlanning(projectSnapshots, purchaseRecords);
	validateSubstituteLinks(substituteLinks, itemIds);

	return {
		schemaVersion,
		revision,
		updatedAt,
		items,
		categories,
		orderImportBatches,
		transactions,
		stockOutBatches,
		projectSnapshots,
		purchaseRecords,
		substituteLinks,
	};
}

function assertSchemaVersion(value: unknown): InventoryBackupSchemaVersion {
	if (!Number.isSafeInteger(value) || typeof value !== 'number' || value < 1) {
		fail('invalid-schema-version', 'schemaVersion', 'Inventory backup schema version must be a positive integer.');
	}
	if (value > INVENTORY_SCHEMA_VERSION) {
		fail(
			'future-schema-version',
			'schemaVersion',
			`Inventory backup schema version ${value} is newer than supported version ${INVENTORY_SCHEMA_VERSION}.`,
		);
	}
	return value as InventoryBackupSchemaVersion;
}

function validateItems(
	items: JsonRecord[],
	schemaVersion: InventoryBackupSchemaVersion,
	categoryIds: Set<string>,
): Set<string> {
	const itemIds = new Set<string>();
	for (const [index, item] of items.entries()) {
		const path = `items[${index}]`;
		const id = assertIdentifier(item.id, `${path}.id`);
		assertUniqueId(itemIds, id, `${path}.id`, 'inventory item');

		if (item.categoryId !== undefined) {
			const categoryId = assertIdentifier(item.categoryId, `${path}.categoryId`);
			if (!categoryIds.has(categoryId)) {
				fail('dangling-category-reference', `${path}.categoryId`, `Inventory item references missing category ${categoryId}.`);
			}
		}

		validateIdentity(item.identity, `${path}.identity`);
		validateOptionalMarketplaceReference(item.marketplaceReference, `${path}.marketplaceReference`);
		validateOptionalEdaModelReference(item.edaModelReference, `${path}.edaModelReference`);
		if (schemaVersion === 1) {
			validateOptionalEdaModelReference(item.catalogReference, `${path}.catalogReference`);
		}

		const precision = assertEnum(item.precision, ['exact', 'estimated', 'unknown'] as const, `${path}.precision`);
		const quantity = item.quantity;
		if (precision === 'unknown') {
			if (quantity !== null) {
				fail('invalid-field', `${path}.quantity`, 'Unknown inventory quantity must be null.');
			}
		}
		else if (!isNonNegativeSafeInteger(quantity)) {
			fail('invalid-field', `${path}.quantity`, 'Known inventory quantity must be a non-negative safe integer.');
		}

		const state = assertEnum(item.state, ['in-stock', 'depleted'] as const, `${path}.state`);
		if (quantity === 0 && state !== 'depleted') {
			fail('invalid-field', `${path}.state`, 'Zero inventory quantity must use the depleted state.');
		}
		if (typeof quantity === 'number' && quantity > 0 && state !== 'in-stock') {
			fail('invalid-field', `${path}.state`, 'Positive inventory quantity must use the in-stock state.');
		}

		assertEnum(item.source, ['manual', 'marketplace', 'catalog', 'order'] as const, `${path}.source`);
		if (schemaVersion === 1 && item.edaModelStatus === undefined) {
			// Schema v1 predates the explicit EDA model status.
		}
		else {
			assertEnum(item.edaModelStatus, ['available', 'missing', 'failed', 'unchecked'] as const, `${path}.edaModelStatus`);
		}

		if (item.minimumQuantity !== undefined && !isPositiveSafeInteger(item.minimumQuantity)) {
			fail('invalid-field', `${path}.minimumQuantity`, 'Minimum quantity must be a positive safe integer.');
		}
		if (item.favorite !== undefined && typeof item.favorite !== 'boolean') {
			fail('invalid-field', `${path}.favorite`, 'Favorite must be a boolean when present.');
		}
		assertOptionalText(item.location, `${path}.location`, 65_536);
		validateInventoryMetadata(item, path);
		assertOptionalText(item.note, `${path}.note`, 65_536);
		const createdAt = assertTimestamp(item.createdAt, `${path}.createdAt`);
		const itemUpdatedAt = assertTimestamp(item.updatedAt, `${path}.updatedAt`);
		if (Date.parse(createdAt) > Date.parse(itemUpdatedAt)) {
			fail('invalid-field', `${path}.updatedAt`, 'Inventory item updated time must not precede its creation time.');
		}
		assertRevision(item.revision, `${path}.revision`, false);
	}
	return itemIds;
}

function validateSubstituteLinks(links: JsonRecord[], itemIds: Set<string>): void {
	const linkIds = new Set<string>();
	const pairKeys = new Set<string>();
	for (const [index, link] of links.entries()) {
		const path = `substituteLinks[${index}]`;
		const id = assertIdentifier(link.id, `${path}.id`);
		assertUniqueId(linkIds, id, `${path}.id`, 'substitute link');
		const itemIdA = assertIdentifier(link.itemIdA, `${path}.itemIdA`);
		const itemIdB = assertIdentifier(link.itemIdB, `${path}.itemIdB`);
		if (itemIdA >= itemIdB) {
			fail('invalid-field', path, 'Substitute item IDs must be two different IDs in canonical ascending order.');
		}
		if (!itemIds.has(itemIdA)) {
			fail('dangling-substitute-reference', `${path}.itemIdA`, `Substitute link references missing inventory item ${itemIdA}.`);
		}
		if (!itemIds.has(itemIdB)) {
			fail('dangling-substitute-reference', `${path}.itemIdB`, `Substitute link references missing inventory item ${itemIdB}.`);
		}
		const pairKey = `${itemIdA}\u0000${itemIdB}`;
		if (pairKeys.has(pairKey)) {
			fail('duplicate-substitute-pair', path, 'Each unordered inventory item pair may have only one substitute link.');
		}
		pairKeys.add(pairKey);
		if (link.note !== undefined) {
			assertOptionalReadableText(link.note, `${path}.note`, 65_536);
			if (typeof link.note !== 'string' || normalizeInventoryText(link.note) !== link.note) {
				fail('invalid-field', `${path}.note`, 'Substitute link note must be normalized text.');
			}
		}
		const createdAt = assertTimestamp(link.createdAt, `${path}.createdAt`);
		const updatedAt = assertTimestamp(link.updatedAt, `${path}.updatedAt`);
		if (Date.parse(createdAt) > Date.parse(updatedAt)) {
			fail('invalid-field', `${path}.updatedAt`, 'Substitute link updated time must not precede its creation time.');
		}
		assertRevision(link.revision, `${path}.revision`, false);
	}
}

function validateInventoryMetadata(item: JsonRecord, path: string): void {
	try {
		normalizeDatasheetUrl(item.datasheetUrl);
	}
	catch (error) {
		fail('invalid-field', `${path}.datasheetUrl`, validationMessage(error, 'Invalid datasheet URL.'));
	}
	try {
		normalizeStructuredLocation(item.structuredLocation);
	}
	catch (error) {
		fail('invalid-field', `${path}.structuredLocation`, validationMessage(error, 'Invalid structured inventory location.'));
	}
}

function validateIdentity(value: unknown, path: string): void {
	const identity = assertRecord(value, path, 'Inventory item identity must be an object.');
	assertReadableText(identity.name, `${path}.name`, 16_384);
	for (const field of [
		'lcscPartNumber',
		'supplierId',
		'manufacturerPartNumber',
		'manufacturer',
		'package',
		'description',
	] as const) {
		assertOptionalText(identity[field], `${path}.${field}`, field === 'description' ? 65_536 : 16_384);
	}
}

function validateOptionalMarketplaceReference(value: unknown, path: string): void {
	if (value === undefined) {
		return;
	}
	const reference = assertRecord(value, path, 'Marketplace reference must be an object.');
	assertEnum(reference.provider, ['lcsc'] as const, `${path}.provider`);
	assertReadableText(reference.productUrl, `${path}.productUrl`, 8192);
	assertEnum(reference.evidence, ['user-confirmed', 'order-import'] as const, `${path}.evidence`);
	assertTimestamp(reference.confirmedAt, `${path}.confirmedAt`);
}

function validateOptionalEdaModelReference(value: unknown, path: string): void {
	if (value === undefined) {
		return;
	}
	const reference = assertRecord(value, path, 'EDA model reference must be an object.');
	assertReadableText(reference.deviceUuid, `${path}.deviceUuid`, 4096);
	assertReadableText(reference.libraryUuid, `${path}.libraryUuid`, 4096);
	assertOptionalText(reference.symbolName, `${path}.symbolName`, 16_384);
	assertOptionalText(reference.footprintName, `${path}.footprintName`, 16_384);
}

function validateCategories(categories: JsonRecord[]): void {
	const categoryIds = new Set<string>();
	const parents = new Map<string, string | undefined>();
	for (const [index, category] of categories.entries()) {
		const path = `categories[${index}]`;
		const id = assertIdentifier(category.id, `${path}.id`);
		assertUniqueId(categoryIds, id, `${path}.id`, 'inventory category');
		assertReadableText(category.name, `${path}.name`, 16_384);
		const parentId = category.parentId === undefined
			? undefined
			: assertIdentifier(category.parentId, `${path}.parentId`);
		parents.set(id, parentId);
		if (!isNonNegativeSafeInteger(category.sortOrder)) {
			fail('invalid-field', `${path}.sortOrder`, 'Category sort order must be a non-negative safe integer.');
		}
		const createdAt = assertTimestamp(category.createdAt, `${path}.createdAt`);
		const categoryUpdatedAt = assertTimestamp(category.updatedAt, `${path}.updatedAt`);
		if (Date.parse(createdAt) > Date.parse(categoryUpdatedAt)) {
			fail('invalid-field', `${path}.updatedAt`, 'Category updated time must not precede its creation time.');
		}
		assertRevision(category.revision, `${path}.revision`, false);
	}

	for (const [id, parentId] of parents) {
		if (parentId === undefined) {
			continue;
		}
		if (!categoryIds.has(parentId)) {
			fail('dangling-category-reference', categoryPath(categories, id, 'parentId'), `Category references missing parent ${parentId}.`);
		}
		if (parentId === id) {
			fail('invalid-category-hierarchy', categoryPath(categories, id, 'parentId'), 'Category cannot be its own parent.');
		}
		const grandparentId = parents.get(parentId);
		if (grandparentId !== undefined) {
			fail(
				'invalid-category-hierarchy',
				categoryPath(categories, id, 'parentId'),
				'Inventory categories support at most two levels and cannot contain cycles.',
			);
		}
	}
}

function categoryPath(categories: JsonRecord[], id: string, field: string): string {
	const index = categories.findIndex(category => category.id === id);
	return `categories[${index}].${field}`;
}

function validateOrderImportBatches(batches: JsonRecord[]): void {
	const batchIds = new Set<string>();
	let totalFileCount = 0;
	for (const [batchIndex, batch] of batches.entries()) {
		const path = `orderImportBatches[${batchIndex}]`;
		const id = assertIdentifier(batch.id, `${path}.id`);
		assertUniqueId(batchIds, id, `${path}.id`, 'order import batch');
		assertTimestamp(batch.importedAt, `${path}.importedAt`);
		assertEnum(batch.strategy, ['add', 'replace', 'skip'] as const, `${path}.strategy`);
		const files = assertRecordArray(batch.files, `${path}.files`);
		totalFileCount += files.length;
		if (!Number.isSafeInteger(totalFileCount) || totalFileCount > MAX_INVENTORY_BACKUP_ORDER_IMPORT_FILES) {
			fail(
				'order-import-files-limit-exceeded',
				`${path}.files`,
				`Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_ORDER_IMPORT_FILES} order import files.`,
			);
		}
		for (const [fileIndex, file] of files.entries()) {
			validateOrderImportFile(file, `${path}.files[${fileIndex}]`);
		}
		validateImportResult(batch.result, `${path}.result`);
	}
}

function validateOrderImportFile(file: JsonRecord, path: string): void {
	assertReadableText(file.fileName, `${path}.fileName`, 255);
	assertOptionalReadableText(file.orderNumber, `${path}.orderNumber`, 64);
	if (typeof file.fingerprint !== 'string' || !/^[a-f\d]{64}$/i.test(file.fingerprint.trim())) {
		fail('invalid-field', `${path}.fingerprint`, 'Order import fingerprint must be a SHA-256 hexadecimal value.');
	}
	if (!isNonNegativeSafeInteger(file.rowCount)) {
		fail('invalid-field', `${path}.rowCount`, 'Order import row count must be a non-negative safe integer.');
	}
	if (!isNonNegativeSafeInteger(file.totalQuantity)) {
		fail('invalid-field', `${path}.totalQuantity`, 'Order import total quantity must be a non-negative safe integer.');
	}
	const status = assertEnum(file.status, ['imported', 'duplicate'] as const, `${path}.status`);
	validateImportResult(file.result, `${path}.result`);
	if (status === 'duplicate') {
		assertEnum(
			file.duplicateReason,
			['historical-fingerprint', 'historical-order-number', 'batch-fingerprint', 'batch-order-number'] as const,
			`${path}.duplicateReason`,
		);
	}
	else if (file.duplicateReason !== undefined) {
		assertEnum(
			file.duplicateReason,
			['historical-fingerprint', 'historical-order-number', 'batch-fingerprint', 'batch-order-number'] as const,
			`${path}.duplicateReason`,
		);
	}
	assertOptionalText(file.duplicateOfBatchId, `${path}.duplicateOfBatchId`, 4096);
	if (file.duplicateImportedAt !== undefined) {
		assertTimestamp(file.duplicateImportedAt, `${path}.duplicateImportedAt`);
	}
	if (file.deduplicationActive !== undefined && typeof file.deduplicationActive !== 'boolean') {
		fail('invalid-field', `${path}.deduplicationActive`, 'Order import deduplication flag must be a boolean.');
	}
	if (file.inventoryLinks !== undefined) {
		const links = assertRecordArray(file.inventoryLinks, `${path}.inventoryLinks`);
		for (const [linkIndex, link] of links.entries()) {
			const linkPath = `${path}.inventoryLinks[${linkIndex}]`;
			assertReadableText(link.identityKey, `${linkPath}.identityKey`, 4096);
			assertReadableText(link.inventoryItemId, `${linkPath}.inventoryItemId`, 4096);
		}
	}
}

function assertProjectDemandLineLimit(records: JsonRecord[]): void {
	let totalDemandLines = 0;
	for (const record of records) {
		if (!Array.isArray(record.demands)) {
			continue;
		}
		totalDemandLines += record.demands.length;
		if (!Number.isSafeInteger(totalDemandLines)
			|| totalDemandLines > MAX_INVENTORY_BACKUP_PROJECT_DEMAND_LINES) {
			fail(
				'project-demand-lines-limit-exceeded',
				'projectSnapshots',
				`Inventory backup must not contain more than ${MAX_INVENTORY_BACKUP_PROJECT_DEMAND_LINES} total project demand lines.`,
			);
		}
	}
}

function validateProjectPlanning(
	snapshotRecords: JsonRecord[],
	purchaseRecords: JsonRecord[],
): void {
	const snapshotIds = new Set<string>();
	const documentIdentities = new Set<string>();
	for (const [index, record] of snapshotRecords.entries()) {
		const path = `projectSnapshots[${index}]`;
		let snapshot: ProjectDemandSnapshot;
		try {
			snapshot = sanitizeProjectDemandSnapshot(record as unknown as ProjectDemandSnapshot);
		}
		catch (error) {
			fail('invalid-field', path, validationMessage(error, 'Invalid project demand snapshot.'));
		}
		if (snapshotIds.has(snapshot.id)) {
			fail('duplicate-id', `${path}.id`, `Duplicate project snapshot ID: ${snapshot.id}.`);
		}
		snapshotIds.add(snapshot.id);
		const identity = `${snapshot.projectUuid ?? ''}\u0000${snapshot.documentUuid}`;
		if (documentIdentities.has(identity)) {
			fail(
				'invalid-project-planning',
				`${path}.documentUuid`,
				'Project backup contains more than one snapshot for the same project document.',
			);
		}
		documentIdentities.add(identity);
	}

	const purchaseIds = new Set<string>();
	for (const [index, record] of purchaseRecords.entries()) {
		const path = `purchaseRecords[${index}]`;
		let purchase: PurchaseRecord;
		try {
			purchase = sanitizePurchaseRecord(record as unknown as PurchaseRecord);
		}
		catch (error) {
			fail('invalid-field', path, validationMessage(error, 'Invalid purchase record.'));
		}
		if (purchaseIds.has(purchase.id)) {
			fail('duplicate-id', `${path}.id`, `Duplicate purchase record ID: ${purchase.id}.`);
		}
		purchaseIds.add(purchase.id);
	}
}

function validateTransactionLedger(
	transactionRecords: JsonRecord[],
	batchRecords: JsonRecord[],
	itemIds: Set<string>,
): void {
	const transactions: InventoryTransaction[] = [];
	const transactionPaths = new Map<string, string>();
	for (const [index, record] of transactionRecords.entries()) {
		const path = `transactions[${index}]`;
		let transaction: InventoryTransaction;
		try {
			transaction = sanitizeInventoryTransaction(record as unknown as InventoryTransaction);
		}
		catch (error) {
			fail('invalid-field', path, validationMessage(error, 'Invalid inventory transaction.'));
		}
		if (transactionPaths.has(transaction.id)) {
			fail('duplicate-id', `${path}.id`, `Duplicate inventory transaction ID: ${transaction.id}.`);
		}
		transactionPaths.set(transaction.id, path);
		transactions.push(transaction);
	}

	const batches: StockOutBatchRecord[] = [];
	const batchPaths = new Map<string, string>();
	const batchFingerprints = new Set<string>();
	const reversalIds = new Set<string>();
	for (const [index, record] of batchRecords.entries()) {
		const path = `stockOutBatches[${index}]`;
		let batch: StockOutBatchRecord;
		try {
			batch = sanitizeStockOutBatchRecord(record as unknown as StockOutBatchRecord);
		}
		catch (error) {
			fail('invalid-field', path, validationMessage(error, 'Invalid stock-out batch.'));
		}
		if (batchPaths.has(batch.id)) {
			fail('duplicate-id', `${path}.id`, `Duplicate stock-out batch ID: ${batch.id}.`);
		}
		if (batchFingerprints.has(batch.fingerprint)) {
			fail('invalid-transaction-ledger', `${path}.fingerprint`, 'Stock-out batch fingerprint must be unique.');
		}
		batchPaths.set(batch.id, path);
		batchFingerprints.add(batch.fingerprint);
		if (batch.reversal) {
			if (reversalIds.has(batch.reversal.id)) {
				fail('duplicate-id', `${path}.reversal.id`, `Duplicate stock-out reversal ID: ${batch.reversal.id}.`);
			}
			reversalIds.add(batch.reversal.id);
		}
		batches.push(batch);
	}
	const reversalTransactionReserve = batches
		.filter(batch => !batch.reversal)
		.reduce((total, batch) => total + batch.lines.length, 0);
	if (!Number.isSafeInteger(transactions.length + reversalTransactionReserve)
		|| transactions.length + reversalTransactionReserve > MAX_INVENTORY_BACKUP_TRANSACTIONS) {
		fail(
			'transactions-limit-exceeded',
			'transactions',
			'Inventory backup must reserve transaction capacity for every active stock-out batch reversal.',
		);
	}

	const transactionsById = new Map(transactions.map(transaction => [transaction.id, transaction]));
	const batchesById = new Map(batches.map(batch => [batch.id, batch]));
	const linkedOriginalTransactions = new Set<string>();
	const linkedReversalTransactions = new Set<string>();
	for (const batch of batches) {
		const batchPath = batchPaths.get(batch.id)!;
		for (const [lineIndex, line] of batch.lines.entries()) {
			const linePath = `${batchPath}.lines[${lineIndex}]`;
			if (!batch.reversal && !itemIds.has(line.itemId)) {
				fail(
					'dangling-stock-out-item-reference',
					`${linePath}.itemId`,
					`Active stock-out line references missing inventory item ${line.itemId}.`,
				);
			}
			const transaction = transactionsById.get(line.transactionId);
			if (!transaction) {
				fail(
					'dangling-transaction-reference',
					`${linePath}.transactionId`,
					`Stock-out line references missing transaction ${line.transactionId}.`,
				);
			}
			if (linkedOriginalTransactions.has(transaction.id)
				|| transaction.kind !== 'bom-stock-out'
				|| transaction.batchId !== batch.id
				|| transaction.itemId !== line.itemId
				|| transaction.delta !== -line.quantity
				|| transaction.createdAt !== batch.createdAt) {
				fail('invalid-transaction-ledger', linePath, 'Stock-out line and transaction are inconsistent.');
			}
			linkedOriginalTransactions.add(transaction.id);
		}

		if (!batch.reversal) {
			continue;
		}
		for (const [transactionIndex, transactionId] of batch.reversal.transactionIds.entries()) {
			const transactionPath = `${batchPath}.reversal.transactionIds[${transactionIndex}]`;
			const transaction = transactionsById.get(transactionId);
			if (!transaction) {
				fail(
					'dangling-transaction-reference',
					transactionPath,
					`Stock-out reversal references missing transaction ${transactionId}.`,
				);
			}
			if (linkedReversalTransactions.has(transaction.id)
				|| transaction.kind !== 'bom-stock-out-reversal'
				|| transaction.batchId !== batch.id
				|| transaction.reversalId !== batch.reversal.id
				|| transaction.createdAt !== batch.reversal.createdAt) {
				fail('invalid-transaction-ledger', transactionPath, 'Stock-out reversal record and transaction are inconsistent.');
			}
			linkedReversalTransactions.add(transaction.id);
		}
	}

	const reversedOriginalTransactions = new Set<string>();
	for (const transaction of transactions) {
		const path = transactionPaths.get(transaction.id)!;
		const batch = batchesById.get(transaction.batchId);
		if (!batch) {
			fail(
				'dangling-transaction-reference',
				`${path}.batchId`,
				`Inventory transaction references missing stock-out batch ${transaction.batchId}.`,
			);
		}
		if (transaction.kind === 'bom-stock-out') {
			if (!linkedOriginalTransactions.has(transaction.id)) {
				fail('invalid-transaction-ledger', path, 'BOM stock-out transaction is not linked from its batch.');
			}
			continue;
		}
		if (!linkedReversalTransactions.has(transaction.id)) {
			fail('invalid-transaction-ledger', path, 'BOM stock-out reversal is not linked from its batch reversal record.');
		}
		const original = transactionsById.get(transaction.reversesTransactionId!);
		if (!original) {
			fail(
				'dangling-transaction-reference',
				`${path}.reversesTransactionId`,
				`Reversal references missing transaction ${transaction.reversesTransactionId}.`,
			);
		}
		if (reversedOriginalTransactions.has(original.id)
			|| original.kind !== 'bom-stock-out'
			|| original.batchId !== transaction.batchId
			|| original.itemId !== transaction.itemId
			|| original.delta !== -transaction.delta) {
			fail('invalid-transaction-ledger', path, 'BOM stock-out reversal does not exactly reverse its original transaction.');
		}
		reversedOriginalTransactions.add(original.id);
	}
}

function validationMessage(error: unknown, fallback: string): string {
	return error instanceof Error && error.message ? error.message : fallback;
}

function validateImportResult(value: unknown, path: string): void {
	const result = assertRecord(value, path, 'Order import result must be an object.');
	for (const field of ['added', 'merged', 'skipped'] as const) {
		if (!isNonNegativeSafeInteger(result[field])) {
			fail('invalid-field', `${path}.${field}`, 'Order import result counts must be non-negative safe integers.');
		}
	}
}

function assertRecord(
	value: unknown,
	path: string,
	message: string,
	code: InventoryBackupValidationCode = 'invalid-field',
): JsonRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		fail(code, path, message);
	}
	return value as JsonRecord;
}

function assertRecordArray(value: unknown, path: string): JsonRecord[] {
	if (!Array.isArray(value)) {
		fail('invalid-field', path, 'Expected an array.');
	}
	return value.map((entry, index) => assertRecord(entry, `${path}[${index}]`, 'Expected an object.'));
}

function assertIdentifier(value: unknown, path: string): string {
	if (typeof value !== 'string'
		|| value.length === 0
		|| value.length > 4096
		|| normalizeInventoryText(value) !== value) {
		fail('invalid-field', path, 'Identifier must be non-empty, normalized text.');
	}
	return value;
}

function assertReadableText(value: unknown, path: string, maximumLength: number): string {
	if (typeof value !== 'string' || value.length > maximumLength || !normalizeInventoryText(value)) {
		fail('invalid-field', path, `Expected non-empty text no longer than ${maximumLength} characters.`);
	}
	return value;
}

function assertOptionalReadableText(value: unknown, path: string, maximumLength: number): void {
	if (value !== undefined) {
		assertReadableText(value, path, maximumLength);
	}
}

function assertOptionalText(value: unknown, path: string, maximumLength: number): void {
	if (value !== undefined && (typeof value !== 'string' || value.length > maximumLength)) {
		fail('invalid-field', path, `Expected text no longer than ${maximumLength} characters.`);
	}
}

function assertTimestamp(value: unknown, path: string): string {
	if (typeof value !== 'string') {
		fail('invalid-field', path, 'Expected an ISO timestamp.');
	}
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
		fail('invalid-field', path, 'Expected a canonical UTC ISO timestamp.');
	}
	return value;
}

function assertRevision(value: unknown, path: string, allowZero: boolean): number {
	if (!Number.isSafeInteger(value)
		|| typeof value !== 'number'
		|| value < (allowZero ? 0 : 1)) {
		fail('invalid-field', path, `Revision must be a ${allowZero ? 'non-negative' : 'positive'} safe integer.`);
	}
	return value;
}

function assertEnum<const Value extends string>(
	value: unknown,
	accepted: readonly Value[],
	path: string,
): Value {
	if (typeof value !== 'string' || !accepted.includes(value as Value)) {
		fail('invalid-field', path, `Expected one of: ${accepted.join(', ')}.`);
	}
	return value as Value;
}

function assertUniqueId(ids: Set<string>, id: string, path: string, label: string): void {
	if (ids.has(id)) {
		fail('duplicate-id', path, `Duplicate ${label} ID: ${id}.`);
	}
	ids.add(id);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function fail(
	code: InventoryBackupValidationCode,
	path: string,
	message: string,
): never {
	throw new InventoryBackupValidationError(code, path, message);
}
