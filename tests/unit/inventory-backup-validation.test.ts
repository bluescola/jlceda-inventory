import { describe, expect, it } from 'vitest';
import {
	InventoryBackupValidationError,
	MAX_INVENTORY_BACKUP_CATEGORIES,
	MAX_INVENTORY_BACKUP_ITEMS,
	MAX_INVENTORY_BACKUP_ORDER_IMPORT_BATCHES,
	MAX_INVENTORY_BACKUP_PROJECT_DEMAND_LINES,
	MAX_INVENTORY_BACKUP_PROJECT_SNAPSHOTS,
	MAX_INVENTORY_BACKUP_PURCHASE_RECORDS,
	MAX_INVENTORY_BACKUP_STOCK_OUT_BATCHES,
	MAX_INVENTORY_BACKUP_SUBSTITUTE_LINKS,
	MAX_INVENTORY_BACKUP_TEXT_LENGTH,
	MAX_INVENTORY_BACKUP_TRANSACTIONS,
	validateInventoryBackup,
} from '../../src/features/inventory/application/validate-inventory-backup';
import { INVENTORY_SCHEMA_VERSION } from '../../src/features/inventory/domain/inventory-document';

const TIMESTAMP = '2026-07-22T08:30:00.000Z';

describe('inventory backup validation', () => {
	it.each([1, 2, 3, 4, 5, 6, 7, 8] as const)('accepts and migrates schema v%d', (schemaVersion) => {
		const source = createDocument(schemaVersion);
		const result = validateInventoryBackup(JSON.stringify(source));

		expect(result.document.schemaVersion).toBe(INVENTORY_SCHEMA_VERSION);
		expect(result.metadata).toEqual({
			sourceSchemaVersion: schemaVersion,
			itemCount: 1,
			categoryCount: schemaVersion >= 3 ? 1 : 0,
			orderImportBatchCount: schemaVersion >= 4 ? 1 : 0,
			transactionCount: 0,
			stockOutBatchCount: 0,
			projectSnapshotCount: 0,
			purchaseRecordCount: 0,
			substituteLinkCount: 0,
			updatedAt: TIMESTAMP,
			revision: 4,
		});
	});

	it('returns a detached current document and preserves legacy text sanitization', () => {
		const source = createDocument(2);
		(source.items[0] as Record<string, unknown>).identity = {
			name: ' Resistor ',
			package: '0603\u200B',
		};

		const result = validateInventoryBackup(source);

		expect(result.document.items[0].identity).toMatchObject({ name: 'Resistor', package: '0603' });
		expect(result.document).not.toBe(source);
	});

	it('distinguishes malformed JSON, oversized text, and future schemas', () => {
		expectValidation('{', 'invalid-json', '');
		expectValidation(' '.repeat(MAX_INVENTORY_BACKUP_TEXT_LENGTH + 1), 'text-too-large', '');
		expectValidation({ ...createDocument(8), schemaVersion: 10 }, 'future-schema-version', 'schemaVersion');
		expectValidation({ ...createDocument(6), schemaVersion: 0 }, 'invalid-schema-version', 'schemaVersion');
	});

	it('enforces collection and aggregate limits before entry validation', () => {
		expectValidation(
			{ ...createDocument(6), items: Array.from({ length: MAX_INVENTORY_BACKUP_ITEMS + 1 }, () => ({})) },
			'items-limit-exceeded',
			'items',
		);
		expectValidation(
			{ ...createDocument(6), categories: Array.from({ length: MAX_INVENTORY_BACKUP_CATEGORIES + 1 }, () => ({})) },
			'categories-limit-exceeded',
			'categories',
		);
		expectValidation(
			{
				...createDocument(6),
				orderImportBatches: Array.from({ length: MAX_INVENTORY_BACKUP_ORDER_IMPORT_BATCHES + 1 }, () => ({})),
			},
			'order-import-batches-limit-exceeded',
			'orderImportBatches',
		);
		expectValidation(
			{ ...createDocument(7), transactions: Array.from({ length: MAX_INVENTORY_BACKUP_TRANSACTIONS + 1 }, () => ({})) },
			'transactions-limit-exceeded',
			'transactions',
		);
		expectValidation(
			{ ...createDocument(7), stockOutBatches: Array.from({ length: MAX_INVENTORY_BACKUP_STOCK_OUT_BATCHES + 1 }, () => ({})) },
			'stock-out-batches-limit-exceeded',
			'stockOutBatches',
		);
		expectValidation(
			{ ...createDocument(8), projectSnapshots: Array.from({ length: MAX_INVENTORY_BACKUP_PROJECT_SNAPSHOTS + 1 }, () => ({})) },
			'project-snapshots-limit-exceeded',
			'projectSnapshots',
		);
		expectValidation(
			{ ...createDocument(8), purchaseRecords: Array.from({ length: MAX_INVENTORY_BACKUP_PURCHASE_RECORDS + 1 }, () => ({})) },
			'purchase-records-limit-exceeded',
			'purchaseRecords',
		);
		const excessiveDemands = createDocument(8);
		excessiveDemands.projectSnapshots = [{
			...createProjectSnapshot('snapshot-limit'),
			demands: Array.from({ length: MAX_INVENTORY_BACKUP_PROJECT_DEMAND_LINES + 1 }, () => ({})),
		}];
		expectValidation(
			excessiveDemands,
			'project-demand-lines-limit-exceeded',
			'projectSnapshots',
		);
		expectValidation(
			{ ...createDocument(9), substituteLinks: Array.from({ length: MAX_INVENTORY_BACKUP_SUBSTITUTE_LINKS + 1 }, () => ({})) },
			'substitute-links-limit-exceeded',
			'substituteLinks',
		);
	});

	it('accepts canonical v9 substitute links and reports their count', () => {
		const source = createDocument(9);
		source.items.push({ ...createItem('category-1'), id: 'item-2', identity: { name: 'Alternate' } });
		source.substituteLinks = [createSubstituteLink('link-1', 'item-1', 'item-2')];

		const validated = validateInventoryBackup(source);

		expect(validated.metadata).toMatchObject({ sourceSchemaVersion: 9, substituteLinkCount: 1 });
		expect(validated.document.substituteLinks).toEqual([
			expect.objectContaining({ id: 'link-1', itemIdA: 'item-1', itemIdB: 'item-2', note: 'confirmed' }),
		]);
	});

	it('rejects non-canonical, duplicate, and dangling v9 substitute links', () => {
		const source = createDocument(9);
		source.items.push({ ...createItem('category-1'), id: 'item-2', identity: { name: 'Alternate' } });

		const nonCanonical = structuredClone(source);
		nonCanonical.substituteLinks = [createSubstituteLink('link-1', 'item-2', 'item-1')];
		expectValidation(nonCanonical, 'invalid-field', 'substituteLinks[0]');

		const duplicate = structuredClone(source);
		duplicate.substituteLinks = [
			createSubstituteLink('link-1', 'item-1', 'item-2'),
			createSubstituteLink('link-2', 'item-1', 'item-2'),
		];
		expectValidation(duplicate, 'duplicate-substitute-pair', 'substituteLinks[1]');

		const dangling = structuredClone(source);
		dangling.substituteLinks = [createSubstituteLink('link-1', 'item-1', 'missing')];
		expectValidation(dangling, 'dangling-substitute-reference', 'substituteLinks[0].itemIdB');
	});

	it('accepts and reports complete v8 project planning data', () => {
		const source = createDocument(8);
		source.projectSnapshots = [createProjectSnapshot('snapshot-1')];
		source.purchaseRecords = [createPurchaseRecord('purchase-1', ['snapshot-1'])];

		const validated = validateInventoryBackup(source);

		expect(validated.metadata).toMatchObject({
			sourceSchemaVersion: 8,
			projectSnapshotCount: 1,
			purchaseRecordCount: 1,
		});
		expect(validated.document.projectSnapshots[0]).toMatchObject({
			id: 'snapshot-1',
			label: 'Controller board',
		});
		expect(validated.document.purchaseRecords[0]).toMatchObject({
			id: 'purchase-1',
			lcscPartNumber: 'C1',
			currency: 'CNY',
			projectSnapshotIds: ['snapshot-1'],
		});
	});

	it('rejects duplicate and conflicting v8 project planning records', () => {
		const duplicateSnapshots = createDocument(8);
		duplicateSnapshots.projectSnapshots = [
			createProjectSnapshot('snapshot-1'),
			{ ...createProjectSnapshot('snapshot-1'), documentUuid: 'pcb-2' },
		];
		expectValidation(duplicateSnapshots, 'duplicate-id', 'projectSnapshots[1].id');

		const duplicateDocuments = createDocument(8);
		duplicateDocuments.projectSnapshots = [
			createProjectSnapshot('snapshot-1'),
			createProjectSnapshot('snapshot-2'),
		];
		expectValidation(
			duplicateDocuments,
			'invalid-project-planning',
			'projectSnapshots[1].documentUuid',
		);

		const duplicatePurchases = createDocument(8);
		duplicatePurchases.purchaseRecords = [
			createPurchaseRecord('purchase-1'),
			createPurchaseRecord('purchase-1'),
		];
		expectValidation(duplicatePurchases, 'duplicate-id', 'purchaseRecords[1].id');
	});

	it('rejects invalid v8 project planning and inventory metadata fields', () => {
		const invalidSnapshot = createDocument(8);
		invalidSnapshot.projectSnapshots = [{ ...createProjectSnapshot('snapshot-1'), boardQuantity: 0 }];
		expectValidation(invalidSnapshot, 'invalid-field', 'projectSnapshots[0]');

		const invalidPurchase = createDocument(8);
		invalidPurchase.purchaseRecords = [{ ...createPurchaseRecord('purchase-1'), currency: 'CN' }];
		expectValidation(invalidPurchase, 'invalid-field', 'purchaseRecords[0]');

		const invalidDatasheet = createDocument(8);
		invalidDatasheet.items[0].datasheetUrl = 'file:///private/data.pdf';
		expectValidation(invalidDatasheet, 'invalid-field', 'items[0].datasheetUrl');

		const invalidLocation = createDocument(8);
		invalidLocation.items[0].structuredLocation = { cabinet: 1 };
		expectValidation(invalidLocation, 'invalid-field', 'items[0].structuredLocation');
	});

	it('rejects duplicate inventory, category, and batch IDs', () => {
		const duplicateItems = createDocument(6);
		duplicateItems.items.push({ ...duplicateItems.items[0] });
		expectValidation(duplicateItems, 'duplicate-id', 'items[1].id');

		const duplicateCategories = createDocument(6);
		duplicateCategories.categories.push({ ...duplicateCategories.categories[0] });
		expectValidation(duplicateCategories, 'duplicate-id', 'categories[1].id');

		const duplicateBatches = createDocument(6);
		duplicateBatches.orderImportBatches.push({ ...duplicateBatches.orderImportBatches[0] });
		expectValidation(duplicateBatches, 'duplicate-id', 'orderImportBatches[1].id');
	});

	it('rejects invalid document and entity revisions or timestamps', () => {
		expectValidation({ ...createDocument(6), revision: -1 }, 'invalid-field', 'revision');
		expectValidation({ ...createDocument(6), updatedAt: 'not-a-date' }, 'invalid-field', 'updatedAt');

		const invalidItemRevision = createDocument(6);
		invalidItemRevision.items[0].revision = 0;
		expectValidation(invalidItemRevision, 'invalid-field', 'items[0].revision');

		const invalidCategoryTime = createDocument(6);
		invalidCategoryTime.categories[0].createdAt = '2026-07-23T00:00:00.000Z';
		expectValidation(invalidCategoryTime, 'invalid-field', 'categories[0].updatedAt');
	});

	it('rejects missing identity and incoherent quantity, precision, or state', () => {
		const missingName = createDocument(6);
		missingName.items[0].identity = { name: '\u200B' };
		expectValidation(missingName, 'invalid-field', 'items[0].identity.name');

		const unknownWithQuantity = createDocument(6);
		unknownWithQuantity.items[0].precision = 'unknown';
		expectValidation(unknownWithQuantity, 'invalid-field', 'items[0].quantity');

		const estimatedWithoutQuantity = createDocument(6);
		estimatedWithoutQuantity.items[0].precision = 'estimated';
		estimatedWithoutQuantity.items[0].quantity = null;
		expectValidation(estimatedWithoutQuantity, 'invalid-field', 'items[0].quantity');

		const zeroInStock = createDocument(6);
		zeroInStock.items[0].quantity = 0;
		expectValidation(zeroInStock, 'invalid-field', 'items[0].state');

		const positiveDepleted = createDocument(6);
		positiveDepleted.items[0].state = 'depleted';
		expectValidation(positiveDepleted, 'invalid-field', 'items[0].state');
	});

	it('rejects dangling item and parent category references', () => {
		const danglingItem = createDocument(6);
		danglingItem.items[0].categoryId = 'missing';
		expectValidation(danglingItem, 'dangling-category-reference', 'items[0].categoryId');

		const danglingParent = createDocument(6);
		danglingParent.categories[0].parentId = 'missing';
		expectValidation(danglingParent, 'dangling-category-reference', 'categories[0].parentId');
	});

	it('rejects self-referencing and deeper-than-supported category hierarchies', () => {
		const selfReference = createDocument(6);
		selfReference.categories[0].parentId = 'category-1';
		expectValidation(selfReference, 'invalid-category-hierarchy', 'categories[0].parentId');

		const deepHierarchy = createDocument(6);
		deepHierarchy.categories.push(
			createCategory('category-2', 'category-1'),
			createCategory('category-3', 'category-2'),
		);
		expectValidation(deepHierarchy, 'invalid-category-hierarchy', 'categories[2].parentId');
	});

	it('validates order import batches before migration', () => {
		const invalidFingerprint = createDocument(6);
		invalidFingerprint.orderImportBatches[0].files[0].fingerprint = 'invalid';
		expectValidation(
			invalidFingerprint,
			'invalid-field',
			'orderImportBatches[0].files[0].fingerprint',
		);

		const invalidDuplicate = createDocument(6);
		invalidDuplicate.orderImportBatches[0].files[0].status = 'duplicate';
		expectValidation(
			invalidDuplicate,
			'invalid-field',
			'orderImportBatches[0].files[0].duplicateReason',
		);
	});

	it('accepts a complete v7 audit chain and reports ledger counts', () => {
		const source = createDocument(7);
		source.items[0].quantity = 18;
		source.transactions = [{
			id: 'transaction-1',
			itemId: 'item-1',
			kind: 'bom-stock-out',
			source: 'bom',
			delta: -2,
			beforeQuantity: 20,
			afterQuantity: 18,
			createdAt: TIMESTAMP,
			identity: { name: '10k resistor', lcscPartNumber: 'C25804' },
			batchId: 'stock-out-1',
		}];
		source.stockOutBatches = [{
			id: 'stock-out-1',
			fingerprint: 'b'.repeat(64),
			source: 'bom',
			sourceFingerprint: 'c'.repeat(64),
			createdAt: TIMESTAMP,
			lines: [{ itemId: 'item-1', quantity: 2, transactionId: 'transaction-1' }],
		}];

		const validated = validateInventoryBackup(source);

		expect(validated.metadata).toMatchObject({
			sourceSchemaVersion: 7,
			transactionCount: 1,
			stockOutBatchCount: 1,
		});
		expect(validated.document.transactions).toHaveLength(1);
		expect(validated.document.stockOutBatches).toHaveLength(1);
	});

	it('rejects duplicate, dangling, and inconsistent v7 audit links', () => {
		const missingActiveItem = createDocumentWithLedger();
		missingActiveItem.items = [];
		expectValidation(
			missingActiveItem,
			'dangling-stock-out-item-reference',
			'stockOutBatches[0].lines[0].itemId',
		);

		const dangling = createDocumentWithLedger();
		dangling.stockOutBatches[0].lines[0].transactionId = 'missing';
		expectValidation(
			dangling,
			'dangling-transaction-reference',
			'stockOutBatches[0].lines[0].transactionId',
		);

		const inconsistent = createDocumentWithLedger();
		inconsistent.transactions[0].delta = -3;
		expectValidation(inconsistent, 'invalid-field', 'transactions[0]');

		const duplicate = createDocumentWithLedger();
		duplicate.transactions.push({ ...duplicate.transactions[0] });
		expectValidation(duplicate, 'duplicate-id', 'transactions[1].id');
	});
});

function createDocument(schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): Record<string, any> {
	const document: Record<string, any> = {
		schemaVersion,
		revision: 4,
		updatedAt: TIMESTAMP,
		items: [createItem(schemaVersion >= 3 ? 'category-1' : undefined)],
	};
	if (schemaVersion >= 3) {
		document.categories = [createCategory('category-1')];
	}
	if (schemaVersion >= 4) {
		document.orderImportBatches = [createOrderImportBatch()];
	}
	if (schemaVersion >= 7) {
		document.transactions = [];
		document.stockOutBatches = [];
	}
	if (schemaVersion >= 8) {
		document.projectSnapshots = [];
		document.purchaseRecords = [];
	}
	if (schemaVersion >= 9) {
		document.substituteLinks = [];
	}
	return document;
}

function createDocumentWithLedger(): Record<string, any> {
	const document = createDocument(7);
	document.items[0].quantity = 18;
	document.transactions = [{
		id: 'transaction-1',
		itemId: 'item-1',
		kind: 'bom-stock-out',
		source: 'bom',
		delta: -2,
		beforeQuantity: 20,
		afterQuantity: 18,
		createdAt: TIMESTAMP,
		identity: { name: '10k resistor', lcscPartNumber: 'C25804' },
		batchId: 'stock-out-1',
	}];
	document.stockOutBatches = [{
		id: 'stock-out-1',
		fingerprint: 'b'.repeat(64),
		source: 'bom',
		sourceFingerprint: 'c'.repeat(64),
		createdAt: TIMESTAMP,
		lines: [{ itemId: 'item-1', quantity: 2, transactionId: 'transaction-1' }],
	}];
	return document;
}

function createItem(categoryId?: string): Record<string, any> {
	return {
		id: 'item-1',
		categoryId,
		identity: { name: '10k resistor', lcscPartNumber: 'C25804' },
		edaModelStatus: 'unchecked',
		quantity: 20,
		precision: 'exact',
		state: 'in-stock',
		source: 'manual',
		createdAt: TIMESTAMP,
		updatedAt: TIMESTAMP,
		revision: 1,
	};
}

function createCategory(id: string, parentId?: string): Record<string, any> {
	return {
		id,
		name: id,
		parentId,
		sortOrder: 0,
		createdAt: TIMESTAMP,
		updatedAt: TIMESTAMP,
		revision: 1,
	};
}

function createOrderImportBatch(): Record<string, any> {
	return {
		id: 'batch-1',
		importedAt: TIMESTAMP,
		strategy: 'add',
		files: [{
			fileName: 'order.xls',
			orderNumber: 'SO1',
			fingerprint: 'a'.repeat(64),
			rowCount: 1,
			totalQuantity: 20,
			status: 'imported',
			result: { added: 1, merged: 0, skipped: 0 },
		}],
		result: { added: 1, merged: 0, skipped: 0 },
	};
}

function createProjectSnapshot(id: string): Record<string, any> {
	return {
		id,
		projectUuid: 'project-1',
		documentUuid: 'pcb-1',
		documentKind: 'pcb',
		label: ' Controller board ',
		boardQuantity: 2,
		demands: [{
			key: 'lcsc:c1',
			identity: { name: 'Resistor', lcscPartNumber: '1' },
			designators: ['R1'],
			unitQuantity: 1,
		}],
		sourceFingerprint: 'd'.repeat(64),
		capturedAt: TIMESTAMP,
		revision: 1,
	};
}

function createPurchaseRecord(id: string, projectSnapshotIds: string[] = []): Record<string, any> {
	return {
		id,
		lcscPartNumber: '1',
		name: 'Resistor',
		quantity: 4,
		unitPriceMinor: 25,
		currency: 'cny',
		purchasedAt: '2026-07-22',
		projectSnapshotIds,
		createdAt: TIMESTAMP,
		revision: 1,
	};
}

function createSubstituteLink(id: string, itemIdA: string, itemIdB: string): Record<string, any> {
	return {
		id,
		itemIdA,
		itemIdB,
		note: 'confirmed',
		createdAt: TIMESTAMP,
		updatedAt: TIMESTAMP,
		revision: 1,
	};
}

function expectValidation(
	input: unknown,
	code: InventoryBackupValidationError['code'],
	path: string,
): void {
	let captured: unknown;
	try {
		validateInventoryBackup(input);
	}
	catch (error) {
		captured = error;
	}
	expect(captured).toBeInstanceOf(InventoryBackupValidationError);
	expect(captured).toMatchObject({ code, path });
}
