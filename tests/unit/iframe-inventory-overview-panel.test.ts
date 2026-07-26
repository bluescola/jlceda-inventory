import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { InventoryOverviewIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-panel';
import type { InventoryOverviewViewState } from '../../src/platform/jlceda-v3/presentation/inventory-overview-panel';
import type { DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_INVENTORY_DOCUMENT_ITEMS } from '../../src/features/inventory/application/inventory-document-limits';
import {
	EdaInventoryOverviewIFrameHost,
	IFrameInventoryOverviewPanel,
	InventoryOverviewPanelUnavailableError,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-panel';
import {
	createIFrameInventoryOverviewSnapshotUpdate,
	INVENTORY_OVERVIEW_PROTOCOL_VERSION,
	INVENTORY_OVERVIEW_REQUEST_KEY,
	INVENTORY_OVERVIEW_RESPONSE_KEY,
	INVENTORY_OVERVIEW_RESULT_KEY,
	INVENTORY_OVERVIEW_SNAPSHOT_UPDATE_KEY,
	parseIFrameInventoryOverviewOperationResponse,
	parseIFrameInventoryOverviewRequest,
	parseIFrameInventoryOverviewResult,
	parseIFrameInventoryOverviewSnapshotUpdate,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-protocol';
import {
	MAX_INVENTORY_OVERVIEW_UNMATCHED_COMPONENT_LABEL_LENGTH,
	MAX_INVENTORY_OVERVIEW_UNMATCHED_COMPONENT_LABELS,
} from '../../src/platform/jlceda-v3/presentation/inventory-overview-panel';

const t = ((key: string) => key) as Translate;

const initialState: InventoryOverviewViewState = {
	query: 'C1',
	focusItemId: 'item-1',
	designSelection: {
		itemIds: ['item-1'],
		componentCount: 2,
		unmatchedComponentCount: 1,
		unmatchedComponentLabels: ['R2 (C999)'],
	},
	searchScope: 'current',
	categoryId: 'child',
	stockFilter: 'in-stock',
	replenishmentFilter: 'needs-replenishment',
	favoriteFilter: 'favorites',
	modelFilter: 'available',
	sort: 'updated',
	page: 2,
	pageSize: 25,
};

const item: InventoryItem = {
	id: 'item-1',
	categoryId: 'child',
	identity: {
		name: 'Microphone',
		lcscPartNumber: 'C123',
		manufacturer: 'Maker',
		manufacturerPartNumber: 'MPN-1',
		package: 'SMD',
	},
	marketplaceReference: {
		provider: 'lcsc',
		productUrl: 'https://www.szlcsc.com/C123.html',
		evidence: 'user-confirmed',
		confirmedAt: '2026-07-20T00:00:00.000Z',
	},
	edaModelReference: {
		deviceUuid: 'device-1',
		libraryUuid: 'library-1',
		symbolName: 'MIC',
		footprintName: 'MODEL-SMD',
	},
	edaModelStatus: 'available',
	quantity: 12,
	precision: 'exact',
	state: 'in-stock',
	minimumQuantity: 8,
	favorite: true,
	location: 'A-1',
	datasheetUrl: 'https://example.com/microphone.pdf',
	structuredLocation: { cabinet: 'A', box: '1', row: '2', column: '3' },
	source: 'manual',
	createdAt: '2026-07-20T00:00:00.000Z',
	updatedAt: '2026-07-21T00:00:00.000Z',
	revision: 4,
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

class FakeHost implements InventoryOverviewIFrameHost {
	public readonly values = new Map<string, unknown>();
	public readonly write = vi.fn(async (key: string, value: unknown) => {
		this.values.set(key, value);
		return this.writeResult;
	});

	public readonly remove = vi.fn(async (key: string) => this.values.delete(key));
	public readonly close = vi.fn(async () => true);
	public readonly hide = vi.fn(async () => false);
	public readonly show = vi.fn(async () => true);
	public readonly stopPolling = vi.fn(() => true);
	public readonly startPolling = vi.fn((_id: string, _interval: number, callback: () => void) => {
		this.poll = callback;
		return this.pollResult;
	});

	public readonly open = vi.fn(async (options: { title: string; onClose: () => void }) => {
		this.onClose = options.onClose;
		return this.openResult;
	});

	public writeResult = true;
	public pollResult = true;
	public openResult = true;
	public poll: () => void = () => undefined;
	public onClose: () => void = () => undefined;

	public read(key: string): unknown {
		return this.values.get(key);
	}
}

async function requestFrom(host: FakeHost) {
	await vi.waitFor(() => expect(host.values.has(INVENTORY_OVERVIEW_REQUEST_KEY)).toBe(true));
	const request = parseIFrameInventoryOverviewRequest(host.values.get(INVENTORY_OVERVIEW_REQUEST_KEY));
	if (!request) {
		throw new Error('Expected a valid inventory overview request.');
	}
	return request;
}

async function settle<T>(promise: Promise<T>): Promise<T> {
	await vi.advanceTimersByTimeAsync(500);
	return promise;
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve: (value: T) => void = () => undefined;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

describe('iframe inventory overview protocol', () => {
	it('opens the native host with a restorable full-width minimized title bar', async () => {
		const openIFrame = vi.fn().mockResolvedValue(true);
		vi.stubGlobal('eda', { sys_IFrame: { openIFrame } });
		const onClose = vi.fn();

		await new EdaInventoryOverviewIFrameHost().open({
			title: 'Inventory overview',
			onClose,
		});

		expect(openIFrame).toHaveBeenCalledWith(
			'/iframe/inventory-overview.html',
			1240,
			800,
			'jlceda-inventory-overview-panel',
			expect.objectContaining({
				maximizeButton: true,
				minimizeButton: true,
				minimizeStyle: 'collapsed',
				title: 'Inventory overview',
			}),
		);
		const nativeOptions = openIFrame.mock.calls[0]?.[4] as {
			buttonCallbackFn: (button: string) => Promise<void> | void;
		};
		await nativeOptions.buttonCallbackFn('minimize');
		await nativeOptions.buttonCallbackFn('maximize');
		expect(onClose).not.toHaveBeenCalled();
		await nativeOptions.buttonCallbackFn('close');
		expect(onClose).toHaveBeenCalledOnce();
	});

	it('round-trips a request snapshot and rejects stale or structurally invalid messages', async () => {
		const host = new FakeHost();
		const pending = new IFrameInventoryOverviewPanel(t, host).open({
			items: [item],
			categories: [
				{ id: 'root', name: 'Audio', sortOrder: 0, revision: 1 },
				{ id: 'child', name: 'Microphones', parentId: 'root', sortOrder: 0, revision: 2 },
			],
			initialState,
		}, vi.fn());
		const request = await requestFrom(host);

		expect(request).toMatchObject({
			initialState,
			items: [{
				id: 'item-1',
				categoryId: 'child',
				lcscPartNumber: 'C123',
				package: 'SMD',
				marketplaceEvidence: 'user-confirmed',
				edaSymbol: 'MIC',
				edaFootprint: 'MODEL-SMD',
				hasEdaModel: true,
				minimumQuantity: 8,
				favorite: true,
				datasheetUrl: 'https://example.com/microphone.pdf',
				structuredLocation: { cabinet: 'A', box: '1', row: '2', column: '3' },
				replenishmentStatus: 'sufficient',
				source: 'manual',
				createdAt: '2026-07-20T00:00:00.000Z',
				revision: 4,
			}],
			categories: [{ id: 'root' }, { id: 'child', parentId: 'root' }],
		});
		expect(request.items[0]).not.toHaveProperty('edaModelReference');
		expect(request.items[0]).not.toHaveProperty('deviceUuid');
		expect(request.items[0]).not.toHaveProperty('libraryUuid');
		expect(request.labels.search).toBe('inventoryOverview.search');
		expect(request.labels.systemCategories).toBe('inventoryOverview.systemCategories');
		expect(request.labels.userCategories).toBe('inventoryOverview.userCategories');
		expect(request.labels.importEdaCategories).toBe('categoryImport.title');
		expect(request.labels.copyLcscPartNumber).toBe('inventoryOverview.copyLcscPartNumber');
		expect(request.labels.deleteSelected).toBe('inventoryOverview.deleteSelected');
		expect(request.labels.replenishmentNeedsReplenishment).toBe('inventoryOverview.replenishmentNeedsReplenishment');
		expect(request.labels.exportReplenishment).toBe('inventoryOverview.exportReplenishment');
		expect(request.labels.designSelectionCount).toBe('inventoryOverview.designSelectionCount');
		expect(request.labels.designSelectionCountWithUnmatched).toBe('inventoryOverview.designSelectionCountWithUnmatched');
		expect(request.labels.designSelectionUnmatchedWarning).toBe('inventoryOverview.designSelectionUnmatchedWarning');
		expect(request.labels.designSelectionUnmatchedWarningWithMore).toBe('inventoryOverview.designSelectionUnmatchedWarningWithMore');
		expect(
			request.initialState?.designSelection?.unmatchedComponentLabels,
		).not.toBe(initialState.designSelection?.unmatchedComponentLabels);
		const reparsedRequest = parseIFrameInventoryOverviewRequest(request);
		expect(
			reparsedRequest?.initialState?.designSelection?.unmatchedComponentLabels,
		).not.toBe(request.initialState?.designSelection?.unmatchedComponentLabels);
		expect(request.labels.favoriteOnly).toBe('inventoryOverview.favoriteOnly');
		expect(request.labels.columnSettings).toBe('inventoryOverview.columnSettings');
		expect(request.labels.restoreDefaultColumns).toBe('inventoryOverview.restoreDefaultColumns');
		expect(request.labels.openDatasheet).toBe('inventoryItem.openDatasheet');
		expect(request.labels.placeItem).toBe('place.action');
		expect(request.labels.placeUnavailableModel).toBe('place.modelUnavailable');
		expect(request.labels.placeUnavailableStock).toBe('place.depleted');
		expect(parseIFrameInventoryOverviewRequest({ ...request, protocolVersion: 1 })).toBeUndefined();
		expect(parseIFrameInventoryOverviewRequest({
			...request,
			initialState: { ...initialState, focusItemId: '' },
		})).toBeUndefined();
		expect(parseIFrameInventoryOverviewRequest({
			...request,
			initialState: {
				...initialState,
				designSelection: { ...initialState.designSelection!, itemIds: ['item-1', 'item-1'] },
			},
		})?.initialState?.designSelection?.itemIds).toEqual(['item-1', 'item-1']);
		expect(parseIFrameInventoryOverviewRequest({
			...request,
			initialState: {
				...initialState,
				designSelection: { ...initialState.designSelection!, itemIds: [] },
			},
		})?.initialState?.designSelection?.itemIds).toEqual([]);
		for (const designSelection of [
			{ itemIds: [''], componentCount: 1, unmatchedComponentCount: 0 },
			{ itemIds: ['x'.repeat(501)], componentCount: 1, unmatchedComponentCount: 0 },
			{ itemIds: ['item-1'], componentCount: 0, unmatchedComponentCount: 0 },
			{ itemIds: ['item-1'], componentCount: 1, unmatchedComponentCount: -1 },
			{ itemIds: ['item-1'], componentCount: 1, unmatchedComponentCount: 2 },
			{ itemIds: ['item-1'], componentCount: 1, unmatchedComponentCount: 1, unmatchedComponentLabels: 'R1' },
			{ itemIds: ['item-1'], componentCount: 1, unmatchedComponentCount: 1, unmatchedComponentLabels: [''] },
			{
				itemIds: ['item-1'],
				componentCount: 1,
				unmatchedComponentCount: 1,
				unmatchedComponentLabels: ['x'.repeat(MAX_INVENTORY_OVERVIEW_UNMATCHED_COMPONENT_LABEL_LENGTH + 1)],
			},
			{ itemIds: ['item-1'], componentCount: 1, unmatchedComponentCount: 1, unmatchedComponentLabels: ['R1\nC1'] },
			{ itemIds: ['item-1'], componentCount: 1, unmatchedComponentCount: 1, unmatchedComponentLabels: ['R1', 'R2'] },
			{
				itemIds: ['item-1'],
				componentCount: MAX_INVENTORY_OVERVIEW_UNMATCHED_COMPONENT_LABELS + 1,
				unmatchedComponentCount: MAX_INVENTORY_OVERVIEW_UNMATCHED_COMPONENT_LABELS + 1,
				unmatchedComponentLabels: Array.from(
					{ length: MAX_INVENTORY_OVERVIEW_UNMATCHED_COMPONENT_LABELS + 1 },
					(_, index) => `R${index + 1}`,
				),
			},
			{
				itemIds: Array.from({ length: MAX_INVENTORY_DOCUMENT_ITEMS + 1 }, () => 'item-1'),
				componentCount: 1,
				unmatchedComponentCount: 0,
			},
		]) {
			expect(parseIFrameInventoryOverviewRequest({
				...request,
				initialState: { ...initialState, designSelection },
			})).toBeUndefined();
		}
		expect(parseIFrameInventoryOverviewRequest({
			...request,
			categories: [...request.categories, {
				id: 'grandchild',
				name: 'Invalid',
				parentId: 'child',
				sortOrder: 0,
				revision: 1,
			}],
		})).toBeUndefined();
		expect(parseIFrameInventoryOverviewRequest({
			...request,
			items: [{ ...request.items[0], source: 'invalid' }],
		})).toBeUndefined();

		host.onClose();
		expect(await settle(pending)).toBeUndefined();
	});

	it('round-trips picker metadata and uses its contextual native-window title', async () => {
		const host = new FakeHost();
		const pending = new IFrameInventoryOverviewPanel(t, host).open({
			items: [item],
			categories: [],
			picker: {
				title: 'Choose the base inventory item',
				actionLabel: 'Use as base item',
			},
			replaceActiveSession: true,
		}, vi.fn());
		const request = await requestFrom(host);

		expect(request.picker).toEqual({
			title: 'Choose the base inventory item',
			actionLabel: 'Use as base item',
		});
		await vi.waitFor(() => expect(host.open).toHaveBeenCalledWith(expect.objectContaining({
			title: 'Choose the base inventory item',
		})));
		expect(parseIFrameInventoryOverviewRequest({
			...request,
			picker: { ...request.picker!, title: '' },
		})).toBeUndefined();
		expect(parseIFrameInventoryOverviewRequest({
			...request,
			picker: { ...request.picker!, actionLabel: ' '.repeat(1001) },
		})).toBeUndefined();

		host.onClose();
		expect(await settle(pending)).toBeUndefined();
	});

	it('validates unsolicited data-only snapshot updates and rejects stale sequences', () => {
		const update = createIFrameInventoryOverviewSnapshotUpdate(
			'request-1',
			2,
			{ items: [item], categories: [{ id: 'child', name: 'Microphones', sortOrder: 0, revision: 2 }] },
		);

		expect(parseIFrameInventoryOverviewSnapshotUpdate(update, 'request-1', 1)).toMatchObject({
			sequence: 2,
			snapshot: { items: [{ id: item.id }], categories: [{ id: 'child' }] },
		});
		expect(parseIFrameInventoryOverviewSnapshotUpdate(update, 'request-1', 1)).not.toHaveProperty('focusItemId');
		expect(parseIFrameInventoryOverviewSnapshotUpdate(update, 'request-1', 2)).toBeUndefined();
		expect(parseIFrameInventoryOverviewSnapshotUpdate(update, 'another-request')).toBeUndefined();
		const legacyUpdate = parseIFrameInventoryOverviewSnapshotUpdate(
			{ ...update, focusItemId: item.id },
			'request-1',
		);
		expect(legacyUpdate).not.toHaveProperty('focusItemId');
	});

	it('validates revisions and view state on every returned intent', () => {
		const valid = {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'operation',
			operation: {
				operationId: 'operation-1',
				intent: {
					type: 'move-items',
					items: [{ id: 'item-1', expectedRevision: 4 }],
					categoryId: 'child',
					viewState: initialState,
				},
			},
		};
		expect(parseIFrameInventoryOverviewResult(valid, 'request-1')).toEqual(valid);
		expect(parseIFrameInventoryOverviewResult({
			...valid,
			operation: {
				operationId: 'operation-select-item',
				intent: {
					type: 'select-item',
					item: { id: 'item-1', expectedRevision: 4 },
					viewState: initialState,
				},
			},
		}, 'request-1')).toMatchObject({ operation: { intent: { type: 'select-item' } } });
		expect(parseIFrameInventoryOverviewResult({
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'completed',
			operationId: 'operation-select-item',
			action: 'select-item',
		}, 'request-1')).toEqual({
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'completed',
			operationId: 'operation-select-item',
			action: 'select-item',
		});
		expect(parseIFrameInventoryOverviewResult({
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'completed',
			operationId: '',
			action: 'select-item',
		}, 'request-1')).toBeUndefined();
		expect(parseIFrameInventoryOverviewResult({
			...valid,
			operation: {
				operationId: 'operation-open-datasheet',
				intent: {
					type: 'open-datasheet',
					item: { id: 'item-1', expectedRevision: 4 },
					viewState: initialState,
				},
			},
		}, 'request-1')).toMatchObject({ operation: { intent: { type: 'open-datasheet' } } });
		expect(parseIFrameInventoryOverviewResult({
			...valid,
			operation: {
				operationId: 'operation-place-item',
				intent: {
					type: 'place-item',
					item: { id: 'item-1', expectedRevision: 4 },
					viewState: initialState,
				},
			},
		}, 'request-1')).toMatchObject({ operation: { intent: { type: 'place-item' } } });
		expect(parseIFrameInventoryOverviewResult({
			...valid,
			operation: {
				...valid.operation,
				intent: { ...valid.operation.intent, items: [{ id: 'item-1', expectedRevision: -1 }] },
			},
		}, 'request-1')).toBeUndefined();
		expect(parseIFrameInventoryOverviewResult({
			...valid,
			operation: {
				...valid.operation,
				intent: { ...valid.operation.intent, viewState: { ...initialState, page: 0 } },
			},
		}, 'request-1')).toBeUndefined();
		expect(parseIFrameInventoryOverviewResult({
			...valid,
			operation: {
				...valid.operation,
				intent: { ...valid.operation.intent, viewState: { ...initialState, focusItemId: ' '.repeat(501) } },
			},
		}, 'request-1')).toBeUndefined();
		expect(parseIFrameInventoryOverviewResult(valid, 'stale-request')).toBeUndefined();
		const importCategories = {
			...valid,
			operation: {
				operationId: 'operation-import-categories',
				intent: { type: 'import-eda-categories', viewState: initialState },
			},
		};
		expect(parseIFrameInventoryOverviewResult(importCategories, 'request-1')).toEqual(importCategories);
		const exportReplenishment = {
			...valid,
			operation: {
				operationId: 'operation-export-replenishment',
				intent: { type: 'export-replenishment', viewState: initialState },
			},
		};
		expect(parseIFrameInventoryOverviewResult(exportReplenishment, 'request-1')).toEqual(exportReplenishment);
		const deleteSelected = {
			...valid,
			operation: {
				operationId: 'operation-delete-selected',
				intent: {
					type: 'delete-items',
					items: [{ id: 'item-1', expectedRevision: 4 }],
					confirmed: true,
					viewState: initialState,
				},
			},
		};
		expect(parseIFrameInventoryOverviewResult(deleteSelected, 'request-1')).toEqual(deleteSelected);
		expect(parseIFrameInventoryOverviewResult({
			...deleteSelected,
			operation: {
				...deleteSelected.operation,
				intent: { ...deleteSelected.operation.intent, confirmed: false },
			},
		}, 'request-1')).toBeUndefined();
		for (const type of ['retry-model', 'attach-model']) {
			expect(parseIFrameInventoryOverviewResult({
				...valid,
				operation: {
					operationId: `retired-${type}`,
					intent: {
						type,
						item: { id: 'item-1', expectedRevision: 4 },
						matchToken: 'retired-token',
						viewState: initialState,
					},
				},
			}, 'request-1')).toBeUndefined();
		}
	});
});

describe('inventory overview category manager markup', () => {
	it('does not expose the retired EDA model rematching flow', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.html'), 'utf8');
		const source = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.ts'), 'utf8');

		expect(html).not.toContain('operation-retry');
		expect(source).not.toMatch(/'retry-model'/u);
		expect(source).not.toMatch(/'attach-model'/u);
	});

	it('does not use eager HTML autofocus before the EDA host settles focus', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.html'), 'utf8');

		expect(html).toMatch(/<input[^>]+id="search-input"/);
		expect(html).not.toMatch(/<input[^>]+id="search-input"[^>]+autofocus/);
	});

	it('does not infer an EDA canvas click from generic window focus events', () => {
		const source = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.ts'), 'utf8');
		const hideCalls = [...source.matchAll(/sys_IFrame\.hideIFrame/g)];

		expect(source).not.toContain('eda.sys_Window.addEventListener');
		expect(source).not.toContain('shouldAutoHideInventoryOverview');
		expect(source).not.toContain('INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY');
		expect(hideCalls).toHaveLength(2);
		for (const call of hideCalls) {
			expect(source.slice(Math.max(0, (call.index ?? 0) - 500), call.index)).toContain('type === \'place-item\'');
		}
	});

	it('uses the searchable overview as a scoped picker and closes it after a successful selection', () => {
		const source = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.ts'), 'utf8');
		const styles = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.css'), 'utf8');

		expect(source).toContain('elements.shell.classList.toggle(\'picker-mode\', request.picker !== undefined)');
		expect(source).toContain('active.intent.type === \'select-item\' && result.status === \'succeeded\'');
		expect(source).toContain('writeResult(completedSelection(request.requestId, active.id))');
		expect(source).not.toContain('eda.sys_IFrame.closeIFrame(INVENTORY_OVERVIEW_IFRAME_ID)');
		expect(source).toContain('select.classList.add(\'row-select-action\')');
		expect(styles).toContain('.picker-mode .select-column');
		expect(styles).toContain('.picker-mode .category-management');
	});

	it('restores the edit draft and displays an operation failure returned by the host', () => {
		const source = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.ts'), 'utf8');

		expect(source).toContain('error.textContent = initialError ?? \'\'');
		expect(source).toContain('onFailed: failureMessage => showOverviewEditor(');
		expect(source).toMatch(/category\.value \|\| undefined,\s+failureMessage,/u);
	});

	it('clears the design-selection scope with the other overview filters', () => {
		const source = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.ts'), 'utf8');
		const clearFiltersStart = source.indexOf('elements.clearFilters.addEventListener(\'click\'');
		const clearFiltersEnd = source.indexOf('elements.exportReplenishment.addEventListener', clearFiltersStart);

		expect(clearFiltersStart).toBeGreaterThanOrEqual(0);
		expect(source.slice(clearFiltersStart, clearFiltersEnd)).toContain('designSelection: undefined');
	});

	it('applies background snapshots without changing the active view state', () => {
		const source = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.ts'), 'utf8');
		const updateStart = source.indexOf('if (snapshotUpdate) {');
		const updateEnd = source.indexOf('const active = pendingOperation;', updateStart);
		const updateBlock = source.slice(updateStart, updateEnd);

		expect(updateStart).toBeGreaterThanOrEqual(0);
		expect(updateBlock).toContain('request.items = snapshotUpdate.snapshot.items');
		expect(updateBlock).toContain('normalizeOverviewViewState(state, request.categories, request.items)');
		expect(updateBlock).toContain('render();');
		expect(updateBlock).not.toContain('draftQuery');
		expect(updateBlock).not.toContain('focusItemId');
		expect(updateBlock).not.toContain('designSelection:');
		expect(updateBlock).not.toContain('page:');
	});

	it('renders partial design-selection misses as an independent alert before the table', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.html'), 'utf8');
		const source = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.ts'), 'utf8');
		const warningIndex = html.indexOf('id="design-selection-warning"');

		expect(warningIndex).toBeGreaterThan(html.indexOf('class="result-toolbar"'));
		expect(warningIndex).toBeLessThan(html.indexOf('class="table-scroll"'));
		expect(html.slice(warningIndex, warningIndex + 140)).toContain('role="alert"');
		expect(html.slice(warningIndex, warningIndex + 140)).toContain('hidden');
		expect(source).toContain('elements.designSelectionWarning.hidden = unmatchedWarning === undefined');
		expect(source).toContain('elements.designSelectionWarning.textContent = unmatchedWarning');
	});

	it('places the EDA category import command in the category manager footer', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.html'), 'utf8');
		const managerStart = html.indexOf('id="category-manager-backdrop"');
		const managerEnd = html.indexOf('id="operation-backdrop"');
		const manager = html.slice(managerStart, managerEnd);

		expect(managerStart).toBeGreaterThanOrEqual(0);
		expect(managerEnd).toBeGreaterThan(managerStart);
		expect(manager).toContain('id="category-manager-status"');
		expect(manager).toContain('id="import-eda-categories"');
		expect(manager.indexOf('id="import-eda-categories"')).toBeLessThan(manager.indexOf('id="category-manager-close"'));
	});

	it('exposes a dedicated delete-selected command in the bulk toolbar', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.html'), 'utf8');

		expect(html).toMatch(/id="bulk-toolbar"[\s\S]*id="delete-selected"/);
	});

	it('renders replenishment and favorite filters with dedicated stock columns', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.html'), 'utf8');

		expect(html).toContain('id="replenishment-filter"');
		expect(html).toContain('id="favorite-filter"');
		expect(html).toContain('id="column-minimum-quantity"');
		expect(html).toContain('id="column-replenishment"');
	});

	it('renders an icon-triggered column menu and column markers without making the name optional', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.html'), 'utf8');
		const header = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
		const businessColumnIds = [...header.matchAll(/<th id="column-([^"]+)"/g)].map(match => match[1]);

		expect(html).toMatch(/id="column-settings"[^>]+class="icon-button/);
		expect(html).toContain('id="column-settings-menu"');
		expect(html).toContain('id="restore-default-columns"');
		expect(html).toContain('data-inventory-column="quantity"');
		expect(html).toContain('data-inventory-column="replenishment"');
		expect(html).toMatch(/<th id="column-name"><\/th>/);
		expect(businessColumnIds).toEqual([
			'name',
			'actions',
			'number',
			'quantity',
			'package',
			'model',
			'location',
			'category',
			'replenishment',
			'minimum-quantity',
			'updated',
		]);
	});

	it('keeps row cells aligned with the operational header order', () => {
		const source = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.ts'), 'utf8');
		const renderRows = source.slice(source.indexOf('function renderRows('), source.indexOf('function renderPagination('));
		const rowAppend = renderRows.slice(renderRows.indexOf('\t\trow.append('), renderRows.indexOf('\n\t\t);'));
		const markers = [
			'nameCell',
			'actionCell(item',
			'\'number\'',
			'\'quantity\'',
			'\'package\'',
			'\'model\'',
			'\'location\'',
			'\'category\'',
			'\'replenishment\'',
			'\'minimum-quantity\'',
			'\'updated\'',
		];

		let previousIndex = -1;
		for (const marker of markers) {
			const markerIndex = rowAppend.indexOf(marker);
			expect(markerIndex, `${marker} should be present after the preceding cell`).toBeGreaterThan(previousIndex);
			previousIndex = markerIndex;
		}
		expect(source).toContain('cell.className = \'actions-column\'');
	});
});

describe('iframeInventoryOverviewPanel', () => {
	it('finishes the operation queue before settling a native close without writing to the closed IFrame', async () => {
		const host = new FakeHost();
		const operationResult = deferred<{
			status: 'succeeded';
			snapshot: { items: InventoryItem[]; categories: [] };
		}>();
		const onOperation = vi.fn(() => operationResult.promise);
		const pending = new IFrameInventoryOverviewPanel(t, host).open({ items: [item], categories: [] }, onOperation);
		const request = await requestFrom(host);
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'operation',
			operation: {
				operationId: 'operation-active',
				intent: {
					type: 'open-marketplace',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: initialState,
				},
			},
		});
		host.poll();
		await vi.waitFor(() => expect(onOperation).toHaveBeenCalledOnce());

		host.onClose();
		expect(host.stopPolling).not.toHaveBeenCalled();
		operationResult.resolve({ status: 'succeeded', snapshot: { items: [item], categories: [] } });
		await settle(pending);

		expect(onOperation).toHaveBeenCalledOnce();
		expect(host.write).not.toHaveBeenCalledWith(INVENTORY_OVERVIEW_RESPONSE_KEY, expect.anything());
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
	});

	it('replaces a stale host iframe before opening a session from a new controller instance', async () => {
		const host = new FakeHost();
		host.hide.mockResolvedValueOnce(true);
		host.values.set(INVENTORY_OVERVIEW_REQUEST_KEY, { stale: true });
		const panel = new IFrameInventoryOverviewPanel(t, host);
		const pending = panel.open({ items: [item], categories: [] }, vi.fn());

		await vi.waitFor(() => expect(host.close).toHaveBeenCalledTimes(1));
		expect(host.open).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(500);
		const request = await requestFrom(host);
		expect(request.items).toHaveLength(1);
		expect(host.hide).toHaveBeenCalledTimes(1);
		expect(host.open).toHaveBeenCalledTimes(1);

		host.onClose();
		expect(await settle(pending)).toBeUndefined();
		expect(host.close).toHaveBeenCalledTimes(2);
	});

	it('prevents a retired controller from cleaning up its replacement session', async () => {
		const host = new FakeHost();
		const oldPanel = new IFrameInventoryOverviewPanel(t, host);
		const oldPending = oldPanel.open({ items: [item], categories: [] }, vi.fn());
		const oldRequest = await requestFrom(host);
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: oldRequest.requestId,
			status: 'ready',
		});
		host.poll();
		const pollOldSession = host.poll;

		host.hide.mockResolvedValueOnce(true);
		const newPanel = new IFrameInventoryOverviewPanel(t, host);
		const newPending = newPanel.open({ items: [], categories: [] }, vi.fn());
		await vi.waitFor(() => expect(host.close).toHaveBeenCalledTimes(1));
		await vi.advanceTimersByTimeAsync(500);
		const newRequest = await requestFrom(host);
		const closeNewSession = host.onClose;
		expect(newRequest.requestId).not.toBe(oldRequest.requestId);

		pollOldSession();
		await vi.advanceTimersByTimeAsync(500);
		expect(await oldPending).toBeUndefined();
		expect(parseIFrameInventoryOverviewRequest(host.values.get(INVENTORY_OVERVIEW_REQUEST_KEY))?.requestId)
			.toBe(newRequest.requestId);
		expect(host.close).toHaveBeenCalledTimes(1);

		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: newRequest.requestId,
			status: 'ready',
		});
		host.poll();
		closeNewSession();
		expect(await settle(newPending)).toBeUndefined();
		expect(host.close).toHaveBeenCalledTimes(2);
	});

	it('silently ends a ready session when the host storage context is unloaded', async () => {
		const host = new FakeHost();
		const trace = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			waitFor: vi.fn(),
		} as unknown as DiagnosticTrace;
		const pending = new IFrameInventoryOverviewPanel(t, host).open({ items: [], categories: [] }, vi.fn(), trace);
		const request = await requestFrom(host);
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
		host.poll();
		vi.spyOn(host, 'read').mockImplementation(() => {
			throw new TypeError('The extension storage context is unavailable.');
		});

		host.poll();
		await vi.advanceTimersByTimeAsync(500);

		expect(await pending).toBeUndefined();
		expect(trace.warn).toHaveBeenCalledWith('inventory-overview-panel.iframe.read.stopped', {
			errorName: 'TypeError',
			stage: 'ready',
			status: 'host-unavailable',
		});
		expect(trace.error).not.toHaveBeenCalled();
	});

	it('shows an existing hidden session instead of queueing another overview', async () => {
		const host = new FakeHost();
		const panel = new IFrameInventoryOverviewPanel(t, host);
		const pending = panel.open({ items: [item], categories: [] }, vi.fn());
		await requestFrom(host);

		await panel.open({ items: [], categories: [] }, vi.fn());

		expect(host.show).toHaveBeenCalledTimes(1);
		expect(host.hide).toHaveBeenCalledTimes(1);
		expect(host.open).toHaveBeenCalledTimes(1);
		host.onClose();
		expect(await settle(pending)).toBeUndefined();
	});

	it('pushes a fresh data-only snapshot into an active or minimized session without reopening it', async () => {
		const host = new FakeHost();
		const panel = new IFrameInventoryOverviewPanel(t, host);
		const pending = panel.open({ items: [item], categories: [] }, vi.fn());
		const request = await requestFrom(host);
		const savedItem = {
			...item,
			id: 'saved-item',
			identity: { ...item.identity, name: 'F4 pending', lcscPartNumber: 'C456' },
			revision: 1,
		};

		expect(await panel.updateSnapshot({ items: [item, savedItem], categories: [] })).toBe(true);
		const update = parseIFrameInventoryOverviewSnapshotUpdate(
			host.values.get(INVENTORY_OVERVIEW_SNAPSHOT_UPDATE_KEY),
			request.requestId,
		);
		expect(update).toMatchObject({
			sequence: expect.any(Number),
			snapshot: { items: [{ id: item.id }, { id: savedItem.id }] },
		});
		expect(update).not.toHaveProperty('focusItemId');
		expect(update?.sequence).toBeGreaterThan(0);
		expect(host.open).toHaveBeenCalledTimes(1);
		expect(host.show).not.toHaveBeenCalled();

		host.onClose();
		expect(await settle(pending)).toBeUndefined();
		expect(host.values.has(INVENTORY_OVERVIEW_SNAPSHOT_UPDATE_KEY)).toBe(false);
	});

	it('pushes a snapshot from a different controller instance into the existing host session', async () => {
		const host = new FakeHost();
		const ownerPanel = new IFrameInventoryOverviewPanel(t, host);
		const pending = ownerPanel.open({ items: [item], categories: [] }, vi.fn());
		const request = await requestFrom(host);
		const externalPanel = new IFrameInventoryOverviewPanel(t, host);
		const savedItem = {
			...item,
			id: 'cross-instance-item',
			identity: { ...item.identity, name: 'Cross-instance item', lcscPartNumber: 'C789' },
			revision: 1,
		};

		expect(await externalPanel.updateSnapshot({ items: [item, savedItem], categories: [] })).toBe(true);
		const update = parseIFrameInventoryOverviewSnapshotUpdate(
			host.values.get(INVENTORY_OVERVIEW_SNAPSHOT_UPDATE_KEY),
			request.requestId,
		);
		expect(update).toMatchObject({
			snapshot: { items: [{ id: item.id }, { id: savedItem.id }] },
		});
		expect(update).not.toHaveProperty('focusItemId');
		expect(externalPanel).not.toBe(ownerPanel);
		expect(host.open).toHaveBeenCalledTimes(1);

		host.onClose();
		expect(await settle(pending)).toBeUndefined();
	});

	it('keeps an active picker scoped when local or cross-instance inventory snapshots change', async () => {
		const host = new FakeHost();
		const ownerPanel = new IFrameInventoryOverviewPanel(t, host);
		const pending = ownerPanel.open({
			items: [item],
			categories: [],
			picker: { title: 'Choose substitute', actionLabel: 'Use as substitute' },
			replaceActiveSession: true,
		}, vi.fn());
		await requestFrom(host);
		const externalPanel = new IFrameInventoryOverviewPanel(t, host);
		const unrelatedItem = {
			...item,
			id: 'unrelated-item',
			identity: { ...item.identity, name: 'Unrelated item', lcscPartNumber: 'C999' },
		};

		expect(await ownerPanel.updateSnapshot({ items: [item, unrelatedItem], categories: [] })).toBe(false);
		expect(await externalPanel.updateSnapshot({ items: [item, unrelatedItem], categories: [] })).toBe(false);
		expect(host.values.has(INVENTORY_OVERVIEW_SNAPSHOT_UPDATE_KEY)).toBe(false);

		host.onClose();
		expect(await settle(pending)).toBeUndefined();
	});

	it('removes the obsolete auto-hide control signal before opening a session', async () => {
		const host = new FakeHost();
		host.values.set('inventory-overview-panel.v2.window-control', {
			action: 'minimize',
			requestId: 'stale-request',
			timestamp: 1,
		});
		const pending = new IFrameInventoryOverviewPanel(t, host).open({ items: [item], categories: [] }, vi.fn());
		await requestFrom(host);

		expect(host.values.has('inventory-overview-panel.v2.window-control')).toBe(false);
		host.onClose();
		expect(await settle(pending)).toBeUndefined();
	});

	it('retires an active session before replacing it with a new scoped request and operation handler', async () => {
		const host = new FakeHost();
		const panel = new IFrameInventoryOverviewPanel(t, host);
		const oldOperationResult = deferred<{ status: 'cancelled' }>();
		const oldOperation = vi.fn(() => oldOperationResult.promise);
		const oldPending = panel.open({ items: [item], categories: [] }, oldOperation);
		const oldRequest = await requestFrom(host);
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: oldRequest.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: oldRequest.requestId,
			status: 'operation',
			operation: {
				operationId: 'old-operation',
				intent: {
					type: 'open-marketplace',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: initialState,
				},
			},
		});
		host.poll();
		await vi.waitFor(() => expect(oldOperation).toHaveBeenCalledOnce());

		const replacementItem = {
			...item,
			id: 'item-2',
			identity: { ...item.identity, name: 'Replacement item', lcscPartNumber: 'C456' },
			revision: 1,
		};
		const replacementState: InventoryOverviewViewState = {
			...initialState,
			focusItemId: replacementItem.id,
			designSelection: {
				itemIds: [replacementItem.id],
				componentCount: 2,
				unmatchedComponentCount: 1,
			},
		};
		const newOperation = vi.fn().mockResolvedValue({
			status: 'succeeded',
			snapshot: { items: [replacementItem], categories: [] },
		});
		const replacementPending = panel.open({
			items: [replacementItem],
			categories: [],
			initialState: replacementState,
			replaceActiveSession: true,
		}, newOperation);

		await vi.advanceTimersByTimeAsync(500);
		expect(parseIFrameInventoryOverviewRequest(host.values.get(INVENTORY_OVERVIEW_REQUEST_KEY))?.requestId)
			.toBe(oldRequest.requestId);
		expect(host.close).not.toHaveBeenCalled();
		oldOperationResult.resolve({ status: 'cancelled' });
		await vi.advanceTimersByTimeAsync(1_000);
		await vi.waitFor(() => {
			const request = parseIFrameInventoryOverviewRequest(host.values.get(INVENTORY_OVERVIEW_REQUEST_KEY));
			expect(request?.requestId).not.toBe(oldRequest.requestId);
		});
		const replacementRequest = await requestFrom(host);
		expect(replacementRequest).toMatchObject({
			items: [{ id: replacementItem.id, lcscPartNumber: 'C456' }],
			initialState: replacementState,
		});
		expect(host.show).not.toHaveBeenCalled();
		expect(host.close).toHaveBeenCalledTimes(1);
		expect(await oldPending).toBeUndefined();

		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: replacementRequest.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: replacementRequest.requestId,
			status: 'operation',
			operation: {
				operationId: 'replacement-operation',
				intent: {
					type: 'open-marketplace',
					item: { id: replacementItem.id, expectedRevision: replacementItem.revision },
					viewState: replacementState,
				},
			},
		});
		host.poll();
		await vi.waitFor(() => expect(newOperation).toHaveBeenCalledOnce());
		expect(oldOperation).toHaveBeenCalledOnce();
		expect(newOperation).toHaveBeenCalledWith(expect.objectContaining({
			operationId: 'replacement-operation',
		}));

		host.onClose();
		expect(await settle(replacementPending)).toBeUndefined();
		expect(host.close).toHaveBeenCalledTimes(2);
	});

	it('keeps the panel open while operations are handled and closes only on an explicit host close', async () => {
		const host = new FakeHost();
		const onOperation = vi.fn().mockResolvedValue({
			status: 'succeeded',
			snapshot: { items: [item], categories: [] },
		});
		const pending = new IFrameInventoryOverviewPanel(t, host).open({
			items: [item],
			categories: [{ id: 'child', name: 'Audio', sortOrder: 0, revision: 2 }],
			initialState,
		}, onOperation);
		const request = await requestFrom(host);
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'operation',
			operation: {
				operationId: 'operation-1',
				intent: {
					type: 'open-marketplace',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: initialState,
				},
			},
		});
		host.poll();
		await vi.waitFor(() => expect(onOperation).toHaveBeenCalledTimes(1));
		const response = parseIFrameInventoryOverviewOperationResponse(
			host.values.get(INVENTORY_OVERVIEW_RESPONSE_KEY),
			request.requestId,
			'operation-1',
		);
		expect(response).toMatchObject({
			operationId: 'operation-1',
			result: { status: 'succeeded', snapshot: { items: [{ id: item.id }] } },
		});
		host.poll();
		expect(onOperation).toHaveBeenCalledTimes(1);
		expect(host.close).not.toHaveBeenCalled();

		host.onClose();
		expect(await settle(pending)).toBeUndefined();
		expect(host.stopPolling).toHaveBeenCalledTimes(1);
		expect(host.close).toHaveBeenCalledTimes(1);
		expect(host.values.has(INVENTORY_OVERVIEW_REQUEST_KEY)).toBe(false);
		expect(host.values.has(INVENTORY_OVERVIEW_RESULT_KEY)).toBe(false);
		expect(host.values.has(INVENTORY_OVERVIEW_RESPONSE_KEY)).toBe(false);
	});

	it('closes a picker session when the iframe reports a completed selection', async () => {
		const host = new FakeHost();
		const trace = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			waitFor: vi.fn(),
		} as unknown as DiagnosticTrace;
		const onOperation = vi.fn().mockResolvedValue({ status: 'succeeded' });
		const pending = new IFrameInventoryOverviewPanel(t, host).open({
			items: [item],
			categories: [],
			picker: {
				title: 'Choose an inventory item',
				actionLabel: 'Select item',
			},
			replaceActiveSession: true,
		}, onOperation, trace);
		const request = await requestFrom(host);
		await vi.waitFor(() => expect(host.open).toHaveBeenCalledOnce());

		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'operation',
			operation: {
				operationId: 'operation-select-item',
				intent: {
					type: 'select-item',
					item: { id: item.id, expectedRevision: item.revision },
					viewState: initialState,
				},
			},
		});
		host.poll();
		await vi.waitFor(() => expect(onOperation).toHaveBeenCalledOnce());
		await vi.waitFor(() => expect(parseIFrameInventoryOverviewOperationResponse(
			host.values.get(INVENTORY_OVERVIEW_RESPONSE_KEY),
			request.requestId,
			'operation-select-item',
		)).toMatchObject({ result: { status: 'succeeded' } }));

		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'completed',
			operationId: 'operation-select-item',
			action: 'select-item',
		});
		host.poll();

		expect(await settle(pending)).toBeUndefined();
		expect(trace.info).toHaveBeenCalledWith('inventory-overview-panel.iframe.response', { status: 'completed' });
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
		expect(host.values.has(INVENTORY_OVERVIEW_REQUEST_KEY)).toBe(false);
		expect(host.values.has(INVENTORY_OVERVIEW_RESULT_KEY)).toBe(false);
	});

	it('cleans fixed bridge keys when the host rejects opening', async () => {
		const host = new FakeHost();
		host.openResult = false;
		const pending = new IFrameInventoryOverviewPanel(t, host).open({ items: [], categories: [] }, vi.fn());
		await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1));

		await vi.advanceTimersByTimeAsync(500);
		await expect(pending).rejects.toBeInstanceOf(InventoryOverviewPanelUnavailableError);
		expect(host.stopPolling).toHaveBeenCalledTimes(1);
		expect(host.values.has(INVENTORY_OVERVIEW_REQUEST_KEY)).toBe(false);
		expect(host.values.has(INVENTORY_OVERVIEW_RESULT_KEY)).toBe(false);
	});

	it('records the last render stage and error when the iframe fails before ready', async () => {
		const host = new FakeHost();
		const trace = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			waitFor: vi.fn(),
		} as unknown as DiagnosticTrace;
		const pending = new IFrameInventoryOverviewPanel(t, host).open({ items: [], categories: [] }, vi.fn(), trace);
		const request = await requestFrom(host);
		await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1));
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'failed',
			stage: 'request-read',
			errorName: 'TypeError',
			error: 'Failed to register an event listener.',
		});
		host.poll();

		await vi.advanceTimersByTimeAsync(500);
		await expect(pending).rejects.toMatchObject({ status: 'render-failed' });
		expect(trace.error).toHaveBeenCalledWith('inventory-overview-panel.iframe.failed', {
			error: 'Failed to register an event listener.',
			errorName: 'TypeError',
			stage: 'request-read',
		});
	});

	it('records a distinct ready timeout with the last observed stage', async () => {
		const host = new FakeHost();
		const trace = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			waitFor: vi.fn(),
		} as unknown as DiagnosticTrace;
		const pending = new IFrameInventoryOverviewPanel(t, host).open({ items: [], categories: [] }, vi.fn(), trace);
		const request = await requestFrom(host);
		await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1));
		host.values.set(INVENTORY_OVERVIEW_RESULT_KEY, {
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'progress',
			stage: 'request-read',
		});
		host.poll();

		await vi.advanceTimersByTimeAsync(10_500);
		host.poll();
		await vi.advanceTimersByTimeAsync(500);
		await expect(pending).rejects.toMatchObject({ status: 'render-failed' });
		expect(trace.error).toHaveBeenCalledWith('inventory-overview-panel.iframe.ready.timeout', {
			stage: 'request-read',
		});
	});
});
