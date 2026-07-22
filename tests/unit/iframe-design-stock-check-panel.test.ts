import type { InventoryItem } from '../../src/features/inventory/domain/inventory-item';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { DesignStockCheckIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-design-stock-check-panel';
import type { DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chineseMessagesJson from '../../locales/zh-Hans.json';
import { checkDesignStock } from '../../src/features/design-stock-check/application/check-design-stock';
import { IFrameDesignStockCheckPanel } from '../../src/platform/jlceda-v3/presentation/iframe-design-stock-check-panel';
import {
	DESIGN_STOCK_CHECK_EVENT_KEY,
	DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
	DESIGN_STOCK_CHECK_REQUEST_KEY,
	DESIGN_STOCK_CHECK_RESPONSE_KEY,
	parseIFrameDesignStockCheckEvent,
	parseIFrameDesignStockCheckRequest,
	parseIFrameDesignStockCheckResponse,
} from '../../src/platform/jlceda-v3/presentation/iframe-design-stock-check-protocol';

const t = ((key: string) => key) as Translate;
const chineseMessages = chineseMessagesJson as Record<string, string>;
const chineseTranslate = ((key: string) => chineseMessages[key] ?? key) as Translate;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class FakeHost implements DesignStockCheckIFrameHost {
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

function item(
	id: string,
	partNumber: string,
	quantity: number | null,
	precision: InventoryItem['precision'] = 'exact',
): InventoryItem {
	return {
		id,
		identity: { name: id, lcscPartNumber: partNumber },
		edaModelStatus: 'unchecked',
		quantity,
		precision,
		state: quantity === 0 ? 'depleted' : 'in-stock',
		source: 'manual',
		createdAt: '2026-07-22T00:00:00.000Z',
		updatedAt: '2026-07-22T00:00:00.000Z',
		revision: 1,
	};
}

function report() {
	return checkDesignStock({
		boardQuantity: 2,
		components: [
			{ designator: 'R1', identity: { name: 'Enough', lcscPartNumber: 'C1' } },
			{ designator: 'R2', identity: { name: 'Short', lcscPartNumber: 'C2' }, quantity: 3 },
			{ designator: 'R3', identity: { name: 'Estimate', lcscPartNumber: 'C3' } },
			{ designator: 'R4', identity: { name: 'Unknown', lcscPartNumber: 'C4' } },
			{ designator: 'R5', identity: { name: 'Missing', lcscPartNumber: 'C5' } },
			{ designator: 'U1', identity: { name: 'Custom' } },
		],
		inventory: [
			item('inventory-secret-1', 'C1', 2),
			item('inventory-secret-2', 'C2', 1),
			item('inventory-secret-3', 'C3', 10, 'estimated'),
			item('inventory-secret-4', 'C4', null, 'unknown'),
		],
	});
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
	await vi.waitFor(() => expect(host.values.has(DESIGN_STOCK_CHECK_REQUEST_KEY)).toBe(true));
	const request = parseIFrameDesignStockCheckRequest(host.values.get(DESIGN_STOCK_CHECK_REQUEST_KEY));
	if (!request) {
		throw new Error('Expected a valid design stock check request.');
	}
	return request;
}

function writeEvent(host: FakeHost, requestId: string, event: Record<string, unknown>): void {
	host.values.set(DESIGN_STOCK_CHECK_EVENT_KEY, {
		protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
		requestId,
		...event,
	});
	host.poll();
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

describe('iframe design stock check protocol', () => {
	it('creates a complete display snapshot with verified status counts and no inventory IDs', async () => {
		const host = new FakeHost();
		const pending = new IFrameDesignStockCheckPanel(chineseTranslate, host).open(
			{ report: report(), source: 'schematic' },
			async () => ({ status: 'succeeded' }),
		);
		const request = await requestFrom(host);

		expect(request).toMatchObject({
			source: 'schematic',
			boardQuantity: 2,
			labels: {
				title: '当前设计库存校验',
				sourceSchematic: '当前原理图',
				inventoryMissing: '库存缺失',
				exportCsv: '导出缺料 CSV',
				filterAll: '全部状态',
			},
			summary: {
				'sufficient': 1,
				'insufficient': 1,
				'review-required': 1,
				'stocktake-required': 1,
				'inventory-missing': 1,
				'identity-unmatched': 1,
			},
		});
		expect(request.rows).toHaveLength(6);
		expect(request.rows[0]).not.toHaveProperty('inventoryItemIds');
		expect(request.rows[0]).not.toHaveProperty('key');
		expect(parseIFrameDesignStockCheckRequest({
			...request,
			summary: { ...request.summary, sufficient: 2 },
		})).toBeUndefined();
		expect(parseIFrameDesignStockCheckEvent({
			protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
			requestId: 'stale',
			status: 'ready',
		}, request.requestId)).toBeUndefined();

		writeEvent(host, request.requestId, { status: 'action', operationId: 'close-1', action: 'close' });
		await settle(pending);
	});
});

describe('iframeDesignStockCheckPanel', () => {
	it('finishes an active export before settling a native close without writing to the closed IFrame', async () => {
		const host = new FakeHost();
		const outcome = deferred<{ status: 'succeeded' }>();
		const handleAction = vi.fn(() => outcome.promise);
		const pending = new IFrameDesignStockCheckPanel(t, host).open(
			{ report: report(), source: 'pcb' },
			handleAction,
		);
		const request = await requestFrom(host);
		writeEvent(host, request.requestId, { status: 'ready' });
		writeEvent(host, request.requestId, {
			status: 'action',
			operationId: 'export-active',
			action: 'export-csv',
		});
		await vi.waitFor(() => expect(handleAction).toHaveBeenCalledWith({ type: 'export-csv' }));

		host.onClose();
		expect(host.stopPolling).not.toHaveBeenCalled();
		outcome.resolve({ status: 'succeeded' });
		await settle(pending);

		expect(handleAction).toHaveBeenCalledOnce();
		expect(host.write).not.toHaveBeenCalledWith(DESIGN_STOCK_CHECK_RESPONSE_KEY, expect.anything());
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
	});

	it('keeps the report open for export, returns the result, then closes through an explicit action', async () => {
		const host = new FakeHost();
		const diagnostic = trace();
		const handleAction = vi.fn(async (action: { type: 'close' | 'export-csv' }) => action.type === 'export-csv'
			? { status: 'succeeded' as const, message: 'saved' }
			: { status: 'succeeded' as const });
		const pending = new IFrameDesignStockCheckPanel(t, host).open(
			{ report: report(), source: 'pcb' },
			handleAction,
			diagnostic,
		);
		const request = await requestFrom(host);
		writeEvent(host, request.requestId, { status: 'ready' });

		writeEvent(host, request.requestId, {
			status: 'action',
			operationId: 'export-1',
			action: 'export-csv',
		});
		await vi.waitFor(() => expect(handleAction).toHaveBeenCalledWith({ type: 'export-csv' }));
		await vi.waitFor(() => expect(host.values.has(DESIGN_STOCK_CHECK_RESPONSE_KEY)).toBe(true));
		expect(parseIFrameDesignStockCheckResponse(
			host.values.get(DESIGN_STOCK_CHECK_RESPONSE_KEY),
			request.requestId,
			'export-1',
		)).toMatchObject({ status: 'succeeded', message: 'saved' });
		expect(host.close).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(diagnostic.info).toHaveBeenCalledWith(
			'design-stock-check-panel.action.completed',
			{ action: 'export-csv', status: 'succeeded' },
		));

		writeEvent(host, request.requestId, {
			status: 'action',
			operationId: 'close-1',
			action: 'close',
		});
		await vi.waitFor(() => expect(handleAction).toHaveBeenCalledWith({ type: 'close' }));
		await settle(pending);

		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
		expect(host.values.has(DESIGN_STOCK_CHECK_REQUEST_KEY)).toBe(false);
		expect(host.values.has(DESIGN_STOCK_CHECK_EVENT_KEY)).toBe(false);
		expect(host.values.has(DESIGN_STOCK_CHECK_RESPONSE_KEY)).toBe(false);
		expect(diagnostic.info).toHaveBeenCalledWith(
			'design-stock-check-panel.action.completed',
			{ action: 'export-csv', status: 'succeeded' },
		);
	});

	it('passes failed exports back to the IFrame without closing the report', async () => {
		const host = new FakeHost();
		const handleAction = vi.fn(async (action: { type: 'close' | 'export-csv' }) => action.type === 'export-csv'
			? { status: 'failed' as const, message: 'save failed' }
			: { status: 'succeeded' as const });
		const pending = new IFrameDesignStockCheckPanel(t, host).open(
			{ report: report(), source: 'file' },
			handleAction,
		);
		const request = await requestFrom(host);
		writeEvent(host, request.requestId, { status: 'ready' });
		writeEvent(host, request.requestId, {
			status: 'action',
			operationId: 'export-failed',
			action: 'export-csv',
		});
		await vi.waitFor(() => expect(host.values.has(DESIGN_STOCK_CHECK_RESPONSE_KEY)).toBe(true));
		expect(parseIFrameDesignStockCheckResponse(
			host.values.get(DESIGN_STOCK_CHECK_RESPONSE_KEY),
			request.requestId,
			'export-failed',
		)).toMatchObject({ status: 'failed', message: 'save failed' });
		expect(host.close).not.toHaveBeenCalled();

		writeEvent(host, request.requestId, { status: 'action', operationId: 'close-2', action: 'close' });
		await settle(pending);
	});

	it('keeps the source template self-contained and exposes the report table and two commands', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/design-stock-check/design-stock-check.html'), 'utf8');
		expect(html).toMatch(/__DESIGN_STOCK_CHECK_INLINE_CSS__/);
		expect(html).toMatch(/__DESIGN_STOCK_CHECK_INLINE_JS__/);
		expect(html).toMatch(/<table>/);
		expect(html).toMatch(/id="export-csv"/);
		expect(html).toMatch(/id="close"/);
		expect(html).not.toMatch(/<link[^>]+href|<script[^>]+src/i);
	});
});
