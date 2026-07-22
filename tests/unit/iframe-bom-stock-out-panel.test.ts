import type { BomStockOutPreview } from '../../src/features/inventory/application/bom-stock-out';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { BomStockOutPanelInput } from '../../src/platform/jlceda-v3/presentation/bom-stock-out-panel';
import type { BomStockOutIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-bom-stock-out-panel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chineseMessagesJson from '../../locales/zh-Hans.json';
import { IFrameBomStockOutPanel } from '../../src/platform/jlceda-v3/presentation/iframe-bom-stock-out-panel';
import {
	BOM_STOCK_OUT_EVENT_KEY,
	BOM_STOCK_OUT_PROTOCOL_VERSION,
	BOM_STOCK_OUT_REQUEST_KEY,
	BOM_STOCK_OUT_RESPONSE_KEY,
	parseIFrameBomStockOutRequest,
	parseIFrameBomStockOutResponse,
} from '../../src/platform/jlceda-v3/presentation/iframe-bom-stock-out-protocol';

const t = ((key: string) => key) as Translate;
const messages = chineseMessagesJson as Record<string, string>;
const zh = ((key: string) => messages[key] ?? key) as Translate;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class FakeHost implements BomStockOutIFrameHost {
	public readonly values = new Map<string, unknown>();
	public readonly write = vi.fn(async (key: string, value: unknown) => {
		this.values.set(key, value);
		return true;
	});

	public readonly remove = vi.fn(async (key: string) => this.values.delete(key));
	public readonly close = vi.fn(async () => true);
	public readonly stopPolling = vi.fn(() => true);
	public readonly startPolling = vi.fn((_id: string, _interval: number, callback: () => void) => {
		this.poll = callback;
		return true;
	});

	public readonly open = vi.fn(async (options: { title: string; onClose: () => void }) => {
		this.onClose = options.onClose;
		return true;
	});

	public poll: () => void = () => undefined;
	public onClose: () => void = () => undefined;

	public read(key: string): unknown {
		return this.values.get(key);
	}
}

function preview(status: BomStockOutPreview['status'] = 'ready'): BomStockOutPreview {
	return {
		status,
		documentRevision: 7,
		batchFingerprint: 'a'.repeat(64),
		lines: status === 'ready'
			? [{
					lineIndex: 0,
					itemId: 'inventory-secret-id',
					itemRevision: 4,
					requestedQuantity: 2,
					beforeQuantity: 5,
					afterQuantity: 3,
					sourceReference: 'R1,R2',
				}]
			: [],
		issues: status === 'blocked'
			? [{
					code: 'insufficient-stock',
					lineIndex: 0,
					itemId: 'inventory-secret-id',
					requestedQuantity: 2,
					availableQuantity: 1,
				}]
			: status === 'duplicate' ? [{ code: 'duplicate-batch', existingBatchId: 'old-batch' }] : [],
	};
}

function input(status: BomStockOutPreview['status'] = 'ready'): BomStockOutPanelInput {
	return {
		sourceName: 'controller-board.csv',
		boardQuantity: 2,
		itemSummaries: [{
			lineIndex: 0,
			itemId: 'inventory-secret-id',
			requestedQuantity: 2,
			designators: ['R1', 'R2'],
			identity: {
				name: '10k resistor',
				lcscPartNumber: 'C1001',
				manufacturerPartNumber: 'RC0603FR-0710KL',
				package: '0603',
			},
		}],
		preview: preview(status),
	};
}

async function requestFrom(host: FakeHost) {
	await vi.waitFor(() => expect(host.values.has(BOM_STOCK_OUT_REQUEST_KEY)).toBe(true));
	const request = parseIFrameBomStockOutRequest(host.values.get(BOM_STOCK_OUT_REQUEST_KEY));
	if (!request)
		throw new Error('Expected a valid stock-out request.');
	return request;
}

function event(host: FakeHost, requestId: string, value: Record<string, unknown>): void {
	host.values.set(BOM_STOCK_OUT_EVENT_KEY, {
		protocolVersion: BOM_STOCK_OUT_PROTOCOL_VERSION,
		requestId,
		...value,
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

describe('iframe BOM stock-out protocol', () => {
	it('publishes a bounded ready preview without inventory IDs and verifies issue consistency', async () => {
		const host = new FakeHost();
		const pending = new IFrameBomStockOutPanel(zh, host).open(input(), async () => ({ status: 'succeeded' }));
		const request = await requestFrom(host);

		expect(request).toMatchObject({
			sourceName: 'controller-board.csv',
			boardQuantity: 2,
			status: 'ready',
			batchFingerprintShort: 'aaaaaaaaaaaa',
			labels: {
				title: 'BOM 整批出库预览',
				commit: '确认整批出库',
			},
			rows: [{
				lcscPartNumber: 'C1001',
				designators: ['R1', 'R2'],
				requestedQuantity: 2,
				beforeQuantity: 5,
				afterQuantity: 3,
				issues: [],
			}],
		});
		expect(JSON.stringify(request)).not.toContain('inventory-secret-id');
		expect(JSON.stringify(request)).not.toContain('itemRevision');
		expect(parseIFrameBomStockOutRequest({
			...request,
			globalIssues: [{ code: 'duplicate-batch' }],
		})).toBeUndefined();

		event(host, request.requestId, { status: 'action', operationId: 'close', action: 'close' });
		await settle(pending);
	});

	it('keeps blocking issue quantities while omitting unavailable after quantities', async () => {
		const host = new FakeHost();
		const pending = new IFrameBomStockOutPanel(t, host).open(input('blocked'), async () => ({ status: 'succeeded' }));
		const request = await requestFrom(host);

		expect(request.rows[0]).toMatchObject({
			beforeQuantity: 1,
			afterQuantity: null,
			issues: [{ code: 'insufficient-stock', requestedQuantity: 2, availableQuantity: 1 }],
		});

		event(host, request.requestId, { status: 'action', operationId: 'close', action: 'close' });
		await settle(pending);
	});

	it('rejects previews above the protocol row limit before opening an iframe', async () => {
		const host = new FakeHost();
		const oversized = input();
		oversized.itemSummaries = Array.from({ length: 10_001 }, (_, lineIndex) => ({
			...oversized.itemSummaries[0],
			lineIndex,
			itemId: `item-${lineIndex}`,
		}));

		await expect(new IFrameBomStockOutPanel(t, host).open(
			oversized,
			async () => ({ status: 'succeeded' }),
		)).rejects.toThrow('Invalid BOM stock-out panel input');
		expect(host.open).not.toHaveBeenCalled();
	});
});

describe('iframe BOM stock-out panel', () => {
	it('finishes an active commit before settling a native close without writing to the closed IFrame', async () => {
		const host = new FakeHost();
		const outcome = deferred<{ status: 'failed'; message: string }>();
		const handler = vi.fn(() => outcome.promise);
		const pending = new IFrameBomStockOutPanel(t, host).open(input(), handler);
		const request = await requestFrom(host);
		event(host, request.requestId, { status: 'ready' });
		event(host, request.requestId, { status: 'action', operationId: 'commit-active', action: 'commit' });
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ type: 'commit' }));

		host.onClose();
		expect(host.stopPolling).not.toHaveBeenCalled();
		outcome.resolve({ status: 'failed', message: 'stale preview' });
		await settle(pending);

		expect(handler).toHaveBeenCalledOnce();
		expect(host.write).not.toHaveBeenCalledWith(BOM_STOCK_OUT_RESPONSE_KEY, expect.anything());
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
	});

	it('commits a ready preview once and closes after the host confirms success', async () => {
		const host = new FakeHost();
		const handler = vi.fn(async () => ({ status: 'succeeded' as const, message: 'committed' }));
		const pending = new IFrameBomStockOutPanel(t, host).open(input(), handler);
		const request = await requestFrom(host);
		event(host, request.requestId, { status: 'ready' });
		event(host, request.requestId, { status: 'action', operationId: 'commit-once', action: 'commit' });

		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ type: 'commit' }));
		await settle(pending);
		expect(host.close).toHaveBeenCalledOnce();
		expect(host.values.has(BOM_STOCK_OUT_REQUEST_KEY)).toBe(false);
	});

	it('rejects commit events for blocked previews and keeps the panel open', async () => {
		const host = new FakeHost();
		const handler = vi.fn(async () => ({ status: 'succeeded' as const }));
		const pending = new IFrameBomStockOutPanel(t, host).open(input('blocked'), handler);
		const request = await requestFrom(host);
		event(host, request.requestId, { status: 'ready' });
		event(host, request.requestId, { status: 'action', operationId: 'blocked-commit', action: 'commit' });
		await vi.waitFor(() => expect(host.values.has(BOM_STOCK_OUT_RESPONSE_KEY)).toBe(true));

		expect(parseIFrameBomStockOutResponse(
			host.values.get(BOM_STOCK_OUT_RESPONSE_KEY),
			request.requestId,
			'blocked-commit',
		)).toMatchObject({ status: 'failed' });
		expect(handler).not.toHaveBeenCalled();
		expect(host.close).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		event(host, request.requestId, { status: 'action', operationId: 'close', action: 'close' });
		await settle(pending);
	});

	it('keeps failed commits open and exposes a self-contained explicit confirmation UI', async () => {
		const host = new FakeHost();
		const handler = vi.fn(async (action: { type: 'close' | 'commit' }) => action.type === 'commit'
			? { status: 'failed' as const, message: 'stale preview' }
			: { status: 'succeeded' as const });
		const pending = new IFrameBomStockOutPanel(t, host).open(input(), handler);
		const request = await requestFrom(host);
		event(host, request.requestId, { status: 'ready' });
		event(host, request.requestId, { status: 'action', operationId: 'commit', action: 'commit' });
		await vi.waitFor(() => expect(host.values.has(BOM_STOCK_OUT_RESPONSE_KEY)).toBe(true));
		expect(parseIFrameBomStockOutResponse(
			host.values.get(BOM_STOCK_OUT_RESPONSE_KEY),
			request.requestId,
			'commit',
		)).toMatchObject({ status: 'failed', message: 'stale preview' });
		expect(host.close).not.toHaveBeenCalled();

		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/bom-stock-out/bom-stock-out.html'), 'utf8');
		expect(html).toMatch(/__BOM_STOCK_OUT_INLINE_CSS__/);
		expect(html).toMatch(/__BOM_STOCK_OUT_INLINE_JS__/);
		expect(html).toMatch(/id="confirm-dialog"/);
		expect(html).toMatch(/id="commit"/);
		expect(html).not.toMatch(/<link[^>]+href|<script[^>]+src/i);

		event(host, request.requestId, { status: 'action', operationId: 'close', action: 'close' });
		await settle(pending);
	});
});
