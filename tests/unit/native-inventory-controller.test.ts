import type { CommonLibrary } from '../../src/features/common-library/ports/common-library';
import type { EdaModel, EdaModelCatalog } from '../../src/features/component-catalog/ports/component-catalog';
import type { InventoryService } from '../../src/features/inventory/application/inventory-service';
import type { InventoryItem, NewInventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { EdaLibraryCategories } from '../../src/features/inventory/ports/eda-library-categories';
import type { MarketplaceNavigator } from '../../src/features/marketplace-catalog/ports/marketplace-navigator';
import type { EdaFileClient, PickedOrderFile } from '../../src/platform/jlceda-v3/eda/file-client';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { EdaPlacementClient } from '../../src/platform/jlceda-v3/eda/placement-client';
import type { InventoryCreateDraft, InventoryCreateFormState, InventoryCreatePanel } from '../../src/platform/jlceda-v3/presentation/inventory-create-panel';
import type { InventoryItemPanel } from '../../src/platform/jlceda-v3/presentation/inventory-item-panel';
import type { InventoryOverviewInput, InventoryOverviewOperationHandler, InventoryOverviewPanel, InventoryOverviewViewState } from '../../src/platform/jlceda-v3/presentation/inventory-overview-panel';
import type { Diagnostics, DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import type { NativeDialog } from '../../src/platform/jlceda-v3/presentation/native-dialog';
import type { OrderImportPanel, OrderImportPanelActionHandler } from '../../src/platform/jlceda-v3/presentation/order-import-panel';
import type { ProductDetailsDraft, ProductDetailsForm } from '../../src/platform/jlceda-v3/presentation/product-details-form';
import { describe, expect, it, vi } from 'vitest';
import { normalizeInventoryItem } from '../../src/features/inventory/domain/inventory-item';
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
) {
	const add = vi.fn().mockImplementation(async (input: NewInventoryItem) => normalizeInventoryItem(
		input,
		'2026-07-20T00:00:00.000Z',
		'saved-item',
	));
	const openSearch = vi.fn();
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
		createCategory: vi.fn(),
		renameCategory: vi.fn(),
		deleteCategory: vi.fn(),
		reorderCategories: vi.fn(),
		moveItemsToCategory: vi.fn(),
		importCategories: vi.fn().mockResolvedValue({ added: 0, skipped: 0 }),
		attachEdaModel: vi.fn(),
		exportDocument: vi.fn(async () => ({
			schemaVersion: 4 as const,
			revision: 1,
			updatedAt: '2026-07-21T00:00:00.000Z',
			categories: [],
			items: await list(),
			orderImportBatches: [],
		})),
	};
	const files = {
		pickOrderFiles: vi.fn().mockResolvedValue(pickedOrderFiles),
		saveJson: vi.fn(),
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
		{ findByLcscPartNumber } as EdaModelCatalog,
		{ openSearch, createReference } as MarketplaceNavigator,
		{} as CommonLibrary,
		files as unknown as EdaFileClient,
		edaLibraryCategories ?? {
			availableSources: vi.fn().mockResolvedValue([]),
			read: vi.fn(),
		} as EdaLibraryCategories,
		{} as EdaPlacementClient,
		dialog as unknown as NativeDialog,
		diagnostics,
		productDetailsForm,
		inventoryCreatePanel as InventoryCreatePanel,
		orderImportPanel as OrderImportPanel,
		inventoryOverviewPanel as InventoryOverviewPanel,
		inventoryItemPanel as unknown as InventoryItemPanel,
		((key: string) => key) as Translate,
		'0.2.1',
	);
	return { add, controller, createReference, diagnostics, dialog, files, inventory, inventoryCreatePanel, inventoryItemPanel, inventoryOverviewPanel, openSearch, orderImportPanel, productDetailsForm, trace };
}

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
			expect.objectContaining({ identity: expect.objectContaining({ name: 'Edited microphone' }), quantity: 8 }),
		);
		expect(context.inventoryItemPanel.edit).not.toHaveBeenCalled();
		expect(context.inventory.moveItemsToCategory).toHaveBeenCalledWith(
			[{ id: item.id, expectedRevision: item.revision + 1 }],
			category.id,
		);
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
	it('delegates the inventory backup to the host save dialog without a premature result popup', async () => {
		const context = createController(vi.fn(), [], []);
		context.files.saveJson.mockResolvedValue(undefined);

		await context.controller.exportInventoryBackup();

		expect(context.files.saveJson).toHaveBeenCalledWith(
			expect.objectContaining({ schemaVersion: 4 }),
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
