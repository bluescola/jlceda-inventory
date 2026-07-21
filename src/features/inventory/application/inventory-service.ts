import type { InventoryCategory, NewInventoryCategory } from '../domain/inventory-category';
import type { InventoryDocument } from '../domain/inventory-document';
import type { EdaModelReference, EdaModelStatus, InventoryItem, MarketplaceReference, NewInventoryItem, PartIdentity, QuantityPrecision } from '../domain/inventory-item';
import type {
	OrderImportBatchInput,
	OrderImportBatchPreview,
	OrderImportBatchRecord,
	OrderImportBatchResult,
	OrderImportDuplicateReference,
	OrderImportFileInput,
	OrderImportFileRecord,
	OrderImportResultSummary,
	OrderImportStrategy,
} from '../domain/order-import-batch';
import type { InventoryRepository } from '../ports/inventory-repository';
import { normalizeInventoryCategory, normalizeInventoryCategoryName } from '../domain/inventory-category';
import { cloneInventoryDocument } from '../domain/inventory-document';
import { inventoryIdentityKey, normalizeInventoryItem, normalizeQuantity, sanitizeEdaModelReferenceText } from '../domain/inventory-item';
import { sanitizeOrderImportFileSummary } from '../domain/order-import-batch';

export type DuplicateStrategy = OrderImportStrategy;

export interface ImportInventoryResult {
	added: number;
	merged: number;
	skipped: number;
}

export interface InventoryEditInput {
	identity: PartIdentity;
	marketplaceReference?: MarketplaceReference;
	edaModelReference?: EdaModelReference;
	edaModelStatus: EdaModelStatus;
	quantity: number;
	precision: Exclude<QuantityPrecision, 'unknown'>;
	location?: string;
	note?: string;
}

export interface InventoryMergeDuplicate {
	id: string;
	expectedRevision: number;
}

export interface InventoryCategoryOrderEntry {
	id: string;
	expectedRevision: number;
}

export interface InventoryItemCategoryMoveEntry {
	id: string;
	expectedRevision: number;
}

export interface DeleteInventoryCategoryResult {
	deletedCategoryIds: string[];
	uncategorizedItemIds: string[];
}

export type InventoryEditResult
	= | { status: 'updated'; item: InventoryItem }
		| { status: 'duplicate'; candidate: InventoryItem; existing: InventoryItem }
		| { status: 'merged'; item: InventoryItem };

export type InventoryCreateResult
	= | { status: 'created'; item: InventoryItem }
		| { status: 'duplicate'; candidate: InventoryItem; existing: InventoryItem }
		| { status: 'merged'; item: InventoryItem };

export class InventoryRevisionConflictError extends Error {
	public constructor(
		public readonly itemId: string,
		public readonly expectedRevision: number,
		public readonly actualRevision?: number,
	) {
		super(`Inventory item revision conflict for ${itemId}: expected ${expectedRevision}, actual ${actualRevision ?? 'missing'}.`);
		this.name = 'InventoryRevisionConflictError';
	}
}

export class InventoryCategoryRevisionConflictError extends Error {
	public constructor(
		public readonly categoryId: string,
		public readonly expectedRevision: number,
		public readonly actualRevision?: number,
	) {
		super(`Inventory category revision conflict for ${categoryId}: expected ${expectedRevision}, actual ${actualRevision ?? 'missing'}.`);
		this.name = 'InventoryCategoryRevisionConflictError';
	}
}

export class InventoryService {
	public constructor(
		private readonly repository: InventoryRepository,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly createId: () => string = () => crypto.randomUUID(),
	) {}

	public async list(includeDepleted = true): Promise<InventoryItem[]> {
		const document = await this.repository.load();
		return document.items
			.filter(item => includeDepleted || item.state === 'in-stock')
			.toSorted(compareInventoryItems);
	}

	public async get(id: string): Promise<InventoryItem | undefined> {
		const document = await this.repository.load();
		return document.items.find(item => item.id === id);
	}

	public async listCategories(): Promise<InventoryCategory[]> {
		const document = await this.repository.load();
		return orderInventoryCategories(document.categories);
	}

	public async createCategory(input: NewInventoryCategory): Promise<InventoryCategory> {
		const document = await this.repository.load();
		assertValidCategoryParent(document, input.parentId);
		const timestamp = this.now();
		const category = normalizeInventoryCategory(
			input,
			timestamp,
			this.createId(),
			nextCategorySortOrder(document.categories, input.parentId),
		);
		assertUniqueSiblingCategoryName(document.categories, category.name, category.parentId);
		document.categories.push(category);
		await this.persist(document, timestamp);
		return category;
	}

	public async renameCategory(id: string, expectedRevision: number, name: string): Promise<InventoryCategory> {
		const document = await this.repository.load();
		const categoryIndex = document.categories.findIndex(category => category.id === id);
		const current = document.categories[categoryIndex];
		assertCategoryRevision(current, id, expectedRevision);
		const normalizedName = normalizeInventoryCategoryName(name);
		assertUniqueSiblingCategoryName(document.categories, normalizedName, current.parentId, current.id);
		if (normalizedName === current.name) {
			return current;
		}
		const timestamp = this.now();
		const renamed = {
			...current,
			name: normalizedName,
			updatedAt: timestamp,
			revision: current.revision + 1,
		};
		document.categories[categoryIndex] = renamed;
		await this.persist(document, timestamp);
		return renamed;
	}

	public async reorderCategories(parentId: string | undefined, order: InventoryCategoryOrderEntry[]): Promise<InventoryCategory[]> {
		const document = await this.repository.load();
		assertValidCategoryParent(document, parentId);
		const siblings = document.categories.filter(category => category.parentId === parentId);
		assertCompleteCategoryOrder(siblings, order);
		for (const entry of order) {
			assertCategoryRevision(document.categories.find(category => category.id === entry.id), entry.id, entry.expectedRevision);
		}

		const timestamp = this.now();
		let changed = false;
		const reordered = order.map((entry, sortOrder) => {
			const categoryIndex = document.categories.findIndex(category => category.id === entry.id);
			const current = document.categories[categoryIndex];
			if (current.sortOrder === sortOrder) {
				return current;
			}
			changed = true;
			const updated = {
				...current,
				sortOrder,
				updatedAt: timestamp,
				revision: current.revision + 1,
			};
			document.categories[categoryIndex] = updated;
			return updated;
		});
		if (changed) {
			await this.persist(document, timestamp);
		}
		return reordered;
	}

	public async deleteCategory(id: string, expectedRevision: number): Promise<DeleteInventoryCategoryResult> {
		const document = await this.repository.load();
		const current = document.categories.find(category => category.id === id);
		assertCategoryRevision(current, id, expectedRevision);
		const deletedCategoryIds = collectCategoryBranchIds(document.categories, id);
		const deletedIdSet = new Set(deletedCategoryIds);
		const timestamp = this.now();
		const uncategorizedItemIds: string[] = [];
		document.categories = document.categories.filter(category => !deletedIdSet.has(category.id));
		document.items = document.items.map((item) => {
			if (!item.categoryId || !deletedIdSet.has(item.categoryId)) {
				return item;
			}
			uncategorizedItemIds.push(item.id);
			return removeItemCategory(item, timestamp);
		});
		await this.persist(document, timestamp);
		return { deletedCategoryIds, uncategorizedItemIds };
	}

	public async moveItemsToCategory(
		items: InventoryItemCategoryMoveEntry[],
		categoryId?: string,
	): Promise<InventoryItem[]> {
		const document = await this.repository.load();
		if (categoryId !== undefined && !document.categories.some(category => category.id === categoryId)) {
			throw new Error(`Inventory category not found: ${categoryId}`);
		}
		assertUniqueIds(items.map(item => item.id), 'Inventory item category move contains duplicate item IDs.');
		const currentItems = items.map((entry) => {
			const current = document.items.find(item => item.id === entry.id);
			assertRevision(current, entry.id, entry.expectedRevision);
			return current;
		});

		const timestamp = this.now();
		let changed = false;
		const movedItems = currentItems.map((current) => {
			if (current.categoryId === categoryId) {
				return current;
			}
			changed = true;
			const moved = categoryId === undefined
				? removeItemCategory(current, timestamp)
				: {
						...current,
						categoryId,
						updatedAt: timestamp,
						revision: current.revision + 1,
					};
			document.items[document.items.findIndex(item => item.id === current.id)] = moved;
			return moved;
		});
		if (changed) {
			await this.persist(document, timestamp);
		}
		return movedItems;
	}

	public async add(input: NewInventoryItem, strategy: DuplicateStrategy = 'add'): Promise<InventoryItem> {
		const document = await this.repository.load();
		assertExistingCategory(document, input.categoryId);
		const timestamp = this.now();
		const candidate = normalizeInventoryItem(input, timestamp, this.createId());
		const existingIndex = document.items.findIndex(item => inventoryIdentityKey(item.identity) === inventoryIdentityKey(candidate.identity));

		if (existingIndex < 0) {
			document.items.push(candidate);
			await this.persist(document, timestamp);
			return candidate;
		}

		if (strategy === 'skip') {
			return document.items[existingIndex];
		}

		const merged = mergeInventoryItems(document.items[existingIndex], candidate, strategy, timestamp);
		document.items[existingIndex] = merged;
		await this.persist(document, timestamp);
		return merged;
	}

	public async createItem(
		input: NewInventoryItem,
		mergeDuplicate?: InventoryMergeDuplicate,
	): Promise<InventoryCreateResult> {
		const document = await this.repository.load();
		assertExistingCategory(document, input.categoryId);
		const timestamp = this.now();
		const candidate = normalizeInventoryItem(input, timestamp, this.createId());
		const duplicateIndex = document.items.findIndex(item => inventoryIdentityKey(item.identity) === inventoryIdentityKey(candidate.identity));

		if (!mergeDuplicate) {
			if (duplicateIndex >= 0) {
				return { status: 'duplicate', candidate, existing: document.items[duplicateIndex] };
			}
			document.items.push(candidate);
			await this.persist(document, timestamp);
			return { status: 'created', item: candidate };
		}

		const mergeTargetIndex = document.items.findIndex(item => item.id === mergeDuplicate.id);
		const mergeTarget = document.items[mergeTargetIndex];
		assertRevision(mergeTarget, mergeDuplicate.id, mergeDuplicate.expectedRevision);
		if (duplicateIndex !== mergeTargetIndex) {
			throw new Error('The confirmed duplicate target no longer matches the pending inventory item.');
		}
		const merged = mergeInventoryItems(mergeTarget, candidate, 'add', timestamp);
		document.items[mergeTargetIndex] = merged;
		await this.persist(document, timestamp);
		return { status: 'merged', item: merged };
	}

	public async updateQuantity(id: string, quantity: number | null, precision: QuantityPrecision): Promise<InventoryItem> {
		return this.update(id, (item, timestamp) => {
			const normalizedQuantity = normalizeQuantity(quantity, precision);
			return {
				...item,
				quantity: normalizedQuantity,
				precision,
				state: normalizedQuantity === 0 ? 'depleted' : 'in-stock',
				updatedAt: timestamp,
				revision: item.revision + 1,
			};
		});
	}

	public async updateItem(
		id: string,
		expectedRevision: number,
		input: InventoryEditInput,
		mergeDuplicate?: InventoryMergeDuplicate,
	): Promise<InventoryEditResult> {
		const document = await this.repository.load();
		const itemIndex = document.items.findIndex(item => item.id === id);
		const current = document.items[itemIndex];
		assertRevision(current, id, expectedRevision);

		let mergeTargetIndex = -1;
		if (mergeDuplicate) {
			if (mergeDuplicate.id === id) {
				throw new Error('Duplicate merge target must be a different inventory item.');
			}
			mergeTargetIndex = document.items.findIndex(item => item.id === mergeDuplicate.id);
			assertRevision(document.items[mergeTargetIndex], mergeDuplicate.id, mergeDuplicate.expectedRevision);
		}

		const timestamp = this.now();
		const precision = input.quantity === 0 ? 'exact' : input.precision;
		const normalized = normalizeInventoryItem({
			categoryId: current.categoryId,
			identity: input.identity,
			marketplaceReference: input.marketplaceReference,
			edaModelReference: input.edaModelReference,
			edaModelStatus: input.edaModelStatus,
			quantity: input.quantity,
			precision,
			state: input.quantity === 0 ? 'depleted' : 'in-stock',
			location: input.location,
			note: input.note,
			source: current.source,
		}, timestamp, current.id);
		const candidate: InventoryItem = {
			...normalized,
			createdAt: current.createdAt,
			revision: current.revision + 1,
		};

		const identityKey = inventoryIdentityKey(candidate.identity);
		const duplicateIndex = document.items.findIndex((item, index) => index !== itemIndex && inventoryIdentityKey(item.identity) === identityKey);
		if (duplicateIndex >= 0) {
			const existing = document.items[duplicateIndex];
			if (!mergeDuplicate || mergeTargetIndex !== duplicateIndex) {
				return { status: 'duplicate', candidate, existing };
			}

			const merged = mergeInventoryItems(existing, candidate, 'add', timestamp);
			document.items[duplicateIndex] = merged;
			document.items.splice(itemIndex, 1);
			await this.persist(document, timestamp);
			return { status: 'merged', item: merged };
		}

		document.items[itemIndex] = candidate;
		await this.persist(document, timestamp);
		return { status: 'updated', item: candidate };
	}

	public async markDepleted(id: string): Promise<InventoryItem> {
		return this.updateQuantity(id, 0, 'exact');
	}

	public attachEdaModel(id: string, reference: EdaModelReference): Promise<InventoryItem>;
	public attachEdaModel(id: string, expectedRevision: number, reference: EdaModelReference): Promise<InventoryItem>;
	public async attachEdaModel(
		id: string,
		expectedRevisionOrReference: number | EdaModelReference,
		reference?: EdaModelReference,
	): Promise<InventoryItem> {
		const expectedRevision = typeof expectedRevisionOrReference === 'number' ? expectedRevisionOrReference : undefined;
		const nextReference = typeof expectedRevisionOrReference === 'number' ? reference : expectedRevisionOrReference;
		if (!nextReference) {
			throw new TypeError('EDA model reference is required.');
		}
		const transform = (item: InventoryItem, timestamp: string): InventoryItem => ({
			...item,
			edaModelReference: sanitizeEdaModelReferenceText(nextReference),
			edaModelStatus: 'available',
			updatedAt: timestamp,
			revision: item.revision + 1,
		});
		return expectedRevision === undefined
			? this.update(id, transform)
			: this.updateWithRevision(id, expectedRevision, transform);
	}

	public async remove(id: string): Promise<boolean> {
		const document = await this.repository.load();
		const nextItems = document.items.filter(item => item.id !== id);
		if (nextItems.length === document.items.length) {
			return false;
		}
		document.items = nextItems;
		await this.persist(document, this.now());
		return true;
	}

	public async import(items: NewInventoryItem[], strategy: DuplicateStrategy): Promise<ImportInventoryResult> {
		const document = await this.repository.load();
		const timestamp = this.now();
		const result = applyImportedItems(document, items, strategy, timestamp, this.createId);

		if (result.added > 0 || result.merged > 0) {
			await this.persist(document, timestamp);
		}
		return result;
	}

	public async previewOrderImportBatch(
		input: OrderImportBatchInput,
		strategy: DuplicateStrategy,
	): Promise<OrderImportBatchPreview> {
		const document = cloneInventoryDocument(await this.repository.load());
		const files = normalizeOrderImportFiles(input);
		let previewId = 0;
		const evaluation = evaluateOrderImportBatch(
			document,
			files,
			strategy,
			document.updatedAt,
			() => `order-import-preview-${++previewId}`,
		);
		return {
			files: evaluation.files.map(file => ({
				...file,
				status: file.status === 'imported' ? 'ready' : 'duplicate',
			})),
			result: evaluation.result,
		};
	}

	public async importOrderBatch(
		input: OrderImportBatchInput,
		strategy: DuplicateStrategy,
	): Promise<OrderImportBatchResult> {
		const document = await this.repository.load();
		const files = normalizeOrderImportFiles(input);
		const timestamp = this.now();
		const batchId = this.createId();
		const evaluation = evaluateOrderImportBatch(document, files, strategy, timestamp, this.createId);
		const record: OrderImportBatchRecord = {
			id: batchId,
			importedAt: timestamp,
			strategy,
			files: evaluation.files,
			result: evaluation.result,
		};
		document.orderImportBatches.push(record);
		await this.persist(document, timestamp);
		return {
			batchId,
			files: record.files,
			result: record.result,
			record,
		};
	}

	public async exportDocument(): Promise<InventoryDocument> {
		return this.repository.load();
	}

	private async update(id: string, transform: (item: InventoryItem, timestamp: string) => InventoryItem): Promise<InventoryItem> {
		const document = await this.repository.load();
		const index = document.items.findIndex(item => item.id === id);
		if (index < 0) {
			throw new Error(`Inventory item not found: ${id}`);
		}
		const timestamp = this.now();
		const updated = transform(document.items[index], timestamp);
		document.items[index] = updated;
		await this.persist(document, timestamp);
		return updated;
	}

	private async updateWithRevision(
		id: string,
		expectedRevision: number,
		transform: (item: InventoryItem, timestamp: string) => InventoryItem,
	): Promise<InventoryItem> {
		const document = await this.repository.load();
		const index = document.items.findIndex(item => item.id === id);
		const current = document.items[index];
		assertRevision(current, id, expectedRevision);
		const timestamp = this.now();
		const updated = transform(current, timestamp);
		document.items[index] = updated;
		await this.persist(document, timestamp);
		return updated;
	}

	private async persist(document: InventoryDocument, timestamp: string): Promise<void> {
		document.revision += 1;
		document.updatedAt = timestamp;
		await this.repository.save(document);
	}
}

interface NormalizedOrderImportFile extends OrderImportFileInput {
	fileName: string;
	orderNumber?: string;
	fingerprint: string;
}

interface EvaluatedOrderImportBatch {
	files: OrderImportFileRecord[];
	result: OrderImportResultSummary;
}

interface ImportedFileHistory {
	batchId: string;
	importedAt: string;
}

function normalizeOrderImportFiles(input: OrderImportBatchInput): NormalizedOrderImportFile[] {
	if (!Array.isArray(input.files) || input.files.length === 0) {
		throw new Error('Order import batch must contain at least one file.');
	}
	return input.files.map((file) => {
		if (!Array.isArray(file.items)) {
			throw new TypeError('Order import file items must be an array.');
		}
		return {
			...file,
			...sanitizeOrderImportFileSummary(file),
			items: [...file.items],
		};
	});
}

function evaluateOrderImportBatch(
	document: InventoryDocument,
	files: NormalizedOrderImportFile[],
	strategy: DuplicateStrategy,
	timestamp: string,
	createId: () => string,
): EvaluatedOrderImportBatch {
	const historicalFingerprints = new Map<string, ImportedFileHistory>();
	const historicalOrderNumbers = new Map<string, ImportedFileHistory>();
	for (const batch of document.orderImportBatches) {
		for (const file of batch.files) {
			if (file.status !== 'imported') {
				continue;
			}
			const history = { batchId: batch.id, importedAt: batch.importedAt };
			if (!historicalFingerprints.has(file.fingerprint)) {
				historicalFingerprints.set(file.fingerprint, history);
			}
			if (file.orderNumber && !historicalOrderNumbers.has(file.orderNumber)) {
				historicalOrderNumbers.set(file.orderNumber, history);
			}
		}
	}

	const batchFingerprints = new Set<string>();
	const batchOrderNumbers = new Set<string>();
	const evaluatedFiles: OrderImportFileRecord[] = [];
	const totalResult = emptyImportResult();

	for (const file of files) {
		const duplicate = findOrderImportDuplicate(
			file,
			historicalFingerprints,
			historicalOrderNumbers,
			batchFingerprints,
			batchOrderNumbers,
		);
		const summary = sanitizeOrderImportFileSummary(file);
		if (duplicate) {
			const result = { added: 0, merged: 0, skipped: file.items.length };
			evaluatedFiles.push({
				...summary,
				status: 'duplicate',
				...duplicate,
				result,
			});
			addImportResult(totalResult, result);
			continue;
		}

		batchFingerprints.add(file.fingerprint);
		if (file.orderNumber) {
			batchOrderNumbers.add(file.orderNumber);
		}
		const result = applyImportedItems(document, file.items, strategy, timestamp, createId);
		evaluatedFiles.push({
			...summary,
			status: 'imported',
			result,
		});
		addImportResult(totalResult, result);
	}

	return { files: evaluatedFiles, result: totalResult };
}

function findOrderImportDuplicate(
	file: NormalizedOrderImportFile,
	historicalFingerprints: Map<string, ImportedFileHistory>,
	historicalOrderNumbers: Map<string, ImportedFileHistory>,
	batchFingerprints: Set<string>,
	batchOrderNumbers: Set<string>,
): OrderImportDuplicateReference | undefined {
	const fingerprintHistory = historicalFingerprints.get(file.fingerprint);
	if (fingerprintHistory) {
		return {
			duplicateReason: 'historical-fingerprint',
			duplicateOfBatchId: fingerprintHistory.batchId,
			duplicateImportedAt: fingerprintHistory.importedAt,
		};
	}
	if (file.orderNumber) {
		const orderHistory = historicalOrderNumbers.get(file.orderNumber);
		if (orderHistory) {
			return {
				duplicateReason: 'historical-order-number',
				duplicateOfBatchId: orderHistory.batchId,
				duplicateImportedAt: orderHistory.importedAt,
			};
		}
	}
	if (batchFingerprints.has(file.fingerprint)) {
		return { duplicateReason: 'batch-fingerprint' };
	}
	if (file.orderNumber && batchOrderNumbers.has(file.orderNumber)) {
		return { duplicateReason: 'batch-order-number' };
	}
	return undefined;
}

function applyImportedItems(
	document: InventoryDocument,
	items: NewInventoryItem[],
	strategy: DuplicateStrategy,
	timestamp: string,
	createId: () => string,
): ImportInventoryResult {
	const result = emptyImportResult();
	for (const input of items) {
		assertExistingCategory(document, input.categoryId);
		const candidate = normalizeInventoryItem(input, timestamp, createId());
		const existingIndex = document.items.findIndex(item => inventoryIdentityKey(item.identity) === inventoryIdentityKey(candidate.identity));
		if (existingIndex < 0) {
			document.items.push(candidate);
			result.added += 1;
		}
		else if (strategy === 'skip') {
			result.skipped += 1;
		}
		else {
			document.items[existingIndex] = mergeInventoryItems(document.items[existingIndex], candidate, strategy, timestamp);
			result.merged += 1;
		}
	}
	return result;
}

function emptyImportResult(): ImportInventoryResult {
	return { added: 0, merged: 0, skipped: 0 };
}

function addImportResult(total: ImportInventoryResult, result: ImportInventoryResult): void {
	total.added += result.added;
	total.merged += result.merged;
	total.skipped += result.skipped;
}

function assertExistingCategory(document: InventoryDocument, categoryId?: string): void {
	if (categoryId !== undefined && !document.categories.some(category => category.id === categoryId)) {
		throw new Error(`Inventory category not found: ${categoryId}`);
	}
}

function assertValidCategoryParent(document: InventoryDocument, parentId?: string): void {
	if (parentId === undefined) {
		return;
	}
	const parent = document.categories.find(category => category.id === parentId);
	if (!parent) {
		throw new Error(`Inventory category not found: ${parentId}`);
	}
	if (parent.parentId !== undefined) {
		throw new Error('Inventory categories support at most two levels.');
	}
}

function assertCategoryRevision(
	category: InventoryCategory | undefined,
	categoryId: string,
	expectedRevision: number,
): asserts category is InventoryCategory {
	if (!category || category.revision !== expectedRevision) {
		throw new InventoryCategoryRevisionConflictError(categoryId, expectedRevision, category?.revision);
	}
}

function assertUniqueSiblingCategoryName(
	categories: InventoryCategory[],
	name: string,
	parentId?: string,
	excludedId?: string,
): void {
	const normalizedName = name.toLowerCase();
	if (categories.some(category => category.id !== excludedId
		&& category.parentId === parentId
		&& category.name.toLowerCase() === normalizedName)) {
		throw new Error(`Inventory category already exists: ${name}`);
	}
}

function assertCompleteCategoryOrder(siblings: InventoryCategory[], order: InventoryCategoryOrderEntry[]): void {
	assertUniqueIds(order.map(entry => entry.id), 'Inventory category order contains duplicate category IDs.');
	const siblingIds = new Set(siblings.map(category => category.id));
	if (order.length !== siblings.length || order.some(entry => !siblingIds.has(entry.id))) {
		throw new Error('Inventory category order must contain every sibling category exactly once.');
	}
}

function assertUniqueIds(ids: string[], message: string): void {
	if (new Set(ids).size !== ids.length) {
		throw new Error(message);
	}
}

function nextCategorySortOrder(categories: InventoryCategory[], parentId?: string): number {
	return categories
		.filter(category => category.parentId === parentId)
		.reduce((maximum, category) => Math.max(maximum, category.sortOrder), -1) + 1;
}

function orderInventoryCategories(categories: InventoryCategory[]): InventoryCategory[] {
	const roots = categories.filter(category => category.parentId === undefined).toSorted(compareCategoryOrder);
	const ordered: InventoryCategory[] = [];
	const visited = new Set<string>();
	for (const root of roots) {
		ordered.push(root);
		visited.add(root.id);
		for (const child of categories.filter(category => category.parentId === root.id).toSorted(compareCategoryOrder)) {
			ordered.push(child);
			visited.add(child.id);
		}
	}
	ordered.push(...categories.filter(category => !visited.has(category.id)).toSorted(compareCategoryOrder));
	return ordered;
}

function compareCategoryOrder(left: InventoryCategory, right: InventoryCategory): number {
	return left.sortOrder - right.sortOrder
		|| left.name.localeCompare(right.name)
		|| left.id.localeCompare(right.id);
}

function collectCategoryBranchIds(categories: InventoryCategory[], rootId: string): string[] {
	const collected = [rootId];
	const collectedSet = new Set(collected);
	for (let index = 0; index < collected.length; index += 1) {
		const parentId = collected[index];
		for (const category of categories) {
			if (category.parentId === parentId && !collectedSet.has(category.id)) {
				collected.push(category.id);
				collectedSet.add(category.id);
			}
		}
	}
	return collected;
}

function removeItemCategory(item: InventoryItem, timestamp: string): InventoryItem {
	const uncategorized: InventoryItem = {
		...item,
		updatedAt: timestamp,
		revision: item.revision + 1,
	};
	delete uncategorized.categoryId;
	return uncategorized;
}

function assertRevision(item: InventoryItem | undefined, itemId: string, expectedRevision: number): asserts item is InventoryItem {
	if (!item || item.revision !== expectedRevision) {
		throw new InventoryRevisionConflictError(itemId, expectedRevision, item?.revision);
	}
}

function mergeInventoryItems(existing: InventoryItem, candidate: InventoryItem, strategy: Exclude<DuplicateStrategy, 'skip'>, timestamp: string): InventoryItem {
	const quantity = strategy === 'replace'
		? candidate.quantity
		: addQuantities(existing.quantity, candidate.quantity);
	const precision = strategy === 'replace'
		? candidate.precision
		: mergePrecision(existing.precision, candidate.precision, quantity);

	const edaModelReference = existing.edaModelReference ?? candidate.edaModelReference;
	return {
		...existing,
		identity: mergeIdentity(existing.identity, candidate.identity),
		marketplaceReference: mergeMarketplaceReference(existing.marketplaceReference, candidate.marketplaceReference),
		edaModelReference,
		edaModelStatus: edaModelReference
			? 'available'
			: candidate.edaModelStatus === 'unchecked' ? existing.edaModelStatus : candidate.edaModelStatus,
		quantity,
		precision,
		state: quantity === 0 || (quantity === null && strategy === 'replace' && candidate.state === 'depleted') ? 'depleted' : 'in-stock',
		location: candidate.location ?? existing.location,
		note: candidate.note ?? existing.note,
		updatedAt: timestamp,
		revision: existing.revision + 1,
	};
}

function addQuantities(current: number | null, incoming: number | null): number | null {
	if (current === null) {
		return incoming;
	}
	if (incoming === null) {
		return current;
	}
	return current + incoming;
}

function mergePrecision(current: QuantityPrecision, incoming: QuantityPrecision, quantity: number | null): QuantityPrecision {
	if (quantity === null) {
		return 'unknown';
	}
	return current === 'estimated' || incoming === 'estimated' || current === 'unknown' || incoming === 'unknown'
		? 'estimated'
		: 'exact';
}

function mergeIdentity(current: PartIdentity, incoming: PartIdentity): PartIdentity {
	return {
		name: incoming.name || current.name,
		lcscPartNumber: incoming.lcscPartNumber ?? current.lcscPartNumber,
		supplierId: incoming.supplierId ?? current.supplierId,
		manufacturerPartNumber: incoming.manufacturerPartNumber ?? current.manufacturerPartNumber,
		manufacturer: incoming.manufacturer ?? current.manufacturer,
		package: incoming.package ?? current.package,
		description: incoming.description ?? current.description,
	};
}

function mergeMarketplaceReference(current?: MarketplaceReference, incoming?: MarketplaceReference): MarketplaceReference | undefined {
	if (current?.evidence === 'user-confirmed') {
		return current;
	}
	return incoming ?? current;
}

function compareInventoryItems(left: InventoryItem, right: InventoryItem): number {
	if (left.state !== right.state) {
		return left.state === 'in-stock' ? -1 : 1;
	}
	return left.identity.name.localeCompare(right.identity.name);
}
