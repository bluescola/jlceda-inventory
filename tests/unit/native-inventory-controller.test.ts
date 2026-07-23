import type { CommonLibrary } from '../../src/features/common-library/ports/common-library';
import type { EdaModel, EdaModelCatalog } from '../../src/features/component-catalog/ports/component-catalog';
import type { CurrentDesignReader, SelectedDesignComponentsReader } from '../../src/features/design-stock-check/ports/design-component-reader';
import type { InventoryService } from '../../src/features/inventory/application/inventory-service';
import type { InventoryItem, NewInventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { EdaLibraryCategories } from '../../src/features/inventory/ports/eda-library-categories';
import type { ExternalLinkNavigator } from '../../src/features/inventory/ports/external-link-navigator';
import type { MarketplaceNavigator } from '../../src/features/marketplace-catalog/ports/marketplace-navigator';
import type { EdaFileClient, PickedOrderFile } from '../../src/platform/jlceda-v3/eda/file-client';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { EdaPlacementClient } from '../../src/platform/jlceda-v3/eda/placement-client';
import type { AutomaticInventoryBackup } from '../../src/platform/jlceda-v3/persistence/automatic-inventory-backup';
import type { BomDiffPanel } from '../../src/platform/jlceda-v3/presentation/bom-diff-panel';
import type { BomMappingPanel } from '../../src/platform/jlceda-v3/presentation/bom-mapping-panel';
import type { BomStockOutPanel } from '../../src/platform/jlceda-v3/presentation/bom-stock-out-panel';
import type { DesignStockCheckPanel } from '../../src/platform/jlceda-v3/presentation/design-stock-check-panel';
import type { InventoryCreateDraft, InventoryCreateFormState, InventoryCreatePanel } from '../../src/platform/jlceda-v3/presentation/inventory-create-panel';
import type { InventoryItemPanel } from '../../src/platform/jlceda-v3/presentation/inventory-item-panel';
import type { InventoryOverviewInput, InventoryOverviewOperationHandler, InventoryOverviewPanel, InventoryOverviewViewState } from '../../src/platform/jlceda-v3/presentation/inventory-overview-panel';
import type { InventoryTransactionsPanel } from '../../src/platform/jlceda-v3/presentation/inventory-transactions-panel';
import type { Diagnostics, DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import type { NativeDialog } from '../../src/platform/jlceda-v3/presentation/native-dialog';
import type { OrderImportPanel, OrderImportPanelActionHandler } from '../../src/platform/jlceda-v3/presentation/order-import-panel';
import type { ProductDetailsDraft, ProductDetailsForm } from '../../src/platform/jlceda-v3/presentation/product-details-form';
import type { ProjectPlanningPanel } from '../../src/platform/jlceda-v3/presentation/project-planning-panel';
import { describe, expect, it, vi } from 'vitest';
import { normalizeInventoryItem } from '../../src/features/inventory/domain/inventory-item';
import { AutomaticBackupFolderPickerError } from '../../src/platform/jlceda-v3/persistence/automatic-inventory-backup';
import { NativeInventoryController } from '../../src/platform/jlceda-v3/presentation/native-inventory-controller';

const edaModel: EdaModel = {
	identity: {
		name: '10k resistor',
		manufacturer: 'UNI-ROYAL',
		manufacturerPartNumber: '0603WAF1002T5E',
		package: '0603',
	},
	reference: {
		deviceUuid: 'device-C25804',
		libraryUuid: 'system-library',
		symbolName: 'R',
		footprintName: 'R0603',
	},
	attributes: {},
};

const overviewViewState: InventoryOverviewViewState = {
	query: '',
	searchScope: 'all',
	categoryId: 'all',
	stockFilter: 'all',
	modelFilter: 'all',
	sort: 'relevance',
	page: 1,
	pageSize: 50,
};

function createForm(overrides: Partial<InventoryCreateFormState>): InventoryCreateFormState {
	return {
		lcscPartNumber: '',
		marketplaceConfirmed: false,
		supplierId: '',
		name: '',
		manufacturer: '',
		manufacturerPartNumber: '',
		package: '',
		description: '',
		quantityMode: 'exact',
		quantity: '1',
		minimumQuantity: '',
		favorite: false,
		categoryId: '',
		location: '',
		note: '',
		...overrides,
	};
}

function createDraft(form: InventoryCreateFormState): InventoryCreateDraft {
	const quantity = form.quantityMode === 'unknown' ? null : form.quantityMode === 'depleted' ? 0 : Number(form.quantity);
	return {
		identity: {
			name: form.name,
			lcscPartNumber: form.lcscPartNumber || undefined,
			supplierId: form.supplierId || undefined,
			manufacturer: form.manufacturer || undefined,
			manufacturerPartNumber: form.manufacturerPartNumber || undefined,
			package: form.package || undefined,
			description: form.description || undefined,
		},
		quantity,
		precision: form.quantityMode === 'estimated' ? 'estimated' : form.quantityMode === 'unknown' ? 'unknown' : 'exact',
		state: quantity === 0 ? 'depleted' : 'in-stock',
		minimumQuantity: form.minimumQuantity ? Number(form.minimumQuantity) : undefined,
		favorite: form.favorite === true,
		categoryId: form.categoryId || undefined,
		location: form.location || undefined,
		note: form.note || undefined,
	};
}

function createController(
	findByLcscPartNumber: EdaModelCatalog['findByLcscPartNumber'],
	inputs: Array<string | undefined>,
	selections: Array<string | undefined>,
	productDetails?: ProductDetailsDraft,
	pickedOrderFiles?: PickedOrderFile[],
	openCreatePanel?: InventoryCreatePanel['open'],
	openOrderImportPanel?: OrderImportPanel['open'],
	edaLibraryCategories?: EdaLibraryCategories,
	selectedDesignComponents?: SelectedDesignComponentsReader,
	currentDesign?: CurrentDesignReader,
	openDesignStockCheckPanel?: DesignStockCheckPanel['open'],
	automaticBackup?: AutomaticInventoryBackup,
	bomMappingPanel?: BomMappingPanel,
	bomDiffPanel?: BomDiffPanel,
	bomStockOutPanel?: BomStockOutPanel,
	inventoryTransactionsPanel?: InventoryTransactionsPanel,
	projectPlanningPanel?: ProjectPlanningPanel,
	externalLinks?: ExternalLinkNavigator,
) {
	const add = vi.fn().mockImplementation(async (input: NewInventoryItem) => normalizeInventoryItem(
		input,
		'2026-07-20T00:00:00.000Z',
		'saved-item',
	));
	const openSearch = vi.fn();
	const searchModels = vi.fn().mockResolvedValue([]);
	const createReference = vi.fn((partNumber: string) => ({
		provider: 'lcsc' as const,
		productUrl: `https://so.szlcsc.com/global.html?k=${partNumber}`,
		evidence: 'user-confirmed' as const,
		confirmedAt: '2026-07-20T00:00:00.000Z',
	}));
	const dialog = {
		input: vi.fn().mockImplementation(async () => inputs.shift()),
		select: vi.fn().mockImplementation(async () => selections.shift()),
		info: vi.fn(),
		confirm: vi.fn().mockResolvedValue(true),
	};
	const trace = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		waitFor: vi.fn(async (_step: string, operation: () => Promise<unknown>) => operation()),
	} as unknown as DiagnosticTrace;
	const diagnostics = {
		start: vi.fn(() => trace),
		show: vi.fn().mockResolvedValue(undefined),
		flush: vi.fn().mockResolvedValue(undefined),
		exportDocument: vi.fn(),
	} as unknown as Diagnostics;
	const productDetailsForm = {
		open: vi.fn().mockResolvedValue(productDetails),
	} as unknown as ProductDetailsForm;
	const inventoryItemPanel = {
		view: vi.fn(),
		edit: vi.fn(),
		compare: vi.fn(),
	};
	const list = vi.fn().mockResolvedValue([]);
	const previewOrderImportBatch = vi.fn().mockImplementation(async (input: { files: Array<{ fileName: string; orderNumber?: string; fingerprint: string; items: NewInventoryItem[]; rowCount: number; totalQuantity: number }> }) => ({
		files: input.files.map(file => ({
			fileName: file.fileName,
			orderNumber: file.orderNumber,
			fingerprint: file.fingerprint,
			rowCount: file.rowCount,
			totalQuantity: file.totalQuantity,
			status: 'ready' as const,
			result: { added: file.items.length, merged: 0, skipped: 0 },
		})),
		result: { added: input.files.reduce((total, file) => total + file.items.length, 0), merged: 0, skipped: 0 },
	}));
	const importOrderBatch = vi.fn().mockImplementation(async (input: { files: Array<{ fileName: string; orderNumber?: string; fingerprint: string; items: NewInventoryItem[]; rowCount: number; totalQuantity: number }> }) => ({
		batchId: 'order-batch-1',
		files: input.files.map(file => ({
			fileName: file.fileName,
			orderNumber: file.orderNumber,
			fingerprint: file.fingerprint,
			rowCount: file.rowCount,
			totalQuantity: file.totalQuantity,
			status: 'imported' as const,
			result: { added: file.items.length, merged: 0, skipped: 0 },
		})),
		result: { added: input.files.reduce((total, file) => total + file.items.length, 0), merged: 0, skipped: 0 },
	}));
	const inventory = {
		add,
		createItem: vi.fn().mockImplementation(async (input: NewInventoryItem) => ({
			status: 'created' as const,
			item: normalizeInventoryItem(input, '2026-07-20T00:00:00.000Z', 'saved-item'),
		})),
		import: vi.fn().mockResolvedValue({ added: 1, merged: 0, skipped: 0 }),
		previewOrderImportBatch,
		importOrderBatch,
		list,
		get: vi.fn(),
		updateItem: vi.fn(),
		remove: vi.fn(),
		removeItems: vi.fn(),
		createCategory: vi.fn(),
		renameCategory: vi.fn(),
		deleteCategory: vi.fn(),
		reorderCategories: vi.fn(),
		moveItemsToCategory: vi.fn(),
		importCategories: vi.fn().mockResolvedValue({ added: 0, skipped: 0 }),
		attachEdaModel: vi.fn(),
		previewBomStockOut: vi.fn(),
		commitBomStockOut: vi.fn(),
		previewStockOutReversal: vi.fn(),
		reverseStockOutBatch: vi.fn(),
		listTransactions: vi.fn().mockResolvedValue([]),
		listStockOutBatches: vi.fn().mockResolvedValue([]),
		listProjectSnapshots: vi.fn().mockResolvedValue([]),
		captureProjectSnapshot: vi.fn(),
		replaceProjectSnapshot: vi.fn(),
		setProjectSnapshotBoardQuantity: vi.fn(),
		removeProjectSnapshot: vi.fn(),
		listPurchaseRecords: vi.fn().mockResolvedValue([]),
		addPurchaseRecord: vi.fn(),
		removePurchaseRecord: vi.fn(),
		listSubstituteLinks: vi.fn().mockResolvedValue([]),
		createSubstituteLink: vi.fn(),
		removeSubstituteLink: vi.fn(),
		loadRecoverySnapshot: vi.fn().mockResolvedValue(undefined),
		restoreDocument: vi.fn(),
		exportDocument: vi.fn(async () => ({
			schemaVersion: 9 as const,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: await list(),
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [],
		})),
	};
	const files = {
		pickInventoryBackup: vi.fn(),
		pickBomFiles: vi.fn(),
		pickOrderFiles: vi.fn().mockResolvedValue(pickedOrderFiles),
		saveCsv: vi.fn(),
		saveJson: vi.fn(),
	};
	const designStockCheckPanel = {
		open: vi.fn(openDesignStockCheckPanel ?? (async () => undefined)),
	};
	const inventoryOverviewPanel = {
		open: vi.fn(async (input: InventoryOverviewInput, onOperation: InventoryOverviewOperationHandler): Promise<void> => {
			const itemId = selections.shift();
			if (!itemId) {
				return;
			}
			const action = selections.shift();
			const item = input.items.find(candidate => candidate.id === itemId);
			if (!item) {
				return;
			}
			const reference = { id: item.id, expectedRevision: item.revision };
			if (action === 'details') {
				await onOperation({ operationId: 'operation-details', intent: { type: 'view-item', item: reference, viewState: overviewViewState } });
			}
			if (action === 'edit') {
				await onOperation({ operationId: 'operation-edit', intent: { type: 'edit-item', item: reference, viewState: overviewViewState } });
			}
			if (action === 'remove') {
				await onOperation({
					operationId: 'operation-remove',
					intent: { type: 'delete-item', item: reference, confirmed: true, viewState: overviewViewState },
				});
			}
		}),
	};
	const commonLibrary = {
		copy: vi.fn(),
	};
	const placement = {
		placeWithMouse: vi.fn().mockResolvedValue('ready'),
	};
	const externalLinkNavigator = externalLinks ?? { open: vi.fn().mockReturnValue(true) };
	const inventoryCreatePanel = {
		open: vi.fn(openCreatePanel ?? (async () => ({ status: 'cancelled' as const }))),
	};
	const orderImportPanel = {
		open: vi.fn(openOrderImportPanel ?? (async (_input, handleAction: OrderImportPanelActionHandler) => {
			const defaultState = selections.shift() as 'depleted' | 'in-stock' | undefined;
			const strategy = selections.shift() as 'add' | 'replace' | 'skip' | undefined;
			if (!defaultState || !strategy) {
				return 'cancelled' as const;
			}
			const settings = { defaultState, strategy };
			const reportProgress = vi.fn(async () => undefined);
			const preview = await handleAction({ type: 'preview', operationId: 'preview', settings }, reportProgress);
			if (preview.stage !== 'preview' || !preview.preview.files.some(file => file.status === 'ready')) {
				return 'cancelled' as const;
			}
			const result = await handleAction({
				type: 'import',
				operationId: 'import',
				settings,
				previewToken: preview.previewToken,
			}, reportProgress);
			return result.stage === 'completed' ? 'completed' as const : 'cancelled' as const;
		})),
	};
	const controller = new NativeInventoryController(
		inventory as unknown as InventoryService,
		{ findByLcscPartNumber, search: searchModels } as EdaModelCatalog,
		{ openSearch, createReference } as MarketplaceNavigator,
		commonLibrary as CommonLibrary,
		files as unknown as EdaFileClient,
		edaLibraryCategories ?? {
			availableSources: vi.fn().mockResolvedValue([]),
			read: vi.fn(),
		} as EdaLibraryCategories,
		placement as unknown as EdaPlacementClient,
		dialog as unknown as NativeDialog,
		diagnostics,
		productDetailsForm,
		inventoryCreatePanel as InventoryCreatePanel,
		orderImportPanel as OrderImportPanel,
		inventoryOverviewPanel as InventoryOverviewPanel,
		inventoryItemPanel as unknown as InventoryItemPanel,
		((key: string) => key) as Translate,
		'0.2.1',
		selectedDesignComponents,
		currentDesign,
		designStockCheckPanel as DesignStockCheckPanel,
		automaticBackup,
		bomMappingPanel,
		bomDiffPanel,
		bomStockOutPanel,
		inventoryTransactionsPanel,
		projectPlanningPanel,
		externalLinkNavigator,
	);
	return { add, commonLibrary, controller, createReference, designStockCheckPanel, diagnostics, dialog, externalLinkNavigator, files, inventory, inventoryCreatePanel, inventoryItemPanel, inventoryOverviewPanel, openSearch, orderImportPanel, placement, productDetailsForm, searchModels, trace };
}

function createAutomaticBackup(settings: { enabled: boolean; path?: string } = { enabled: false }) {
	return {
		getSettings: vi.fn(() => settings),
		selectFolder: vi.fn(async () => 'D:\\Inventory'),
		prepareBackupPath: vi.fn(async folder => `${folder}\\jlceda-inventory-latest.json`),
		configure: vi.fn(async path => ({ ...settings, enabled: true, path })),
		disable: vi.fn(async () => ({ ...settings, enabled: false })),
		test: vi.fn(async () => ({ status: 'succeeded' as const, completedAt: '2026-07-22T00:00:00.000Z' })),
		backupAfterSave: vi.fn(),
	} satisfies AutomaticInventoryBackup;
}

describe('nativeInventoryController.manageSubstituteLinks', () => {
	it('creates a user-confirmed link after choosing two items and confirming', async () => {
		const base = createInventoryItem('base-item');
		const target = createInventoryItem('target-item');
		const context = createController(vi.fn(), ['5', 'bench verified'], [base.id, '__create__', target.id]);
		context.inventory.list.mockResolvedValue([base, target]);
		context.inventory.createSubstituteLink.mockResolvedValue({
			id: 'link-1',
			itemIdA: base.id,
			itemIdB: target.id,
			note: 'bench verified',
			createdAt: '2026-07-22T08:00:00.000Z',
			updatedAt: '2026-07-22T08:00:00.000Z',
			revision: 1,
		});

		await context.controller.manageSubstituteLinks();

		expect(context.dialog.confirm).toHaveBeenCalledWith('substituteLinks.confirmCreate', 'substituteLinks.title');
		expect(context.inventory.createSubstituteLink).toHaveBeenCalledWith({
			itemA: { id: base.id, expectedRevision: base.revision },
			itemB: { id: target.id, expectedRevision: target.revision },
			expectedDocumentRevision: 1,
			note: 'bench verified',
		});
	});

	it('shows a confirmed candidate with required quantity and removes only after confirmation', async () => {
		const base = createInventoryItem('base-item');
		const target = createInventoryItem('target-item');
		const link = {
			id: 'link-1',
			itemIdA: base.id,
			itemIdB: target.id,
			createdAt: '2026-07-22T08:00:00.000Z',
			updatedAt: '2026-07-22T08:00:00.000Z',
			revision: 1,
		};
		const context = createController(vi.fn(), ['6'], [base.id, `link:${link.id}`]);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 9,
			revision: 4,
			updatedAt: '2026-07-22T08:00:00.000Z',
			categories: [],
			items: [base, target],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
			substituteLinks: [link],
		});
		context.inventory.removeSubstituteLink.mockResolvedValue(link);

		await context.controller.manageSubstituteLinks();

		expect(context.dialog.select).toHaveBeenLastCalledWith(
			expect.arrayContaining([expect.objectContaining({ value: `link:${link.id}` })]),
			'substituteLinks.title',
			'substituteLinks.candidatePrompt',
			undefined,
			expect.any(Function),
		);
		expect(context.dialog.confirm).toHaveBeenCalledWith('substituteLinks.confirmRemove', 'substituteLinks.title');
		expect(context.inventory.removeSubstituteLink).toHaveBeenCalledWith(link.id, link.revision);
	});
});

describe('nativeInventoryController.locateSelectedInventory', () => {
	it('opens the inventory overview filtered to the selected component C-number', async () => {
		const item = createInventoryItem();
		const selectedDesignComponents = {
			readSelectedComponents: vi.fn().mockResolvedValue({
				status: 'available',
				snapshot: {
					document: { kind: 'schematic', uuid: 'schematic-1' },
					components: [{
						primitiveId: 'primitive-r1',
						designator: 'R1',
						lcscPartNumber: 'C233991',
						name: '10k resistor',
					}],
				},
			}),
		} satisfies SelectedDesignComponentsReader;
		const context = createController(
			vi.fn(),
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			selectedDesignComponents,
		);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 8,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: [item],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
		});

		await context.controller.locateSelectedInventory();

		expect(selectedDesignComponents.readSelectedComponents).toHaveBeenCalledOnce();
		expect(context.inventoryOverviewPanel.open).toHaveBeenCalledWith(
			expect.objectContaining({
				items: [item],
				initialState: expect.objectContaining({
					focusItemId: item.id,
					query: 'C233991',
					searchScope: 'all',
				}),
			}),
			expect.any(Function),
			context.trace,
		);
		expect(context.inventoryCreatePanel.open).not.toHaveBeenCalled();
	});

	it('focuses the exact inventory record selected from duplicate C-number matches', async () => {
		const first = createInventoryItem('first-match');
		const second = {
			...createInventoryItem('second-match'),
			identity: { ...createInventoryItem('second-match').identity, name: 'Second stock record' },
		};
		const selectedDesignComponents = {
			readSelectedComponents: vi.fn().mockResolvedValue({
				status: 'available',
				snapshot: {
					document: { kind: 'schematic', uuid: 'schematic-1' },
					components: [{
						primitiveId: 'primitive-r1',
						designator: 'R1',
						lcscPartNumber: 'C233991',
					}],
				},
			}),
		} satisfies SelectedDesignComponentsReader;
		const context = createController(
			vi.fn(),
			[],
			[second.id],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			selectedDesignComponents,
		);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 8,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: [first, second],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
		});

		await context.controller.locateSelectedInventory();

		expect(context.dialog.select).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ value: first.id }),
				expect.objectContaining({ value: second.id }),
			]),
			'selectedInventory.title',
			'selectedInventory.chooseInventory',
		);
		expect(context.inventoryOverviewPanel.open).toHaveBeenCalledWith(
			expect.objectContaining({
				initialState: expect.objectContaining({
					focusItemId: second.id,
					query: 'C233991',
				}),
			}),
			expect.any(Function),
			context.trace,
		);
	});

	it('offers a prefilled create flow when the selected component is missing from inventory', async () => {
		const selectedDesignComponents = {
			readSelectedComponents: vi.fn().mockResolvedValue({
				status: 'available',
				snapshot: {
					document: { kind: 'pcb', uuid: 'pcb-1' },
					components: [{
						primitiveId: 'primitive-u1',
						designator: 'U1',
						manufacturer: 'Acme',
						manufacturerPartNumber: 'MCU-42',
						name: 'Microcontroller',
						package: 'QFN-32',
					}],
				},
			}),
		} satisfies SelectedDesignComponentsReader;
		const context = createController(
			vi.fn(),
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			selectedDesignComponents,
		);

		await context.controller.locateSelectedInventory();

		expect(context.dialog.confirm).toHaveBeenCalledWith(
			'selectedInventory.offerAdd',
			'selectedInventory.title',
		);
		expect(context.inventoryCreatePanel.open).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'custom',
				initial: expect.objectContaining({
					name: 'Microcontroller',
					manufacturer: 'Acme',
					manufacturerPartNumber: 'MCU-42',
					package: 'QFN-32',
				}),
			}),
			expect.any(Function),
			context.trace,
		);
		expect(context.inventoryOverviewPanel.open).not.toHaveBeenCalled();
	});
});

describe('nativeInventoryController.placeFromInventory', () => {
	it('opens the searchable categorized overview and places the selected row without a native selector', async () => {
		const item = {
			...createInventoryItem(),
			edaModelReference: edaModel.reference,
			edaModelStatus: 'available' as const,
		};
		const context = createController(vi.fn(), [], []);
		context.inventory.list.mockResolvedValue([item]);
		context.inventory.get.mockResolvedValue(item);
		let operationResult: unknown;
		context.inventoryOverviewPanel.open.mockImplementation(async (input, onOperation) => {
			expect(input).toMatchObject({
				items: [item],
				initialState: {
					categoryId: 'all',
					modelFilter: 'available',
					searchScope: 'all',
					stockFilter: 'in-stock',
				},
			});
			operationResult = await onOperation({
				operationId: 'place-item',
				intent: {
					type: 'place-item',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: overviewViewState,
				},
			});
		});

		await context.controller.placeFromInventory();

		expect(context.diagnostics.start).toHaveBeenCalledWith('place-from-inventory', false);
		expect(context.dialog.select).not.toHaveBeenCalled();
		expect(context.placement.placeWithMouse).toHaveBeenCalledWith(edaModel.reference);
		expect(operationResult).toMatchObject({ status: 'succeeded', message: 'place.ready' });
		expect(context.inventory.updateItem).not.toHaveBeenCalled();
		expect(context.inventory.remove).not.toHaveBeenCalled();
	});

	it.each([
		['depleted inventory', { state: 'depleted' as const }, 'place.depleted'],
		['missing model', { edaModelReference: undefined, edaModelStatus: 'missing' as const }, 'place.modelUnavailable'],
	])('revalidates and rejects %s before calling the placement API', async (_name, latestPatch, message) => {
		const item = {
			...createInventoryItem(),
			edaModelReference: edaModel.reference,
			edaModelStatus: 'available' as const,
		};
		const latest = { ...item, ...latestPatch };
		const context = createController(vi.fn(), [], []);
		context.inventory.list.mockResolvedValue([item]);
		context.inventory.get.mockResolvedValue(latest);
		let operationResult: unknown;
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			operationResult = await onOperation({
				operationId: 'place-item',
				intent: {
					type: 'place-item',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: overviewViewState,
				},
			});
		});

		await context.controller.placeFromInventory();

		expect(operationResult).toEqual({ status: 'failed', message });
		expect(context.placement.placeWithMouse).not.toHaveBeenCalled();
	});

	it('keeps the overview visible with a specific failure when no schematic is active', async () => {
		const item = {
			...createInventoryItem(),
			edaModelReference: edaModel.reference,
			edaModelStatus: 'available' as const,
		};
		const context = createController(vi.fn(), [], []);
		context.inventory.list.mockResolvedValue([item]);
		context.inventory.get.mockResolvedValue(item);
		context.placement.placeWithMouse.mockResolvedValue('not-schematic');
		let operationResult: unknown;
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			operationResult = await onOperation({
				operationId: 'place-item',
				intent: {
					type: 'place-item',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: overviewViewState,
				},
			});
		});

		await context.controller.placeFromInventory();

		expect(operationResult).toEqual({ status: 'failed', message: 'place.schematicRequired' });
	});

	it('reports a placement API exception without exposing host details in the UI', async () => {
		const item = {
			...createInventoryItem(),
			edaModelReference: edaModel.reference,
			edaModelStatus: 'available' as const,
		};
		const context = createController(vi.fn(), [], []);
		context.inventory.list.mockResolvedValue([item]);
		context.inventory.get.mockResolvedValue(item);
		context.placement.placeWithMouse.mockRejectedValue(new TypeError('host internals'));
		let operationResult: unknown;
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			operationResult = await onOperation({
				operationId: 'place-item',
				intent: {
					type: 'place-item',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: overviewViewState,
				},
			});
		});

		await context.controller.placeFromInventory();

		expect(operationResult).toEqual({ status: 'failed', message: 'place.failed' });
		expect(context.trace.warn).toHaveBeenCalledWith('inventory-overview.place.failed', { errorName: 'TypeError' });
	});
});

describe('nativeInventoryController.checkCurrentDesignStock', () => {
	it('checks current design demand and exports the non-sufficient report through the host file API', async () => {
		const item = { ...createInventoryItem(), quantity: 1, precision: 'exact' as const };
		const currentDesign = {
			readCurrentDesign: vi.fn().mockResolvedValue({
				status: 'available',
				snapshot: {
					document: { kind: 'schematic', uuid: 'schematic-1' },
					components: [
						{ primitiveId: 'r1', designator: 'R1', lcscPartNumber: 'C233991', name: 'Resistor' },
						{ primitiveId: 'r2', designator: 'R2', lcscPartNumber: 'C233991', name: 'Resistor' },
					],
				},
			}),
		} satisfies CurrentDesignReader;
		const openReport = vi.fn<DesignStockCheckPanel['open']>(async (input, handleAction) => {
			expect(input.source).toBe('schematic');
			expect(input.report).toMatchObject({
				boardQuantity: 2,
				rows: [{
					availableQuantity: 1,
					requiredQuantity: 4,
					shortageQuantity: 3,
					status: 'insufficient',
				}],
			});
			expect(await handleAction({ type: 'export-csv' })).toEqual({
				status: 'succeeded',
				message: 'designStockCheck.exportSucceeded',
			});
		});
		const context = createController(
			vi.fn(),
			['2'],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			currentDesign,
			openReport,
		);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 8,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: [item],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
		});

		await context.controller.checkCurrentDesignStock();

		expect(currentDesign.readCurrentDesign).toHaveBeenCalledOnce();
		expect(context.files.saveCsv).toHaveBeenCalledWith(
			expect.stringContaining('"C233991"'),
			expect.stringMatching(/^jlceda-inventory-shortage-\d{4}-\d{2}-\d{2}\.csv$/),
		);
	});

	it('does not open a report when the board quantity is invalid', async () => {
		const currentDesign = {
			readCurrentDesign: vi.fn().mockResolvedValue({
				status: 'available',
				snapshot: {
					document: { kind: 'pcb', uuid: 'pcb-1' },
					components: [],
				},
			}),
		} satisfies CurrentDesignReader;
		const context = createController(
			vi.fn(),
			['1.5'],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			currentDesign,
		);

		await context.controller.checkCurrentDesignStock();

		expect(context.dialog.info).toHaveBeenCalledWith(
			'designStockCheck.boardQuantityInvalid',
			'designStockCheck.title',
		);
		expect(context.designStockCheckPanel.open).not.toHaveBeenCalled();
	});
});

describe('nativeInventoryController.checkExternalBomStock', () => {
	it('maps one BOM file and reuses the design stock report with board multiplication', async () => {
		const bomMappingPanel = {
			open: vi.fn(async () => ({
				status: 'submitted' as const,
				files: [{
					fileIndex: 0,
					sheetIndex: 0,
					headerRowIndex: 0,
					mapping: { lcscPartNumber: 0, designators: 1, quantity: 2, name: 3 },
				}],
			})),
		} satisfies BomMappingPanel;
		const openReport = vi.fn<DesignStockCheckPanel['open']>(async (input) => {
			expect(input.source).toBe('file');
			expect(input.report).toMatchObject({
				boardQuantity: 2,
				rows: [{
					designators: ['R1, R2'],
					requiredQuantity: 4,
					status: 'inventory-missing',
				}],
			});
		});
		const context = createController(
			vi.fn(),
			['2'],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			openReport,
			undefined,
			bomMappingPanel,
		);
		context.files.pickBomFiles.mockResolvedValue([{
			name: 'bom.csv',
			content: new TextEncoder().encode('LCSC,Designators,Qty,Name\nC25804,"R1,R2",2,Resistor').buffer,
		}]);

		await context.controller.checkExternalBomStock();

		expect(bomMappingPanel.open).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'stock-check', files: [expect.objectContaining({ fileName: 'bom.csv' })] }),
			context.trace,
		);
		expect(context.designStockCheckPanel.open).toHaveBeenCalledOnce();
		expect(context.inventory.restoreDocument).not.toHaveBeenCalled();
	});
});

describe('nativeInventoryController.compareBomVersions', () => {
	it('maps two files, reports normalized changes, and exports the complete CSV', async () => {
		const mapping = { lcscPartNumber: 0, quantity: 1, designators: 2, name: 3 };
		const bomMappingPanel = {
			open: vi.fn(async () => ({
				status: 'submitted' as const,
				files: [
					{ fileIndex: 0, sheetIndex: 0, headerRowIndex: 0, mapping },
					{ fileIndex: 1, sheetIndex: 0, headerRowIndex: 0, mapping },
				],
			})),
		} satisfies BomMappingPanel;
		const bomDiffPanel = {
			open: vi.fn<BomDiffPanel['open']>(async (input, handleAction) => {
				expect(input.beforeFileName).toBe('before.csv');
				expect(input.afterFileName).toBe('after.csv');
				expect(input.result.entries.map(entry => [entry.type, entry.lcscPartNumber, entry.quantityDelta])).toEqual([
					['quantity-increased', 'C1', 2],
					['added', 'C2', 1],
				]);
				await handleAction({ type: 'export-csv' });
			}),
		} satisfies BomDiffPanel;
		const context = createController(
			vi.fn(),
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			bomMappingPanel,
			bomDiffPanel,
		);
		context.files.pickBomFiles.mockResolvedValue([
			{
				name: 'before.csv',
				content: new TextEncoder().encode('LCSC,Qty,Designators,Name\nC1,1,R1,Resistor').buffer,
			},
			{
				name: 'after.csv',
				content: new TextEncoder().encode('LCSC,Qty,Designators,Name\nC1,3,"R1,R2,R3",Resistor\nC2,1,C1,Capacitor').buffer,
			},
		]);

		await context.controller.compareBomVersions();

		expect(bomMappingPanel.open).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'compare' }),
			context.trace,
		);
		expect(bomDiffPanel.open).toHaveBeenCalledOnce();
		expect(context.files.saveCsv).toHaveBeenCalledWith(
			expect.stringContaining('"bomDiff.change.quantityIncreased","C1","1","3","2"'),
			expect.stringMatching(/^jlceda-inventory-bom-diff-\d{4}-\d{2}-\d{2}\.csv$/),
		);
	});
});

describe('nativeInventoryController.stockOutBomFile', () => {
	it('commits one explicitly mapped, exact, sufficient BOM batch atomically', async () => {
		const inventoryItem = { ...createInventoryItem('stock-item'), quantity: 10, precision: 'exact' as const };
		const mapping = { lcscPartNumber: 0, quantity: 1, designators: 2, name: 3 };
		const bomMappingPanel = {
			open: vi.fn(async () => ({
				status: 'submitted' as const,
				files: [{ fileIndex: 0, sheetIndex: 0, headerRowIndex: 0, mapping }],
			})),
		} satisfies BomMappingPanel;
		const preview = {
			status: 'ready' as const,
			documentRevision: 7,
			batchFingerprint: 'b'.repeat(64),
			lines: [{
				lineIndex: 0,
				itemId: inventoryItem.id,
				itemRevision: inventoryItem.revision,
				requestedQuantity: 4,
				beforeQuantity: 10,
				afterQuantity: 6,
				sourceReference: 'R1, R2',
			}],
			issues: [],
		};
		const bomStockOutPanel = {
			open: vi.fn<BomStockOutPanel['open']>(async (input, handleAction) => {
				expect(input).toMatchObject({
					sourceName: 'assembly.csv',
					boardQuantity: 2,
					itemSummaries: [{ itemId: inventoryItem.id, requestedQuantity: 4, designators: ['R1', 'R2'] }],
					preview,
				});
				expect(await handleAction({ type: 'commit' })).toMatchObject({
					status: 'succeeded',
					message: 'bomStockOut.completed',
				});
			}),
		} satisfies BomStockOutPanel;
		const context = createController(
			vi.fn(),
			['2', 'Assembly run 1'],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			bomMappingPanel,
			undefined,
			bomStockOutPanel,
		);
		context.files.pickBomFiles.mockResolvedValue([{
			name: 'assembly.csv',
			content: new TextEncoder().encode('LCSC,Qty,Designators,Name\nC233991,2,"R1,R2",Resistor').buffer,
		}]);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 8,
			revision: 7,
			updatedAt: '2026-07-22T00:00:00.000Z',
			categories: [],
			items: [inventoryItem],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
		});
		context.inventory.previewBomStockOut.mockResolvedValue(preview);
		context.inventory.commitBomStockOut.mockResolvedValue({
			batch: {},
			transactions: [{ id: 'transaction-1' }],
			items: [],
			documentRevision: 8,
		});

		await context.controller.stockOutBomFile();

		expect(context.inventory.previewBomStockOut).toHaveBeenCalledWith(expect.objectContaining({
			sourceName: 'assembly.csv',
			note: 'Assembly run 1',
			lines: [{ itemId: inventoryItem.id, quantity: 4, sourceReference: 'R1, R2' }],
		}));
		expect(context.inventory.commitBomStockOut).toHaveBeenCalledWith(expect.any(Object), 7);
		expect(bomStockOutPanel.open).toHaveBeenCalledOnce();
	});
});

describe('nativeInventoryController.openInventoryTransactions', () => {
	it('revalidates and reverses a complete stock-out batch before refreshing the ledger', async () => {
		const batch = {
			id: 'batch-1',
			fingerprint: 'a'.repeat(64),
			source: 'bom' as const,
			sourceFingerprint: 'b'.repeat(64),
			sourceName: 'assembly.csv',
			createdAt: '2026-07-22T00:00:00.000Z',
			lines: [{ itemId: 'stock-item', quantity: 2, transactionId: 'transaction-1' }],
		};
		const transaction = {
			id: 'transaction-1',
			itemId: 'stock-item',
			kind: 'bom-stock-out' as const,
			source: 'bom' as const,
			delta: -2,
			beforeQuantity: 10,
			afterQuantity: 8,
			createdAt: '2026-07-22T00:00:00.000Z',
			identity: { name: 'Resistor', lcscPartNumber: 'C233991' },
			batchId: 'batch-1',
		};
		const inventoryTransactionsPanel = {
			open: vi.fn<InventoryTransactionsPanel['open']>(async (input, handleAction) => {
				expect(input).toEqual({ batches: [batch], transactions: [transaction] });
				expect(await handleAction({ type: 'undo-batch', batchId: batch.id })).toMatchObject({
					status: 'succeeded',
					message: 'inventoryTransactions.undoCompleted',
					snapshot: { batches: [expect.objectContaining({ id: batch.id })] },
				});
			}),
		} satisfies InventoryTransactionsPanel;
		const context = createController(
			vi.fn(),
			['Incorrect assembly'],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			inventoryTransactionsPanel,
		);
		const initial = {
			schemaVersion: 8,
			revision: 7,
			updatedAt: '2026-07-22T00:00:00.000Z',
			categories: [],
			items: [],
			orderImportBatches: [],
			transactions: [transaction],
			stockOutBatches: [batch],
		};
		const reversedBatch = {
			...batch,
			reversal: {
				id: 'reversal-1',
				createdAt: '2026-07-22T01:00:00.000Z',
				transactionIds: ['transaction-2'],
			},
		};
		context.inventory.exportDocument
			.mockResolvedValueOnce(initial)
			.mockResolvedValueOnce({ ...initial, revision: 8, stockOutBatches: [reversedBatch] });
		context.inventory.previewStockOutReversal.mockResolvedValue({
			status: 'ready',
			documentRevision: 7,
			batchId: batch.id,
			lines: [{
				itemId: 'stock-item',
				itemRevision: 2,
				quantity: 2,
				beforeQuantity: 8,
				afterQuantity: 10,
				originalTransactionId: 'transaction-1',
			}],
			issues: [],
		});
		context.inventory.reverseStockOutBatch.mockResolvedValue({
			batch: reversedBatch,
			transactions: [{ id: 'transaction-2' }],
			items: [],
			reversalId: 'reversal-1',
			documentRevision: 8,
		});

		await context.controller.openInventoryTransactions();

		expect(context.inventory.reverseStockOutBatch).toHaveBeenCalledWith(
			batch.id,
			7,
			'Incorrect assembly',
		);
	});
});

describe('nativeInventoryController.openProjectPlanning', () => {
	it('captures the current design with UUID identity and a single-board demand snapshot', async () => {
		const currentDesign = {
			readCurrentDesign: vi.fn().mockResolvedValue({
				status: 'available',
				snapshot: {
					document: { kind: 'pcb', uuid: 'pcb-1', projectUuid: 'project-1' },
					components: [{
						primitiveId: 'r1',
						designator: 'R1',
						lcscPartNumber: 'C233991',
						name: 'Resistor',
					}],
				},
			}),
		} satisfies CurrentDesignReader;
		const projectPlanningPanel = {
			open: vi.fn<ProjectPlanningPanel['open']>(async (_input, handleOperation) => {
				const result = await handleOperation({
					operationId: 'capture-current',
					intent: {
						type: 'capture-current',
						viewState: { tab: 'snapshots', snapshotPage: 1, procurementPage: 1, purchasePage: 1, pageSize: 25 },
					},
				});
				expect(result).toMatchObject({
					status: 'succeeded',
					message: 'projectPlanning.snapshotCaptured',
					snapshot: {
						snapshots: [expect.objectContaining({ documentUuid: 'pcb-1', boardQuantity: 3 })],
						procurement: [expect.objectContaining({ suggestedQuantity: 3 })],
					},
				});
			}),
		} satisfies ProjectPlanningPanel;
		const context = createController(
			vi.fn(),
			['Controller board', '3'],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			currentDesign,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			projectPlanningPanel,
		);
		const initial = {
			schemaVersion: 8 as const,
			revision: 1,
			updatedAt: '2026-07-22T00:00:00.000Z',
			categories: [],
			items: [],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
			projectSnapshots: [],
			purchaseRecords: [],
		};
		let captured: Awaited<ReturnType<typeof context.inventory.captureProjectSnapshot>> | undefined;
		context.inventory.captureProjectSnapshot.mockImplementation(async (input) => {
			captured = { ...input, revision: 1 };
			return captured;
		});
		context.inventory.exportDocument
			.mockResolvedValueOnce(initial)
			.mockResolvedValueOnce(initial)
			.mockImplementationOnce(async () => ({ ...initial, revision: 2, projectSnapshots: captured ? [captured] : [] }));

		await context.controller.openProjectPlanning();

		expect(context.inventory.captureProjectSnapshot).toHaveBeenCalledWith(expect.objectContaining({
			projectUuid: 'project-1',
			documentUuid: 'pcb-1',
			documentKind: 'pcb',
			label: 'Controller board',
			boardQuantity: 3,
			demands: [expect.objectContaining({ unitQuantity: 1 })],
		}));
	});
});

describe('nativeInventoryController datasheet navigation', () => {
	it('opens only the persisted datasheet URL from a revision-checked overview intent', async () => {
		const item = { ...createInventoryItem('datasheet-item'), datasheetUrl: 'https://example.com/data.pdf' };
		const context = createController(vi.fn(), [], []);
		context.inventory.list.mockResolvedValue([item]);
		context.inventoryOverviewPanel.open.mockImplementation(async (input, onOperation) => {
			const snapshot = input.items[0];
			expect(await onOperation({
				operationId: 'open-datasheet',
				intent: {
					type: 'open-datasheet',
					item: { id: snapshot.id, expectedRevision: snapshot.revision },
					viewState: overviewViewState,
				},
			})).toMatchObject({ status: 'succeeded' });
		});

		await context.controller.openInventory();

		expect(context.externalLinkNavigator.open).toHaveBeenCalledWith('https://example.com/data.pdf');
	});
});

describe('nativeInventoryController.importEdaCategories', () => {
	it('imports explicit category structure without assigning inventory items', async () => {
		const categories = {
			availableSources: vi.fn().mockResolvedValue(['personal']),
			read: vi.fn().mockResolvedValue({
				status: 'available',
				snapshot: {
					source: 'personal',
					discovery: 'device-scan',
					complete: false,
					categories: [{ name: 'Passive', children: ['Resistors'] }],
				},
			}),
		} as EdaLibraryCategories;
		const { controller, dialog, inventory } = createController(
			vi.fn(),
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			categories,
		);
		inventory.importCategories.mockResolvedValue({ added: 2, skipped: 0 });

		await controller.importEdaCategories();

		expect(categories.read).toHaveBeenCalledWith('personal');
		expect(dialog.confirm).toHaveBeenCalledWith('categoryImport.confirm', 'categoryImport.title');
		expect(inventory.importCategories).toHaveBeenCalledWith([{ name: 'Passive', children: ['Resistors'] }]);
		expect(inventory.moveItemsToCategory).not.toHaveBeenCalled();
		expect(dialog.info).toHaveBeenCalledWith(
			'categoryImport.completed\n\ncategoryImport.incomplete',
			'categoryImport.title',
		);
	});

	it('returns the refreshed category snapshot to an active inventory overview session', async () => {
		const importedCategory = {
			id: 'category-passive',
			name: 'Passive',
			sortOrder: 0,
			createdAt: '2026-07-22T00:00:00.000Z',
			updatedAt: '2026-07-22T00:00:00.000Z',
			revision: 1,
		};
		const categories = {
			availableSources: vi.fn().mockResolvedValue(['personal']),
			read: vi.fn().mockResolvedValue({
				status: 'available',
				snapshot: {
					source: 'personal',
					discovery: 'classification-tree',
					complete: true,
					categories: [{ name: 'Passive', children: [] }],
				},
			}),
		} as EdaLibraryCategories;
		const context = createController(
			vi.fn(),
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			categories,
		);
		context.inventory.importCategories.mockResolvedValue({ added: 1, skipped: 0 });
		context.inventory.exportDocument
			.mockResolvedValueOnce({ categories: [], items: [] })
			.mockResolvedValueOnce({ categories: [importedCategory], items: [] });
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const result = await onOperation({
				operationId: 'operation-import-categories',
				intent: { type: 'import-eda-categories', viewState: overviewViewState },
			});
			expect(result).toEqual({
				status: 'succeeded',
				message: 'categoryImport.completed',
				snapshot: { categories: [importedCategory], items: [] },
			});
		});

		await context.controller.openInventory();

		expect(context.inventory.importCategories).toHaveBeenCalledWith([{ name: 'Passive', children: [] }]);
		expect(context.inventoryOverviewPanel.open).toHaveBeenCalledTimes(1);
		expect(context.diagnostics.start).toHaveBeenCalledWith('inventory-overview', false);
		expect(context.inventoryOverviewPanel.open).toHaveBeenCalledWith(
			expect.objectContaining({ categories: [], items: [] }),
			expect.any(Function),
			context.trace,
		);
		expect(context.diagnostics.flush).toHaveBeenCalledTimes(1);
		expect(context.dialog.info).not.toHaveBeenCalledWith('categoryImport.completed');
	});
});

describe('nativeInventoryController.addByLcscPartNumber', () => {
	it('prefills the unified create form from an LCSC package code', async () => {
		const openPanel: InventoryCreatePanel['open'] = async (input) => {
			expect(input).toMatchObject({
				mode: 'lcsc',
				initial: {
					lcscPartNumber: 'C307423',
					supplierId: 'C307423',
					name: 'RC0603FR-0710KL',
					manufacturerPartNumber: 'RC0603FR-0710KL',
					quantityMode: 'exact',
					quantity: '100',
				},
			});
			return { status: 'cancelled' };
		};
		const setup = createController(
			vi.fn(),
			['{pc:C307423,pm:RC0603FR-0710KL,qty:100}'],
			[],
			undefined,
			undefined,
			openPanel,
		);

		await setup.controller.importPackageCode();

		expect(setup.dialog.confirm).toHaveBeenCalledWith('packageScan.confirmPreview', 'packageScan.title');
		expect(setup.inventoryCreatePanel.open).toHaveBeenCalledOnce();
		expect(setup.diagnostics.start).toHaveBeenCalledWith('import-package-code');
	});

	it('rejects an invalid package code before opening the create form', async () => {
		const setup = createController(vi.fn(), ['pm:missing-c-number'], []);

		await setup.controller.importPackageCode();

		expect(setup.inventoryCreatePanel.open).not.toHaveBeenCalled();
		expect(setup.dialog.info).toHaveBeenCalledWith('packageScan.missingPartNumber', 'packageScan.title');
	});

	it('queries EDA and saves the bound model from the unified form', async () => {
		const form = createForm({ lcscPartNumber: 'C25804', name: '10k resistor', quantity: '20', location: 'TEST-A00' });
		const findByLcscPartNumber = vi.fn().mockResolvedValue(edaModel);
		const openPanel: InventoryCreatePanel['open'] = async (input, handleAction) => {
			expect(input.mode).toBe('lcsc');
			const lookup = await handleAction({ type: 'query-eda', operationId: 'lookup', form, lcscPartNumber: 'C25804' });
			expect(lookup.stage).toBe('succeeded');
			const modelToken = lookup.stage === 'succeeded' ? lookup.modelToken : undefined;
			const draft = createDraft(form);
			const saved = await handleAction({ type: 'save', operationId: 'save', form, draft, modelToken });
			expect(saved.stage).toBe('succeeded');
			return { status: 'saved', draft, merged: false };
		};
		const { controller, createReference, dialog, inventory, openSearch, trace } = createController(
			findByLcscPartNumber,
			[],
			[],
			undefined,
			undefined,
			openPanel,
		);

		await controller.addByLcscPartNumber();

		expect(findByLcscPartNumber).toHaveBeenCalledWith('C25804');
		expect(openSearch).not.toHaveBeenCalled();
		expect(createReference).not.toHaveBeenCalled();
		expect(dialog.input).not.toHaveBeenCalled();
		expect(inventory.createItem).toHaveBeenCalledWith(expect.objectContaining({
			edaModelReference: edaModel.reference,
			edaModelStatus: 'available',
			quantity: 20,
			location: 'TEST-A00',
			source: 'catalog',
		}));
		expect(trace.waitFor).toHaveBeenCalledWith('eda-model.lookup', expect.any(Function));
		expect(trace.waitFor).toHaveBeenCalledWith('inventory.save', expect.any(Function));
	});

	it('stores user-confirmed marketplace evidence after opening the product search', async () => {
		const form = createForm({ lcscPartNumber: 'C233991', name: 'Electret microphone', quantity: '5' });
		const openPanel: InventoryCreatePanel['open'] = async (_input, handleAction) => {
			const blocked = await handleAction({ type: 'open-marketplace', operationId: 'market-before-query', form, lcscPartNumber: 'C233991' });
			expect(blocked.stage).toBe('failed');
			const lookup = await handleAction({ type: 'query-eda', operationId: 'lookup', form, lcscPartNumber: 'C233991' });
			expect(lookup.stage).toBe('not-found');
			await handleAction({ type: 'open-marketplace', operationId: 'market', form, lcscPartNumber: 'C233991' });
			const confirmedForm = { ...form, marketplaceConfirmed: true };
			const draft = createDraft(confirmedForm);
			await handleAction({ type: 'save', operationId: 'save', form: confirmedForm, draft });
			return { status: 'saved', draft, merged: false };
		};
		const { controller, createReference, inventory, openSearch } = createController(
			vi.fn().mockResolvedValue(undefined),
			[],
			[],
			undefined,
			undefined,
			openPanel,
		);

		await controller.addByLcscPartNumber();

		expect(openSearch).toHaveBeenCalledWith('C233991');
		expect(createReference).toHaveBeenCalledWith('C233991', 'user-confirmed');
		expect(inventory.createItem).toHaveBeenCalledWith(expect.objectContaining({
			edaModelStatus: 'missing',
			marketplaceReference: expect.objectContaining({ evidence: 'user-confirmed' }),
			source: 'marketplace',
		}));
	});

	it('rejects a marketplace confirmation that was not opened in the current session', async () => {
		const form = createForm({
			lcscPartNumber: 'C233991',
			marketplaceConfirmed: true,
			name: 'Electret microphone',
			quantity: '5',
		});
		const openPanel: InventoryCreatePanel['open'] = async (_input, handleAction) => {
			await handleAction({ type: 'query-eda', operationId: 'lookup', form, lcscPartNumber: 'C233991' });
			const draft = createDraft(form);
			await handleAction({ type: 'save', operationId: 'save', form, draft });
			return { status: 'saved', draft, merged: false };
		};
		const { controller, createReference, inventory } = createController(
			vi.fn().mockResolvedValue(undefined),
			[],
			[],
			undefined,
			undefined,
			openPanel,
		);

		await controller.addByLcscPartNumber();

		expect(createReference).not.toHaveBeenCalled();
		expect(inventory.createItem).toHaveBeenCalledWith(expect.objectContaining({
			marketplaceReference: undefined,
			source: 'manual',
		}));
	});

	it('previews a duplicate without writing and merges only with the host token', async () => {
		const form = createForm({ lcscPartNumber: 'C25804', name: '10k resistor', quantity: '2' });
		const draft = createDraft(form);
		const existing = normalizeInventoryItem({ ...draft, source: 'manual' }, '2026-07-19T00:00:00.000Z', 'existing');
		const merged = normalizeInventoryItem({ ...draft, quantity: 12, source: 'manual' }, '2026-07-20T00:00:00.000Z', 'existing');
		const openPanel: InventoryCreatePanel['open'] = async (_input, handleAction) => {
			const duplicate = await handleAction({ type: 'save', operationId: 'save', form, draft });
			expect(duplicate.stage).toBe('duplicate');
			if (duplicate.stage !== 'duplicate') {
				throw new Error('Expected duplicate result.');
			}
			const confirmed = await handleAction({
				type: 'confirm-merge',
				operationId: 'merge',
				form,
				draft,
				duplicateToken: duplicate.duplicateToken,
				existing: { id: duplicate.existing.id, expectedRevision: duplicate.existing.revision },
			});
			expect(confirmed.stage).toBe('succeeded');
			return { status: 'saved', draft, merged: true };
		};
		const setup = createController(vi.fn(), [], [], undefined, undefined, openPanel);
		setup.inventory.createItem
			.mockResolvedValueOnce({ status: 'duplicate', candidate: normalizeInventoryItem({ ...draft, source: 'manual' }, '2026-07-20T00:00:00.000Z', 'candidate'), existing })
			.mockResolvedValueOnce({ status: 'merged', item: merged });

		await setup.controller.addByLcscPartNumber();

		expect(setup.inventory.createItem).toHaveBeenCalledTimes(2);
		expect(setup.inventory.createItem.mock.calls[0]).toHaveLength(1);
		expect(setup.inventory.createItem).toHaveBeenNthCalledWith(2, expect.any(Object), { id: 'existing', expectedRevision: 1 });
	});

	it('uses the same unified form for custom components', async () => {
		const form = createForm({ name: 'Custom sensor', quantity: '3' });
		const openPanel: InventoryCreatePanel['open'] = async (input, handleAction) => {
			expect(input.mode).toBe('custom');
			const draft = createDraft(form);
			await handleAction({ type: 'save', operationId: 'save', form, draft });
			return { status: 'saved', draft, merged: false };
		};
		const { controller, dialog, inventory } = createController(vi.fn(), [], [], undefined, undefined, openPanel);

		await controller.addCustomComponent();

		expect(dialog.input).not.toHaveBeenCalled();
		expect(inventory.createItem).toHaveBeenCalledWith(expect.objectContaining({
			identity: expect.objectContaining({ name: 'Custom sensor' }),
			quantity: 3,
			source: 'manual',
		}));
	});
});

describe('nativeInventoryController.importOrderFile', () => {
	it('imports an order from the binary file content returned by the file client', async () => {
		const content = new TextEncoder().encode([
			'商品编号,商品名称,数量',
			'C25804,10k resistor,20',
		].join('\n')).buffer as ArrayBuffer;
		const context = createController(
			vi.fn().mockResolvedValue(undefined),
			[],
			['in-stock', 'add'],
			undefined,
			[{ name: 'order.csv', content }],
		);

		await context.controller.importOrderFile();

		expect(context.files.pickOrderFiles).toHaveBeenCalledOnce();
		expect(context.inventory.previewOrderImportBatch).toHaveBeenCalledWith(expect.objectContaining({
			files: [expect.objectContaining({
				fileName: 'order.csv',
				rowCount: 1,
				totalQuantity: 20,
				items: [expect.objectContaining({
					identity: expect.objectContaining({ lcscPartNumber: 'C25804', name: '10k resistor' }),
					quantity: 20,
					source: 'order',
				})],
			})],
		}), 'add');
		expect(context.inventory.importOrderBatch).toHaveBeenCalledWith(expect.any(Object), 'add');
		expect(context.orderImportPanel.open).toHaveBeenCalledOnce();
		expect(context.dialog.select).not.toHaveBeenCalled();
		expect(context.dialog.confirm).not.toHaveBeenCalled();
	});

	it('shows the preview and does not write when every selected order is already imported', async () => {
		const content = new TextEncoder().encode('商品编号,商品名称,数量\nC25804,10k resistor,20').buffer as ArrayBuffer;
		const context = createController(
			vi.fn().mockResolvedValue(undefined),
			[],
			['in-stock', 'add'],
			undefined,
			[{ name: '立创商城订单详情-SO25072711175.csv', content }],
		);
		context.inventory.previewOrderImportBatch.mockResolvedValue({
			files: [{
				fileName: '立创商城订单详情-SO25072711175.csv',
				orderNumber: 'SO25072711175',
				fingerprint: 'a'.repeat(64),
				rowCount: 1,
				totalQuantity: 20,
				status: 'duplicate',
				duplicateReason: 'historical-order-number',
				duplicateOfBatchId: 'batch-existing',
				duplicateImportedAt: '2026-07-20T08:00:00.000Z',
				result: { added: 0, merged: 0, skipped: 1 },
			}],
			result: { added: 0, merged: 0, skipped: 1 },
		});

		await context.controller.importOrderFile();

		expect(context.dialog.confirm).not.toHaveBeenCalled();
		expect(context.orderImportPanel.open).toHaveBeenCalledOnce();
		expect(context.inventory.importOrderBatch).not.toHaveBeenCalled();
	});

	it('deduplicates EDA model lookups for repeated C numbers in the same batch', async () => {
		const content = new TextEncoder().encode([
			'商品编号,商品名称,数量',
			'C25804,10k resistor,20',
			'C25804,10k resistor,30',
		].join('\n')).buffer as ArrayBuffer;
		const lookup = vi.fn().mockResolvedValue(edaModel);
		const context = createController(lookup, [], ['in-stock', 'add'], undefined, [{ name: 'order.csv', content }]);

		await context.controller.importOrderFile();

		expect(lookup).toHaveBeenCalledOnce();
		expect(context.inventory.importOrderBatch).toHaveBeenCalledOnce();
	});

	it('limits order-import EDA model lookup concurrency to four', async () => {
		const content = new TextEncoder().encode([
			'商品编号,商品名称,数量',
			...Array.from({ length: 8 }, (_, index) => `C${25804 + index},Part ${index},1`),
		].join('\n')).buffer as ArrayBuffer;
		let active = 0;
		let maximumActive = 0;
		const lookup = vi.fn().mockImplementation(async () => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise(resolve => setTimeout(resolve, 5));
			active -= 1;
			return undefined;
		});
		const context = createController(lookup, [], ['in-stock', 'add'], undefined, [{ name: 'order.csv', content }]);

		await context.controller.importOrderFile();

		expect(lookup).toHaveBeenCalledTimes(8);
		expect(maximumActive).toBeGreaterThan(1);
		expect(maximumActive).toBeLessThanOrEqual(4);
	});
});

describe('nativeInventoryController inventory management', () => {
	it('opens the category overview even when inventory is empty', async () => {
		const context = createController(vi.fn(), [], []);
		context.inventory.list.mockResolvedValue([]);

		await context.controller.openInventory();

		expect(context.inventoryOverviewPanel.open).toHaveBeenCalledWith({
			items: [],
			categories: [],
		}, expect.any(Function), context.trace);
		expect(context.dialog.info).not.toHaveBeenCalledWith('inventory.empty');
	});

	it('exports the replenishment list from the overview with a stable dated file name', async () => {
		const lowItem = { ...createInventoryItem('low-item'), minimumQuantity: 40 };
		const sufficientItem = { ...createInventoryItem('sufficient-item'), minimumQuantity: 10 };
		const context = createController(vi.fn(), [], []);
		let operationResult: unknown;
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 8,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: [lowItem, sufficientItem],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
		});
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			operationResult = await onOperation({
				operationId: 'operation-export-replenishment',
				intent: { type: 'export-replenishment', viewState: overviewViewState },
			});
		});

		await context.controller.openInventory();

		expect(context.files.saveCsv).toHaveBeenCalledWith(
			expect.stringContaining('"inventoryItem.replenishment.possiblyLow"'),
			expect.stringMatching(/^jlceda-inventory-replenishment-\d{4}-\d{2}-\d{2}\.csv$/),
		);
		const csv = context.files.saveCsv.mock.calls[0]?.[0] as string;
		expect(csv.match(/"C233991"/g)).toHaveLength(1);
		expect(operationResult).toMatchObject({
			status: 'succeeded',
			message: 'inventoryOverview.exportReplenishmentSucceeded',
		});
	});

	it('returns explicit cancelled and failed feedback for replenishment file saves', async () => {
		const context = createController(vi.fn(), [], []);
		const item = { ...createInventoryItem(), minimumQuantity: 40 };
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 8,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: [item],
			orderImportBatches: [],
			transactions: [],
			stockOutBatches: [],
		});
		const results: unknown[] = [];
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			context.files.saveCsv.mockRejectedValueOnce(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
			results.push(await onOperation({
				operationId: 'operation-export-cancelled',
				intent: { type: 'export-replenishment', viewState: overviewViewState },
			}));
			context.files.saveCsv.mockRejectedValueOnce(new Error('disk full'));
			results.push(await onOperation({
				operationId: 'operation-export-failed',
				intent: { type: 'export-replenishment', viewState: overviewViewState },
			}));
		});

		await context.controller.openInventory();

		expect(results).toEqual([
			expect.objectContaining({
				status: 'cancelled',
				message: 'inventoryOverview.exportReplenishmentCancelled',
			}),
			expect.objectContaining({
				status: 'failed',
				message: 'inventoryOverview.exportReplenishmentFailed',
			}),
		]);
	});

	it('opens the overview with real inventory rows and routes its view intent', async () => {
		const partial = {
			...createInventoryItem('partial-item'),
			identity: {
				...createInventoryItem('partial-item').identity,
				lcscPartNumber: 'C12345',
				supplierId: 'C12345',
			},
		};
		const depleted = {
			...createInventoryItem('depleted-item'),
			identity: {
				...createInventoryItem('depleted-item').identity,
				lcscPartNumber: 'C123',
				supplierId: 'C123',
			},
			quantity: 0,
			state: 'depleted' as const,
		};
		const context = createController(vi.fn(), [], [depleted.id, 'details']);
		context.inventory.list.mockResolvedValue([partial, depleted]);

		await context.controller.openInventory();

		expect(context.inventoryOverviewPanel.open).toHaveBeenNthCalledWith(1, expect.objectContaining({
			items: [partial, depleted],
			categories: [],
		}), expect.any(Function), context.trace);
		expect(context.dialog.input).not.toHaveBeenCalled();
		expect(context.inventoryItemPanel.view).toHaveBeenCalledWith(depleted);
	});

	it('moves selected items and restores the overview view state', async () => {
		const item = createInventoryItem();
		const category = {
			id: 'category-passive',
			name: 'Passives',
			sortOrder: 0,
			createdAt: '2026-07-21T00:00:00.000Z',
			updatedAt: '2026-07-21T00:00:00.000Z',
			revision: 1,
		};
		const restoredState = { ...overviewViewState, query: 'C233991', categoryId: category.id, page: 2 };
		const context = createController(vi.fn(), [], []);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 3,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [category],
			items: [item],
		});
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const result = await onOperation({
				operationId: 'operation-move',
				intent: {
					type: 'move-items',
					items: [{ id: item.id, expectedRevision: item.revision }],
					categoryId: category.id,
					viewState: restoredState,
				},
			});
			expect(result).toMatchObject({ status: 'succeeded', snapshot: { items: [item] } });
		});

		await context.controller.openInventory();

		expect(context.inventory.moveItemsToCategory).toHaveBeenCalledWith(
			[{ id: item.id, expectedRevision: item.revision }],
			category.id,
		);
		expect(context.inventoryOverviewPanel.open).toHaveBeenCalledTimes(1);
	});

	it('routes the complete category lifecycle and confirms cascading deletion', async () => {
		const item = { ...createInventoryItem(), categoryId: 'category-passive' };
		const category = {
			id: 'category-passive',
			name: 'Passives',
			sortOrder: 0,
			createdAt: '2026-07-21T00:00:00.000Z',
			updatedAt: '2026-07-21T00:00:00.000Z',
			revision: 1,
		};
		const context = createController(vi.fn(), [], []);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 3,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [category],
			items: [item],
		});
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const intents = [
				{ type: 'create-category', name: 'Resistors', parentId: category.id, viewState: overviewViewState },
				{ type: 'rename-category', category: { id: category.id, expectedRevision: 1 }, name: 'Passive parts', viewState: overviewViewState },
				{ type: 'reorder-categories', categories: [{ id: category.id, expectedRevision: 1 }], viewState: overviewViewState },
				{ type: 'delete-category', category: { id: category.id, expectedRevision: 1 }, confirmed: true, viewState: overviewViewState },
			] as const;
			for (const [index, intent] of intents.entries()) {
				await onOperation({ operationId: `category-${index}`, intent });
			}
		});

		await context.controller.openInventory();

		expect(context.inventory.createCategory).toHaveBeenCalledWith({ name: 'Resistors', parentId: category.id });
		expect(context.inventory.renameCategory).toHaveBeenCalledWith(category.id, 1, 'Passive parts');
		expect(context.inventory.reorderCategories).toHaveBeenCalledWith(undefined, [{ id: category.id, expectedRevision: 1 }]);
		expect(context.dialog.confirm).not.toHaveBeenCalled();
		expect(context.inventory.deleteCategory).toHaveBeenCalledWith(category.id, category.revision);
	});

	it('rejects a stale delete intent without removing the current inventory item', async () => {
		const item = createInventoryItem();
		const context = createController(vi.fn(), [], []);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 3,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: [item],
		});
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const result = await onOperation({
				operationId: 'operation-stale-delete',
				intent: {
					type: 'delete-item',
					item: { id: item.id, expectedRevision: item.revision + 1 },
					confirmed: true,
					viewState: overviewViewState,
				},
			});
			expect(result).toEqual({ status: 'failed', message: 'inventory.concurrentConflict' });
		});

		await context.controller.openInventory();

		expect(context.dialog.info).not.toHaveBeenCalledWith('inventory.concurrentConflict');
		expect(context.inventory.remove).not.toHaveBeenCalled();
	});

	it('deletes selected overview items through one revision-checked batch operation', async () => {
		const first = createInventoryItem('first-item');
		const second = createInventoryItem('second-item');
		const context = createController(vi.fn(), [], []);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 5,
			revision: 1,
			updatedAt: '2026-07-22T00:00:00.000Z',
			categories: [],
			items: [first, second],
			orderImportBatches: [],
		});
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const items = [first, second].map(item => ({ id: item.id, expectedRevision: item.revision }));
			const result = await onOperation({
				operationId: 'operation-delete-selected',
				intent: { type: 'delete-items', items, confirmed: true, viewState: overviewViewState },
			});
			expect(result.status).toBe('succeeded');
		});

		await context.controller.openInventory();

		expect(context.inventory.removeItems).toHaveBeenCalledWith([
			{ id: first.id, expectedRevision: first.revision },
			{ id: second.id, expectedRevision: second.revision },
		]);
	});

	it('returns a failed overview result when the common-library copy is rejected', async () => {
		const item = {
			...createInventoryItem(),
			edaModelReference: edaModel.reference,
			edaModelStatus: 'available' as const,
		};
		const context = createController(vi.fn(), [], []);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 5,
			revision: 1,
			updatedAt: '2026-07-22T00:00:00.000Z',
			categories: [],
			items: [item],
			orderImportBatches: [],
		});
		context.commonLibrary.copy.mockResolvedValue({
			status: 'failed',
			reason: 'copy-rejected',
			attempts: [{ target: 'personal', status: 'copy-rejected' }],
		});
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const result = await onOperation({
				operationId: 'operation-copy-common',
				intent: {
					type: 'copy-common',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: overviewViewState,
				},
			});
			expect(result).toEqual({ status: 'failed', message: 'common.failed.copy-rejected' });
		});

		await context.controller.openInventory();

		expect(context.trace.warn).toHaveBeenCalledWith('common-library.copy.result', {
			attempts: 'personal:copy-rejected',
			reason: 'copy-rejected',
			status: 'failed',
		});
		expect(context.trace.info).not.toHaveBeenCalledWith('common-library.copy.result', expect.anything());
		expect(context.dialog.info).not.toHaveBeenCalledWith('common.failed.copy-rejected');
	});

	it('opens full editing from details and saves zero as depleted', async () => {
		const item = createInventoryItem();
		const context = createController(vi.fn(), [], [item.id, 'details']);
		context.inventory.list.mockResolvedValue([item]);
		context.inventoryItemPanel.view.mockResolvedValue('edit');
		context.inventoryItemPanel.edit.mockResolvedValue(createEditDraft({ quantity: 0 }));
		context.inventory.updateItem.mockResolvedValue({ status: 'updated', item: { ...item, quantity: 0, state: 'depleted' } });

		await context.controller.openInventory();

		expect(context.inventoryItemPanel.view).toHaveBeenCalledWith(item);
		expect(context.inventoryItemPanel.edit).toHaveBeenCalledWith(item, {
			initial: undefined,
			locationOptions: [],
			suggestion: undefined,
		});
		expect(context.inventory.updateItem).toHaveBeenCalledWith(item.id, item.revision, expect.objectContaining({
			quantity: 0,
			precision: 'exact',
		}));
		expect(context.dialog.info).toHaveBeenCalledWith('inventory.updated');
	});

	it('looks up a changed C number and reopens editing with EDA field suggestions', async () => {
		const item = createInventoryItem();
		const changed = createEditDraft({ lcscPartNumber: 'C25804', supplierId: 'C25804' });
		const reviewed = createEditDraft({
			lcscPartNumber: 'C25804',
			supplierId: 'C25804',
			name: '10k resistor',
			manufacturer: 'UNI-ROYAL',
		});
		const findByLcscPartNumber = vi.fn().mockResolvedValue(edaModel);
		const context = createController(findByLcscPartNumber, [], [item.id, 'edit']);
		context.inventory.list.mockResolvedValue([item]);
		context.inventoryItemPanel.edit.mockResolvedValueOnce(changed).mockResolvedValueOnce(reviewed);
		context.inventory.updateItem.mockResolvedValue({ status: 'updated', item });

		await context.controller.openInventory();

		expect(findByLcscPartNumber).toHaveBeenCalledWith('C25804');
		expect(context.inventoryItemPanel.edit).toHaveBeenNthCalledWith(2, item, expect.objectContaining({
			initial: changed,
			suggestion: expect.objectContaining({
				name: '10k resistor',
				lcscPartNumber: 'C25804',
			}),
		}));
		expect(context.inventory.updateItem).toHaveBeenCalledWith(item.id, item.revision, expect.objectContaining({
			identity: expect.objectContaining({ lcscPartNumber: 'C25804' }),
			marketplaceReference: undefined,
			edaModelReference: edaModel.reference,
			edaModelStatus: 'available',
		}));
	});

	it('reopens the full editor for user review when a changed C number has no EDA model', async () => {
		const item = createInventoryItem();
		const changed = createEditDraft({ lcscPartNumber: 'C233992', supplierId: 'C233992' });
		const reviewed = createEditDraft({
			lcscPartNumber: 'C233992',
			supplierId: 'C233992',
			name: 'User maintained component',
		});
		const findByLcscPartNumber = vi.fn().mockResolvedValue(undefined);
		const context = createController(findByLcscPartNumber, [], [item.id, 'edit']);
		context.inventory.list.mockResolvedValue([item]);
		context.inventoryItemPanel.edit.mockResolvedValueOnce(changed).mockResolvedValueOnce(reviewed);
		context.inventory.updateItem.mockResolvedValue({ status: 'updated', item });

		await context.controller.openInventory();

		expect(findByLcscPartNumber).toHaveBeenCalledWith('C233992');
		expect(context.inventoryItemPanel.edit).toHaveBeenNthCalledWith(2, item, {
			initial: changed,
			locationOptions: [],
			suggestion: undefined,
		});
		expect(context.inventory.updateItem).toHaveBeenCalledWith(item.id, item.revision, expect.objectContaining({
			identity: expect.objectContaining({
				lcscPartNumber: 'C233992',
				name: 'User maintained component',
			}),
			marketplaceReference: undefined,
			edaModelReference: undefined,
			edaModelStatus: 'missing',
		}));
	});

	it('passes distinct existing storage locations to the full editor', async () => {
		const item = { ...createInventoryItem(), location: 'Drawer A' };
		const other = { ...createInventoryItem('other-item'), location: 'Shelf B' };
		const duplicateLocation = { ...createInventoryItem('duplicate-location'), location: ' Drawer A ' };
		const context = createController(vi.fn(), [], [item.id, 'edit']);
		context.inventory.list.mockResolvedValue([item, other, duplicateLocation]);
		context.inventoryItemPanel.edit.mockResolvedValue(undefined);

		await context.controller.openInventory();

		expect(context.inventoryItemPanel.edit).toHaveBeenCalledWith(item, {
			initial: undefined,
			locationOptions: ['Drawer A', 'Shelf B'],
			suggestion: undefined,
		});
	});

	it('shows duplicate details and merges only after panel confirmation', async () => {
		const item = createInventoryItem();
		const existing = { ...createInventoryItem('existing-item'), revision: 4 };
		const candidate = { ...item, quantity: 5, revision: 3 };
		const context = createController(vi.fn(), [], [item.id, 'edit']);
		context.inventory.list.mockResolvedValue([item]);
		context.inventoryItemPanel.edit.mockResolvedValue(createEditDraft());
		context.inventoryItemPanel.compare.mockResolvedValue(true);
		context.inventory.updateItem
			.mockResolvedValueOnce({ status: 'duplicate', candidate, existing })
			.mockResolvedValueOnce({ status: 'merged', item: existing });

		await context.controller.openInventory();

		expect(context.inventoryItemPanel.compare).toHaveBeenCalledWith(existing, candidate);
		expect(context.inventory.updateItem).toHaveBeenNthCalledWith(2, item.id, item.revision, expect.any(Object), {
			id: existing.id,
			expectedRevision: existing.revision,
		});
		expect(context.dialog.info).toHaveBeenCalledWith('inventory.merged');
	});

	it('reloads the record before an already confirmed overview deletion', async () => {
		const item = createInventoryItem();
		const context = createController(vi.fn(), [], [item.id, 'remove']);
		context.inventory.list.mockResolvedValue([item]);
		context.inventory.get.mockResolvedValue(item);
		context.inventory.updateItem.mockResolvedValue({ status: 'updated', item: { ...item, edaModelReference: edaModel.reference } });
		context.inventory.remove.mockResolvedValue(true);

		await context.controller.openInventory();

		expect(context.inventory.get).toHaveBeenCalledWith(item.id);
		expect(context.dialog.confirm).not.toHaveBeenCalled();
		expect(context.inventory.remove).toHaveBeenCalledWith(item.id);
	});

	it('returns an EDA model match for in-overview confirmation and checks revision before attaching', async () => {
		const item = createInventoryItem();
		const context = createController(vi.fn().mockResolvedValue(edaModel), [], []);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 3,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: [item],
		});
		context.inventory.get.mockResolvedValue(item);
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const match = await onOperation({
				operationId: 'retry-model',
				intent: {
					type: 'retry-model',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: overviewViewState,
				},
			});
			expect(context.inventory.updateItem).not.toHaveBeenCalled();
			expect(match).toMatchObject({
				status: 'model-match',
				item: { id: item.id, expectedRevision: item.revision },
			});
			if (match.status !== 'model-match') {
				throw new Error('Expected model match.');
			}
			const attached = await onOperation({
				operationId: 'attach-model',
				intent: {
					type: 'attach-model',
					item: match.item,
					matchToken: match.matchToken,
					viewState: overviewViewState,
				},
			});
			expect(attached.status).toBe('succeeded');
		});

		await context.controller.openInventory();

		expect(context.inventory.get).toHaveBeenCalledWith(item.id);
		expect(context.inventory.updateItem).toHaveBeenCalledWith(
			item.id,
			item.revision,
			expect.objectContaining({ edaModelReference: edaModel.reference, edaModelStatus: 'available' }),
		);
	});

	it('searches and lets the user select a model candidate when exact C-number lookup misses', async () => {
		const item = createInventoryItem();
		const selectedModel: EdaModel = {
			...edaModel,
			identity: { ...edaModel.identity, name: 'Selected candidate', manufacturerPartNumber: 'ALT-2' },
			reference: { ...edaModel.reference, deviceUuid: 'device-alt-2' },
		};
		const context = createController(vi.fn().mockResolvedValue(undefined), ['ALT'], ['1']);
		context.searchModels.mockResolvedValue([edaModel, selectedModel]);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 5,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: [item],
			orderImportBatches: [],
		});
		context.inventory.get.mockResolvedValue(item);
		context.inventory.updateItem.mockResolvedValue({
			status: 'updated',
			item: { ...item, edaModelReference: selectedModel.reference, edaModelStatus: 'available' },
		});
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const match = await onOperation({
				operationId: 'search-model',
				intent: {
					type: 'retry-model',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: overviewViewState,
				},
			});
			expect(match.status).toBe('model-match');
			if (match.status !== 'model-match') {
				throw new Error('Expected model candidate match.');
			}
			await onOperation({
				operationId: 'attach-selected-model',
				intent: {
					type: 'attach-model',
					item: match.item,
					matchToken: match.matchToken,
					viewState: overviewViewState,
				},
			});
		});

		await context.controller.openInventory();

		expect(context.searchModels).toHaveBeenCalledWith('ALT', 20);
		expect(context.dialog.select).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ value: '1', label: expect.stringContaining('ALT-2') })]),
			'edaModel.searchTitle',
			'edaModel.selectCandidate',
		);
		expect(context.inventory.updateItem).toHaveBeenCalledWith(
			item.id,
			item.revision,
			expect.objectContaining({ edaModelReference: selectedModel.reference }),
		);
	});

	it('saves a full in-overview edit through the revision-checked inventory update path', async () => {
		const item = createInventoryItem();
		const category = {
			createdAt: item.createdAt,
			id: 'category-audio',
			name: 'Audio',
			revision: 1,
			sortOrder: 0,
			updatedAt: item.updatedAt,
		};
		const draft = createEditDraft({ name: 'Edited microphone', quantity: 8 });
		const context = createController(vi.fn(), [], []);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 3,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [category],
			items: [item],
		});
		context.inventory.updateItem.mockResolvedValue({ status: 'updated', item: { ...item, quantity: 8, revision: item.revision + 1 } });
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const result = await onOperation({
				operationId: 'update-item',
				intent: {
					type: 'update-item',
					item: { id: item.id, expectedRevision: item.revision },
					draft,
					categoryId: category.id,
					viewState: overviewViewState,
				},
			});
			expect(result.status).toBe('succeeded');
		});

		await context.controller.openInventory();

		expect(context.inventory.updateItem).toHaveBeenCalledWith(
			item.id,
			item.revision,
			expect.objectContaining({
				categoryId: category.id,
				identity: expect.objectContaining({ name: 'Edited microphone' }),
				quantity: 8,
			}),
		);
		expect(context.inventoryItemPanel.edit).not.toHaveBeenCalled();
		expect(context.inventory.moveItemsToCategory).not.toHaveBeenCalled();
	});

	it('requires an in-overview confirmation token before merging a duplicate edit', async () => {
		const item = createInventoryItem();
		const existing = { ...createInventoryItem('existing-item'), revision: 7 };
		const candidate = { ...item, identity: { ...item.identity, name: existing.identity.name }, revision: item.revision + 1 };
		const merged = { ...existing, quantity: 68, revision: existing.revision + 1 };
		const draft = createEditDraft({ name: existing.identity.name });
		const context = createController(vi.fn(), [], []);
		context.inventory.exportDocument.mockResolvedValue({
			schemaVersion: 3,
			revision: 1,
			updatedAt: item.updatedAt,
			categories: [],
			items: [item, existing],
		});
		context.inventory.updateItem
			.mockResolvedValueOnce({ status: 'duplicate', candidate, existing })
			.mockResolvedValueOnce({ status: 'merged', item: merged });
		context.inventoryOverviewPanel.open.mockImplementation(async (_input, onOperation) => {
			const duplicate = await onOperation({
				operationId: 'detect-duplicate',
				intent: {
					type: 'update-item',
					item: { id: item.id, expectedRevision: item.revision },
					draft,
					viewState: overviewViewState,
				},
			});
			expect(duplicate).toMatchObject({
				status: 'duplicate-match',
				source: { id: item.id, expectedRevision: item.revision },
				target: { id: existing.id, expectedRevision: existing.revision },
			});
			expect(context.inventory.updateItem).toHaveBeenCalledTimes(1);
			if (duplicate.status !== 'duplicate-match') {
				throw new Error('Expected a duplicate match.');
			}
			const confirmed = await onOperation({
				operationId: 'confirm-duplicate',
				intent: {
					type: 'merge-items',
					matchToken: duplicate.matchToken,
					source: duplicate.source,
					target: duplicate.target,
					viewState: overviewViewState,
				},
			});
			expect(confirmed.status).toBe('succeeded');
		});

		await context.controller.openInventory();

		expect(context.inventory.updateItem).toHaveBeenNthCalledWith(
			2,
			item.id,
			item.revision,
			expect.any(Object),
			{ id: existing.id, expectedRevision: existing.revision },
		);
	});
});

describe('nativeInventoryController export status', () => {
	it('validates and confirms a JSON backup before replacing current inventory', async () => {
		const context = createController(vi.fn(), [], []);
		const backup = {
			schemaVersion: 6,
			revision: 4,
			updatedAt: '2026-07-20T00:00:00.000Z',
			categories: [],
			items: [],
			orderImportBatches: [],
		};
		context.files.pickInventoryBackup.mockResolvedValue({
			name: 'inventory-backup.json',
			content: JSON.stringify(backup),
		});
		context.inventory.restoreDocument.mockResolvedValue({ ...backup, revision: 2 });

		await context.controller.restoreInventoryBackup();

		expect(context.dialog.confirm).toHaveBeenCalledWith('backup.restore.confirm', 'backup.restore.title');
		expect(context.inventory.restoreDocument).toHaveBeenCalledWith(
			expect.objectContaining({ schemaVersion: 9, revision: 4 }),
			1,
		);
		expect(context.trace.info).toHaveBeenCalledWith('backup-restore.completed', { revision: 2 });
		expect(context.dialog.info).toHaveBeenCalledWith('backup.restore.completed', 'backup.restore.title');
	});

	it('rejects malformed backup JSON without asking for replacement confirmation', async () => {
		const context = createController(vi.fn(), [], []);
		context.files.pickInventoryBackup.mockResolvedValue({ name: 'broken.json', content: '{' });

		await context.controller.restoreInventoryBackup();

		expect(context.dialog.info).toHaveBeenCalledWith('backup.restore.invalid', 'backup.restore.title');
		expect(context.dialog.confirm).not.toHaveBeenCalled();
		expect(context.inventory.restoreDocument).not.toHaveBeenCalled();
	});

	it('ignores an unreadable recovery snapshot and still restores an external backup file', async () => {
		const context = createController(vi.fn(), [], []);
		context.inventory.loadRecoverySnapshot.mockRejectedValueOnce(new Error('damaged recovery snapshot'));
		context.files.pickInventoryBackup.mockResolvedValue({
			name: 'external-backup.json',
			content: JSON.stringify({
				schemaVersion: 6,
				revision: 4,
				updatedAt: '2026-07-20T00:00:00.000Z',
				categories: [],
				items: [],
				orderImportBatches: [],
			}),
		});
		context.inventory.restoreDocument.mockResolvedValue(await context.inventory.exportDocument());

		await context.controller.restoreInventoryBackup();

		expect(context.dialog.info).toHaveBeenCalledWith(
			'backup.restore.recoveryUnavailable',
			'backup.restore.title',
		);
		expect(context.files.pickInventoryBackup).toHaveBeenCalledOnce();
		expect(context.inventory.restoreDocument).toHaveBeenCalledOnce();
	});

	it('opens the native folder picker and creates the fixed JSON without setup prompts', async () => {
		const automaticBackup = createAutomaticBackup();
		const context = createController(
			vi.fn(),
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			automaticBackup,
		);

		await context.controller.configureAutomaticBackup();

		expect(context.dialog.select).not.toHaveBeenCalled();
		expect(context.dialog.input).not.toHaveBeenCalled();
		expect(automaticBackup.selectFolder).toHaveBeenCalledOnce();
		expect(automaticBackup.prepareBackupPath).toHaveBeenCalledWith('D:\\Inventory');
		expect(automaticBackup.test).toHaveBeenCalledWith(
			expect.objectContaining({ schemaVersion: 9 }),
			'D:\\Inventory\\jlceda-inventory-latest.json',
		);
		expect(automaticBackup.configure).toHaveBeenCalledWith('D:\\Inventory\\jlceda-inventory-latest.json');
		expect(automaticBackup.test.mock.invocationCallOrder[0]).toBeLessThan(automaticBackup.configure.mock.invocationCallOrder[0]);
		expect(context.trace.info).toHaveBeenCalledWith('auto-backup.folder.selected', {
			pathKind: 'windows-drive',
			pathLength: 'D:\\Inventory'.length,
		});
		expect(context.trace.info).toHaveBeenCalledWith('auto-backup.path.prepared', {
			pathKind: 'windows-drive',
			pathLength: 'D:\\Inventory\\jlceda-inventory-latest.json'.length,
		});
		expect(context.dialog.info).toHaveBeenCalledWith('autoBackup.enabledMessage', 'autoBackup.title');
		expect(context.dialog.confirm).not.toHaveBeenCalled();
	});

	it('leaves automatic backup unchanged when the native folder picker is cancelled', async () => {
		const automaticBackup = createAutomaticBackup();
		automaticBackup.selectFolder.mockResolvedValueOnce(undefined);
		const context = createController(
			vi.fn(),
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			automaticBackup,
		);

		await context.controller.configureAutomaticBackup();

		expect(automaticBackup.prepareBackupPath).not.toHaveBeenCalled();
		expect(automaticBackup.test).not.toHaveBeenCalled();
		expect(automaticBackup.configure).not.toHaveBeenCalled();
		expect(context.inventory.exportDocument).not.toHaveBeenCalled();
		expect(context.dialog.info).not.toHaveBeenCalled();
		expect(context.trace.info).toHaveBeenCalledWith('auto-backup.folder-picker.cancelled');
		expect(context.dialog.confirm).not.toHaveBeenCalled();
	});

	it('reports an unavailable native folder picker separately from a missing desktop API', async () => {
		const automaticBackup = createAutomaticBackup();
		automaticBackup.selectFolder.mockRejectedValueOnce(
			new AutomaticBackupFolderPickerError('The native backup folder picker is unavailable.'),
		);
		const context = createController(
			vi.fn(),
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			automaticBackup,
		);

		await context.controller.configureAutomaticBackup();

		expect(automaticBackup.prepareBackupPath).not.toHaveBeenCalled();
		expect(context.dialog.info).toHaveBeenCalledWith('autoBackup.folderPickerFailed', 'autoBackup.title');
		expect(context.trace.warn).toHaveBeenCalledWith('auto-backup.folder-picker-failed', expect.objectContaining({
			reason: 'picker-error',
			stage: 'host-result',
		}));
	});

	it('reports a desktop or external-interaction failure before opening the native picker', async () => {
		const automaticBackup = createAutomaticBackup();
		automaticBackup.selectFolder.mockRejectedValueOnce(new Error('external interaction is unavailable'));
		const context = createController(
			vi.fn(),
			[],
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			automaticBackup,
		);

		await context.controller.configureAutomaticBackup();

		expect(automaticBackup.prepareBackupPath).not.toHaveBeenCalled();
		expect(context.dialog.info).toHaveBeenCalledWith('autoBackup.unsupported', 'autoBackup.title');
		expect(context.trace.warn).toHaveBeenCalledWith('auto-backup.folder-picker-failed', expect.objectContaining({
			reason: 'host-api-error',
			stage: 'permission-probe',
		}));
	});

	it('re-enables a saved automatic backup path without asking for the folder again', async () => {
		const path = 'D:\\Inventory\\jlceda-inventory-latest.json';
		const automaticBackup = createAutomaticBackup({ enabled: false, path });
		const context = createController(
			vi.fn(),
			[],
			['enable'],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			automaticBackup,
		);

		await context.controller.configureAutomaticBackup();

		expect(context.dialog.input).not.toHaveBeenCalled();
		expect(automaticBackup.test).toHaveBeenCalledWith(expect.any(Object), path);
		expect(automaticBackup.configure).toHaveBeenCalledWith(path);
		expect(context.dialog.confirm).not.toHaveBeenCalled();
	});

	it('moves an existing automatic backup setting to a newly selected folder without input', async () => {
		const automaticBackup = createAutomaticBackup({
			enabled: true,
			path: 'C:\\Old\\jlceda-inventory-latest.json',
		});
		const context = createController(
			vi.fn(),
			[],
			['choose-folder'],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			automaticBackup,
		);

		await context.controller.configureAutomaticBackup();

		expect(context.dialog.input).not.toHaveBeenCalled();
		expect(automaticBackup.prepareBackupPath).toHaveBeenCalledWith('D:\\Inventory');
		expect(automaticBackup.configure).toHaveBeenCalledWith('D:\\Inventory\\jlceda-inventory-latest.json');
		expect(context.dialog.confirm).not.toHaveBeenCalled();
	});

	it('delegates the inventory backup to the host save dialog without a premature result popup', async () => {
		const context = createController(vi.fn(), [], []);
		context.files.saveJson.mockResolvedValue(undefined);

		await context.controller.exportInventoryBackup();

		expect(context.files.saveJson).toHaveBeenCalledWith(
			expect.objectContaining({ schemaVersion: 9 }),
			expect.stringMatching(/^jlceda-inventory-\d{4}-\d{2}-\d{2}\.json$/),
		);
		expect(context.dialog.info).not.toHaveBeenCalled();
	});

	it('delegates diagnostic export to the host save dialog without a premature result popup', async () => {
		const context = createController(vi.fn(), [], []);
		context.files.saveJson.mockResolvedValue(undefined);

		await context.controller.exportDiagnosticLogs();

		expect(context.files.saveJson).toHaveBeenCalledWith(
			undefined,
			expect.stringMatching(/^jlceda-inventory-diagnostics-.+\.json$/),
		);
		expect(context.dialog.info).not.toHaveBeenCalled();
	});
});

function createInventoryItem(id = 'inventory-item'): InventoryItem {
	return normalizeInventoryItem({
		identity: {
			name: 'GMI9745-64db',
			lcscPartNumber: 'C233991',
			supplierId: 'C233991',
			manufacturer: 'INGHAi',
			manufacturerPartNumber: 'GMI9745-64db',
			package: 'SMD,D=9.7mm',
			description: 'Electret microphone',
		},
		marketplaceReference: {
			provider: 'lcsc',
			productUrl: 'https://item.szlcsc.com/233991.html',
			evidence: 'user-confirmed',
			confirmedAt: '2026-07-20T00:00:00.000Z',
		},
		edaModelStatus: 'missing',
		quantity: 34,
		precision: 'estimated',
		source: 'marketplace',
	}, '2026-07-20T00:00:00.000Z', id);
}

function createEditDraft(overrides: Partial<{
	lcscPartNumber: string;
	supplierId: string;
	name: string;
	manufacturer: string;
	quantity: number;
}> = {}) {
	return {
		identity: {
			name: overrides.name ?? 'GMI9745-64db',
			lcscPartNumber: overrides.lcscPartNumber ?? 'C233991',
			supplierId: overrides.supplierId ?? 'C233991',
			manufacturer: overrides.manufacturer ?? 'INGHAi',
			manufacturerPartNumber: 'GMI9745-64db',
			package: 'SMD,D=9.7mm',
			description: 'Electret microphone',
		},
		quantity: overrides.quantity ?? 34,
		precision: 'estimated' as const,
		location: 'Drawer A',
		note: 'Checked',
	};
}
