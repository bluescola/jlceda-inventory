import type { NewPurchaseRecord, ProjectDemandSnapshot, PurchaseRecord } from '../../project-planning/domain/project-planning';
import type { InventoryCategory, NewInventoryCategory } from '../domain/inventory-category';
import type { InventoryDocument } from '../domain/inventory-document';
import type { EdaModelReference, EdaModelStatus, InventoryItem, MarketplaceReference, NewInventoryItem, PartIdentity, QuantityPrecision } from '../domain/inventory-item';
import type { StructuredInventoryLocation } from '../domain/inventory-metadata';
import type { InventoryTransaction, StockOutBatchRecord } from '../domain/inventory-transaction';
import type {
	OrderImportBatchInput,
	OrderImportBatchPreview,
	OrderImportBatchRecord,
	OrderImportBatchResult,
	OrderImportDuplicateReference,
	OrderImportFileInput,
	OrderImportFileRecord,
	OrderImportInventoryLink,
	OrderImportResultSummary,
	OrderImportStrategy,
} from '../domain/order-import-batch';
import type { NewSubstituteLink, SubstituteLink } from '../domain/substitute-link';
import type { InventoryRepository } from '../ports/inventory-repository';
import type {
	AppliedBomStockOut,
	AppliedStockOutReversal,
	BomStockOutInput,
	BomStockOutPreview,
	StockOutReversalPreview,
} from './bom-stock-out';
import { normalizePurchaseRecord } from '../../project-planning/application/purchase-cost';
import { sanitizeProjectDemandSnapshot } from '../../project-planning/domain/project-planning';
import { normalizeInventoryCategory, normalizeInventoryCategoryName } from '../domain/inventory-category';
import { cloneInventoryDocument } from '../domain/inventory-document';
import { inventoryIdentityKey, normalizeInventoryItem, normalizeInventoryText, normalizeMinimumQuantity, normalizeQuantity, sanitizeEdaModelReferenceText } from '../domain/inventory-item';
import { sanitizeOrderImportFileSummary } from '../domain/order-import-batch';
import { normalizeSubstituteLink, substitutePairKey } from '../domain/substitute-link';
import { InventoryDocumentRevisionConflictError } from '../ports/inventory-repository';
import {
	applyBomStockOut,
	applyStockOutReversal,
	canonicalizeBomStockOut,
	evaluateBomStockOut,
	evaluateStockOutReversal,
	normalizeBomStockOutInput,
} from './bom-stock-out';
import { assertInventoryDocumentWithinLimits } from './inventory-document-limits';

export type DuplicateStrategy = OrderImportStrategy;

export interface ImportInventoryResult {
	added: number;
	merged: number;
	skipped: number;
}

export interface InventoryEditInput {
	identity: PartIdentity;
	categoryId?: string | null;
	marketplaceReference?: MarketplaceReference;
	edaModelReference?: EdaModelReference;
	edaModelStatus: EdaModelStatus;
	quantity: number;
	precision: Exclude<QuantityPrecision, 'unknown'>;
	minimumQuantity?: number | null;
	favorite?: boolean;
	location?: string;
	datasheetUrl?: string | null;
	structuredLocation?: StructuredInventoryLocation | null;
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

export interface InventoryItemRemoveEntry {
	id: string;
	expectedRevision: number;
}

export interface SubstituteItemRevisionRef {
	id: string;
	expectedRevision: number;
}

export interface CreateSubstituteLinkInput extends Pick<NewSubstituteLink, 'note'> {
	itemA: SubstituteItemRevisionRef;
	itemB: SubstituteItemRevisionRef;
	expectedDocumentRevision: number;
}

export interface DeleteInventoryCategoryResult {
	deletedCategoryIds: string[];
	uncategorizedItemIds: string[];
}

export interface InventoryCategoryImportNode {
	name: string;
	children?: readonly string[];
}

export interface ImportInventoryCategoriesResult {
	added: number;
	skipped: number;
}

export type InventoryEditResult
	= | { status: 'updated'; item: InventoryItem }
		| { status: 'duplicate'; candidate: InventoryItem; existing: InventoryItem }
		| { status: 'merged'; item: InventoryItem };

export type InventoryCreateResult
	= | { status: 'created'; item: InventoryItem }
		| { status: 'duplicate'; candidate: InventoryItem; existing: InventoryItem }
		| { status: 'merged'; item: InventoryItem };

export interface BomStockOutResult extends Omit<AppliedBomStockOut, 'document'> {
	documentRevision: number;
}

export interface StockOutReversalResult extends Omit<AppliedStockOutReversal, 'document'> {
	documentRevision: number;
}

export type ProjectSnapshotCaptureInput = Omit<ProjectDemandSnapshot, 'revision'>;
export type ProjectSnapshotReplacementInput = Omit<ProjectDemandSnapshot, 'id' | 'revision'>;

export class BomStockOutBlockedError extends Error {
	public constructor(public readonly preview: BomStockOutPreview) {
		super(`BOM stock-out is ${preview.status}.`);
		this.name = 'BomStockOutBlockedError';
	}
}

export class StockOutReversalBlockedError extends Error {
	public constructor(public readonly preview: StockOutReversalPreview) {
		super(`Stock-out reversal is ${preview.status}.`);
		this.name = 'StockOutReversalBlockedError';
	}
}

export class InventoryItemActiveStockOutReferenceError extends Error {
	public constructor(
		public readonly itemIds: readonly string[],
		public readonly batchIds: readonly string[],
	) {
		super('Inventory items referenced by active BOM stock-out batches cannot be removed or merged.');
		this.name = 'InventoryItemActiveStockOutReferenceError';
	}
}

export class InventoryItemSubstituteReferenceError extends Error {
	public constructor(
		public readonly itemIds: readonly string[],
		public readonly linkIds: readonly string[],
	) {
		super('Inventory items referenced by confirmed substitute links cannot be removed or merged.');
		this.name = 'InventoryItemSubstituteReferenceError';
	}
}

export class SubstituteLinkDuplicateError extends Error {
	public constructor(public readonly existing: SubstituteLink) {
		super(`A substitute link already exists for ${existing.itemIdA} and ${existing.itemIdB}.`);
		this.name = 'SubstituteLinkDuplicateError';
	}
}

export class SubstituteLinkRevisionConflictError extends Error {
	public constructor(
		public readonly linkId: string,
		public readonly expectedRevision: number,
		public readonly actualRevision?: number,
	) {
		super(`Substitute link revision conflict for ${linkId}: expected ${expectedRevision}, actual ${actualRevision ?? 'missing'}.`);
		this.name = 'SubstituteLinkRevisionConflictError';
	}
}

export class ProjectSnapshotIdentityConflictError extends Error {
	public constructor(public readonly existing: ProjectDemandSnapshot) {
		super(`A project snapshot already exists for document ${existing.documentUuid}.`);
		this.name = 'ProjectSnapshotIdentityConflictError';
	}
}

export class ProjectSnapshotRevisionConflictError extends Error {
	public constructor(
		public readonly snapshotId: string,
		public readonly expectedRevision: number,
		public readonly actualRevision?: number,
	) {
		super(`Project snapshot revision conflict for ${snapshotId}: expected ${expectedRevision}, actual ${actualRevision ?? 'missing'}.`);
		this.name = 'ProjectSnapshotRevisionConflictError';
	}
}

export class PurchaseRecordRevisionConflictError extends Error {
	public constructor(
		public readonly recordId: string,
		public readonly expectedRevision: number,
		public readonly actualRevision?: number,
	) {
		super(`Purchase record revision conflict for ${recordId}: expected ${expectedRevision}, actual ${actualRevision ?? 'missing'}.`);
		this.name = 'PurchaseRecordRevisionConflictError';
	}
}

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
		private readonly fingerprint: (canonicalValue: string) => Promise<string> = fingerprintCanonicalValue,
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

	public async importCategories(input: readonly InventoryCategoryImportNode[]): Promise<ImportInventoryCategoriesResult> {
		const normalized = input.map(category => ({
			name: normalizeInventoryCategoryName(category.name),
			children: (category.children ?? []).map(normalizeInventoryCategoryName),
		}));
		const document = await this.repository.load();
		const timestamp = this.now();
		const result: ImportInventoryCategoriesResult = { added: 0, skipped: 0 };

		for (const importedRoot of normalized) {
			let root = findSiblingCategory(document.categories, importedRoot.name);
			if (root) {
				result.skipped += 1;
			}
			else {
				root = normalizeInventoryCategory(
					{ name: importedRoot.name },
					timestamp,
					this.createId(),
					nextCategorySortOrder(document.categories),
				);
				document.categories.push(root);
				result.added += 1;
			}

			for (const childName of importedRoot.children) {
				if (findSiblingCategory(document.categories, childName, root.id)) {
					result.skipped += 1;
					continue;
				}
				document.categories.push(normalizeInventoryCategory(
					{ name: childName, parentId: root.id },
					timestamp,
					this.createId(),
					nextCategorySortOrder(document.categories, root.id),
				));
				result.added += 1;
			}
		}

		if (result.added > 0) {
			await this.persist(document, timestamp);
		}
		return result;
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

	public async listSubstituteLinks(itemId?: string): Promise<SubstituteLink[]> {
		if (itemId !== undefined) {
			assertNormalizedId(itemId, 'Inventory item ID');
		}
		const document = await this.repository.load();
		return clonePlanningRecords(document.substituteLinks
			.filter(link => itemId === undefined || link.itemIdA === itemId || link.itemIdB === itemId)
			.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)));
	}

	public async createSubstituteLink(input: CreateSubstituteLinkInput): Promise<SubstituteLink> {
		const document = await this.repository.load();
		assertDocumentRevision(document, input.expectedDocumentRevision);
		assertRevision(document.items.find(item => item.id === input.itemA.id), input.itemA.id, input.itemA.expectedRevision);
		assertRevision(document.items.find(item => item.id === input.itemB.id), input.itemB.id, input.itemB.expectedRevision);
		const pairKey = substitutePairKey(input.itemA.id, input.itemB.id);
		const existing = document.substituteLinks.find(link => substitutePairKey(link.itemIdA, link.itemIdB) === pairKey);
		if (existing) {
			throw new SubstituteLinkDuplicateError(clonePlanningRecord(existing));
		}
		const timestamp = this.now();
		const link = normalizeSubstituteLink({
			itemIdA: input.itemA.id,
			itemIdB: input.itemB.id,
			note: input.note,
		}, timestamp, this.createId());
		if (document.substituteLinks.some(candidate => candidate.id === link.id)) {
			throw new Error(`Substitute link ID already exists: ${link.id}.`);
		}
		document.substituteLinks.push(link);
		await this.persist(document, timestamp);
		return clonePlanningRecord(link);
	}

	public async removeSubstituteLink(id: string, expectedRevision: number): Promise<SubstituteLink> {
		const document = await this.repository.load();
		const index = document.substituteLinks.findIndex(link => link.id === id);
		const current = document.substituteLinks[index];
		assertSubstituteLinkRevision(current, id, expectedRevision);
		document.substituteLinks.splice(index, 1);
		await this.persist(document, this.now());
		return clonePlanningRecord(current);
	}

	public async updateMinimumQuantity(
		id: string,
		expectedRevision: number,
		minimumQuantity?: number,
	): Promise<InventoryItem> {
		const document = await this.repository.load();
		const index = document.items.findIndex(item => item.id === id);
		const current = document.items[index];
		assertRevision(current, id, expectedRevision);
		const normalized = normalizeMinimumQuantity(minimumQuantity);
		if (current.minimumQuantity === normalized) {
			return current;
		}

		const timestamp = this.now();
		const updated: InventoryItem = {
			...current,
			updatedAt: timestamp,
			revision: current.revision + 1,
		};
		if (normalized === undefined) {
			delete updated.minimumQuantity;
		}
		else {
			updated.minimumQuantity = normalized;
		}
		document.items[index] = updated;
		await this.persist(document, timestamp);
		return updated;
	}

	public async toggleFavorite(id: string, expectedRevision: number): Promise<InventoryItem> {
		const document = await this.repository.load();
		const index = document.items.findIndex(item => item.id === id);
		const current = document.items[index];
		assertRevision(current, id, expectedRevision);
		const timestamp = this.now();
		const updated: InventoryItem = {
			...current,
			updatedAt: timestamp,
			revision: current.revision + 1,
		};
		if (current.favorite === true) {
			delete updated.favorite;
		}
		else {
			updated.favorite = true;
		}
		document.items[index] = updated;
		await this.persist(document, timestamp);
		return updated;
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
		const categoryChanged = input.categoryId !== undefined;
		const nextCategoryId = categoryChanged ? input.categoryId ?? undefined : current.categoryId;
		assertExistingCategory(document, nextCategoryId);

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
			categoryId: nextCategoryId,
			identity: input.identity,
			marketplaceReference: input.marketplaceReference,
			edaModelReference: input.edaModelReference,
			edaModelStatus: input.edaModelStatus,
			quantity: input.quantity,
			precision,
			state: input.quantity === 0 ? 'depleted' : 'in-stock',
			minimumQuantity: input.minimumQuantity === undefined
				? current.minimumQuantity
				: input.minimumQuantity ?? undefined,
			favorite: input.favorite === undefined ? current.favorite : input.favorite,
			location: input.location,
			datasheetUrl: input.datasheetUrl === undefined
				? current.datasheetUrl
				: input.datasheetUrl ?? undefined,
			structuredLocation: input.structuredLocation === undefined
				? current.structuredLocation
				: input.structuredLocation ?? undefined,
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

			assertNoActiveStockOutReferences(document, [current.id]);
			assertNoSubstituteReferences(document, [current.id]);
			const merged = categoryChanged
				? assignInventoryItemCategory(mergeInventoryItems(existing, candidate, 'add', timestamp), nextCategoryId)
				: mergeInventoryItems(existing, candidate, 'add', timestamp);
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
		assertNoActiveStockOutReferences(document, [id]);
		assertNoSubstituteReferences(document, [id]);
		document.items = nextItems;
		await this.persist(document, this.now());
		return true;
	}

	public async removeItems(items: InventoryItemRemoveEntry[]): Promise<string[]> {
		assertUniqueIds(items.map(item => item.id), 'Inventory item removal contains duplicate item IDs.');
		if (items.length === 0) {
			return [];
		}
		const document = await this.repository.load();
		for (const entry of items) {
			assertRevision(
				document.items.find(item => item.id === entry.id),
				entry.id,
				entry.expectedRevision,
			);
		}
		const removedIds = items.map(item => item.id);
		assertNoActiveStockOutReferences(document, removedIds);
		assertNoSubstituteReferences(document, removedIds);
		const removedIdSet = new Set(removedIds);
		document.items = document.items.filter(item => !removedIdSet.has(item.id));
		await this.persist(document, this.now());
		return removedIds;
	}

	public async import(items: NewInventoryItem[], strategy: DuplicateStrategy): Promise<ImportInventoryResult> {
		const document = await this.repository.load();
		const timestamp = this.now();
		const { result } = applyImportedItems(document, items, strategy, timestamp, this.createId);

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
		supersedeHistoricalOrderImports(document, evaluation.files);
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

	public async listProjectSnapshots(): Promise<ProjectDemandSnapshot[]> {
		const document = await this.repository.load();
		return clonePlanningRecords(document.projectSnapshots
			.toSorted((left, right) => right.capturedAt.localeCompare(left.capturedAt) || right.id.localeCompare(left.id)));
	}

	public async captureProjectSnapshot(input: ProjectSnapshotCaptureInput): Promise<ProjectDemandSnapshot> {
		const document = await this.repository.load();
		const snapshot = sanitizeProjectDemandSnapshot({ ...input, revision: 1 });
		assertUniqueProjectSnapshotId(document.projectSnapshots, snapshot.id);
		assertUniqueProjectDocument(document.projectSnapshots, snapshot);
		const timestamp = this.now();
		document.projectSnapshots.push(snapshot);
		await this.persist(document, timestamp);
		return clonePlanningRecord(snapshot);
	}

	public async replaceProjectSnapshot(
		id: string,
		expectedRevision: number,
		input: ProjectSnapshotReplacementInput,
	): Promise<ProjectDemandSnapshot> {
		const document = await this.repository.load();
		const index = document.projectSnapshots.findIndex(snapshot => snapshot.id === id);
		const current = document.projectSnapshots[index];
		assertProjectSnapshotRevision(current, id, expectedRevision);
		const replacement = sanitizeProjectDemandSnapshot({
			...input,
			id: current.id,
			revision: current.revision + 1,
		});
		assertUniqueProjectDocument(document.projectSnapshots, replacement, current.id);
		const timestamp = this.now();
		document.projectSnapshots[index] = replacement;
		await this.persist(document, timestamp);
		return clonePlanningRecord(replacement);
	}

	public async setProjectSnapshotBoardQuantity(
		id: string,
		expectedRevision: number,
		boardQuantity: number,
	): Promise<ProjectDemandSnapshot> {
		const document = await this.repository.load();
		const index = document.projectSnapshots.findIndex(snapshot => snapshot.id === id);
		const current = document.projectSnapshots[index];
		assertProjectSnapshotRevision(current, id, expectedRevision);
		if (current.boardQuantity === boardQuantity) {
			return clonePlanningRecord(current);
		}
		const updated = sanitizeProjectDemandSnapshot({
			...current,
			boardQuantity,
			revision: current.revision + 1,
		});
		const timestamp = this.now();
		document.projectSnapshots[index] = updated;
		await this.persist(document, timestamp);
		return clonePlanningRecord(updated);
	}

	public async removeProjectSnapshot(
		id: string,
		expectedRevision: number,
	): Promise<ProjectDemandSnapshot> {
		const document = await this.repository.load();
		const index = document.projectSnapshots.findIndex(snapshot => snapshot.id === id);
		const current = document.projectSnapshots[index];
		assertProjectSnapshotRevision(current, id, expectedRevision);
		document.projectSnapshots.splice(index, 1);
		await this.persist(document, this.now());
		return clonePlanningRecord(current);
	}

	public async listPurchaseRecords(): Promise<PurchaseRecord[]> {
		const document = await this.repository.load();
		return clonePlanningRecords(document.purchaseRecords
			.toSorted((left, right) => right.purchasedAt.localeCompare(left.purchasedAt) || right.id.localeCompare(left.id)));
	}

	public async addPurchaseRecord(input: NewPurchaseRecord): Promise<PurchaseRecord> {
		const document = await this.repository.load();
		const timestamp = this.now();
		const record = normalizePurchaseRecord(input, this.createId(), timestamp);
		assertExistingProjectSnapshotReferences(document, record.projectSnapshotIds);
		if (document.purchaseRecords.some(candidate => candidate.id === record.id)) {
			throw new Error(`Purchase record ID already exists: ${record.id}.`);
		}
		document.purchaseRecords.push(record);
		await this.persist(document, timestamp);
		return clonePlanningRecord(record);
	}

	public async removePurchaseRecord(
		id: string,
		expectedRevision: number,
	): Promise<PurchaseRecord> {
		const document = await this.repository.load();
		const index = document.purchaseRecords.findIndex(record => record.id === id);
		const current = document.purchaseRecords[index];
		assertPurchaseRecordRevision(current, id, expectedRevision);
		document.purchaseRecords.splice(index, 1);
		await this.persist(document, this.now());
		return clonePlanningRecord(current);
	}

	public async previewBomStockOut(input: BomStockOutInput): Promise<BomStockOutPreview> {
		const normalized = normalizeBomStockOutInput(input);
		const document = await this.repository.load();
		const batchFingerprint = await this.createBomStockOutFingerprint(normalized);
		return evaluateBomStockOut(document, normalized, batchFingerprint);
	}

	public async commitBomStockOut(
		input: BomStockOutInput,
		expectedDocumentRevision: number,
	): Promise<BomStockOutResult> {
		const normalized = normalizeBomStockOutInput(input);
		const document = await this.repository.load();
		assertDocumentRevision(document, expectedDocumentRevision);
		const batchFingerprint = await this.createBomStockOutFingerprint(normalized);
		const preview = evaluateBomStockOut(document, normalized, batchFingerprint);
		if (preview.status !== 'ready') {
			throw new BomStockOutBlockedError(preview);
		}

		const timestamp = this.now();
		const applied = applyBomStockOut(document, normalized, preview, timestamp, this.createId);
		await this.persist(applied.document, timestamp);
		return {
			batch: applied.batch,
			transactions: applied.transactions,
			items: applied.items,
			documentRevision: applied.document.revision,
		};
	}

	public async previewStockOutReversal(batchId: string): Promise<StockOutReversalPreview> {
		assertNormalizedId(batchId, 'Stock-out batch ID');
		return evaluateStockOutReversal(await this.repository.load(), batchId);
	}

	public async reverseStockOutBatch(
		batchId: string,
		expectedDocumentRevision: number,
		note?: string,
	): Promise<StockOutReversalResult> {
		assertNormalizedId(batchId, 'Stock-out batch ID');
		const document = await this.repository.load();
		assertDocumentRevision(document, expectedDocumentRevision);
		const preview = evaluateStockOutReversal(document, batchId);
		if (preview.status !== 'ready') {
			throw new StockOutReversalBlockedError(preview);
		}

		const timestamp = this.now();
		const applied = applyStockOutReversal(document, preview, timestamp, note, this.createId);
		await this.persist(applied.document, timestamp);
		return {
			batch: applied.batch,
			transactions: applied.transactions,
			items: applied.items,
			reversalId: applied.reversalId,
			documentRevision: applied.document.revision,
		};
	}

	public async listTransactions(itemId?: string): Promise<InventoryTransaction[]> {
		if (itemId !== undefined) {
			assertNormalizedId(itemId, 'Inventory item ID');
		}
		const document = await this.repository.load();
		return document.transactions
			.filter(transaction => itemId === undefined || transaction.itemId === itemId)
			.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
	}

	public async listStockOutBatches(): Promise<StockOutBatchRecord[]> {
		const document = await this.repository.load();
		return document.stockOutBatches
			.toSorted((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
	}

	public async exportDocument(): Promise<InventoryDocument> {
		return this.repository.load();
	}

	public async loadRecoverySnapshot(): Promise<InventoryDocument | undefined> {
		return this.repository.loadRecoverySnapshot?.();
	}

	public async restoreDocument(
		backup: InventoryDocument,
		expectedCurrentRevision: number,
	): Promise<InventoryDocument> {
		const current = await this.repository.load();
		if (current.revision !== expectedCurrentRevision) {
			throw new InventoryDocumentRevisionConflictError(expectedCurrentRevision, current.revision);
		}
		if (!this.repository.loadRecoverySnapshot
			|| !this.repository.saveRecoverySnapshot
			|| !this.repository.clearRecoverySnapshot) {
			throw new Error('The inventory repository does not support transactional recovery snapshots.');
		}
		const restored = cloneInventoryDocument(backup);
		restored.revision = current.revision + 1;
		restored.updatedAt = this.now();
		assertInventoryDocumentWithinLimits(restored);
		const previousRecoverySnapshot = await this.repository.loadRecoverySnapshot();
		await this.repository.saveRecoverySnapshot(current);
		try {
			await this.repository.save(restored, current.revision);
		}
		catch (error) {
			try {
				if (previousRecoverySnapshot) {
					await this.repository.saveRecoverySnapshot(previousRecoverySnapshot);
				}
				else {
					await this.repository.clearRecoverySnapshot();
				}
			}
			catch (recoveryError) {
				throw new AggregateError(
					[error, recoveryError],
					'Inventory restore failed and the previous recovery snapshot could not be reinstated.',
				);
			}
			throw error;
		}
		return cloneInventoryDocument(restored);
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
		const expectedRevision = document.revision;
		document.revision += 1;
		document.updatedAt = timestamp;
		assertInventoryDocumentWithinLimits(document);
		await this.repository.save(document, expectedRevision);
	}

	private async createBomStockOutFingerprint(input: ReturnType<typeof normalizeBomStockOutInput>): Promise<string> {
		const fingerprint = (await this.fingerprint(canonicalizeBomStockOut(input))).trim().toLowerCase();
		if (!/^[a-f\d]{64}$/.test(fingerprint)) {
			throw new TypeError('BOM stock-out fingerprint provider must return a SHA-256 hexadecimal value.');
		}
		return fingerprint;
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
	file: OrderImportFileRecord;
}

interface AppliedImportedItems {
	result: ImportInventoryResult;
	inventoryLinks: OrderImportInventoryLink[];
}

type OrderImportFileDecision
	= | { status: 'new' }
		| { status: 'duplicate'; reference: OrderImportDuplicateReference }
		| {
			status: 'restore';
			reference: OrderImportDuplicateReference;
			restoreIdentityKeys: Set<string>;
			retainedLinks: OrderImportInventoryLink[];
		};

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
	const { historicalFingerprints, historicalOrderNumbers } = collectOrderImportHistory(document);
	const currentItemsById = new Map(document.items.map(item => [item.id, item]));
	const currentItemsByIdentityKey = new Map(
		document.items.map(item => [inventoryIdentityKey(item.identity), item]),
	);

	const batchFingerprints = new Set<string>();
	const batchOrderNumbers = new Set<string>();
	const evaluatedFiles: OrderImportFileRecord[] = [];
	const totalResult = emptyImportResult();

	for (const file of files) {
		const decision = decideOrderImportFile(
			file,
			historicalFingerprints,
			historicalOrderNumbers,
			batchFingerprints,
			batchOrderNumbers,
			currentItemsById,
			currentItemsByIdentityKey,
		);
		const summary = sanitizeOrderImportFileSummary(file);
		if (decision.status === 'duplicate') {
			const result = { added: 0, merged: 0, skipped: file.items.length };
			evaluatedFiles.push({
				...summary,
				status: 'duplicate',
				...decision.reference,
				result,
			});
			addImportResult(totalResult, result);
			continue;
		}

		const selectedItems = decision.status === 'restore'
			? file.items.filter(item => decision.restoreIdentityKeys.has(inventoryIdentityKey(item.identity)))
			: file.items;
		if (decision.status === 'restore' && selectedItems.length === 0) {
			const result = { added: 0, merged: 0, skipped: file.items.length };
			evaluatedFiles.push({
				...summary,
				status: 'duplicate',
				...decision.reference,
				result,
			});
			addImportResult(totalResult, result);
			continue;
		}

		batchFingerprints.add(file.fingerprint);
		if (file.orderNumber) {
			batchOrderNumbers.add(file.orderNumber);
		}
		const applied = applyImportedItems(document, selectedItems, strategy, timestamp, createId);
		const result = {
			...applied.result,
			skipped: applied.result.skipped + file.items.length - selectedItems.length,
		};
		evaluatedFiles.push({
			...summary,
			status: 'imported',
			result,
			inventoryLinks: mergeOrderImportInventoryLinks(
				decision.status === 'restore' ? decision.retainedLinks : [],
				applied.inventoryLinks,
			),
			deduplicationActive: true,
		});
		addImportResult(totalResult, result);
	}

	return { files: evaluatedFiles, result: totalResult };
}

function collectOrderImportHistory(document: InventoryDocument): {
	historicalFingerprints: Map<string, ImportedFileHistory>;
	historicalOrderNumbers: Map<string, ImportedFileHistory>;
} {
	const historicalFingerprints = new Map<string, ImportedFileHistory>();
	const historicalOrderNumbers = new Map<string, ImportedFileHistory>();
	for (let batchIndex = document.orderImportBatches.length - 1; batchIndex >= 0; batchIndex -= 1) {
		const batch = document.orderImportBatches[batchIndex];
		for (let fileIndex = batch.files.length - 1; fileIndex >= 0; fileIndex -= 1) {
			const file = batch.files[fileIndex];
			if (file.status !== 'imported' || file.deduplicationActive === false) {
				continue;
			}
			const history = { batchId: batch.id, importedAt: batch.importedAt, file };
			if (!historicalFingerprints.has(file.fingerprint)) {
				historicalFingerprints.set(file.fingerprint, history);
			}
			if (file.orderNumber && !historicalOrderNumbers.has(file.orderNumber)) {
				historicalOrderNumbers.set(file.orderNumber, history);
			}
		}
	}
	return { historicalFingerprints, historicalOrderNumbers };
}

function decideOrderImportFile(
	file: NormalizedOrderImportFile,
	historicalFingerprints: Map<string, ImportedFileHistory>,
	historicalOrderNumbers: Map<string, ImportedFileHistory>,
	batchFingerprints: Set<string>,
	batchOrderNumbers: Set<string>,
	currentItemsById: Map<string, InventoryItem>,
	currentItemsByIdentityKey: Map<string, InventoryItem>,
): OrderImportFileDecision {
	if (batchFingerprints.has(file.fingerprint)) {
		return { status: 'duplicate', reference: { duplicateReason: 'batch-fingerprint' } };
	}
	if (file.orderNumber && batchOrderNumbers.has(file.orderNumber)) {
		return { status: 'duplicate', reference: { duplicateReason: 'batch-order-number' } };
	}

	const fingerprintHistory = historicalFingerprints.get(file.fingerprint);
	const orderHistory = file.orderNumber ? historicalOrderNumbers.get(file.orderNumber) : undefined;
	const history = fingerprintHistory ?? orderHistory;
	if (!history) {
		return { status: 'new' };
	}
	const reference: OrderImportDuplicateReference = {
		duplicateReason: fingerprintHistory ? 'historical-fingerprint' : 'historical-order-number',
		duplicateOfBatchId: history.batchId,
		duplicateImportedAt: history.importedAt,
	};

	if (history.file.inventoryLinks?.length) {
		const retainedLinks: OrderImportInventoryLink[] = [];
		const restoreIdentityKeys = new Set<string>();
		for (const link of history.file.inventoryLinks) {
			const current = currentItemsById.get(link.inventoryItemId);
			if (current && inventoryIdentityKey(current.identity) === link.identityKey) {
				retainedLinks.push(link);
			}
			else {
				restoreIdentityKeys.add(link.identityKey);
			}
		}
		return restoreIdentityKeys.size === 0
			? { status: 'duplicate', reference }
			: { status: 'restore', reference, restoreIdentityKeys, retainedLinks };
	}

	const restoreIdentityKeys = new Set<string>();
	const retainedLinks = new Map<string, OrderImportInventoryLink>();
	for (const item of file.items) {
		const identityKey = inventoryIdentityKey(item.identity);
		const current = currentItemsByIdentityKey.get(identityKey);
		if (current) {
			retainedLinks.set(identityKey, { identityKey, inventoryItemId: current.id });
		}
		else {
			restoreIdentityKeys.add(identityKey);
		}
	}
	return restoreIdentityKeys.size === 0
		? { status: 'duplicate', reference }
		: { status: 'restore', reference, restoreIdentityKeys, retainedLinks: [...retainedLinks.values()] };
}

function applyImportedItems(
	document: InventoryDocument,
	items: NewInventoryItem[],
	strategy: DuplicateStrategy,
	timestamp: string,
	createId: () => string,
): AppliedImportedItems {
	const result = emptyImportResult();
	const inventoryLinks = new Map<string, OrderImportInventoryLink>();
	for (const input of items) {
		assertExistingCategory(document, input.categoryId);
		const candidate = normalizeInventoryItem(input, timestamp, createId());
		const identityKey = inventoryIdentityKey(candidate.identity);
		const existingIndex = document.items.findIndex(item => inventoryIdentityKey(item.identity) === identityKey);
		if (existingIndex < 0) {
			document.items.push(candidate);
			result.added += 1;
			inventoryLinks.set(identityKey, { identityKey, inventoryItemId: candidate.id });
		}
		else if (strategy === 'skip') {
			result.skipped += 1;
			inventoryLinks.set(identityKey, { identityKey, inventoryItemId: document.items[existingIndex].id });
		}
		else {
			document.items[existingIndex] = mergeInventoryItems(document.items[existingIndex], candidate, strategy, timestamp);
			result.merged += 1;
			inventoryLinks.set(identityKey, { identityKey, inventoryItemId: document.items[existingIndex].id });
		}
	}
	return { result, inventoryLinks: [...inventoryLinks.values()] };
}

function mergeOrderImportInventoryLinks(
	retained: OrderImportInventoryLink[],
	applied: OrderImportInventoryLink[],
): OrderImportInventoryLink[] {
	const merged = new Map(retained.map(link => [link.identityKey, link]));
	for (const link of applied) {
		merged.set(link.identityKey, link);
	}
	return [...merged.values()];
}

function supersedeHistoricalOrderImports(
	document: InventoryDocument,
	evaluatedFiles: OrderImportFileRecord[],
): void {
	const importedFiles = evaluatedFiles.filter(file => file.status === 'imported');
	if (importedFiles.length === 0) {
		return;
	}
	for (const batch of document.orderImportBatches) {
		batch.files = batch.files.map((historicalFile) => {
			if (historicalFile.status !== 'imported' || historicalFile.deduplicationActive === false) {
				return historicalFile;
			}
			const superseded = importedFiles.some(file => file.fingerprint === historicalFile.fingerprint
				|| (file.orderNumber !== undefined && file.orderNumber === historicalFile.orderNumber));
			return superseded ? { ...historicalFile, deduplicationActive: false } : historicalFile;
		});
	}
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

function findSiblingCategory(
	categories: InventoryCategory[],
	name: string,
	parentId?: string,
): InventoryCategory | undefined {
	const normalizedName = name.toLowerCase();
	return categories.find(category => category.parentId === parentId && category.name.toLowerCase() === normalizedName);
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

function assertNoActiveStockOutReferences(document: InventoryDocument, itemIds: readonly string[]): void {
	const requestedIds = new Set(itemIds);
	const batchIds = document.stockOutBatches
		.filter(batch => !batch.reversal && batch.lines.some(line => requestedIds.has(line.itemId)))
		.map(batch => batch.id);
	if (batchIds.length > 0) {
		throw new InventoryItemActiveStockOutReferenceError([...requestedIds], batchIds);
	}
}

function assertNoSubstituteReferences(document: InventoryDocument, itemIds: readonly string[]): void {
	const requestedIds = new Set(itemIds);
	const linkIds = document.substituteLinks
		.filter(link => requestedIds.has(link.itemIdA) || requestedIds.has(link.itemIdB))
		.map(link => link.id);
	if (linkIds.length > 0) {
		throw new InventoryItemSubstituteReferenceError([...requestedIds], linkIds);
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
		minimumQuantity: candidate.minimumQuantity ?? existing.minimumQuantity,
		favorite: candidate.favorite ?? existing.favorite,
		location: candidate.location ?? existing.location,
		datasheetUrl: candidate.datasheetUrl ?? existing.datasheetUrl,
		structuredLocation: candidate.structuredLocation ?? existing.structuredLocation,
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

function assignInventoryItemCategory(item: InventoryItem, categoryId?: string): InventoryItem {
	if (categoryId === undefined) {
		const uncategorized = { ...item };
		delete uncategorized.categoryId;
		return uncategorized;
	}
	return { ...item, categoryId };
}

function assertDocumentRevision(document: InventoryDocument, expectedRevision: number): void {
	if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
		throw new TypeError('Expected inventory document revision must be a non-negative safe integer.');
	}
	if (document.revision !== expectedRevision) {
		throw new InventoryDocumentRevisionConflictError(expectedRevision, document.revision);
	}
}

function assertNormalizedId(value: string, label: string): void {
	if (typeof value !== 'string'
		|| value.length === 0
		|| value.length > 4096
		|| normalizeInventoryText(value) !== value) {
		throw new TypeError(`${label} must be non-empty, normalized text.`);
	}
}

function assertUniqueProjectSnapshotId(snapshots: readonly ProjectDemandSnapshot[], id: string): void {
	if (snapshots.some(snapshot => snapshot.id === id)) {
		throw new Error(`Project snapshot ID already exists: ${id}.`);
	}
}

function assertUniqueProjectDocument(
	snapshots: readonly ProjectDemandSnapshot[],
	candidate: ProjectDemandSnapshot,
	excludedId?: string,
): void {
	const existing = snapshots.find(snapshot => snapshot.id !== excludedId
		&& snapshot.projectUuid === candidate.projectUuid
		&& snapshot.documentUuid === candidate.documentUuid);
	if (existing) {
		throw new ProjectSnapshotIdentityConflictError(clonePlanningRecord(existing));
	}
}

function assertProjectSnapshotRevision(
	snapshot: ProjectDemandSnapshot | undefined,
	id: string,
	expectedRevision: number,
): asserts snapshot is ProjectDemandSnapshot {
	if (!snapshot || snapshot.revision !== expectedRevision) {
		throw new ProjectSnapshotRevisionConflictError(id, expectedRevision, snapshot?.revision);
	}
}

function assertPurchaseRecordRevision(
	record: PurchaseRecord | undefined,
	id: string,
	expectedRevision: number,
): asserts record is PurchaseRecord {
	if (!record || record.revision !== expectedRevision) {
		throw new PurchaseRecordRevisionConflictError(id, expectedRevision, record?.revision);
	}
}

function assertSubstituteLinkRevision(
	link: SubstituteLink | undefined,
	id: string,
	expectedRevision: number,
): asserts link is SubstituteLink {
	if (!link || link.revision !== expectedRevision) {
		throw new SubstituteLinkRevisionConflictError(id, expectedRevision, link?.revision);
	}
}

function assertExistingProjectSnapshotReferences(
	document: InventoryDocument,
	snapshotIds: readonly string[],
): void {
	const existingIds = new Set(document.projectSnapshots.map(snapshot => snapshot.id));
	const missingId = snapshotIds.find(id => !existingIds.has(id));
	if (missingId) {
		throw new Error(`Project snapshot not found: ${missingId}.`);
	}
}

function clonePlanningRecord<Value>(value: Value): Value {
	return JSON.parse(JSON.stringify(value)) as Value;
}

function clonePlanningRecords<Value>(values: readonly Value[]): Value[] {
	return JSON.parse(JSON.stringify(values)) as Value[];
}

async function fingerprintCanonicalValue(value: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error('Web Crypto SHA-256 is not available in this environment.');
	}
	const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
