import type { BomDiffCsvLabels } from '../../../features/bom-analysis/application/export-bom-diff-csv';
import type { BomDesignDemand, BomMappingResult, BomRowIssue, ParsedBomFile } from '../../../features/bom-analysis/domain/bom-analysis';
import type { CommonLibrary } from '../../../features/common-library/ports/common-library';
import type { EdaModel, EdaModelCatalog } from '../../../features/component-catalog/ports/component-catalog';
import type { DesignStockCsvLabels } from '../../../features/design-stock-check/application/export-design-stock-csv';
import type { DesignComponentSnapshot as StockDesignComponentSnapshot } from '../../../features/design-stock-check/domain/design-stock-check';
import type { CurrentDesignReader, DesignComponentSnapshot, SelectedDesignComponentsReader } from '../../../features/design-stock-check/ports/design-component-reader';
import type { ReplenishmentCsvLabels } from '../../../features/inventory/application/export-replenishment-csv';
import type { InventoryEditInput, InventoryService } from '../../../features/inventory/application/inventory-service';
import type { InventoryCategory } from '../../../features/inventory/domain/inventory-category';
import type { EdaModelReference, EdaModelStatus, InventoryItem, MarketplaceReference, NewInventoryItem, PartIdentity, QuantityPrecision } from '../../../features/inventory/domain/inventory-item';
import type { OrderImportBatchInput, OrderImportBatchPreview } from '../../../features/inventory/domain/order-import-batch';
import type { SubstituteLink } from '../../../features/inventory/domain/substitute-link';
import type { EdaLibraryCategories, EdaLibraryCategorySource } from '../../../features/inventory/ports/eda-library-categories';
import type { ExternalLinkNavigator } from '../../../features/inventory/ports/external-link-navigator';
import type { MarketplaceNavigator } from '../../../features/marketplace-catalog/ports/marketplace-navigator';
import type { ParseLcscPackageCodeResult } from '../../../features/package-scan/application/parse-lcsc-package-code';
import type { ProcurementCsvLabels } from '../../../features/project-planning/application/export-procurement-csv';
import type { EdaFileClient, PickedOrderFile } from '../eda/file-client';
import type { Translate } from '../eda/i18n-client';
import type { EdaPlacementClient } from '../eda/placement-client';
import type { AutomaticBackupFailure, AutomaticInventoryBackup } from '../persistence/automatic-inventory-backup';
import type { BomDiffPanel } from './bom-diff-panel';
import type { BomMappingPanel } from './bom-mapping-panel';
import type { BomStockOutPanel } from './bom-stock-out-panel';
import type { DesignStockCheckPanel } from './design-stock-check-panel';
import type { InventoryCreateActionOutcome, InventoryCreateDraft, InventoryCreateDuplicateSnapshot, InventoryCreateFormState, InventoryCreateMode, InventoryCreatePanel, InventoryCreatePanelAction } from './inventory-create-panel';
import type { InventoryItemEditDraft, InventoryItemPanel } from './inventory-item-panel';
import type { InventoryOverviewIntent, InventoryOverviewOperationResult, InventoryOverviewPanel, InventoryOverviewViewState } from './inventory-overview-panel';
import type { InventoryTransactionsPanel } from './inventory-transactions-panel';
import type { Diagnostics, DiagnosticTrace } from './native-diagnostics';
import type { InputOptions, NativeDialog, SelectOption } from './native-dialog';
import type { OrderImportPanel, OrderImportPanelAction, OrderImportPanelActionOutcome, OrderImportPanelProgressReporter, OrderImportPanelSettings } from './order-import-panel';
import type { ProductDetailsForm } from './product-details-form';
import type { ProjectPlanningOperationResult, ProjectPlanningPanel, ProjectPlanningPanelSnapshot } from './project-planning-panel';
import { createBomDiffCsv } from '../../../features/bom-analysis/application/export-bom-diff-csv';
import { mapBomRows } from '../../../features/bom-analysis/application/map-bom-rows';
import { fingerprintBomSource, prepareBomStockOut } from '../../../features/bom-analysis/application/prepare-bom-stock-out';
import { readBomFile } from '../../../features/bom-analysis/application/read-bom-file';
import { diffNormalizedBoms } from '../../../features/bom-analysis/domain/diff-boms';
import { checkDesignStock } from '../../../features/design-stock-check/application/check-design-stock';
import { createDesignStockShortageCsv } from '../../../features/design-stock-check/application/export-design-stock-csv';
import { createReplenishmentCsv } from '../../../features/inventory/application/export-replenishment-csv';
import { BomStockOutBlockedError, InventoryCategoryRevisionConflictError, InventoryItemActiveStockOutReferenceError, InventoryItemSubstituteReferenceError, InventoryRevisionConflictError, ProjectSnapshotRevisionConflictError, PurchaseRecordRevisionConflictError, StockOutReversalBlockedError, SubstituteLinkDuplicateError, SubstituteLinkRevisionConflictError } from '../../../features/inventory/application/inventory-service';
import { InventoryBackupValidationError, MAX_INVENTORY_BACKUP_TEXT_LENGTH, validateInventoryBackup } from '../../../features/inventory/application/validate-inventory-backup';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../../features/inventory/domain/inventory-item';
import { listConfirmedSubstituteCandidates } from '../../../features/inventory/domain/substitute-link';
import { InventoryDocumentRevisionConflictError as DocumentRevisionConflictError } from '../../../features/inventory/ports/inventory-repository';
import { identifyOrderFile } from '../../../features/order-import/application/order-file-identity';
import { MAX_ORDER_IMPORT_FILES, parseOrderFile } from '../../../features/order-import/application/parse-order-file';
import { parseLcscPackageCode } from '../../../features/package-scan/application/parse-lcsc-package-code';
import { analyzeProjectDemand, createProcurementSuggestions } from '../../../features/project-planning/application/analyze-project-demand';
import { createProjectSnapshot } from '../../../features/project-planning/application/create-project-snapshot';
import { diffProjectSnapshots } from '../../../features/project-planning/application/diff-project-snapshots';
import { createProcurementCsv } from '../../../features/project-planning/application/export-procurement-csv';
import { InvalidAutomaticBackupFolderError } from '../persistence/automatic-inventory-backup';

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
		private readonly selectedDesignComponents?: SelectedDesignComponentsReader,
		private readonly currentDesign?: CurrentDesignReader,
		private readonly designStockCheckPanel?: DesignStockCheckPanel,
		private readonly automaticBackup?: AutomaticInventoryBackup,
		private readonly bomMappingPanel?: BomMappingPanel,
		private readonly bomDiffPanel?: BomDiffPanel,
		private readonly bomStockOutPanel?: BomStockOutPanel,
		private readonly inventoryTransactionsPanel?: InventoryTransactionsPanel,
		private readonly projectPlanningPanel?: ProjectPlanningPanel,
		private readonly externalLinks?: ExternalLinkNavigator,
	) {}

	public openInventory(initialState?: InventoryOverviewViewState): Promise<void> {
		const trace = this.diagnostics.start('inventory-overview', false);
		return this.execute(() => this.runInventoryOverview(initialState, trace), trace);
	}

	private async runInventoryOverview(initialState: InventoryOverviewViewState | undefined, trace: DiagnosticTrace): Promise<void> {
		let document = await this.inventory.exportDocument();
		const pendingModelMatches = new Map<string, PendingOverviewModelMatch>();
		const pendingDuplicateMatches = new Map<string, PendingOverviewDuplicateMatch>();
		await this.inventoryOverviewPanel.open({
			items: document.items,
			categories: document.categories,
			initialState,
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
	}

	public addByLcscPartNumber(): Promise<void> {
		return this.openInventoryCreatePanel('lcsc');
	}

	public addCustomComponent(): Promise<void> {
		return this.openInventoryCreatePanel('custom');
	}

	public importPackageCode(): Promise<void> {
		const trace = this.diagnostics.start('import-package-code');
		return this.execute(async () => {
			const rawCode = await this.tracedInput(trace, 'package-code.input', {
				title: this.t('packageScan.title'),
				label: this.t('packageScan.input'),
			});
			if (rawCode === undefined) {
				trace.info('workflow.cancelled', { step: 'package-code.input' });
				return;
			}
			const parsed = parseLcscPackageCode(rawCode);
			if (parsed.status === 'invalid') {
				trace.warn('package-code.invalid', { reason: parsed.reason });
				this.dialog.info(this.t(packageScanErrorKey(parsed.reason)), this.t('packageScan.title'));
				return;
			}
			if (!await this.dialog.confirm(
				this.t(
					'packageScan.confirmPreview',
					rawCode.trim(),
					parsed.value.lcscPartNumber,
					parsed.value.manufacturerPartNumber ?? this.t('inventoryItem.emptyValue'),
					parsed.value.quantity,
				),
				this.t('packageScan.title'),
			)) {
				return;
			}
			await this.runInventoryCreatePanel('lcsc', {
				lcscPartNumber: parsed.value.lcscPartNumber,
				supplierId: parsed.value.lcscPartNumber,
				name: parsed.value.manufacturerPartNumber ?? parsed.value.lcscPartNumber,
				manufacturerPartNumber: parsed.value.manufacturerPartNumber ?? '',
				quantityMode: 'exact',
				quantity: String(parsed.value.quantity),
			}, trace);
		}, trace);
	}

	public locateSelectedInventory(): Promise<void> {
		const trace = this.diagnostics.start('locate-selected-inventory', false);
		return this.execute(async () => {
			if (!this.selectedDesignComponents) {
				this.dialog.info(this.t('selectedInventory.unsupported'), this.t('selectedInventory.title'));
				return;
			}
			const result = await trace.waitFor('selected-components.read', () => this.selectedDesignComponents!.readSelectedComponents());
			if (result.status !== 'available') {
				trace.warn('selected-components.result', { status: result.status });
				this.dialog.info(
					this.t(result.status === 'no-active-document' || result.status === 'unsupported-document'
						? 'selectedInventory.noDocument'
						: 'selectedInventory.unsupported'),
					this.t('selectedInventory.title'),
				);
				return;
			}
			if (result.snapshot.components.length === 0) {
				this.dialog.info(this.t('selectedInventory.empty'), this.t('selectedInventory.title'));
				return;
			}
			const component = await this.chooseSelectedDesignComponent(result.snapshot.components);
			if (!component) {
				return;
			}
			const document = await this.inventory.exportDocument();
			const matches = document.items.filter(item => matchesSelectedDesignComponent(item, component));
			let item: InventoryItem | undefined;
			if (matches.length === 1) {
				item = matches[0];
			}
			else if (matches.length > 1) {
				const selectedId = await this.dialog.select(
					matches.map(candidate => ({ value: candidate.id, label: this.formatItemLine(candidate) })),
					this.t('selectedInventory.title'),
					this.t('selectedInventory.chooseInventory'),
				);
				item = matches.find(candidate => candidate.id === selectedId);
				if (!item) {
					return;
				}
			}
			if (!item) {
				if (!await this.dialog.confirm(
					this.t('selectedInventory.offerAdd', component.designator ?? component.name ?? component.lcscPartNumber ?? '-'),
					this.t('selectedInventory.title'),
				)) {
					return;
				}
				const mode: InventoryCreateMode = component.lcscPartNumber ? 'lcsc' : 'custom';
				await this.runInventoryCreatePanel(mode, {
					lcscPartNumber: component.lcscPartNumber ?? '',
					supplierId: component.lcscPartNumber ?? '',
					name: component.name ?? component.manufacturerPartNumber ?? component.lcscPartNumber ?? '',
					manufacturer: component.manufacturer ?? '',
					manufacturerPartNumber: component.manufacturerPartNumber ?? '',
					package: component.package ?? '',
					quantityMode: 'exact',
					quantity: '1',
				}, trace);
				return;
			}
			const query = item.identity.lcscPartNumber
				?? item.identity.manufacturerPartNumber
				?? item.identity.name;
			await this.runInventoryOverview(createOverviewSearchState(query, item.id), trace);
		}, trace);
	}

	public checkCurrentDesignStock(): Promise<void> {
		const trace = this.diagnostics.start('check-current-design-stock', false);
		return this.execute(async () => {
			if (!this.currentDesign || !this.designStockCheckPanel) {
				await this.offerExternalBomStockCheck(this.t('designStockCheck.unsupported'), trace);
				return;
			}
			const design = await trace.waitFor('design-stock-check.read-current-design', () => this.currentDesign!.readCurrentDesign());
			if (design.status !== 'available') {
				trace.warn('design-stock-check.read-result', { status: design.status });
				const key = design.status === 'no-active-document' || design.status === 'unsupported-document'
					? 'designStockCheck.noDocument'
					: design.status === 'capability-unavailable'
						? 'designStockCheck.unsupported'
						: 'designStockCheck.readFailed';
				await this.offerExternalBomStockCheck(this.t(key), trace);
				return;
			}
			const rawBoardQuantity = await this.tracedInput(trace, 'design-stock-check.board-quantity', {
				title: this.t('designStockCheck.title'),
				label: this.t('designStockCheck.boardQuantityPrompt'),
				type: 'number',
				value: 1,
				min: 1,
				step: 1,
			});
			if (rawBoardQuantity === undefined) {
				return;
			}
			const boardQuantity = Number(rawBoardQuantity.trim());
			if (!Number.isSafeInteger(boardQuantity) || boardQuantity <= 0) {
				this.dialog.info(this.t('designStockCheck.boardQuantityInvalid'), this.t('designStockCheck.title'));
				return;
			}
			const inventory = await trace.waitFor('design-stock-check.read-inventory', () => this.inventory.exportDocument());
			const report = checkDesignStock({
				components: design.snapshot.components.map(toStockDesignComponent),
				inventory: inventory.items,
				boardQuantity,
			});
			trace.info('design-stock-check.report', {
				boardQuantity,
				componentCount: design.snapshot.components.length,
				rowCount: report.rows.length,
			});
			await this.designStockCheckPanel.open({
				report,
				source: design.snapshot.document.kind,
			}, async (action) => {
				if (action.type === 'close') {
					return { status: 'succeeded' };
				}
				try {
					const csv = createDesignStockShortageCsv(report, this.designStockCsvLabels());
					await this.files.saveCsv(csv, `jlceda-inventory-shortage-${new Date().toISOString().slice(0, 10)}.csv`);
					return { status: 'succeeded', message: this.t('designStockCheck.exportSucceeded') };
				}
				catch (error) {
					trace.error('design-stock-check.export.failed', { error: errorMessage(error) });
					return { status: 'failed', message: this.t('designStockCheck.operationError') };
				}
			}, trace);
		}, trace);
	}

	public checkExternalBomStock(): Promise<void> {
		const trace = this.diagnostics.start('check-external-bom-stock', false);
		return this.execute(() => this.runExternalBomStockCheck(trace), trace);
	}

	public compareBomVersions(): Promise<void> {
		const trace = this.diagnostics.start('compare-bom-versions', false);
		return this.execute(() => this.runBomVersionComparison(trace), trace);
	}

	public stockOutBomFile(): Promise<void> {
		const trace = this.diagnostics.start('stock-out-bom-file', false);
		return this.execute(() => this.runBomStockOut(trace), trace);
	}

	public openInventoryTransactions(): Promise<void> {
		const trace = this.diagnostics.start('inventory-transactions', false);
		return this.execute(async () => {
			if (!this.inventoryTransactionsPanel) {
				this.dialog.info(this.t('inventoryTransactions.unsupported'), this.t('inventoryTransactions.title'));
				return;
			}
			const initial = await this.inventory.exportDocument();
			await this.inventoryTransactionsPanel.open({
				batches: initial.stockOutBatches,
				transactions: initial.transactions,
			}, async (action) => {
				if (action.type === 'close') {
					return { status: 'succeeded' };
				}
				if (action.type === 'refresh') {
					const refreshed = await this.inventory.exportDocument();
					return {
						status: 'succeeded',
						snapshot: {
							batches: refreshed.stockOutBatches,
							transactions: refreshed.transactions,
						},
					};
				}
				try {
					const preview = await this.inventory.previewStockOutReversal(action.batchId);
					if (preview.status !== 'ready') {
						return { status: 'failed', message: this.t(`inventoryTransactions.undo.${preview.status}`) };
					}
					const note = await this.tracedInput(trace, 'inventory-transactions.undo-note', {
						title: this.t('inventoryTransactions.title'),
						label: this.t('inventoryTransactions.undoNotePrompt'),
					});
					if (note === undefined) {
						return { status: 'failed', message: this.t('inventoryTransactions.undoCancelled') };
					}
					const result = await this.inventory.reverseStockOutBatch(
						action.batchId,
						preview.documentRevision,
						note,
					);
					const refreshed = await this.inventory.exportDocument();
					trace.info('inventory-transactions.batch-reversed', {
						lineCount: result.transactions.length,
						documentRevision: result.documentRevision,
					});
					return {
						status: 'succeeded',
						message: this.t('inventoryTransactions.undoCompleted', result.transactions.length),
						snapshot: {
							batches: refreshed.stockOutBatches,
							transactions: refreshed.transactions,
						},
					};
				}
				catch (error) {
					if (error instanceof DocumentRevisionConflictError || error instanceof StockOutReversalBlockedError) {
						return { status: 'failed', message: this.t('inventoryTransactions.concurrentConflict') };
					}
					trace.error('inventory-transactions.undo.failed', { error: errorMessage(error) });
					return { status: 'failed', message: this.t('inventoryTransactions.operationError') };
				}
			}, trace);
		}, trace);
	}

	public openProjectPlanning(): Promise<void> {
		const trace = this.diagnostics.start('project-planning', false);
		return this.execute(async () => {
			if (!this.projectPlanningPanel) {
				this.dialog.info(this.t('projectPlanning.unsupported'), this.t('projectPlanning.title'));
				return;
			}
			const initial = await this.inventory.exportDocument();
			await this.projectPlanningPanel.open(
				this.createProjectPlanningSnapshot(initial),
				async (operation) => {
					try {
						if (operation.intent.type === 'close') {
							return { status: 'succeeded' };
						}
						let message: string | undefined;
						switch (operation.intent.type) {
							case 'capture-current':
								return this.captureCurrentProjectSnapshot(trace);
							case 'set-board-quantity':
								await this.inventory.setProjectSnapshotBoardQuantity(
									operation.intent.snapshot.id,
									operation.intent.snapshot.expectedRevision,
									operation.intent.boardQuantity,
								);
								message = this.t('projectPlanning.boardQuantityUpdated');
								break;
							case 'remove-snapshot':
								await this.inventory.removeProjectSnapshot(
									operation.intent.snapshot.id,
									operation.intent.snapshot.expectedRevision,
								);
								message = this.t('projectPlanning.snapshotRemoved');
								break;
							case 'export-procurement': {
								const document = await this.inventory.exportDocument();
								const suggestions = createProcurementSuggestions(analyzeProjectDemand(
									document.projectSnapshots,
									document.items,
								));
								await this.files.saveCsv(
									createProcurementCsv(suggestions, this.procurementCsvLabels()),
									`jlceda-inventory-procurement-${new Date().toISOString().slice(0, 10)}.csv`,
								);
								message = this.t('projectPlanning.exportSucceeded');
								break;
							}
							case 'add-purchase':
								await this.inventory.addPurchaseRecord(operation.intent.draft);
								message = this.t('projectPlanning.purchaseAdded');
								break;
							case 'remove-purchase':
								await this.inventory.removePurchaseRecord(
									operation.intent.purchase.id,
									operation.intent.purchase.expectedRevision,
								);
								message = this.t('projectPlanning.purchaseRemoved');
								break;
							case 'refresh':
								break;
						}
						return {
							status: 'succeeded',
							message,
							snapshot: this.createProjectPlanningSnapshot(await this.inventory.exportDocument()),
						};
					}
					catch (error) {
						if (error instanceof DocumentRevisionConflictError
							|| error instanceof InventoryRevisionConflictError
							|| error instanceof ProjectSnapshotRevisionConflictError
							|| error instanceof PurchaseRecordRevisionConflictError) {
							return { status: 'failed', message: this.t('projectPlanning.concurrentConflict') };
						}
						trace.error('project-planning.operation.failed', { error: errorMessage(error) });
						return { status: 'failed', message: this.t('projectPlanning.operationError') };
					}
				},
				trace,
			);
		}, trace);
	}

	public manageSubstituteLinks(): Promise<void> {
		const trace = this.diagnostics.start('manage-substitute-links', false);
		return this.execute(async () => {
			const document = await this.inventory.exportDocument();
			if (document.items.length < 2) {
				this.dialog.info(this.t('substituteLinks.notEnoughItems'), this.t('substituteLinks.title'));
				return;
			}
			const baseItemId = await this.tracedSelect(
				trace,
				'substitute-links.base-item',
				document.items
					.toSorted((left, right) => left.identity.name.localeCompare(right.identity.name) || left.id.localeCompare(right.id))
					.map(item => ({ value: item.id, label: this.formatItemLine(item) })),
				this.t('substituteLinks.title'),
				this.t('substituteLinks.chooseBase'),
			);
			if (!baseItemId) {
				return;
			}
			const requiredQuantityText = await this.tracedInput(trace, 'substitute-links.required-quantity', {
				title: this.t('substituteLinks.title'),
				label: this.t('substituteLinks.requiredQuantity'),
				type: 'number',
				value: 1,
				min: 1,
				step: 1,
			});
			if (requiredQuantityText === undefined) {
				return;
			}
			const requiredQuantity = Number(requiredQuantityText.trim());
			if (!Number.isSafeInteger(requiredQuantity) || requiredQuantity <= 0) {
				this.dialog.info(this.t('substituteLinks.invalidRequiredQuantity'), this.t('substituteLinks.title'));
				return;
			}
			await this.runSubstituteLinkManager(baseItemId, requiredQuantity, trace);
		}, trace);
	}

	private async runSubstituteLinkManager(
		baseItemId: string,
		requiredQuantity: number,
		trace: DiagnosticTrace,
	): Promise<void> {
		const document = await this.inventory.exportDocument();
		const baseItem = document.items.find(item => item.id === baseItemId);
		if (!baseItem) {
			this.dialog.info(this.t('substituteLinks.concurrentConflict'), this.t('substituteLinks.title'));
			return;
		}
		const candidates = listConfirmedSubstituteCandidates(
			baseItem.id,
			requiredQuantity,
			document.items,
			document.substituteLinks,
		);
		const action = await this.tracedSelect(
			trace,
			'substitute-links.action',
			[
				{ value: '__create__', label: this.t('substituteLinks.createAction') },
				...candidates.map(candidate => ({
					value: `link:${candidate.link.id}`,
					label: this.t(
						'substituteLinks.candidateOption',
						this.formatItemLine(candidate.item),
						this.t(`substituteLinks.status.${candidate.status}`),
					),
				})),
			],
			this.t('substituteLinks.title'),
			this.t('substituteLinks.candidatePrompt', baseItem.identity.name, requiredQuantity),
		);
		if (!action) {
			return;
		}
		if (action === '__create__') {
			await this.createSubstituteLinkFromDialog(document, baseItem, candidates.map(candidate => candidate.link), trace);
			return;
		}
		const linkId = action.startsWith('link:') ? action.slice(5) : '';
		const candidate = candidates.find(entry => entry.link.id === linkId);
		if (!candidate) {
			this.dialog.info(this.t('substituteLinks.concurrentConflict'), this.t('substituteLinks.title'));
			return;
		}
		const confirmed = await this.dialog.confirm(
			this.t(
				'substituteLinks.confirmRemove',
				this.formatItemLine(baseItem),
				this.formatItemLine(candidate.item),
				this.t(`substituteLinks.status.${candidate.status}`),
				requiredQuantity,
				candidate.link.note ?? this.t('substituteLinks.noNote'),
			),
			this.t('substituteLinks.title'),
		);
		if (!confirmed) {
			return;
		}
		try {
			await this.inventory.removeSubstituteLink(candidate.link.id, candidate.link.revision);
			trace.info('substitute-links.removed', { linkId: candidate.link.id });
			this.dialog.info(this.t('substituteLinks.removed'), this.t('substituteLinks.title'));
		}
		catch (error) {
			if (error instanceof SubstituteLinkRevisionConflictError || error instanceof DocumentRevisionConflictError) {
				this.dialog.info(this.t('substituteLinks.concurrentConflict'), this.t('substituteLinks.title'));
				return;
			}
			throw error;
		}
	}

	private async createSubstituteLinkFromDialog(
		document: Awaited<ReturnType<InventoryService['exportDocument']>>,
		baseItem: InventoryItem,
		baseLinks: readonly SubstituteLink[],
		trace: DiagnosticTrace,
	): Promise<void> {
		const linkedItemIds = new Set(baseLinks.map(link => link.itemIdA === baseItem.id ? link.itemIdB : link.itemIdA));
		const availableTargets = document.items
			.filter(item => item.id !== baseItem.id && !linkedItemIds.has(item.id))
			.toSorted((left, right) => left.identity.name.localeCompare(right.identity.name) || left.id.localeCompare(right.id));
		if (availableTargets.length === 0) {
			this.dialog.info(this.t('substituteLinks.noAvailableTarget'), this.t('substituteLinks.title'));
			return;
		}
		const targetId = await this.tracedSelect(
			trace,
			'substitute-links.target-item',
			availableTargets.map(item => ({ value: item.id, label: this.formatItemLine(item) })),
			this.t('substituteLinks.title'),
			this.t('substituteLinks.chooseTarget', baseItem.identity.name),
		);
		const target = availableTargets.find(item => item.id === targetId);
		if (!target) {
			return;
		}
		const note = await this.tracedInput(trace, 'substitute-links.note', {
			title: this.t('substituteLinks.title'),
			label: this.t('substituteLinks.notePrompt'),
		});
		if (note === undefined) {
			return;
		}
		if (!await this.dialog.confirm(
			this.t(
				'substituteLinks.confirmCreate',
				this.formatItemLine(baseItem),
				this.formatItemLine(target),
				note.trim() || this.t('substituteLinks.noNote'),
			),
			this.t('substituteLinks.title'),
		)) {
			return;
		}
		try {
			const link = await this.inventory.createSubstituteLink({
				itemA: { id: baseItem.id, expectedRevision: baseItem.revision },
				itemB: { id: target.id, expectedRevision: target.revision },
				expectedDocumentRevision: document.revision,
				note,
			});
			trace.info('substitute-links.created', { linkId: link.id });
			this.dialog.info(this.t('substituteLinks.created'), this.t('substituteLinks.title'));
		}
		catch (error) {
			if (error instanceof InventoryRevisionConflictError
				|| error instanceof DocumentRevisionConflictError
				|| error instanceof SubstituteLinkDuplicateError) {
				this.dialog.info(this.t('substituteLinks.concurrentConflict'), this.t('substituteLinks.title'));
				return;
			}
			throw error;
		}
	}

	private async captureCurrentProjectSnapshot(trace: DiagnosticTrace): Promise<ProjectPlanningOperationResult> {
		if (!this.currentDesign) {
			return { status: 'failed', message: this.t('projectPlanning.captureUnsupported') };
		}
		const design = await trace.waitFor('project-planning.read-current-design', () => this.currentDesign!.readCurrentDesign());
		if (design.status !== 'available') {
			return { status: 'failed', message: this.t('projectPlanning.captureUnavailable') };
		}
		if (design.snapshot.components.length === 0) {
			return { status: 'failed', message: this.t('projectPlanning.captureEmpty') };
		}
		const document = await this.inventory.exportDocument();
		const existing = document.projectSnapshots.find(snapshot => (
			snapshot.documentKind === design.snapshot.document.kind
			&& snapshot.documentUuid === design.snapshot.document.uuid
			&& snapshot.projectUuid === design.snapshot.document.projectUuid
		));
		const label = await this.tracedInput(trace, 'project-planning.snapshot-label', {
			title: this.t('projectPlanning.title'),
			label: this.t('projectPlanning.snapshotLabelPrompt'),
			value: existing?.label ?? design.snapshot.document.uuid,
		});
		if (label === undefined) {
			return { status: 'cancelled' };
		}
		const rawBoardQuantity = await this.tracedInput(trace, 'project-planning.board-quantity', {
			title: this.t('projectPlanning.title'),
			label: this.t('designStockCheck.boardQuantityPrompt'),
			type: 'number',
			value: existing?.boardQuantity ?? 1,
			min: 1,
			step: 1,
		});
		if (rawBoardQuantity === undefined) {
			return { status: 'cancelled' };
		}
		const boardQuantity = Number(rawBoardQuantity.trim());
		if (!Number.isSafeInteger(boardQuantity) || boardQuantity <= 0) {
			return { status: 'failed', message: this.t('designStockCheck.boardQuantityInvalid') };
		}
		const candidate = await createProjectSnapshot({
			id: existing?.id ?? `snapshot-${createSessionToken()}`,
			label,
			boardQuantity,
			capturedAt: new Date().toISOString(),
			source: design.snapshot,
		});
		if (existing) {
			const difference = diffProjectSnapshots(existing, candidate);
			const changeCount = difference.demand.entries.length
				+ difference.demand.unmatchedBefore.length
				+ difference.demand.unmatchedAfter.length;
			if (!difference.sourceChanged
				&& !difference.boardQuantityChanged
				&& existing.label === candidate.label) {
				return { status: 'cancelled', message: this.t('projectPlanning.noChanges') };
			}
			if (!await this.dialog.confirm(
				this.t(
					'projectPlanning.confirmResync',
					changeCount,
					existing.boardQuantity,
					candidate.boardQuantity,
					this.projectSnapshotDiffSummary(difference),
				),
				this.t('projectPlanning.title'),
			)) {
				return { status: 'cancelled' };
			}
			const { id: _id, revision: _revision, ...replacement } = candidate;
			await this.inventory.replaceProjectSnapshot(existing.id, existing.revision, replacement);
		}
		else {
			const { revision: _revision, ...capture } = candidate;
			await this.inventory.captureProjectSnapshot(capture);
		}
		return {
			status: 'succeeded',
			message: this.t(existing ? 'projectPlanning.snapshotUpdated' : 'projectPlanning.snapshotCaptured'),
			snapshot: this.createProjectPlanningSnapshot(await this.inventory.exportDocument()),
		};
	}

	private createProjectPlanningSnapshot(document: Awaited<ReturnType<InventoryService['exportDocument']>>): ProjectPlanningPanelSnapshot {
		return {
			snapshots: document.projectSnapshots,
			procurement: createProcurementSuggestions(analyzeProjectDemand(document.projectSnapshots, document.items)),
			purchases: document.purchaseRecords,
		};
	}

	private projectSnapshotDiffSummary(difference: ReturnType<typeof diffProjectSnapshots>): string {
		const lines = difference.demand.entries.slice(0, 8).map((entry) => {
			const typeKey = entry.type === 'added'
				? 'bomDiff.change.added'
				: entry.type === 'removed'
					? 'bomDiff.change.removed'
					: entry.type === 'quantity-increased'
						? 'bomDiff.change.quantityIncreased'
						: entry.type === 'quantity-decreased'
							? 'bomDiff.change.quantityDecreased'
							: 'bomDiff.change.identityChanged';
			const delta = entry.quantityDelta === undefined
				? ''
				: ` (${entry.quantityDelta > 0 ? '+' : ''}${entry.quantityDelta})`;
			return `${this.t(typeKey)}: ${entry.lcscPartNumber}${delta}`;
		});
		if (difference.demand.unmatchedBefore.length > 0) {
			lines.push(`${this.t('bomDiff.review.beforeUnmatched')}: ${difference.demand.unmatchedBefore.length}`);
		}
		if (difference.demand.unmatchedAfter.length > 0) {
			lines.push(`${this.t('bomDiff.review.afterUnmatched')}: ${difference.demand.unmatchedAfter.length}`);
		}
		if (difference.demand.entries.length > 8) {
			lines.push(this.t('projectPlanning.moreChanges', difference.demand.entries.length - 8));
		}
		return lines.join('\n') || this.t('projectPlanning.noDemandChanges');
	}

	private async runBomStockOut(trace: DiagnosticTrace): Promise<void> {
		if (!this.bomMappingPanel || !this.bomStockOutPanel) {
			this.dialog.info(this.t('bomStockOut.unsupported'), this.t('bomStockOut.title'));
			return;
		}
		const pickedFiles = await trace.waitFor('bom-stock-out.pick-file', () => this.files.pickBomFiles());
		if (!pickedFiles || pickedFiles.length === 0) {
			return;
		}
		if (pickedFiles.length !== 1) {
			this.dialog.info(this.t('bomStockOut.selectOneFile'), this.t('bomStockOut.title'));
			return;
		}
		let parsed: ParsedBomFile;
		try {
			parsed = readBomFile(pickedFiles[0].name, pickedFiles[0].content);
		}
		catch (error) {
			this.dialog.info(this.t('bomAnalysis.readFailed', errorMessage(error)), this.t('bomStockOut.title'));
			return;
		}
		if (parsed.sheets.length === 0) {
			this.dialog.info(this.t('bomAnalysis.emptyFile'), this.t('bomStockOut.title'));
			return;
		}
		const mapping = await this.bomMappingPanel.open({ mode: 'stock-check', files: [parsed] }, trace);
		if (mapping.status !== 'submitted') {
			return;
		}
		const selected = mapping.files.find(entry => entry.fileIndex === 0);
		const sheet = selected ? parsed.sheets[selected.sheetIndex] : undefined;
		if (!selected || !sheet) {
			this.dialog.info(this.t('bomDiff.mappingFailed'), this.t('bomStockOut.title'));
			return;
		}
		let mapped: BomMappingResult;
		try {
			mapped = mapBomRows(sheet, selected.headerRowIndex, selected.mapping);
		}
		catch (error) {
			trace.error('bom-stock-out.mapping.failed', { error: errorMessage(error) });
			this.dialog.info(this.t('bomDiff.mappingFailed'), this.t('bomStockOut.title'));
			return;
		}
		if (mapped.issues.length > 0 || mapped.demands.length === 0) {
			this.dialog.info(
				this.t('bomStockOut.mappingBlocked', mapped.demands.length, mapped.issues.length),
				this.t('bomStockOut.title'),
			);
			return;
		}
		const rawBoardQuantity = await this.tracedInput(trace, 'bom-stock-out.board-quantity', {
			title: this.t('bomStockOut.title'),
			label: this.t('designStockCheck.boardQuantityPrompt'),
			type: 'number',
			value: 1,
			min: 1,
			step: 1,
		});
		if (rawBoardQuantity === undefined) {
			return;
		}
		const boardQuantity = Number(rawBoardQuantity.trim());
		if (!Number.isSafeInteger(boardQuantity) || boardQuantity <= 0) {
			this.dialog.info(this.t('designStockCheck.boardQuantityInvalid'), this.t('bomStockOut.title'));
			return;
		}
		const note = await this.tracedInput(trace, 'bom-stock-out.note', {
			title: this.t('bomStockOut.title'),
			label: this.t('bomStockOut.notePrompt'),
		});
		if (note === undefined) {
			return;
		}
		const [document, sourceFingerprint] = await Promise.all([
			this.inventory.exportDocument(),
			fingerprintBomSource(pickedFiles[0].content),
		]);
		const prepared = prepareBomStockOut({
			demands: mapped.demands,
			inventory: document.items,
			boardQuantity,
			sourceFingerprint,
			sourceName: pickedFiles[0].name,
			note,
		});
		trace.info('bom-stock-out.prepared', {
			lineCount: prepared.lines.length,
			issueCount: prepared.issues.length,
			status: prepared.status,
		});
		if (prepared.status !== 'ready') {
			const issueCounts = new Map<string, number>();
			for (const issue of prepared.issues) {
				issueCounts.set(issue.code, (issueCounts.get(issue.code) ?? 0) + 1);
			}
			this.dialog.info(
				this.t(
					'bomStockOut.preflightBlocked',
					prepared.issues.length,
					[...issueCounts].map(([code, count]) => `${this.t(`bomStockOut.issue.${code}`)}: ${count}`).join('\n'),
				),
				this.t('bomStockOut.title'),
			);
			return;
		}
		let stockOutInput = prepared.input;
		let preview = await this.inventory.previewBomStockOut(stockOutInput);
		if (preview.status === 'duplicate') {
			const existingBatchId = preview.issues.find(issue => issue.code === 'duplicate-batch')?.existingBatchId ?? '-';
			if (!await this.dialog.confirm(
				this.t('bomStockOut.confirmNewProductionRun', existingBatchId),
				this.t('bomStockOut.title'),
			)) {
				return;
			}
			stockOutInput = { ...stockOutInput, productionRunId: `run-${createSessionToken()}` };
			preview = await this.inventory.previewBomStockOut(stockOutInput);
		}
		const itemById = new Map(document.items.map(item => [item.id, item]));
		await this.bomStockOutPanel.open({
			sourceName: pickedFiles[0].name,
			boardQuantity,
			itemSummaries: prepared.lines.map((line, lineIndex) => {
				const item = itemById.get(line.itemId)!;
				return {
					lineIndex,
					itemId: line.itemId,
					requestedQuantity: line.requiredQuantity,
					designators: line.designators,
					identity: {
						name: item.identity.name,
						lcscPartNumber: item.identity.lcscPartNumber,
						manufacturerPartNumber: item.identity.manufacturerPartNumber,
						manufacturer: item.identity.manufacturer,
						package: item.identity.package,
					},
				};
			}),
			preview,
		}, async (action) => {
			if (action.type === 'close') {
				return { status: 'succeeded' };
			}
			try {
				const result = await this.inventory.commitBomStockOut(stockOutInput, preview.documentRevision);
				trace.info('bom-stock-out.committed', {
					lineCount: result.transactions.length,
					documentRevision: result.documentRevision,
				});
				return { status: 'succeeded', message: this.t('bomStockOut.completed', result.transactions.length) };
			}
			catch (error) {
				if (error instanceof DocumentRevisionConflictError || error instanceof BomStockOutBlockedError) {
					return { status: 'failed', message: this.t('bomStockOut.concurrentConflict') };
				}
				trace.error('bom-stock-out.commit.failed', { error: errorMessage(error) });
				return { status: 'failed', message: this.t('bomStockOut.operationError') };
			}
		}, trace);
	}

	private async runBomVersionComparison(trace: DiagnosticTrace): Promise<void> {
		if (!this.bomMappingPanel || !this.bomDiffPanel) {
			this.dialog.info(this.t('bomDiff.unsupported'), this.t('bomDiff.title'));
			return;
		}
		const pickedFiles = await trace.waitFor('bom-diff.pick-files', () => this.files.pickBomFiles());
		if (!pickedFiles || pickedFiles.length === 0) {
			return;
		}
		if (pickedFiles.length !== 2) {
			this.dialog.info(this.t('bomDiff.selectTwoFiles'), this.t('bomDiff.title'));
			return;
		}
		const parsedFiles: ParsedBomFile[] = [];
		try {
			for (const file of pickedFiles) {
				const parsed = readBomFile(file.name, file.content);
				if (parsed.sheets.length === 0) {
					this.dialog.info(this.t('bomAnalysis.emptyFile'), this.t('bomDiff.title'));
					return;
				}
				parsedFiles.push(parsed);
			}
		}
		catch (error) {
			this.dialog.info(this.t('bomAnalysis.readFailed', errorMessage(error)), this.t('bomDiff.title'));
			return;
		}
		const selection = await this.bomMappingPanel.open({ mode: 'compare', files: parsedFiles }, trace);
		if (selection.status !== 'submitted') {
			return;
		}
		let mappedFiles: BomMappingResult[];
		try {
			mappedFiles = parsedFiles.map((file, fileIndex) => {
				const selected = selection.files.find(entry => entry.fileIndex === fileIndex);
				const sheet = selected ? file.sheets[selected.sheetIndex] : undefined;
				if (!selected || !sheet) {
					throw new Error('BOM mapping selection is incomplete.');
				}
				return mapBomRows(sheet, selected.headerRowIndex, selected.mapping);
			});
		}
		catch (error) {
			trace.error('bom-diff.mapping.failed', { error: errorMessage(error) });
			this.dialog.info(this.t('bomDiff.mappingFailed'), this.t('bomDiff.title'));
			return;
		}
		const issueCount = mappedFiles.reduce((count, mapped) => count + mapped.issues.length, 0);
		trace.info('bom-diff.mapping-result', {
			beforeDemandCount: mappedFiles[0].demands.length,
			afterDemandCount: mappedFiles[1].demands.length,
			issueCount,
		});
		if (issueCount > 0 && !await this.dialog.confirm(
			this.t(
				'bomDiff.mappingIssues',
				mappedFiles[0].demands.length,
				mappedFiles[1].demands.length,
				issueCount,
			),
			this.t('bomDiff.title'),
		)) {
			return;
		}
		const result = diffNormalizedBoms(mappedFiles[0].demands, mappedFiles[1].demands);
		trace.info('bom-diff.report', {
			changeCount: result.entries.length,
			unmatchedBeforeCount: result.unmatchedBefore.length,
			unmatchedAfterCount: result.unmatchedAfter.length,
		});
		await this.bomDiffPanel.open({
			result,
			beforeFileName: parsedFiles[0].fileName,
			afterFileName: parsedFiles[1].fileName,
			beforeIssues: mappedFiles[0].issues,
			afterIssues: mappedFiles[1].issues,
		}, async (action) => {
			if (action.type === 'close') {
				return { status: 'succeeded' };
			}
			try {
				await this.files.saveCsv(
					createBomDiffCsv(result, this.bomDiffCsvLabels()),
					`jlceda-inventory-bom-diff-${new Date().toISOString().slice(0, 10)}.csv`,
				);
				return { status: 'succeeded', message: this.t('bomDiff.exportSucceeded') };
			}
			catch (error) {
				trace.error('bom-diff.export.failed', { error: errorMessage(error) });
				return { status: 'failed', message: this.t('bomDiff.operationError') };
			}
		}, trace);
	}

	private async offerExternalBomStockCheck(reason: string, trace: DiagnosticTrace): Promise<void> {
		if (!this.bomMappingPanel || !this.designStockCheckPanel) {
			this.dialog.info(reason, this.t('designStockCheck.title'));
			return;
		}
		if (await this.dialog.confirm(
			`${reason}\n\n${this.t('designStockCheck.offerExternalBom')}`,
			this.t('designStockCheck.title'),
		)) {
			await this.runExternalBomStockCheck(trace);
		}
	}

	private async runExternalBomStockCheck(trace: DiagnosticTrace): Promise<void> {
		if (!this.bomMappingPanel || !this.designStockCheckPanel) {
			this.dialog.info(this.t('bomAnalysis.unsupported'), this.t('bomAnalysis.stockCheckTitle'));
			return;
		}
		const pickedFiles = await trace.waitFor('bom-stock-check.pick-file', () => this.files.pickBomFiles());
		if (!pickedFiles || pickedFiles.length === 0) {
			return;
		}
		if (pickedFiles.length !== 1) {
			this.dialog.info(this.t('bomAnalysis.selectOneFile'), this.t('bomAnalysis.stockCheckTitle'));
			return;
		}
		let parsed: ParsedBomFile;
		try {
			parsed = readBomFile(pickedFiles[0].name, pickedFiles[0].content);
		}
		catch (error) {
			this.dialog.info(this.t('bomAnalysis.readFailed', errorMessage(error)), this.t('bomAnalysis.stockCheckTitle'));
			return;
		}
		if (parsed.sheets.length === 0) {
			this.dialog.info(this.t('bomAnalysis.emptyFile'), this.t('bomAnalysis.stockCheckTitle'));
			return;
		}
		const mapping = await this.bomMappingPanel.open({ mode: 'stock-check', files: [parsed] }, trace);
		if (mapping.status !== 'submitted') {
			return;
		}
		const selection = mapping.files[0];
		const sheet = parsed.sheets[selection.sheetIndex];
		const mapped = mapBomRows(sheet, selection.headerRowIndex, selection.mapping);
		if (!await this.confirmBomMappingIssues(mapped.demands.length, mapped.issues, trace)) {
			return;
		}
		const rawBoardQuantity = await this.tracedInput(trace, 'bom-stock-check.board-quantity', {
			title: this.t('bomAnalysis.stockCheckTitle'),
			label: this.t('designStockCheck.boardQuantityPrompt'),
			type: 'number',
			value: 1,
			min: 1,
			step: 1,
		});
		if (rawBoardQuantity === undefined) {
			return;
		}
		const boardQuantity = Number(rawBoardQuantity.trim());
		if (!Number.isSafeInteger(boardQuantity) || boardQuantity <= 0) {
			this.dialog.info(this.t('designStockCheck.boardQuantityInvalid'), this.t('bomAnalysis.stockCheckTitle'));
			return;
		}
		const inventory = await this.inventory.exportDocument();
		const report = checkDesignStock({
			components: mapped.demands.map(bomDemandToStockComponent),
			inventory: inventory.items,
			boardQuantity,
		});
		await this.designStockCheckPanel.open({ report, source: 'file' }, async (action) => {
			if (action.type === 'close') {
				return { status: 'succeeded' };
			}
			try {
				await this.files.saveCsv(
					createDesignStockShortageCsv(report, this.designStockCsvLabels()),
					`jlceda-inventory-shortage-${new Date().toISOString().slice(0, 10)}.csv`,
				);
				return { status: 'succeeded', message: this.t('designStockCheck.exportSucceeded') };
			}
			catch (error) {
				trace.error('bom-stock-check.export.failed', { error: errorMessage(error) });
				return { status: 'failed', message: this.t('designStockCheck.operationError') };
			}
		}, trace);
	}

	private async confirmBomMappingIssues(
		demandCount: number,
		issues: readonly BomRowIssue[],
		trace: DiagnosticTrace,
	): Promise<boolean> {
		trace.info('bom-analysis.mapping-result', { demandCount, issueCount: issues.length });
		if (demandCount === 0) {
			this.dialog.info(this.t('bomAnalysis.noValidRows'), this.t('bomAnalysis.stockCheckTitle'));
			return false;
		}
		return issues.length === 0 || this.dialog.confirm(
			this.t('bomAnalysis.mappingIssues', demandCount, issues.length),
			this.t('bomAnalysis.stockCheckTitle'),
		);
	}

	public configureAutomaticBackup(): Promise<void> {
		const trace = this.diagnostics.start('configure-automatic-backup', false);
		return this.execute(async () => {
			if (!this.automaticBackup) {
				this.dialog.info(this.t('autoBackup.unsupported'), this.t('autoBackup.title'));
				return;
			}
			const settings = this.automaticBackup.getSettings();
			let action: 'disable' | 'enable' | 'test' | 'use-default';
			if (!settings.path) {
				action = 'use-default';
			}
			else {
				const options: SelectOption[] = settings.enabled
					? [
							{ value: 'use-default', label: this.t('autoBackup.useDefault') },
							{ value: 'test', label: this.t('autoBackup.test') },
							{ value: 'disable', label: this.t('autoBackup.disable') },
						]
					: [
							{ value: 'enable', label: this.t('autoBackup.reenable') },
							{ value: 'use-default', label: this.t('autoBackup.useDefault') },
							{ value: 'test', label: this.t('autoBackup.test') },
						];
				const selectedAction = await this.tracedSelect(
					trace,
					'auto-backup.action',
					options,
					this.t('autoBackup.title'),
					this.t('autoBackup.status', settings.enabled ? this.t('autoBackup.enabled') : this.t('autoBackup.disabled'), settings.path),
					settings.enabled ? 'test' : 'enable',
				);
				if (!selectedAction) {
					return;
				}
				action = selectedAction as typeof action;
			}
			if (action === 'disable') {
				await this.automaticBackup.disable();
				this.dialog.info(this.t('autoBackup.disabledMessage'), this.t('autoBackup.title'));
				return;
			}
			let path = settings.path;
			if (action === 'use-default') {
				path = await this.prepareDefaultAutomaticBackupPath(trace);
			}
			if (!path) {
				return;
			}
			const document = await this.inventory.exportDocument();
			const result = await trace.waitFor('auto-backup.test-write', () => this.automaticBackup!.test(document, path));
			if (result.status !== 'succeeded') {
				const failure = result.status === 'failed' ? result.failure : 'api-unavailable';
				this.dialog.info(this.t(automaticBackupFailureKey(failure)), this.t('autoBackup.title'));
				return;
			}
			if (action === 'use-default' || action === 'enable') {
				await this.automaticBackup.configure(path);
				this.dialog.info(this.t('autoBackup.enabledMessage', path), this.t('autoBackup.title'));
				return;
			}
			this.dialog.info(this.t('autoBackup.testSucceeded', path), this.t('autoBackup.title'));
		}, trace);
	}

	private async prepareDefaultAutomaticBackupPath(trace: DiagnosticTrace): Promise<string | undefined> {
		let folder: string | undefined;
		try {
			folder = await trace.waitFor('auto-backup.default-folder', () => this.automaticBackup!.getDefaultFolder());
		}
		catch (error) {
			const invalidHostPath = error instanceof InvalidAutomaticBackupFolderError;
			trace.warn('auto-backup.default-folder-unavailable', {
				error: errorMessage(error),
				reason: invalidHostPath ? 'invalid-host-path' : 'host-api-error',
			});
			this.dialog.info(
				this.t(invalidHostPath ? 'autoBackup.invalidDefaultFolder' : 'autoBackup.unsupported'),
				this.t('autoBackup.title'),
			);
			return undefined;
		}
		if (!folder) {
			trace.warn('auto-backup.default-folder-unavailable', { reason: 'api-unavailable' });
			this.dialog.info(this.t('autoBackup.unsupported'), this.t('autoBackup.title'));
			return undefined;
		}
		trace.info('auto-backup.default-folder.resolved', automaticBackupPathDiagnostics(folder));
		try {
			const path = await trace.waitFor(
				'auto-backup.prepare-path',
				() => this.automaticBackup!.prepareBackupPath(folder),
			);
			trace.info('auto-backup.path.prepared', automaticBackupPathDiagnostics(path));
			return path;
		}
		catch (error) {
			trace.warn('auto-backup.prepare-path-failed', { error: errorMessage(error) });
			this.dialog.info(this.t('autoBackup.writeFailed'), this.t('autoBackup.title'));
			return undefined;
		}
	}

	public restoreInventoryBackup(): Promise<void> {
		const trace = this.diagnostics.start('restore-inventory-backup', false);
		return this.execute(async () => {
			let recoverySnapshot: Awaited<ReturnType<InventoryService['loadRecoverySnapshot']>>;
			try {
				recoverySnapshot = await this.inventory.loadRecoverySnapshot();
			}
			catch (error) {
				trace.warn('backup-restore.recovery-snapshot-unavailable', { error: errorMessage(error) });
				this.dialog.info(this.t('backup.restore.recoveryUnavailable'), this.t('backup.restore.title'));
			}
			const sources: SelectOption[] = [{ value: 'file', label: this.t('backup.restore.fileSource') }];
			if (recoverySnapshot) {
				sources.push({ value: 'recovery', label: this.t('backup.restore.recoverySource') });
			}
			const source = sources.length === 1
				? 'file'
				: await this.tracedSelect(
						trace,
						'backup-restore.source',
						sources,
						this.t('backup.restore.title'),
						this.t('backup.restore.sourcePrompt'),
						'file',
					);
			if (!source) {
				return;
			}

			let rawBackup: unknown;
			let sourceLabel: string;
			if (source === 'recovery') {
				rawBackup = recoverySnapshot;
				sourceLabel = this.t('backup.restore.recoverySource');
			}
			else {
				const picked = await this.files.pickInventoryBackup(MAX_INVENTORY_BACKUP_TEXT_LENGTH);
				if (!picked) {
					return;
				}
				rawBackup = picked.content;
				sourceLabel = picked.name;
			}

			let validated: ReturnType<typeof validateInventoryBackup>;
			try {
				validated = validateInventoryBackup(rawBackup);
			}
			catch (error) {
				if (error instanceof InventoryBackupValidationError) {
					trace.warn('backup-restore.validation-failed', { code: error.code, path: error.path });
					this.dialog.info(
						this.t('backup.restore.invalid', error.code, error.path || '-'),
						this.t('backup.restore.title'),
					);
					return;
				}
				throw error;
			}
			const current = await this.inventory.exportDocument();
			const { metadata } = validated;
			if (!await this.dialog.confirm(
				this.t(
					'backup.restore.confirm',
					sourceLabel,
					metadata.sourceSchemaVersion,
					metadata.updatedAt,
					metadata.itemCount,
					metadata.categoryCount,
					metadata.orderImportBatchCount,
					metadata.transactionCount,
					metadata.stockOutBatchCount,
					metadata.projectSnapshotCount,
					metadata.purchaseRecordCount,
					metadata.substituteLinkCount,
					metadata.revision,
					current.revision,
				),
				this.t('backup.restore.title'),
			)) {
				return;
			}
			try {
				const restored = await trace.waitFor('backup-restore.replace', () => this.inventory.restoreDocument(
					validated.document,
					current.revision,
				));
				this.dialog.info(
					this.t('backup.restore.completed', restored.items.length, restored.revision),
					this.t('backup.restore.title'),
				);
			}
			catch (error) {
				if (error instanceof DocumentRevisionConflictError) {
					this.dialog.info(this.t('backup.restore.concurrentConflict'), this.t('backup.restore.title'));
					return;
				}
				throw error;
			}
		}, trace);
	}

	private designStockCsvLabels(): DesignStockCsvLabels {
		return {
			partNumber: this.t('designStockCheck.column.partNumber'),
			name: this.t('designStockCheck.column.name'),
			manufacturerPartNumber: this.t('designStockCheck.column.manufacturerPart'),
			package: this.t('designStockCheck.column.package'),
			designators: this.t('designStockCheck.column.designators'),
			unitQuantity: this.t('designStockCheck.column.unitQuantity'),
			boardQuantity: this.t('designStockCheck.boardQuantity'),
			requiredQuantity: this.t('designStockCheck.column.requiredQuantity'),
			availableQuantity: this.t('designStockCheck.column.availableQuantity'),
			shortageQuantity: this.t('designStockCheck.column.shortageQuantity'),
			status: this.t('designStockCheck.column.status'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			statuses: {
				'sufficient': this.t('designStockCheck.status.sufficient'),
				'insufficient': this.t('designStockCheck.status.insufficient'),
				'review-required': this.t('designStockCheck.status.reviewRequired'),
				'stocktake-required': this.t('designStockCheck.status.stocktakeRequired'),
				'inventory-missing': this.t('designStockCheck.status.inventoryMissing'),
				'identity-unmatched': this.t('designStockCheck.status.identityUnmatched'),
			},
		};
	}

	private replenishmentCsvLabels(): ReplenishmentCsvLabels {
		return {
			partNumber: this.t('part.lcscLabel'),
			name: this.t('part.nameLabel'),
			manufacturerPartNumber: this.t('part.manufacturerPartLabel'),
			package: this.t('part.packageLabel'),
			quantity: this.t('inventory.quantityLabel'),
			precision: this.t('inventoryItem.precision'),
			minimumQuantity: this.t('inventoryItem.minimumQuantity'),
			status: this.t('inventoryOverview.columnReplenishment'),
			location: this.t('inventory.locationLabel'),
			note: this.t('inventory.noteLabel'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			precisions: {
				exact: this.t('inventory.exact'),
				estimated: this.t('inventory.estimated'),
				unknown: this.t('inventory.unknown'),
			},
			statuses: {
				'depleted': this.t('inventoryItem.replenishment.depleted'),
				'low': this.t('inventoryItem.replenishment.low'),
				'needs-count': this.t('inventoryItem.replenishment.needsCount'),
				'not-configured': this.t('inventoryItem.replenishment.notConfigured'),
				'possibly-low': this.t('inventoryItem.replenishment.possiblyLow'),
				'sufficient': this.t('inventoryItem.replenishment.sufficient'),
			},
		};
	}

	private bomDiffCsvLabels(): BomDiffCsvLabels {
		return {
			type: this.t('bomDiff.column.changeType'),
			lcscPartNumber: this.t('bomDiff.column.partNumber'),
			beforeQuantity: this.t('bomDiff.column.beforeQuantity'),
			afterQuantity: this.t('bomDiff.column.afterQuantity'),
			quantityDelta: this.t('bomDiff.column.quantityDelta'),
			beforeDesignators: this.t('bomDiff.column.beforeDesignators'),
			afterDesignators: this.t('bomDiff.column.afterDesignators'),
			beforeName: this.t('bomDiff.column.beforeName'),
			afterName: this.t('bomDiff.column.afterName'),
			beforeManufacturerPartNumber: this.t('bomDiff.column.beforeManufacturerPart'),
			afterManufacturerPartNumber: this.t('bomDiff.column.afterManufacturerPart'),
			beforeManufacturer: this.t('bomDiff.column.beforeManufacturer'),
			afterManufacturer: this.t('bomDiff.column.afterManufacturer'),
			beforePackage: this.t('bomDiff.column.beforePackage'),
			afterPackage: this.t('bomDiff.column.afterPackage'),
			identityChanges: this.t('bomDiff.column.identityChanges'),
			sourceSheet: this.t('bomDiff.column.sourceSheet'),
			sourceRow: this.t('bomDiff.column.sourceRow'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			types: {
				'added': this.t('bomDiff.change.added'),
				'removed': this.t('bomDiff.change.removed'),
				'quantity-increased': this.t('bomDiff.change.quantityIncreased'),
				'quantity-decreased': this.t('bomDiff.change.quantityDecreased'),
				'identity-changed': this.t('bomDiff.change.identityChanged'),
				'unmatched-before': this.t('bomDiff.review.beforeUnmatched'),
				'unmatched-after': this.t('bomDiff.review.afterUnmatched'),
			},
			identityFields: {
				name: this.t('bomDiff.identity.name'),
				manufacturerPartNumber: this.t('bomDiff.identity.manufacturerPartNumber'),
				manufacturer: this.t('bomDiff.identity.manufacturer'),
				package: this.t('bomDiff.identity.package'),
			},
		};
	}

	private procurementCsvLabels(): ProcurementCsvLabels {
		return {
			lcscPartNumber: this.t('designStockCheck.column.partNumber'),
			name: this.t('designStockCheck.column.name'),
			manufacturerPartNumber: this.t('designStockCheck.column.manufacturerPart'),
			package: this.t('designStockCheck.column.package'),
			requiredQuantity: this.t('designStockCheck.column.requiredQuantity'),
			availableQuantity: this.t('designStockCheck.column.availableQuantity'),
			suggestedQuantity: this.t('projectPlanning.column.suggestedQuantity'),
			status: this.t('designStockCheck.column.status'),
			sources: this.t('projectPlanning.column.sources'),
			emptyValue: this.t('inventoryItem.emptyValue'),
			boardQuantityPrefix: this.t('projectPlanning.boardQuantityPrefix'),
			statuses: {
				'sufficient': this.t('designStockCheck.status.sufficient'),
				'insufficient': this.t('designStockCheck.status.insufficient'),
				'review-required': this.t('designStockCheck.status.reviewRequired'),
				'stocktake-required': this.t('designStockCheck.status.stocktakeRequired'),
				'inventory-missing': this.t('designStockCheck.status.inventoryMissing'),
				'identity-unmatched': this.t('designStockCheck.status.identityUnmatched'),
			},
		};
	}

	private async chooseSelectedDesignComponent(
		components: readonly DesignComponentSnapshot[],
	): Promise<DesignComponentSnapshot | undefined> {
		if (components.length === 1) {
			return components[0];
		}
		const selectedPrimitiveId = await this.dialog.select(
			components.map(component => ({
				value: component.primitiveId,
				label: formatSelectedDesignComponent(component),
			})),
			this.t('selectedInventory.title'),
			this.t('selectedInventory.chooseComponent'),
		);
		return components.find(component => component.primitiveId === selectedPrimitiveId);
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
		return this.execute(() => this.runInventoryCreatePanel(mode, undefined, trace), trace);
	}

	private async runInventoryCreatePanel(
		mode: InventoryCreateMode,
		initial: Partial<InventoryCreateFormState> | undefined,
		trace: DiagnosticTrace,
	): Promise<void> {
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
			initial,
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
			let result: Awaited<ReturnType<InventoryService['createItem']>>;
			try {
				result = await trace.waitFor('inventory.merge', () => this.inventory.createItem(pending.input, pending.existing));
			}
			catch (error) {
				if (error instanceof InventoryItemSubstituteReferenceError) {
					return { stage: 'failed', message: this.t('inventory.substituteReference') };
				}
				throw error;
			}
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
			minimumQuantity: draft.minimumQuantity,
			favorite: draft.favorite,
			location: draft.location,
			datasheetUrl: draft.datasheetUrl,
			structuredLocation: draft.structuredLocation,
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
				case 'open-datasheet':
					if (!item?.datasheetUrl || !this.externalLinks?.open(item.datasheetUrl)) {
						return { status: 'failed', message: this.t('inventoryItem.datasheetOpenFailed') };
					}
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
					return this.copyToCommonLibrary(item!);
				case 'delete-item': {
					const latest = await this.inventory.get(intent.item.id);
					assertOverviewItemRevision(latest, intent.item.expectedRevision);
					await this.inventory.remove(latest.id);
					break;
				}
				case 'delete-items':
					await this.inventory.removeItems(intent.items);
					break;
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
				case 'export-replenishment':
					try {
						await this.files.saveCsv(
							createReplenishmentCsv(items, this.replenishmentCsvLabels()),
							`jlceda-inventory-replenishment-${new Date().toISOString().slice(0, 10)}.csv`,
						);
						return { status: 'succeeded', message: this.t('inventoryOverview.exportReplenishmentSucceeded') };
					}
					catch (error) {
						if (isCancelledFileSave(error)) {
							return { status: 'cancelled', message: this.t('inventoryOverview.exportReplenishmentCancelled') };
						}
						return { status: 'failed', message: this.t('inventoryOverview.exportReplenishmentFailed') };
					}
				case 'refresh':
					break;
			}
			return { status: 'succeeded' };
		}
		catch (error) {
			if (error instanceof InventoryRevisionConflictError || error instanceof InventoryCategoryRevisionConflictError) {
				return { status: 'failed', message: this.t('inventory.concurrentConflict') };
			}
			if (error instanceof InventoryItemActiveStockOutReferenceError) {
				return { status: 'failed', message: this.t('inventory.activeStockOutReference') };
			}
			if (error instanceof InventoryItemSubstituteReferenceError) {
				return { status: 'failed', message: this.t('inventory.substituteReference') };
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
		const input: InventoryEditInput = {
			...createInventoryEditInput(draft, marketplaceReference, edaModelReference, edaModelStatus),
			categoryId: categoryId ?? null,
		};
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
		return { status: 'succeeded', message: this.t('inventory.merged') };
	}

	private async prepareOverviewModelMatch(
		item: InventoryItem,
		pendingModelMatches: Map<string, PendingOverviewModelMatch>,
	): Promise<InventoryOverviewOperationResult> {
		const partNumber = item.identity.lcscPartNumber;
		let model: EdaModel | undefined;
		if (partNumber) {
			const lookup = await this.lookupEdaModel(partNumber);
			model = lookup.model;
		}
		if (!model) {
			const defaultQuery = partNumber
				?? item.identity.manufacturerPartNumber
				?? item.identity.name;
			const query = await this.dialog.input({
				title: this.t('edaModel.searchTitle'),
				label: this.t('edaModel.searchPrompt'),
				value: defaultQuery,
			});
			if (query === undefined) {
				return { status: 'cancelled' };
			}
			const normalizedQuery = normalizeInventoryText(query);
			if (!normalizedQuery) {
				return { status: 'model-missing', message: this.t('edaModel.stillMissing') };
			}
			let candidates: EdaModel[];
			try {
				candidates = deduplicateEdaModels(await this.edaModels.search(normalizedQuery, 20));
			}
			catch {
				return { status: 'failed', message: this.t('edaModel.lookupFailed') };
			}
			if (candidates.length === 0) {
				return { status: 'model-missing', message: this.t('edaModel.stillMissing') };
			}
			if (candidates.length === 1) {
				model = candidates[0];
			}
			else {
				const selectedIndex = await this.dialog.select(
					candidates.map((candidate, index) => ({
						value: String(index),
						label: formatEdaModelCandidate(candidate),
					})),
					this.t('edaModel.searchTitle'),
					this.t('edaModel.selectCandidate'),
				);
				if (selectedIndex === undefined) {
					return { status: 'cancelled' };
				}
				model = candidates[Number(selectedIndex)];
				if (!model) {
					return { status: 'failed', message: this.t('edaModel.lookupFailed') };
				}
			}
		}
		const matchToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
		pendingModelMatches.set(matchToken, {
			expectedRevision: item.revision,
			itemId: item.id,
			model,
		});
		return {
			status: 'model-match',
			item: { id: item.id, expectedRevision: item.revision },
			matchToken,
			message: [
				`${this.t('part.nameLabel')}: ${model.identity.name}`,
				`${this.t('part.lcscLabel')}: ${model.identity.lcscPartNumber ?? partNumber ?? '-'}`,
				`${this.t('part.manufacturerPartLabel')}: ${model.identity.manufacturerPartNumber ?? '-'}`,
				`${this.t('part.packageLabel')}: ${model.identity.package ?? '-'}`,
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
				if (error instanceof InventoryItemActiveStockOutReferenceError) {
					this.dialog.info(this.t('inventory.activeStockOutReference'));
					return;
				}
				if (error instanceof InventoryItemSubstituteReferenceError) {
					this.dialog.info(this.t('inventory.substituteReference'));
					return;
				}
				throw error;
			}
		}
	}

	private async copyToCommonLibrary(item: InventoryItem): Promise<InventoryOverviewOperationResult> {
		if (!item.edaModelReference) {
			return { status: 'failed', message: this.t('common.failed') };
		}
		const trace = this.diagnostics.start('copy-common');
		try {
			const result = await trace.waitFor('common-library.copy', () => this.commonLibrary.copy(
				item.edaModelReference!,
				{ lcscPartNumber: item.identity.lcscPartNumber },
			));
			const details = {
				attempts: result.attempts.map(attempt => `${attempt.target}:${attempt.status}`).join(','),
				reason: result.status === 'failed' ? result.reason : undefined,
				status: result.status,
			};
			if (result.status === 'failed') {
				trace.warn('common-library.copy.result', details);
				return { status: 'failed', message: this.t(`common.failed.${result.reason}`) };
			}
			trace.info('common-library.copy.result', details);
			this.dialog.info(this.t(
				result.status === 'already-present' ? 'common.alreadyPresent' : 'common.copied',
				this.t(`common.${result.target}`),
			));
			return { status: 'succeeded' };
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
		datasheetUrl: draft.datasheetUrl ?? '',
		structuredLocation: draft.structuredLocation
			? {
					cabinet: draft.structuredLocation.cabinet ?? '',
					box: draft.structuredLocation.box ?? '',
					row: draft.structuredLocation.row ?? '',
					column: draft.structuredLocation.column ?? '',
				}
			: undefined,
		minimumQuantity: draft.minimumQuantity ?? null,
		favorite: draft.favorite === true,
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

function isCancelledFileSave(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

function packageScanErrorKey(reason: Extract<ParseLcscPackageCodeResult, { status: 'invalid' }>['reason']): string {
	switch (reason) {
		case 'empty':
		case 'missing-part-number':
			return 'packageScan.missingPartNumber';
		case 'invalid-part-number':
			return 'packageScan.invalidPartNumber';
		case 'invalid-quantity':
			return 'packageScan.invalidQuantity';
		case 'too-long':
			return 'packageScan.tooLong';
		case 'conflicting-field':
			return 'packageScan.conflictingField';
	}
	return reason satisfies never;
}

function automaticBackupFailureKey(failure: AutomaticBackupFailure): string {
	switch (failure) {
		case 'api-unavailable': return 'autoBackup.unsupported';
		case 'host-rejected': return 'autoBackup.hostRejected';
		case 'settings-storage-failed': return 'autoBackup.settingsFailed';
		case 'write-failed': return 'autoBackup.writeFailed';
	}
}

function automaticBackupPathDiagnostics(path: string): { pathKind: string; pathLength: number } {
	const normalized = path.trim();
	const pathKind = /^[A-Z]:[\\/]/i.test(normalized)
		? 'windows-drive'
		: normalized.startsWith('\\\\') || normalized.startsWith('//')
			? 'unc'
			: normalized.startsWith('/')
				? 'posix'
				: /^[A-Z][A-Z\d+.-]*:/i.test(normalized)
					? 'uri'
					: 'host-relative';
	return { pathKind, pathLength: normalized.length };
}

function deduplicateEdaModels(models: readonly EdaModel[]): EdaModel[] {
	const unique = new Map<string, EdaModel>();
	for (const model of models) {
		const key = `${model.reference.libraryUuid}:${model.reference.deviceUuid}`;
		if (!unique.has(key)) {
			unique.set(key, model);
		}
	}
	return [...unique.values()];
}

function formatEdaModelCandidate(model: EdaModel): string {
	return [
		model.identity.lcscPartNumber,
		model.identity.manufacturerPartNumber,
		model.identity.name,
		model.identity.package,
		model.reference.symbolName,
		model.reference.footprintName,
	].filter((value): value is string => Boolean(value)).join(' | ');
}

function matchesSelectedDesignComponent(item: InventoryItem, component: DesignComponentSnapshot): boolean {
	const itemPartNumber = normalizeLcscPartNumber(item.identity.lcscPartNumber ?? item.identity.supplierId);
	const componentPartNumber = normalizeLcscPartNumber(component.lcscPartNumber);
	if (componentPartNumber && /^C\d+$/.test(componentPartNumber)) {
		return itemPartNumber === componentPartNumber;
	}
	const itemMpn = normalizeInventoryText(item.identity.manufacturerPartNumber ?? '').toLowerCase();
	const componentMpn = normalizeInventoryText(component.manufacturerPartNumber ?? '').toLowerCase();
	return Boolean(componentMpn && itemMpn === componentMpn);
}

function formatSelectedDesignComponent(component: DesignComponentSnapshot): string {
	return [
		component.designator,
		component.lcscPartNumber,
		component.manufacturerPartNumber,
		component.name,
	].filter((value): value is string => Boolean(value)).join(' | ');
}

function toStockDesignComponent(component: DesignComponentSnapshot): StockDesignComponentSnapshot {
	return {
		designator: component.designator,
		identity: {
			name: component.name,
			lcscPartNumber: component.lcscPartNumber,
			manufacturerPartNumber: component.manufacturerPartNumber,
			manufacturer: component.manufacturer,
			package: component.package,
		},
		quantity: 1,
	};
}

function bomDemandToStockComponent(demand: BomDesignDemand): StockDesignComponentSnapshot {
	return {
		designator: demand.designators.join(', ') || undefined,
		identity: {
			name: demand.identity.name,
			lcscPartNumber: demand.lcscPartNumber,
			manufacturerPartNumber: demand.identity.manufacturerPartNumber,
			manufacturer: demand.identity.manufacturer,
			package: demand.identity.package,
		},
		quantity: demand.quantity,
	};
}

function createOverviewSearchState(query: string, focusItemId?: string): InventoryOverviewViewState {
	return {
		query,
		focusItemId,
		searchScope: 'all',
		categoryId: 'all',
		stockFilter: 'all',
		modelFilter: 'all',
		sort: 'relevance',
		page: 1,
		pageSize: 50,
	};
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
		minimumQuantity: draft.minimumQuantity ?? null,
		favorite: draft.favorite === true,
		location: optionalText(draft.location),
		datasheetUrl: draft.datasheetUrl === undefined
			? undefined
			: draft.datasheetUrl === null
				? null
				: optionalText(draft.datasheetUrl) ?? null,
		structuredLocation: draft.structuredLocation === undefined
			? undefined
			: draft.structuredLocation,
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
		datasheetUrl: item.datasheetUrl,
		structuredLocation: item.structuredLocation ? { ...item.structuredLocation } : undefined,
		note: item.note ?? '',
		precision: item.precision === 'estimated' ? 'estimated' : 'exact',
		quantity: item.quantity ?? 0,
		minimumQuantity: item.minimumQuantity,
		favorite: item.favorite === true,
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
