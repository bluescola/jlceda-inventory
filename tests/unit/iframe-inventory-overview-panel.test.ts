import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { InventoryOverviewIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-panel';
import type { InventoryOverviewViewState } from '../../src/platform/jlceda-v3/presentation/inventory-overview-panel';
import type { DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	IFrameInventoryOverviewPanel,
	InventoryOverviewPanelUnavailableError,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-panel';
import {
	INVENTORY_OVERVIEW_PROTOCOL_VERSION,
	INVENTORY_OVERVIEW_REQUEST_KEY,
	INVENTORY_OVERVIEW_RESPONSE_KEY,
	INVENTORY_OVERVIEW_RESULT_KEY,
	INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY,
	parseIFrameInventoryOverviewOperationResponse,
	parseIFrameInventoryOverviewRequest,
	parseIFrameInventoryOverviewResult,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-protocol';

const t = ((key: string) => key) as Translate;

const initialState: InventoryOverviewViewState = {
	query: 'C1',
	focusItemId: 'item-1',
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

	public readonly open = vi.fn(async (options: { title: string; onClose: () => void; onWindowControl: (action: 'maximize' | 'minimize') => Promise<void> }) => {
		this.onClose = options.onClose;
		this.onWindowControl = options.onWindowControl;
		return this.openResult;
	});

	public writeResult = true;
	public pollResult = true;
	public openResult = true;
	public poll: () => void = () => undefined;
	public onClose: () => void = () => undefined;
	public onWindowControl: (action: 'maximize' | 'minimize') => Promise<void> = async () => undefined;

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
		expect(request.labels.search).toBe('inventoryOverview.search');
		expect(request.labels.systemCategories).toBe('inventoryOverview.systemCategories');
		expect(request.labels.userCategories).toBe('inventoryOverview.userCategories');
		expect(request.labels.importEdaCategories).toBe('categoryImport.title');
		expect(request.labels.copyLcscPartNumber).toBe('inventoryOverview.copyLcscPartNumber');
		expect(request.labels.deleteSelected).toBe('inventoryOverview.deleteSelected');
		expect(request.labels.replenishmentNeedsReplenishment).toBe('inventoryOverview.replenishmentNeedsReplenishment');
		expect(request.labels.exportReplenishment).toBe('inventoryOverview.exportReplenishment');
		expect(request.labels.favoriteOnly).toBe('inventoryOverview.favoriteOnly');
		expect(request.labels.columnSettings).toBe('inventoryOverview.columnSettings');
		expect(request.labels.restoreDefaultColumns).toBe('inventoryOverview.restoreDefaultColumns');
		expect(request.labels.openDatasheet).toBe('inventoryItem.openDatasheet');
		expect(parseIFrameInventoryOverviewRequest({ ...request, protocolVersion: 1 })).toBeUndefined();
		expect(parseIFrameInventoryOverviewRequest({
			...request,
			initialState: { ...initialState, focusItemId: '' },
		})).toBeUndefined();
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
	});
});

describe('inventory overview category manager markup', () => {
	it('does not use eager HTML autofocus before the EDA host settles focus', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-overview/inventory-overview.html'), 'utf8');

		expect(html).toMatch(/<input[^>]+id="search-input"/);
		expect(html).not.toMatch(/<input[^>]+id="search-input"[^>]+autofocus/);
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

		expect(html).toMatch(/id="column-settings"[^>]+class="icon-button/);
		expect(html).toContain('id="column-settings-menu"');
		expect(html).toContain('id="restore-default-columns"');
		expect(html).toContain('data-inventory-column="quantity"');
		expect(html).toContain('data-inventory-column="replenishment"');
		expect(html).toMatch(/<th id="column-name"><\/th>/);
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

	it('publishes native minimize actions so iframe blur does not hide the restore title window', async () => {
		const host = new FakeHost();
		const pending = new IFrameInventoryOverviewPanel(t, host).open({ items: [item], categories: [] }, vi.fn());
		const request = await requestFrom(host);
		await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1));

		await host.onWindowControl('minimize');

		expect(host.values.get(INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY)).toEqual({
			action: 'minimize',
			requestId: request.requestId,
			timestamp: expect.any(Number),
		});
		host.onClose();
		expect(await settle(pending)).toBeUndefined();
		expect(host.values.has(INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY)).toBe(false);
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
