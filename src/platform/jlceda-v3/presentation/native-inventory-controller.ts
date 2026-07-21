import type { CommonLibrary } from '../../../features/common-library/ports/common-library';
import type { EdaModel, EdaModelCatalog } from '../../../features/component-catalog/ports/component-catalog';
import type { InventoryEditInput, InventoryService } from '../../../features/inventory/application/inventory-service';
import type { InventoryCategory } from '../../../features/inventory/domain/inventory-category';
import type { EdaModelReference, EdaModelStatus, InventoryItem, MarketplaceReference, NewInventoryItem, PartIdentity, QuantityPrecision } from '../../../features/inventory/domain/inventory-item';
import type { OrderImportBatchInput, OrderImportBatchPreview } from '../../../features/inventory/domain/order-import-batch';
import type { EdaLibraryCategories, EdaLibraryCategorySource } from '../../../features/inventory/ports/eda-library-categories';
import type { MarketplaceNavigator } from '../../../features/marketplace-catalog/ports/marketplace-navigator';
import type { EdaFileClient, PickedOrderFile } from '../eda/file-client';
import type { Translate } from '../eda/i18n-client';
import type { EdaPlacementClient } from '../eda/placement-client';
import type { InventoryCreateActionOutcome, InventoryCreateDraft, InventoryCreateDuplicateSnapshot, InventoryCreateMode, InventoryCreatePanel, InventoryCreatePanelAction } from './inventory-create-panel';
import type { InventoryItemEditDraft, InventoryItemPanel } from './inventory-item-panel';
import type { InventoryOverviewIntent, InventoryOverviewOperationResult, InventoryOverviewPanel } from './inventory-overview-panel';
import type { Diagnostics, DiagnosticTrace } from './native-diagnostics';
import type { InputOptions, NativeDialog, SelectOption } from './native-dialog';
import type { OrderImportPanel, OrderImportPanelAction, OrderImportPanelActionOutcome, OrderImportPanelProgressReporter, OrderImportPanelSettings } from './order-import-panel';
import type { ProductDetailsForm } from './product-details-form';
import { InventoryCategoryRevisionConflictError, InventoryRevisionConflictError } from '../../../features/inventory/application/inventory-service';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../../features/inventory/domain/inventory-item';
import { identifyOrderFile } from '../../../features/order-import/application/order-file-identity';
import { parseOrderFile } from '../../../features/order-import/application/parse-order-file';

const MAX_ORDER_IMPORT_FILES = 100;
const ORDER_IMPORT_MODEL_CONCURRENCY = 4;

interface StockInput {
	quantity: number | null;
	precision: QuantityPrecision;
	location?: string;
}

interface PendingOverviewModelMatch {
	itemId: string;
	expectedRevision: number;
	model: EdaModel;
}

interface PendingOverviewDuplicateMatch {
	categoryId?: string;
	input: InventoryEditInput;
	source: { id: string; expectedRevision: number };
	target: { id: string; expectedRevision: number };
}

interface PendingCreateModelMatch {
	lcscPartNumber: string;
	model: EdaModel;
}

interface PendingCreateDuplicateMatch {
	draftFingerprint: string;
	existing: { id: string; expectedRevision: number };
	input: NewInventoryItem;
}

interface InventoryCreateSession {
	categories: readonly InventoryCategory[];
	duplicateMatches: Map<string, PendingCreateDuplicateMatch>;
	lookupStatuses: Map<string, EdaModelStatus>;
	marketplaceVisits: Set<string>;
	modelMatches: Map<string, PendingCreateModelMatch>;
	savedItem?: InventoryItem;
}

interface PendingOrderImportPreview {
	input: OrderImportBatchInput;
	preview: OrderImportBatchPreview;
	settings: OrderImportPanelSettings;
}

export class NativeInventoryController {
	public constructor(
		private readonly inventory: InventoryService,
		private readonly edaModels: EdaModelCatalog,
		private readonly marketplace: MarketplaceNavigator,
		private readonly commonLibrary: CommonLibrary,
		private readonly files: EdaFileClient,
		private readonly edaLibraryCategories: EdaLibraryCategories,
		private readonly placement: EdaPlacementClient,
		private readonly dialog: NativeDialog,
		private readonly diagnostics: Diagnostics,
		private readonly productDetailsForm: ProductDetailsForm,
		private readonly inventoryCreatePanel: InventoryCreatePanel,
		private readonly orderImportPanel: OrderImportPanel,
		private readonly inventoryOverviewPanel: InventoryOverviewPanel,
		private readonly inventoryItemPanel: InventoryItemPanel,
		private readonly t: Translate,
		private readonly version: string,
	) {}

	public openInventory(): Promise<void> {
		const trace = this.diagnostics.start('inventory-overview', false);
		return this.execute(async () => {
			let document = await this.inventory.exportDocument();
			const pendingModelMatches = new Map<string, PendingOverviewModelMatch>();
			const pendingDuplicateMatches = new Map<string, PendingOverviewDuplicateMatch>();
			await this.inventoryOverviewPanel.open({
				items: document.items,
				categories: document.categories,
			}, async (operation) => {
				const result = await this.handleInventoryOverviewIntent(
					operation.intent,
					document.items,
					document.categories,
					pendingModelMatches,
					pendingDuplicateMatches,
				);
				if (result.status === 'model-match'
					|| result.status === 'duplicate-match'
					|| result.status === 'model-missing'
					|| result.status === 'failed') {
					return result;
				}
				document = await this.inventory.exportDocument();
				return { ...result, snapshot: { items: document.items, categories: document.categories } };
			}, trace);
		}, trace);
	}

	public addByLcscPartNumber(): Promise<void> {
		return this.openInventoryCreatePanel('lcsc');
	}

	public addCustomComponent(): Promise<void> {
		return this.openInventoryCreatePanel('custom');
	}

	public importEdaCategories(): Promise<void> {
		return this.execute(async () => {
			const result = await this.importEdaCategoriesCore();
			if ('message' in result && result.message) {
				this.dialog.info(result.message, this.t('categoryImport.title'));
			}
		});
	}

	private async importEdaCategoriesCore(): Promise<InventoryOverviewOperationResult> {
		const sources = await this.edaLibraryCategories.availableSources();
		if (sources.length === 0) {
			return { status: 'failed', message: this.t('categoryImport.noLibrary') };
		}
		const selected = sources.length === 1
			? sources[0]
			: await this.dialog.select(
				sources.map(source => ({ value: source, label: this.sourceLabel(source) })),
				this.t('categoryImport.title'),
				this.t('categoryImport.source'),
				sources[0],
			) as EdaLibraryCategorySource | undefined;
		if (!selected) {
			return { status: 'cancelled' };
		}

		const readResult = await this.edaLibraryCategories.read(selected);
		if (readResult.status === 'unavailable') {
			return { status: 'failed', message: this.t('categoryImport.noLibrary') };
		}
		if (readResult.status === 'unsupported') {
			return { status: 'failed', message: this.t('categoryImport.unsupported') };
		}
		const rootCount = readResult.snapshot.categories.length;
		const childCount = readResult.snapshot.categories.reduce((total, category) => total + category.children.length, 0);
		if (rootCount + childCount === 0) {
			return {
				status: 'succeeded',
				message: this.t(readResult.snapshot.complete ? 'categoryImport.empty' : 'categoryImport.emptyIncomplete'),
			};
		}
		if (!await this.dialog.confirm(
			this.t('categoryImport.confirm', rootCount, childCount, this.sourceLabel(selected)),
			this.t('categoryImport.title'),
		)) {
			return { status: 'cancelled' };
		}

		const result = await this.inventory.importCategories(readResult.snapshot.categories);
		const incompleteNote = readResult.snapshot.complete ? '' : `\n\n${this.t('categoryImport.incomplete')}`;
		return {
			status: 'succeeded',
			message: `${this.t('categoryImport.completed', result.added, result.skipped)}${incompleteNote}`,
		};
	}

	private sourceLabel(source: EdaLibraryCategorySource): string {
		return this.t(source === 'personal' ? 'categoryImport.personal' : 'categoryImport.favorite');
	}

	private openInventoryCreatePanel(mode: InventoryCreateMode): Promise<void> {
		const trace = this.diagnostics.start(mode === 'lcsc' ? 'add-lcsc' : 'add-custom');
		return this.execute(async () => {
			const document = await this.inventory.exportDocument();
			const session: InventoryCreateSession = {
				categories: document.categories,
				duplicateMatches: new Map(),
				lookupStatuses: new Map(),
				marketplaceVisits: new Set(),
				modelMatches: new Map(),
			};
			const result = await this.inventoryCreatePanel.open({
				mode,
				categories: document.categories,
				locationOptions: collectLocationOptions(document.items),
			}, action => this.handleInventoryCreateAction(action, session, trace), trace);
			if (result.status === 'cancelled') {
				trace.info('workflow.cancelled', { step: 'inventory-create-panel' });
				return;
			}
			if (!session.savedItem) {
				throw new Error('The inventory create panel completed without a saved inventory item.');
			}
			this.showSavedItem(session.savedItem);
			trace.info('workflow.success', { merged: result.merged });
		}, trace);
	}

	private async handleInventoryCreateAction(
		action: InventoryCreatePanelAction,
		session: InventoryCreateSession,
		trace: DiagnosticTrace,
	): Promise<InventoryCreateActionOutcome> {
		if (action.type === 'query-eda') {
			const lookup = await this.lookupEdaModel(action.lcscPartNumber, trace);
			session.modelMatches.clear();
			session.lookupStatuses.set(action.lcscPartNumber, lookup.status);
			if (lookup.status === 'failed') {
				return { stage: 'failed', message: this.t('edaModel.lookupFailed') };
			}
			if (!lookup.model) {
				return { stage: 'not-found', message: this.t('inventoryCreate.queryMissing'), model: { status: 'missing' } };
			}
			const modelToken = createSessionToken();
			session.modelMatches.set(modelToken, { lcscPartNumber: action.lcscPartNumber, model: lookup.model });
			return {
				stage: 'succeeded',
				message: this.t('inventoryCreate.queryAvailable'),
				model: { status: 'available' },
				modelToken,
				suggestion: {
					...lookup.model.identity,
					lcscPartNumber: lookup.model.identity.lcscPartNumber ?? action.lcscPartNumber,
					supplierId: lookup.model.identity.supplierId ?? action.lcscPartNumber,
				},
			};
		}
		if (action.type === 'open-marketplace') {
			const partNumber = normalizeLcscPartNumber(action.lcscPartNumber);
			if (!partNumber || !/^C\d+$/.test(partNumber)) {
				return { stage: 'failed', message: this.t('part.lcscInvalid') };
			}
			const lookupStatus = session.lookupStatuses.get(partNumber);
			if (lookupStatus !== 'missing' && lookupStatus !== 'failed') {
				return {
					stage: 'failed',
					message: this.t(lookupStatus === 'available' ? 'inventoryCreate.queryAvailable' : 'inventoryCreate.queryIdle'),
				};
			}
			this.marketplace.openSearch(partNumber);
			session.marketplaceVisits.add(partNumber);
			return { stage: 'succeeded' };
		}

		if (action.type === 'confirm-merge') {
			const pending = session.duplicateMatches.get(action.duplicateToken);
			session.duplicateMatches.delete(action.duplicateToken);
			if (!pending
				|| pending.existing.id !== action.existing.id
				|| pending.existing.expectedRevision !== action.existing.expectedRevision
				|| pending.draftFingerprint !== inventoryCreateDraftFingerprint(action.draft, action.modelToken, action.form.marketplaceConfirmed)) {
				return { stage: 'failed', message: this.t('inventory.concurrentConflict') };
			}
			const result = await trace.waitFor('inventory.merge', () => this.inventory.createItem(pending.input, pending.existing));
			if (result.status !== 'merged') {
				return { stage: 'failed', message: this.t('inventory.concurrentConflict') };
			}
			session.savedItem = result.item;
			return { stage: 'succeeded', message: this.t('inventory.merged') };
		}

		const input = this.createInventoryInput(action.draft, action.modelToken, action.form.marketplaceConfirmed, session);
		if (!input) {
			return { stage: 'failed', message: this.t('inventory.concurrentConflict') };
		}
		const result = await trace.waitFor('inventory.save', () => this.inventory.createItem(input));
		if (result.status === 'duplicate') {
			const duplicateToken = createSessionToken();
			session.duplicateMatches.clear();
			session.duplicateMatches.set(duplicateToken, {
				draftFingerprint: inventoryCreateDraftFingerprint(action.draft, action.modelToken, action.form.marketplaceConfirmed),
				existing: { id: result.existing.id, expectedRevision: result.existing.revision },
				input,
			});
			return {
				stage: 'duplicate',
				duplicateToken,
				existing: inventoryCreateDuplicateSnapshot(result.existing, session.categories),
			};
		}
		session.savedItem = result.item;
		return { stage: 'succeeded', message: this.t('inventory.saved') };
	}

	private createInventoryInput(
		draft: InventoryCreateDraft,
		modelToken: string | undefined,
		marketplaceConfirmed: boolean,
		session: InventoryCreateSession,
	): NewInventoryItem | undefined {
		const partNumber = normalizeLcscPartNumber(draft.identity.lcscPartNumber);
		const pendingModel = modelToken ? session.modelMatches.get(modelToken) : undefined;
		if (modelToken && (!pendingModel || pendingModel.lcscPartNumber !== partNumber)) {
			return undefined;
		}
		const marketplaceReference = partNumber
			&& marketplaceConfirmed
			&& session.marketplaceVisits.has(partNumber)
			? this.marketplace.createReference(partNumber, 'user-confirmed')
			: undefined;
		return {
			categoryId: draft.categoryId,
			identity: draft.identity,
			marketplaceReference,
			edaModelReference: pendingModel?.model.reference,
			edaModelStatus: pendingModel ? 'available' : partNumber ? session.lookupStatuses.get(partNumber) ?? 'unchecked' : 'unchecked',
			quantity: draft.quantity,
			precision: draft.precision,
			state: draft.state,
			location: draft.location,
			note: draft.note,
			source: pendingModel ? 'catalog' : marketplaceReference ? 'marketplace' : 'manual',
		};
	}

	public importOrderFile(): Promise<void> {
		const trace = this.diagnostics.start('import-order');
		return this.execute(async () => {
			const pickedFiles = await this.files.pickOrderFiles();
			if (!pickedFiles) {
				trace.info('workflow.cancelled', { step: 'file-picker' });
				return;
			}
			trace.info('order-import.files.selected', { fileCount: pickedFiles.length });
			if (pickedFiles.length === 0) {
				this.dialog.info(this.t('import.noFile'), this.t('import.title'));
				return;
			}
			if (pickedFiles.length > MAX_ORDER_IMPORT_FILES) {
				this.dialog.info(this.t('import.tooManyFiles', MAX_ORDER_IMPORT_FILES), this.t('import.title'));
				return;
			}
			const previews = new Map<string, PendingOrderImportPreview>();
			const importingPreviewTokens = new Set<string>();
			await this.orderImportPanel.open(
				{ files: pickedFiles.map(file => ({ name: file.name })) },
				(action, reportProgress) => this.handleOrderImportPanelAction(
					action,
					reportProgress,
					pickedFiles,
					previews,
					importingPreviewTokens,
					trace,
				),
				trace,
			);
		}, trace);
	}

	public exportInventoryBackup(): Promise<void> {
		return this.execute(async () => {
			const document = await this.inventory.exportDocument();
			const date = new Date().toISOString().slice(0, 10);
			await this.files.saveJson(document, `jlceda-inventory-${date}.json`);
		});
	}

	public showDiagnosticLogs(): Promise<void> {
		return this.execute(async () => {
			await this.diagnostics.show();
		});
	}

	public exportDiagnosticLogs(): Promise<void> {
		return this.execute(async () => {
			const document = await this.diagnostics.exportDocument();
			const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
			await this.files.saveJson(document, `jlceda-inventory-diagnostics-${timestamp}.json`);
		});
	}

	public placeFromInventory(): Promise<void> {
		return this.execute(async () => {
			const items = (await this.inventory.list(false)).filter(item => item.edaModelReference);
			if (items.length === 0) {
				this.dialog.info(this.t('place.empty'), this.t('place.title'));
				return;
			}
			const selectedId = await this.dialog.select(
				items.map(item => ({ value: item.id, label: this.formatItemLine(item) })),
				this.t('place.title'),
			);
			const selected = selectedId ? items.find(item => item.id === selectedId) : undefined;
			if (!selected?.edaModelReference) {
				return;
			}
			const placed = await this.placement.placeWithMouse(selected.edaModelReference);
			this.dialog.info(this.t(placed ? 'place.ready' : 'place.failed'), this.t('place.title'));
		});
	}

	public about(): void {
		this.dialog.info(this.t('about.content', this.version), this.t('about.title'));
	}

	private async handleInventoryOverviewIntent(
		intent: InventoryOverviewIntent,
		items: readonly InventoryItem[],
		categories: readonly InventoryCategory[],
		pendingModelMatches: Map<string, PendingOverviewModelMatch>,
		pendingDuplicateMatches: Map<string, PendingOverviewDuplicateMatch>,
	): Promise<InventoryOverviewOperationResult> {
		try {
			const item = 'item' in intent ? items.find(candidate => candidate.id === intent.item.id) : undefined;
			if ('item' in intent) {
				assertOverviewItemRevision(item, intent.item.expectedRevision);
			}
			const locationOptions = collectLocationOptions(items, item?.location);
			switch (intent.type) {
				case 'view-item':
					await this.handleInventoryAction(item, 'details', locationOptions);
					break;
				case 'edit-item':
					await this.handleInventoryAction(item, 'edit', locationOptions);
					break;
				case 'update-item':
					return this.updateOverviewItem(item!, intent.draft, intent.categoryId, pendingDuplicateMatches);
				case 'merge-items':
					return this.mergeOverviewItems(intent, pendingDuplicateMatches);
				case 'open-marketplace':
					await this.handleInventoryAction(item, 'marketplace', locationOptions);
					break;
				case 'retry-model':
					return this.prepareOverviewModelMatch(item!, pendingModelMatches);
				case 'attach-model': {
					const pending = pendingModelMatches.get(intent.matchToken);
					if (!pending || pending.itemId !== intent.item.id || pending.expectedRevision !== intent.item.expectedRevision) {
						throw new InventoryRevisionConflictError(intent.item.id, intent.item.expectedRevision, item?.revision);
					}
					const latest = await this.inventory.get(intent.item.id);
					assertOverviewItemRevision(latest, intent.item.expectedRevision);
					const update = await this.inventory.updateItem(
						latest.id,
						intent.item.expectedRevision,
						createInventoryEditInput(
							inventoryItemDraft(latest),
							latest.marketplaceReference,
							pending.model.reference,
							'available',
						),
					);
					if (update.status === 'duplicate') {
						return { status: 'failed', message: this.t('inventoryItem.compareTitle') };
					}
					pendingModelMatches.delete(intent.matchToken);
					return { status: 'succeeded', message: this.t('edaModel.attached') };
				}
				case 'copy-common':
					await this.handleInventoryAction(item, 'copy', locationOptions);
					break;
				case 'delete-item': {
					const latest = await this.inventory.get(intent.item.id);
					assertOverviewItemRevision(latest, intent.item.expectedRevision);
					await this.inventory.remove(latest.id);
					break;
				}
				case 'move-items':
					await this.inventory.moveItemsToCategory(intent.items, intent.categoryId);
					break;
				case 'create-category':
					await this.inventory.createCategory({ name: intent.name, parentId: intent.parentId });
					break;
				case 'rename-category':
					await this.inventory.renameCategory(intent.category.id, intent.category.expectedRevision, intent.name);
					break;
				case 'delete-category': {
					const category = categories.find(entry => entry.id === intent.category.id);
					assertOverviewCategoryRevision(category, intent.category.expectedRevision);
					await this.inventory.deleteCategory(category.id, category.revision);
					break;
				}
				case 'reorder-categories':
					await this.inventory.reorderCategories(intent.parentId, intent.categories);
					break;
				case 'import-eda-categories':
					return this.importEdaCategoriesCore();
				case 'refresh':
					break;
			}
			return { status: 'succeeded' };
		}
		catch (error) {
			if (error instanceof InventoryRevisionConflictError || error instanceof InventoryCategoryRevisionConflictError) {
				return { status: 'failed', message: this.t('inventory.concurrentConflict') };
			}
			return { status: 'failed', message: this.t('error.generic', errorMessage(error)) };
		}
	}

	private async updateOverviewItem(
		item: InventoryItem,
		draft: InventoryItemEditDraft,
		categoryId: string | undefined,
		pendingDuplicateMatches: Map<string, PendingOverviewDuplicateMatch>,
	): Promise<InventoryOverviewOperationResult> {
		const rawPartNumber = normalizeInventoryText(draft.identity.lcscPartNumber);
		const nextPartNumber = rawPartNumber ? normalizeLcscPartNumber(rawPartNumber) : undefined;
		if (rawPartNumber && (!nextPartNumber || !/^C\d+$/.test(nextPartNumber))) {
			return { status: 'failed', message: this.t('part.lcscInvalid') };
		}
		let marketplaceReference = item.marketplaceReference;
		let edaModelReference = item.edaModelReference;
		let edaModelStatus = item.edaModelStatus;
		if (nextPartNumber !== item.identity.lcscPartNumber) {
			marketplaceReference = undefined;
			if (nextPartNumber) {
				const lookup = await this.lookupEdaModel(nextPartNumber);
				edaModelReference = lookup.model?.reference;
				edaModelStatus = lookup.status;
			}
			else {
				edaModelReference = undefined;
				edaModelStatus = 'unchecked';
			}
		}
		const input = createInventoryEditInput(draft, marketplaceReference, edaModelReference, edaModelStatus);
		const result = await this.inventory.updateItem(
			item.id,
			item.revision,
			input,
		);
		if (result.status === 'duplicate') {
			const matchToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
			const source = { id: item.id, expectedRevision: item.revision };
			const target = { id: result.existing.id, expectedRevision: result.existing.revision };
			pendingDuplicateMatches.set(matchToken, { categoryId, input, source, target });
			return {
				status: 'duplicate-match',
				candidate: result.candidate,
				existing: result.existing,
				matchToken,
				source,
				target,
			};
		}
		await this.applyOverviewCategory(result.item, categoryId);
		return { status: 'succeeded', message: this.t(result.status === 'merged' ? 'inventory.merged' : 'inventory.updated') };
	}

	private async mergeOverviewItems(
		intent: Extract<InventoryOverviewIntent, { type: 'merge-items' }>,
		pendingDuplicateMatches: Map<string, PendingOverviewDuplicateMatch>,
	): Promise<InventoryOverviewOperationResult> {
		const pending = pendingDuplicateMatches.get(intent.matchToken);
		if (!pending
			|| pending.source.id !== intent.source.id
			|| pending.source.expectedRevision !== intent.source.expectedRevision
			|| pending.target.id !== intent.target.id
			|| pending.target.expectedRevision !== intent.target.expectedRevision
			|| pending.categoryId !== intent.categoryId) {
			return { status: 'failed', message: this.t('inventory.concurrentConflict') };
		}
		pendingDuplicateMatches.delete(intent.matchToken);
		const result = await this.inventory.updateItem(
			pending.source.id,
			pending.source.expectedRevision,
			pending.input,
			{ id: pending.target.id, expectedRevision: pending.target.expectedRevision },
		);
		if (result.status !== 'merged') {
			return { status: 'failed', message: this.t('inventory.concurrentConflict') };
		}
		await this.applyOverviewCategory(result.item, pending.categoryId);
		return { status: 'succeeded', message: this.t('inventory.merged') };
	}

	private async applyOverviewCategory(item: InventoryItem, categoryId?: string): Promise<void> {
		if (item.categoryId === categoryId) {
			return;
		}
		await this.inventory.moveItemsToCategory(
			[{ id: item.id, expectedRevision: item.revision }],
			categoryId,
		);
	}

	private async prepareOverviewModelMatch(
		item: InventoryItem,
		pendingModelMatches: Map<string, PendingOverviewModelMatch>,
	): Promise<InventoryOverviewOperationResult> {
		const partNumber = item.identity.lcscPartNumber;
		if (!partNumber) {
			return { status: 'model-missing', message: this.t('edaModel.stillMissing') };
		}
		const lookup = await this.lookupEdaModel(partNumber);
		if (lookup.status === 'failed') {
			return { status: 'failed', message: this.t('edaModel.lookupFailed') };
		}
		if (!lookup.model) {
			return { status: 'model-missing', message: this.t('edaModel.stillMissing') };
		}
		const matchToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
		pendingModelMatches.set(matchToken, {
			expectedRevision: item.revision,
			itemId: item.id,
			model: lookup.model,
		});
		return {
			status: 'model-match',
			item: { id: item.id, expectedRevision: item.revision },
			matchToken,
			message: [
				`${this.t('part.nameLabel')}: ${lookup.model.identity.name}`,
				`${this.t('part.lcscLabel')}: ${lookup.model.identity.lcscPartNumber ?? partNumber}`,
				`${this.t('part.manufacturerPartLabel')}: ${lookup.model.identity.manufacturerPartNumber ?? '-'}`,
				`${this.t('part.packageLabel')}: ${lookup.model.identity.package ?? '-'}`,
			].join('\n'),
		};
	}

	private async handleInventoryAction(item: InventoryItem | undefined, action: string | undefined, locationOptions: readonly string[]): Promise<void> {
		if (!item) {
			this.dialog.info(this.t('inventory.concurrentMissing'));
			return;
		}
		switch (action) {
			case 'details': {
				const intent = await this.inventoryItemPanel.view(item);
				if (intent === 'edit') {
					await this.editInventoryItem(item, locationOptions);
				}
				break;
			}
			case 'edit':
				await this.editInventoryItem(item, locationOptions);
				break;
			case 'marketplace':
				if (item.identity.lcscPartNumber) {
					this.marketplace.openSearch(item.identity.lcscPartNumber);
				}
				break;
			case 'retry-model':
				await this.retryEdaModel(item);
				break;
			case 'copy':
				await this.copyToCommonLibrary(item);
				break;
			case 'remove': {
				const latest = await this.inventory.get(item.id);
				if (!latest) {
					this.dialog.info(this.t('inventory.concurrentMissing'));
					break;
				}
				const partNumber = latest.identity.lcscPartNumber ?? latest.identity.manufacturerPartNumber ?? '-';
				if (await this.dialog.confirm(
					this.t('inventory.confirmRemoveDetailed', latest.identity.name, partNumber, this.formatQuantity(latest)),
					this.t('inventory.remove'),
				)) {
					await this.inventory.remove(latest.id);
					this.dialog.info(this.t('inventory.removed'));
				}
				break;
			}
			default:
				break;
		}
	}

	private async editInventoryItem(item: InventoryItem, locationOptions: readonly string[]): Promise<void> {
		const originalPartNumber = item.identity.lcscPartNumber;
		let resolvedPartNumber = originalPartNumber;
		let marketplaceReference = item.marketplaceReference;
		let edaModelReference = item.edaModelReference;
		let edaModelStatus = item.edaModelStatus;
		let initial: InventoryItemEditDraft | undefined;
		let suggestion: PartIdentity | undefined;

		while (true) {
			const draft = await this.inventoryItemPanel.edit(item, { initial, suggestion, locationOptions });
			if (!draft) {
				return;
			}
			const rawPartNumber = normalizeInventoryText(draft.identity.lcscPartNumber);
			const nextPartNumber = rawPartNumber ? normalizeLcscPartNumber(rawPartNumber) : undefined;
			let draftForSave = draft;
			if (rawPartNumber && (!nextPartNumber || !/^C\d+$/.test(nextPartNumber))) {
				this.dialog.info(this.t('part.lcscInvalid'));
				initial = draft;
				suggestion = undefined;
				continue;
			}

			if (nextPartNumber !== resolvedPartNumber) {
				const previousPartNumber = resolvedPartNumber;
				resolvedPartNumber = nextPartNumber;
				draftForSave = normalizeEditedPartNumber(draft, previousPartNumber, nextPartNumber);
				initial = draftForSave;
				suggestion = undefined;
				if (nextPartNumber === originalPartNumber) {
					marketplaceReference = item.marketplaceReference;
					edaModelReference = item.edaModelReference;
					edaModelStatus = item.edaModelStatus;
				}
				else if (nextPartNumber) {
					const lookup = await this.lookupEdaModel(nextPartNumber);
					marketplaceReference = undefined;
					edaModelReference = lookup.model?.reference;
					edaModelStatus = lookup.status;
					if (lookup.model) {
						suggestion = {
							...lookup.model.identity,
							lcscPartNumber: nextPartNumber,
							supplierId: lookup.model.identity.supplierId ?? nextPartNumber,
						};
						continue;
					}
					this.dialog.info(
						this.t(lookup.status === 'failed' ? 'edaModel.lookupFailed' : 'edaModel.stillMissing'),
						this.t('edaModel.section'),
					);
					continue;
				}
				else {
					marketplaceReference = undefined;
					edaModelReference = undefined;
					edaModelStatus = 'unchecked';
				}
			}

			const editInput = createInventoryEditInput(
				draftForSave,
				marketplaceReference,
				edaModelReference,
				edaModelStatus,
			);
			try {
				let result = await this.inventory.updateItem(item.id, item.revision, editInput);
				if (result.status === 'duplicate') {
					const confirmed = await this.inventoryItemPanel.compare(result.existing, result.candidate);
					if (!confirmed) {
						return;
					}
					result = await this.inventory.updateItem(item.id, item.revision, editInput, {
						id: result.existing.id,
						expectedRevision: result.existing.revision,
					});
				}
				this.dialog.info(this.t(result.status === 'merged' ? 'inventory.merged' : 'inventory.updated'));
				return;
			}
			catch (error) {
				if (error instanceof InventoryRevisionConflictError) {
					this.dialog.info(this.t('inventory.concurrentConflict'));
					return;
				}
				throw error;
			}
		}
	}

	private async copyToCommonLibrary(item: InventoryItem): Promise<void> {
		if (!item.edaModelReference) {
			return;
		}
		const trace = this.diagnostics.start('copy-common');
		try {
			const result = await trace.waitFor('common-library.copy', () => this.commonLibrary.copy(
				item.edaModelReference!,
				{ lcscPartNumber: item.identity.lcscPartNumber },
			));
			trace.info('common-library.copy.result', {
				attempts: result.attempts.map(attempt => `${attempt.target}:${attempt.status}`).join(','),
				reason: result.status === 'failed' ? result.reason : undefined,
				status: result.status,
			});
			if (result.status === 'failed') {
				this.dialog.info(this.t(`common.failed.${result.reason}`));
				return;
			}
			this.dialog.info(this.t(
				result.status === 'already-present' ? 'common.alreadyPresent' : 'common.copied',
				this.t(`common.${result.target}`),
			));
		}
		catch (error) {
			trace.error('common-library.copy.failed', { error: errorMessage(error) });
			throw error;
		}
		finally {
			await this.diagnostics.flush();
		}
	}

	private async handleOrderImportPanelAction(
		action: OrderImportPanelAction,
		reportProgress: OrderImportPanelProgressReporter,
		pickedFiles: readonly PickedOrderFile[],
		previews: Map<string, PendingOrderImportPreview>,
		importingPreviewTokens: Set<string>,
		trace: DiagnosticTrace,
	): Promise<OrderImportPanelActionOutcome> {
		let importingToken: string | undefined;
		try {
			if (action.type === 'preview') {
				previews.clear();
				const input = await trace.waitFor('order-import.parsing', async () => {
					const files: OrderImportBatchInput['files'] = [];
					await reportProgress({ phase: 'parsing', completed: 0, total: pickedFiles.length });
					for (const [index, file] of pickedFiles.entries()) {
						const rows = parseOrderFile(file.name, file.content, action.settings.defaultState);
						if (rows.length === 0) {
							throw new Error(`${file.name}: ${this.t('import.noRows')}`);
						}
						const identity = await identifyOrderFile(file.name, file.content);
						files.push({
							fileName: file.name,
							orderNumber: identity.orderNumber,
							fingerprint: identity.fingerprint,
							items: rows.map(row => row.item),
							rowCount: rows.length,
							totalQuantity: rows.reduce((total, row) => total + (row.item.quantity ?? 0), 0),
						});
						await reportProgress({ phase: 'parsing', completed: index + 1, total: pickedFiles.length });
					}
					return { files };
				});
				const rowCount = input.files.reduce((total, file) => total + file.rowCount, 0);
				trace.info('order-import.parsing.completed', { fileCount: input.files.length, rowCount });
				const preview = await trace.waitFor(
					'order-import.preview',
					() => this.inventory.previewOrderImportBatch(input, action.settings.strategy),
				);
				const previewToken = createSessionToken();
				previews.set(previewToken, { input, preview, settings: { ...action.settings } });
				trace.info('order-import.preview.ready', {
					duplicateFileCount: preview.files.filter(file => file.status === 'duplicate').length,
					readyFileCount: preview.files.filter(file => file.status === 'ready').length,
					rowCount,
				});
				return {
					stage: 'preview',
					previewToken,
					preview: {
						files: preview.files.map(file => ({
							fileName: file.fileName,
							orderNumber: file.orderNumber,
							rowCount: file.rowCount,
							totalQuantity: file.totalQuantity,
							status: file.status,
							duplicateReason: file.duplicateReason,
							duplicateImportedAt: file.duplicateImportedAt,
							added: file.result.added,
							merged: file.result.merged,
							skipped: file.result.skipped,
						})),
						added: preview.result.added,
						merged: preview.result.merged,
						skipped: preview.result.skipped,
					},
				};
			}

			const pending = previews.get(action.previewToken);
			if (!pending
				|| pending.settings.defaultState !== action.settings.defaultState
				|| pending.settings.strategy !== action.settings.strategy) {
				return { stage: 'failed', message: this.t('import.previewExpired') };
			}
			if (importingPreviewTokens.has(action.previewToken)) {
				return { stage: 'failed', message: this.t('import.operationError') };
			}
			importingPreviewTokens.add(action.previewToken);
			importingToken = action.previewToken;
			const hydratedInput = await trace.waitFor(
				'order-import.model-matching',
				() => this.hydrateReadyOrderFiles(pending.input, pending.preview, reportProgress, trace),
			);
			await reportProgress({ phase: 'writing', completed: 0, total: 1 });
			const result = await trace.waitFor(
				'order-import.writing',
				() => this.inventory.importOrderBatch(hydratedInput, action.settings.strategy),
			);
			await reportProgress({ phase: 'writing', completed: 1, total: 1 });
			const importedFiles = result.files.filter(file => file.status === 'imported').length;
			const duplicateFiles = result.files.length - importedFiles;
			previews.delete(action.previewToken);
			trace.info('order-import.completed', {
				added: result.result.added,
				duplicateFiles,
				importedFiles,
				merged: result.result.merged,
				skipped: result.result.skipped,
			});
			return {
				stage: 'completed',
				summary: {
					importedFiles,
					duplicateFiles,
					added: result.result.added,
					merged: result.result.merged,
					skipped: result.result.skipped,
				},
			};
		}
		catch (error) {
			trace.error('order-import.failed', { errorName: error instanceof Error ? error.name : typeof error });
			return { stage: 'failed', message: this.t('import.error', errorMessage(error)) };
		}
		finally {
			if (importingToken) {
				importingPreviewTokens.delete(importingToken);
			}
		}
	}

	private async hydrateReadyOrderFiles(
		input: OrderImportBatchInput,
		preview: OrderImportBatchPreview,
		reportProgress?: OrderImportPanelProgressReporter,
		trace?: DiagnosticTrace,
	): Promise<OrderImportBatchInput> {
		if (preview.files.length !== input.files.length) {
			throw new Error('Order import preview no longer matches the selected files.');
		}
		const readyItems = input.files.flatMap((file, index) => preview.files[index]?.status === 'ready' ? file.items : []);
		const hydratedItems = await this.hydrateImportedItems(readyItems, reportProgress, trace);
		let itemIndex = 0;
		return {
			files: input.files.map((file, index) => {
				if (preview.files[index]?.status !== 'ready') {
					return file;
				}
				const items = hydratedItems.slice(itemIndex, itemIndex + file.items.length);
				itemIndex += file.items.length;
				return { ...file, items };
			}),
		};
	}

	private async hydrateImportedItems(
		items: NewInventoryItem[],
		reportProgress?: OrderImportPanelProgressReporter,
		trace?: DiagnosticTrace,
	): Promise<NewInventoryItem[]> {
		const lookupKeys = new Map<string, string>();
		for (const item of items) {
			const partNumber = item.identity.lcscPartNumber ?? item.identity.supplierId;
			if (partNumber) {
				lookupKeys.set(normalizeLcscPartNumber(partNumber) ?? partNumber, partNumber);
			}
		}
		const entries = [...lookupKeys.entries()];
		const lookups = new Map<string, { model?: EdaModel; status: EdaModelStatus }>();
		let cursor = 0;
		let completed = 0;
		trace?.info('order-import.model-matching.started', { uniqueLookupCount: entries.length });
		await reportProgress?.({ phase: 'model-matching', completed: 0, total: entries.length });
		const worker = async (): Promise<void> => {
			while (cursor < entries.length) {
				const entry = entries[cursor++];
				if (!entry) {
					return;
				}
				const [key, partNumber] = entry;
				lookups.set(key, await this.lookupEdaModel(partNumber));
				completed += 1;
				if (completed % 10 === 0 || completed === entries.length) {
					trace?.info('order-import.model-matching.progress', { completed, total: entries.length });
				}
				await reportProgress?.({ phase: 'model-matching', completed, total: entries.length });
			}
		};
		await Promise.all(Array.from(
			{ length: Math.min(ORDER_IMPORT_MODEL_CONCURRENCY, entries.length) },
			() => worker(),
		));
		trace?.info('order-import.model-matching.completed', { uniqueLookupCount: entries.length });
		return items.map((item) => {
			const partNumber = item.identity.lcscPartNumber ?? item.identity.supplierId;
			if (!partNumber) {
				return item;
			}
			const normalizedPartNumber = normalizeLcscPartNumber(partNumber);
			const modelLookup = lookups.get(normalizedPartNumber ?? partNumber) ?? { status: 'unchecked' as const };
			const edaModel = modelLookup.model;
			return {
				...item,
				identity: edaModel ? mergeImportedIdentity(item.identity, edaModel.identity, partNumber) : item.identity,
				marketplaceReference: normalizedPartNumber && /^C\d+$/.test(normalizedPartNumber)
					? this.marketplace.createReference(normalizedPartNumber, 'order-import')
					: undefined,
				edaModelReference: edaModel?.reference,
				edaModelStatus: modelLookup.status,
			};
		});
	}

	private async collectStockInput(defaultQuantity?: number, defaultLocation?: string, trace?: DiagnosticTrace): Promise<StockInput | undefined> {
		const quantityInput = await this.tracedInput(trace, 'dialog.quantity', {
			title: this.t('inventory.title'),
			label: this.t('inventory.quantityLabel'),
			type: 'number',
			value: defaultQuantity,
			min: 0,
			step: 1,
		});
		if (quantityInput === undefined) {
			return undefined;
		}
		const normalized = quantityInput.trim();
		let quantity: number | null = null;
		let precision: QuantityPrecision = 'unknown';
		if (normalized) {
			quantity = Number(normalized);
			if (!Number.isInteger(quantity) || quantity < 0) {
				this.dialog.info(this.t('inventory.quantityInvalid'));
				return undefined;
			}
			const selectedPrecision = await this.tracedSelect(trace, 'dialog.quantity-precision', [
				{ value: 'exact', label: this.t('inventory.exact') },
				{ value: 'estimated', label: this.t('inventory.estimated') },
			], this.t('inventory.title'), undefined, 'exact') as QuantityPrecision | undefined;
			if (!selectedPrecision) {
				return undefined;
			}
			precision = selectedPrecision;
		}
		const location = await this.tracedInput(trace, 'dialog.location', {
			title: this.t('inventory.title'),
			label: this.t('inventory.locationPrompt'),
			value: defaultLocation,
		});
		return { quantity, precision, location };
	}

	private formatItemLine(item: InventoryItem): string {
		const partNumber = item.identity.lcscPartNumber ?? item.identity.manufacturerPartNumber ?? '-';
		const modelStatus = this.t(`edaModel.${item.edaModelStatus}Short`);
		return `${this.t('status.itemLine', item.identity.name, partNumber, this.formatQuantity(item))} | ${modelStatus}`;
	}

	private formatQuantity(item: InventoryItem): string {
		if (item.state === 'depleted') {
			return this.t('inventory.depleted');
		}
		if (item.quantity === null) {
			return this.t('status.quantityUnknown');
		}
		return this.t(item.precision === 'estimated' ? 'status.quantityEstimated' : 'status.quantityExact', item.quantity);
	}

	private formatDetails(item: InventoryItem): string {
		const rows = [
			[this.t('marketplace.section'), this.formatMarketplaceStatus(item)],
			[this.t('edaModel.section'), this.t(`edaModel.${item.edaModelStatus}`)],
			[this.t('edaModel.symbolLabel'), item.edaModelReference?.symbolName],
			[this.t('edaModel.footprintLabel'), item.edaModelReference?.footprintName],
			[this.t('part.nameLabel'), item.identity.name],
			[this.t('part.lcscLabel'), item.identity.lcscPartNumber],
			[this.t('part.manufacturerLabel'), item.identity.manufacturer],
			[this.t('part.manufacturerPartLabel'), item.identity.manufacturerPartNumber],
			[this.t('part.packageLabel'), item.identity.package],
			[this.t('part.descriptionLabel'), item.identity.description],
			[this.t('inventory.quantityLabel'), this.formatQuantity(item)],
			[this.t('inventory.locationLabel'), item.location],
			[this.t('inventory.noteLabel'), item.note],
		];
		return rows.filter((row): row is [string, string] => Boolean(row[1])).map(([label, value]) => `${label}: ${value}`).join('\n');
	}

	private async collectMarketplaceProduct(partNumber: string, trace: DiagnosticTrace): Promise<{ identity: PartIdentity; reference?: MarketplaceReference } | undefined> {
		trace.info('marketplace.open', { partNumber });
		this.marketplace.openSearch(partNumber);
		trace.info('marketplace.browser-confirmation-only');
		const result = await this.tracedSelect(trace, 'dialog.marketplace-confirmation', [
			{ value: 'confirmed', label: this.t('marketplace.confirmed') },
			{ value: 'not-found', label: this.t('marketplace.notFound') },
		], this.t('marketplace.title'), this.t('marketplace.confirmPrompt', partNumber));
		if (!result) {
			return undefined;
		}
		const details = await trace.waitFor('dialog.product-details', () => this.productDetailsForm.open({
			partNumber,
			marketplaceConfirmed: result === 'confirmed',
		}, trace));
		if (!details) {
			return undefined;
		}
		return {
			identity: {
				...details,
				lcscPartNumber: partNumber,
				supplierId: partNumber,
			},
			reference: result === 'confirmed' ? this.marketplace.createReference(partNumber, 'user-confirmed') : undefined,
		};
	}

	private async retryEdaModel(item: InventoryItem): Promise<void> {
		const partNumber = item.identity.lcscPartNumber;
		if (!partNumber) {
			return;
		}
		const lookup = await this.lookupEdaModel(partNumber);
		if (lookup.status === 'failed') {
			this.dialog.info(this.t('edaModel.lookupFailed'), this.t('edaModel.section'));
			return;
		}
		if (!lookup.model) {
			this.dialog.info(this.t('edaModel.stillMissing'), this.t('edaModel.section'));
			return;
		}
		await this.inventory.attachEdaModel(item.id, lookup.model.reference);
		this.dialog.info(this.t('edaModel.attached'), this.t('edaModel.section'));
	}

	private formatMarketplaceStatus(item: InventoryItem): string {
		if (!item.marketplaceReference) {
			return this.t(item.identity.lcscPartNumber ? 'marketplace.unconfirmed' : 'marketplace.notLinked');
		}
		return this.t(item.marketplaceReference.evidence === 'order-import' ? 'marketplace.fromOrder' : 'marketplace.userConfirmed');
	}

	private showSavedItem(item: InventoryItem): void {
		this.dialog.info(
			`${this.t('inventory.saved')}\n\n${this.formatDetails(item)}`,
			this.t('inventory.savedTitle'),
		);
	}

	private async lookupEdaModel(partNumber: string, trace?: DiagnosticTrace): Promise<{ model?: EdaModel; status: EdaModelStatus }> {
		try {
			const operation = () => this.edaModels.findByLcscPartNumber(partNumber);
			const model = trace ? await trace.waitFor('eda-model.lookup', operation) : await operation();
			const status = model ? 'available' : 'missing';
			trace?.info('eda-model.result', { status });
			return model ? { model, status } : { status };
		}
		catch (error) {
			trace?.warn('eda-model.result', { error: errorMessage(error), status: 'failed' });
			return { status: 'failed' };
		}
	}

	private async tracedInput(trace: DiagnosticTrace | undefined, step: string, options: InputOptions): Promise<string | undefined> {
		const operation = () => this.dialog.input(options, trace
			? (event, details) => trace.info(`dialog.${event}`, { ...details, step })
			: undefined);
		const value = trace ? await trace.waitFor(step, operation) : await operation();
		trace?.info('dialog.result', { status: inputStatus(value), step });
		return value;
	}

	private async tracedSelect(trace: DiagnosticTrace | undefined, step: string, options: SelectOption[], title: string, label?: string, defaultValue?: string): Promise<string | undefined> {
		const operation = () => this.dialog.select(options, title, label, defaultValue, trace
			? (event, details) => trace.info(`dialog.${event}`, { ...details, step })
			: undefined);
		const value = trace ? await trace.waitFor(step, operation) : await operation();
		trace?.info('dialog.result', { status: value ?? 'cancelled', step });
		return value;
	}

	private async execute(operation: () => Promise<void>, trace?: DiagnosticTrace): Promise<void> {
		try {
			await operation();
		}
		catch (error) {
			trace?.error('workflow.error', { error: errorMessage(error) });
			this.dialog.info(this.t('error.generic', errorMessage(error)), this.t('dialog.error'));
		}
		finally {
			if (trace) {
				await this.diagnostics.flush();
			}
		}
	}
}

function assertOverviewItemRevision(item: InventoryItem | undefined, expectedRevision: number): asserts item is InventoryItem {
	if (!item || item.revision !== expectedRevision) {
		throw new InventoryRevisionConflictError(item?.id ?? 'missing', expectedRevision, item?.revision);
	}
}

function assertOverviewCategoryRevision(
	category: InventoryCategory | undefined,
	expectedRevision: number,
): asserts category is InventoryCategory {
	if (!category || category.revision !== expectedRevision) {
		throw new InventoryCategoryRevisionConflictError(category?.id ?? 'missing', expectedRevision, category?.revision);
	}
}

function mergeImportedIdentity(imported: PartIdentity, model: PartIdentity, fallbackPartNumber: string): PartIdentity {
	const importedNameIsFallback = imported.name === fallbackPartNumber;
	return {
		name: importedNameIsFallback ? model.name : imported.name,
		lcscPartNumber: imported.lcscPartNumber ?? model.lcscPartNumber,
		supplierId: imported.supplierId ?? model.supplierId,
		manufacturerPartNumber: imported.manufacturerPartNumber ?? model.manufacturerPartNumber,
		manufacturer: imported.manufacturer ?? model.manufacturer,
		package: imported.package ?? model.package,
		description: imported.description ?? model.description,
	};
}

function inventoryCreateDuplicateSnapshot(
	item: InventoryItem,
	categories: readonly InventoryCategory[],
): InventoryCreateDuplicateSnapshot {
	const category = item.categoryId ? categories.find(candidate => candidate.id === item.categoryId) : undefined;
	const parent = category?.parentId ? categories.find(candidate => candidate.id === category.parentId) : undefined;
	return {
		id: item.id,
		revision: item.revision,
		identity: item.identity,
		quantity: item.quantity,
		precision: item.precision,
		state: item.state,
		categoryName: category ? [parent?.name, category.name].filter(Boolean).join(' / ') : undefined,
		location: item.location,
		note: item.note,
	};
}

function inventoryCreateDraftFingerprint(
	draft: InventoryCreateDraft,
	modelToken: string | undefined,
	marketplaceConfirmed: boolean,
): string {
	return JSON.stringify({
		categoryId: draft.categoryId ?? '',
		identity: {
			description: draft.identity.description ?? '',
			lcscPartNumber: draft.identity.lcscPartNumber ?? '',
			manufacturer: draft.identity.manufacturer ?? '',
			manufacturerPartNumber: draft.identity.manufacturerPartNumber ?? '',
			name: draft.identity.name,
			package: draft.identity.package ?? '',
			supplierId: draft.identity.supplierId ?? '',
		},
		location: draft.location ?? '',
		marketplaceConfirmed,
		modelToken: modelToken ?? '',
		note: draft.note ?? '',
		precision: draft.precision,
		quantity: draft.quantity,
		state: draft.state,
	});
}

function createSessionToken(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function normalizeEditedPartNumber(
	draft: InventoryItemEditDraft,
	previousPartNumber: string | undefined,
	nextPartNumber: string | undefined,
): InventoryItemEditDraft {
	const supplierId = normalizeInventoryText(draft.identity.supplierId);
	const shouldSyncSupplier = !supplierId || supplierId === previousPartNumber;
	return {
		...draft,
		identity: {
			...draft.identity,
			lcscPartNumber: nextPartNumber ?? '',
			supplierId: shouldSyncSupplier ? nextPartNumber ?? '' : supplierId,
		},
	};
}

function collectLocationOptions(items: readonly InventoryItem[], currentLocation?: string): string[] {
	const current = normalizeInventoryText(currentLocation ?? '');
	const locations = items
		.map(item => normalizeInventoryText(item.location ?? ''))
		.filter(Boolean);
	return [...new Set([current, ...locations].filter(Boolean))].slice(0, 200);
}

function createInventoryEditInput(
	draft: InventoryItemEditDraft,
	marketplaceReference: MarketplaceReference | undefined,
	edaModelReference: EdaModelReference | undefined,
	edaModelStatus: EdaModelStatus,
): InventoryEditInput {
	return {
		identity: {
			name: draft.identity.name,
			lcscPartNumber: optionalText(draft.identity.lcscPartNumber),
			supplierId: optionalText(draft.identity.supplierId),
			manufacturer: optionalText(draft.identity.manufacturer),
			manufacturerPartNumber: optionalText(draft.identity.manufacturerPartNumber),
			package: optionalText(draft.identity.package),
			description: optionalText(draft.identity.description),
		},
		marketplaceReference,
		edaModelReference,
		edaModelStatus,
		quantity: draft.quantity,
		precision: draft.quantity === 0 ? 'exact' : draft.precision,
		location: optionalText(draft.location),
		note: optionalText(draft.note),
	};
}

function inventoryItemDraft(item: InventoryItem): InventoryItemEditDraft {
	return {
		identity: {
			name: item.identity.name,
			lcscPartNumber: item.identity.lcscPartNumber ?? '',
			supplierId: item.identity.supplierId ?? '',
			manufacturer: item.identity.manufacturer ?? '',
			manufacturerPartNumber: item.identity.manufacturerPartNumber ?? '',
			package: item.identity.package ?? '',
			description: item.identity.description ?? '',
		},
		location: item.location ?? '',
		note: item.note ?? '',
		precision: item.precision === 'estimated' ? 'estimated' : 'exact',
		quantity: item.quantity ?? 0,
	};
}

function optionalText(value: string): string | undefined {
	return normalizeInventoryText(value) || undefined;
}

function inputStatus(value?: string): string {
	if (value === undefined) {
		return 'cancelled';
	}
	return value.trim() ? 'submitted' : 'empty';
}
