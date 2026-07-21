import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { InventoryOverviewIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-panel';
import type { InventoryOverviewViewState } from '../../src/platform/jlceda-v3/presentation/inventory-overview-panel';
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
	parseIFrameInventoryOverviewOperationResponse,
	parseIFrameInventoryOverviewRequest,
	parseIFrameInventoryOverviewResult,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-overview-protocol';

const t = ((key: string) => key) as Translate;

const initialState: InventoryOverviewViewState = {
	query: 'C1',
	searchScope: 'current',
	categoryId: 'child',
	stockFilter: 'in-stock',
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
	edaModelReference: {
		deviceUuid: 'device-1',
		libraryUuid: 'library-1',
	},
	edaModelStatus: 'available',
	quantity: 12,
	precision: 'exact',
	state: 'in-stock',
	location: 'A-1',
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
			items: [{ id: 'item-1', categoryId: 'child', hasEdaModel: true, revision: 4 }],
			categories: [{ id: 'root' }, { id: 'child', parentId: 'root' }],
		});
		expect(request.labels.search).toBe('inventoryOverview.search');
		expect(parseIFrameInventoryOverviewRequest({ ...request, protocolVersion: 1 })).toBeUndefined();
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
		expect(parseIFrameInventoryOverviewResult(valid, 'stale-request')).toBeUndefined();
	});
});

describe('iframeInventoryOverviewPanel', () => {
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
});
