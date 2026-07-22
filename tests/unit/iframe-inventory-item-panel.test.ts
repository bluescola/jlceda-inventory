import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { InventoryItemIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-inventory-item-panel';
import type { DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chineseMessagesJson from '../../locales/zh-Hans.json';
import { IFrameInventoryItemPanel, InventoryItemPanelUnavailableError } from '../../src/platform/jlceda-v3/presentation/iframe-inventory-item-panel';
import {
	INVENTORY_ITEM_PROTOCOL_VERSION,
	INVENTORY_ITEM_REQUEST_KEY,
	INVENTORY_ITEM_RESULT_KEY,
	parseIFrameInventoryItemRequest,
	parseIFrameInventoryItemResult,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-item-protocol';

const item: InventoryItem = {
	id: 'item-secret-id',
	identity: {
		name: 'Secret microphone',
		lcscPartNumber: 'C233991',
		supplierId: 'SUP-SECRET',
		manufacturer: 'Secret Maker',
		manufacturerPartNumber: 'MPN-SECRET',
		package: 'SMD-SECRET',
		description: 'Secret description',
	},
	marketplaceReference: {
		provider: 'lcsc',
		productUrl: 'https://example.invalid/C233991',
		evidence: 'user-confirmed',
		confirmedAt: '2026-07-20T00:00:00.000Z',
	},
	edaModelReference: {
		deviceUuid: 'device-secret',
		libraryUuid: 'library-secret',
		symbolName: 'Symbol secret',
		footprintName: 'Footprint secret',
	},
	edaModelStatus: 'available',
	quantity: 12,
	precision: 'estimated',
	state: 'in-stock',
	location: 'Drawer secret',
	datasheetUrl: 'https://example.com/original.pdf',
	structuredLocation: { cabinet: 'A', box: '1', row: '2', column: '3' },
	note: 'Note secret',
	source: 'marketplace',
	createdAt: '2026-07-20T00:00:00.000Z',
	updatedAt: '2026-07-21T00:00:00.000Z',
	revision: 3,
};

const candidate: InventoryItem = {
	...item,
	id: 'candidate-id',
	identity: {
		...item.identity,
		name: 'Candidate secret',
	},
	quantity: 4,
	revision: 1,
};

const t = ((key: string) => key) as Translate;
const chineseMessages = chineseMessagesJson as Record<string, string>;
const chineseTranslate = ((key: string) => chineseMessages[key] ?? key) as Translate;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class FakeHost implements InventoryItemIFrameHost {
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
		if (this.openError) {
			throw this.openError;
		}
		return this.openResult;
	});

	public writeResult = true;
	public pollResult = true;
	public openResult = true;
	public openError?: Error;
	public poll: () => void = () => undefined;
	public onClose: () => void = () => undefined;

	public read(key: string): unknown {
		return this.values.get(key);
	}
}

function trace(): DiagnosticTrace {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		waitFor: vi.fn(async (_step: string, operation: () => Promise<unknown>) => operation()),
	} as unknown as DiagnosticTrace;
}

async function requestFrom(host: FakeHost) {
	await vi.waitFor(() => expect(host.values.has(INVENTORY_ITEM_REQUEST_KEY)).toBe(true));
	const request = parseIFrameInventoryItemRequest(host.values.get(INVENTORY_ITEM_REQUEST_KEY));
	if (!request) {
		throw new Error('Expected a valid inventory item panel request.');
	}
	return request;
}

function writeReady(host: FakeHost, requestId: string): void {
	host.values.set(INVENTORY_ITEM_RESULT_KEY, {
		protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
		requestId,
		status: 'ready',
	});
	host.poll();
}

async function settle<T>(promise: Promise<T>): Promise<T> {
	await vi.advanceTimersByTimeAsync(500);
	return promise;
}

describe('iframe inventory item protocol', () => {
	it('accepts fixed view/edit/compare requests and isolates terminal results by mode', async () => {
		const host = new FakeHost();
		const panel = new IFrameInventoryItemPanel(t, host);
		const pending = panel.edit(item);
		const request = await requestFrom(host);

		expect(request).toMatchObject({
			mode: 'edit',
			item: {
				identity: { name: 'Secret microphone' },
				marketplaceStatus: 'marketplace.userConfirmed',
				edaModelStatus: 'edaModel.available',
				source: 'inventoryItem.source.marketplace',
				revision: 3,
			},
			initial: {
				quantity: '12',
				precision: 'estimated',
				depleted: false,
				minimumQuantity: '',
				favorite: false,
			},
			locationOptions: [],
		});
		expect(parseIFrameInventoryItemResult({
			protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'edit',
		}, request.requestId, 'edit')).toBeUndefined();
		expect(parseIFrameInventoryItemResult({
			protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
			requestId: 'stale',
			status: 'cancelled',
		}, request.requestId, 'edit')).toBeUndefined();
		expect(parseIFrameInventoryItemRequest({ ...request, protocolVersion: 2 })).toBeUndefined();

		host.values.set(INVENTORY_ITEM_RESULT_KEY, {
			protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'cancelled',
		});
		host.poll();
		expect(await settle(pending)).toBeUndefined();
	});
});

describe('inventory item form markup', () => {
	it('exposes minimum-stock and favorite controls in the full editor', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-item/inventory-item.html'), 'utf8');

		expect(html).toContain('id="edit-minimum-quantity"');
		expect(html).toContain('id="edit-favorite"');
		expect(html).toContain('id="edit-datasheet"');
		expect(html).toContain('id="edit-location-cabinet"');
	});
});

describe('iframeInventoryItemPanel', () => {
	it('passes localized Chinese titles, fields, and system values to the IFrame', async () => {
		const host = new FakeHost();
		const pending = new IFrameInventoryItemPanel(chineseTranslate, host).view(item);
		const request = await requestFrom(host);
		if (request.mode !== 'view') {
			throw new Error('Expected view mode.');
		}

		expect(request.labels).toMatchObject({
			viewTitle: '库存详情',
			supplierId: '供应商编号',
			precision: '数量类型',
			stockState: '库存状态',
			minimumQuantity: '最低库存',
			favorite: '收藏记录',
			replenishmentStatus: '补货状态',
			source: '记录来源',
		});
		expect(request.item).toMatchObject({
			marketplaceStatus: '已由用户在商城确认',
			edaModelStatus: '可用',
			source: '立创商城',
			favorite: false,
			replenishmentStatus: 'not-configured',
		});
		expect(request.item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
		expect(request.item.createdAt).not.toMatch(/[a-z]/i);
		expect(host.open).toHaveBeenCalledWith(expect.objectContaining({ title: '库存详情' }));

		host.values.set(INVENTORY_ITEM_RESULT_KEY, {
			protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'cancelled',
		});
		host.poll();
		await settle(pending);
	});

	it('returns the full-edit intent from the read-only detail view', async () => {
		const host = new FakeHost();
		const diagnostic = trace();
		const pending = new IFrameInventoryItemPanel(t, host).view(item, diagnostic);
		const request = await requestFrom(host);
		expect(request.mode).toBe('view');
		writeReady(host, request.requestId);
		host.values.set(INVENTORY_ITEM_RESULT_KEY, {
			protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'edit',
		});
		host.poll();

		expect(await settle(pending)).toBe('edit');
		expect(host.stopPolling).toHaveBeenCalledTimes(1);
		expect(host.close).toHaveBeenCalledTimes(1);
		expect(host.values.has(INVENTORY_ITEM_REQUEST_KEY)).toBe(false);
		expect(host.values.has(INVENTORY_ITEM_RESULT_KEY)).toBe(false);
		expect(diagnostic.info).toHaveBeenCalledWith('inventory-item-panel.iframe.response', { mode: 'view', status: 'edit' });
	});

	it('submits a normalized edit draft and enforces depleted quantity semantics', async () => {
		const host = new FakeHost();
		const diagnostic = trace();
		const panel = new IFrameInventoryItemPanel(t, host);
		const pending = panel.edit(item, {
			suggestion: {
				name: 'EDA proposed name',
				manufacturer: 'EDA proposed maker',
			},
			locationOptions: [' Drawer secret ', 'Shelf B', 'Shelf B'],
		}, diagnostic);
		const request = await requestFrom(host);
		if (request.mode !== 'edit') {
			throw new Error('Expected edit mode.');
		}
		expect(request.suggestion).toEqual({ name: 'EDA proposed name', manufacturer: 'EDA proposed maker' });
		expect(request.locationOptions).toEqual(['Drawer secret', 'Shelf B']);
		writeReady(host, request.requestId);
		host.values.set(INVENTORY_ITEM_RESULT_KEY, {
			protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'submitted',
			value: {
				lcscPartNumber: ' c25804 ',
				supplierId: ' SUP-NEW ',
				name: ' Edited microphone ',
				manufacturer: ' Maker ',
				manufacturerPartNumber: ' MPN-NEW ',
				package: ' SMD ',
				description: ' Updated description ',
				quantity: '19',
				minimumQuantity: '6',
				precision: 'estimated',
				depleted: true,
				favorite: true,
				location: ' Drawer A ',
				datasheetUrl: ' https://example.com/updated.pdf ',
				locationCabinet: ' B ',
				locationBox: ' 4 ',
				locationRow: ' 5 ',
				locationColumn: ' 6 ',
				note: ' Updated note ',
			},
		});
		host.poll();

		expect(await settle(pending)).toEqual({
			identity: {
				lcscPartNumber: 'C25804',
				supplierId: 'SUP-NEW',
				name: 'Edited microphone',
				manufacturer: 'Maker',
				manufacturerPartNumber: 'MPN-NEW',
				package: 'SMD',
				description: 'Updated description',
			},
			quantity: 0,
			precision: 'exact',
			minimumQuantity: 6,
			favorite: true,
			location: 'Drawer A',
			datasheetUrl: 'https://example.com/updated.pdf',
			structuredLocation: { cabinet: 'B', box: '4', row: '5', column: '6' },
			note: 'Updated note',
		});
		expect(diagnostic.info).toHaveBeenCalledWith('inventory-item-panel.submitted', {
			changedFields: 18,
			mode: 'edit',
			status: 'submitted',
		});

		const logText = JSON.stringify([
			...vi.mocked(diagnostic.info).mock.calls,
			...vi.mocked(diagnostic.warn).mock.calls,
			...vi.mocked(diagnostic.error).mock.calls,
		]);
		expect(logText).not.toMatch(/C233991|Secret microphone|SUP-SECRET|MPN-SECRET|Drawer secret|Edited microphone|SUP-NEW|Updated note/);
	});

	it('returns true only when the duplicate comparison confirms the merge', async () => {
		const host = new FakeHost();
		const pending = new IFrameInventoryItemPanel(t, host).compare(item, candidate);
		const request = await requestFrom(host);
		if (request.mode !== 'compare') {
			throw new Error('Expected compare mode.');
		}
		expect(request.existing.identity.name).toBe('Secret microphone');
		expect(request.candidate.identity.name).toBe('Candidate secret');
		writeReady(host, request.requestId);
		host.values.set(INVENTORY_ITEM_RESULT_KEY, {
			protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'confirmed',
		});
		host.poll();
		expect(await settle(pending)).toBe(true);
	});

	it('cleans fixed bridge keys when opening is rejected', async () => {
		const host = new FakeHost();
		host.openResult = false;
		const pending = new IFrameInventoryItemPanel(t, host).view(item);
		await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1));

		await vi.advanceTimersByTimeAsync(500);
		await expect(pending).rejects.toBeInstanceOf(InventoryItemPanelUnavailableError);
		expect(host.stopPolling).toHaveBeenCalledTimes(1);
		expect(host.values.has(INVENTORY_ITEM_REQUEST_KEY)).toBe(false);
		expect(host.values.has(INVENTORY_ITEM_RESULT_KEY)).toBe(false);
	});
});
