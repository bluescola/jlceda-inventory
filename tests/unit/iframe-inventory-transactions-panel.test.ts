import type { InventoryTransaction, StockOutBatchRecord } from '../../src/features/inventory/domain/inventory-transaction';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { InventoryTransactionsIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-inventory-transactions-panel';
import type { InventoryTransactionsPanelInput } from '../../src/platform/jlceda-v3/presentation/inventory-transactions-panel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chineseMessagesJson from '../../locales/zh-Hans.json';
import { IFrameInventoryTransactionsPanel } from '../../src/platform/jlceda-v3/presentation/iframe-inventory-transactions-panel';
import {
	createIFrameInventoryTransactionsResponse,
	INVENTORY_TRANSACTIONS_EVENT_KEY,
	INVENTORY_TRANSACTIONS_PROTOCOL_VERSION,
	INVENTORY_TRANSACTIONS_REQUEST_KEY,
	INVENTORY_TRANSACTIONS_RESPONSE_KEY,
	parseIFrameInventoryTransactionsRequest,
	parseIFrameInventoryTransactionsResponse,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-transactions-protocol';

const t = ((key: string) => key) as Translate;
const messages = chineseMessagesJson as Record<string, string>;
const zh = ((key: string) => messages[key] ?? key) as Translate;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class FakeHost implements InventoryTransactionsIFrameHost {
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

function batch(id: string, hex: string, reversed: boolean): StockOutBatchRecord {
	return {
		id,
		fingerprint: hex.repeat(64),
		source: 'bom',
		sourceFingerprint: (hex === 'a' ? 'c' : 'd').repeat(64),
		sourceName: `${id}.csv`,
		createdAt: reversed ? '2026-07-21T08:00:00.000Z' : '2026-07-22T08:00:00.000Z',
		lines: [{ itemId: `${id}-secret-item`, quantity: 2, transactionId: `${id}-transaction` }],
		reversal: reversed
			? {
					id: `${id}-reversal`,
					createdAt: '2026-07-22T09:00:00.000Z',
					transactionIds: [`${id}-reversal-transaction`],
				}
			: undefined,
	};
}

function transaction(
	batchId: string,
	kind: InventoryTransaction['kind'],
	createdAt: string,
): InventoryTransaction {
	const reversal = kind === 'bom-stock-out-reversal';
	return {
		id: `${batchId}-${kind}-secret-transaction`,
		itemId: `${batchId}-secret-item`,
		kind,
		source: 'bom',
		delta: reversal ? 2 : -2,
		beforeQuantity: reversal ? 3 : 5,
		afterQuantity: reversal ? 5 : 3,
		createdAt,
		identity: {
			name: '10k resistor',
			lcscPartNumber: 'C1001',
			manufacturerPartNumber: 'RC0603FR-0710KL',
			package: '0603',
		},
		batchId,
		reversalId: reversal ? `${batchId}-reversal` : undefined,
		reversesTransactionId: reversal ? `${batchId}-original` : undefined,
	};
}

function input(activeReversed = false): InventoryTransactionsPanelInput {
	const active = batch('batch-active', 'a', activeReversed);
	const reversed = batch('batch-reversed', 'b', true);
	const transactions = [
		transaction('batch-active', 'bom-stock-out', '2026-07-22T08:00:00.000Z'),
		transaction('batch-reversed', 'bom-stock-out', '2026-07-21T08:00:00.000Z'),
		transaction('batch-reversed', 'bom-stock-out-reversal', '2026-07-22T09:00:00.000Z'),
	];
	if (activeReversed) {
		transactions.push(transaction('batch-active', 'bom-stock-out-reversal', '2026-07-22T10:00:00.000Z'));
	}
	return { batches: [active, reversed], transactions };
}

async function requestFrom(host: FakeHost) {
	await vi.waitFor(() => expect(host.values.has(INVENTORY_TRANSACTIONS_REQUEST_KEY)).toBe(true));
	const request = parseIFrameInventoryTransactionsRequest(host.values.get(INVENTORY_TRANSACTIONS_REQUEST_KEY));
	if (!request)
		throw new Error('Expected a valid inventory transactions request.');
	return request;
}

function event(host: FakeHost, requestId: string, value: Record<string, unknown>): void {
	host.values.set(INVENTORY_TRANSACTIONS_EVENT_KEY, {
		protocolVersion: INVENTORY_TRANSACTIONS_PROTOCOL_VERSION,
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

describe('iframe inventory transactions protocol', () => {
	it('publishes bounded display history without item or transaction IDs', async () => {
		const host = new FakeHost();
		const pending = new IFrameInventoryTransactionsPanel(zh, host).open(input(), async () => ({ status: 'succeeded' }));
		const request = await requestFrom(host);

		expect(request.labels).toMatchObject({
			title: 'BOM 出库批次与撤销流水',
			undoBatch: '撤销批次',
			statusReversed: '已撤销',
		});
		expect(request.snapshot.batches).toHaveLength(2);
		expect(request.snapshot.transactions).toHaveLength(3);
		expect(request.snapshot.batches[0]).toMatchObject({
			id: 'batch-active',
			fingerprintShort: 'aaaaaaaaaaaa',
			sourceFingerprintShort: 'cccccccccccc',
			status: 'active',
			lineCount: 1,
			totalQuantity: 2,
		});
		expect(JSON.stringify(request)).not.toContain('secret-item');
		expect(JSON.stringify(request)).not.toContain('secret-transaction');
		expect(JSON.stringify(request)).not.toContain('a'.repeat(64));
		expect(parseIFrameInventoryTransactionsRequest({
			...request,
			snapshot: {
				...request.snapshot,
				transactions: request.snapshot.transactions.map((value, index) => index === 0
					? { ...value, batchId: 'unknown-batch' }
					: value),
			},
		})).toBeUndefined();

		event(host, request.requestId, { status: 'action', operationId: 'close', action: 'close' });
		await settle(pending);
	});

	it('round-trips a validated replacement snapshot in operation responses', () => {
		const response = createIFrameInventoryTransactionsResponse('request-1', 'refresh-1', {
			status: 'succeeded',
			message: 'updated',
			snapshot: input(true),
		});

		expect(parseIFrameInventoryTransactionsResponse(response, 'request-1', 'refresh-1')).toMatchObject({
			status: 'succeeded',
			message: 'updated',
			snapshot: { batches: [{ status: 'reversed' }, { status: 'reversed' }] },
		});
		expect(parseIFrameInventoryTransactionsResponse(response, 'stale', 'refresh-1')).toBeUndefined();
	});

	it('rejects history above the protocol batch limit before opening an iframe', async () => {
		const host = new FakeHost();
		const oversized: InventoryTransactionsPanelInput = {
			batches: Array.from({ length: 5_001 }, () => batch('batch', 'a', false)),
			transactions: [],
		};

		await expect(new IFrameInventoryTransactionsPanel(t, host).open(
			oversized,
			async () => ({ status: 'succeeded' }),
		)).rejects.toThrow('row limit');
		expect(host.open).not.toHaveBeenCalled();
	});
});

describe('iframe inventory transactions panel', () => {
	it('finishes an active refresh before settling a native close without writing to the closed IFrame', async () => {
		const host = new FakeHost();
		const outcome = deferred<{ status: 'succeeded' }>();
		const handler = vi.fn(() => outcome.promise);
		const pending = new IFrameInventoryTransactionsPanel(t, host).open(input(), handler);
		const request = await requestFrom(host);
		event(host, request.requestId, { status: 'ready' });
		event(host, request.requestId, { status: 'action', operationId: 'refresh-active', action: 'refresh' });
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ type: 'refresh' }));

		host.onClose();
		expect(host.stopPolling).not.toHaveBeenCalled();
		outcome.resolve({ status: 'succeeded' });
		await settle(pending);

		expect(handler).toHaveBeenCalledOnce();
		expect(host.write).not.toHaveBeenCalledWith(INVENTORY_TRANSACTIONS_RESPONSE_KEY, expect.anything());
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
	});

	it('rejects reversal requests for an already reversed batch without calling the handler', async () => {
		const host = new FakeHost();
		const handler = vi.fn(async () => ({ status: 'succeeded' as const }));
		const pending = new IFrameInventoryTransactionsPanel(t, host).open(input(), handler);
		const request = await requestFrom(host);
		event(host, request.requestId, { status: 'ready' });
		event(host, request.requestId, {
			status: 'action',
			operationId: 'undo-reversed',
			action: 'undo-batch',
			batchId: 'batch-reversed',
		});
		await vi.waitFor(() => expect(host.values.has(INVENTORY_TRANSACTIONS_RESPONSE_KEY)).toBe(true));

		expect(parseIFrameInventoryTransactionsResponse(
			host.values.get(INVENTORY_TRANSACTIONS_RESPONSE_KEY),
			request.requestId,
			'undo-reversed',
		)).toMatchObject({ status: 'failed' });
		expect(handler).not.toHaveBeenCalled();
		expect(host.close).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		event(host, request.requestId, { status: 'action', operationId: 'close', action: 'close' });
		await settle(pending);
	});

	it('accepts an active batch undo snapshot, keeps the session open, and exposes filters and confirmation', async () => {
		const host = new FakeHost();
		const handler = vi.fn(async (action: { type: string }) => action.type === 'undo-batch'
			? { status: 'succeeded' as const, snapshot: input(true), message: 'reversed' }
			: { status: 'succeeded' as const });
		const pending = new IFrameInventoryTransactionsPanel(t, host).open(input(), handler);
		const request = await requestFrom(host);
		event(host, request.requestId, { status: 'ready' });
		event(host, request.requestId, {
			status: 'action',
			operationId: 'undo-active',
			action: 'undo-batch',
			batchId: 'batch-active',
		});
		await vi.waitFor(() => expect(host.values.has(INVENTORY_TRANSACTIONS_RESPONSE_KEY)).toBe(true));
		const response = parseIFrameInventoryTransactionsResponse(
			host.values.get(INVENTORY_TRANSACTIONS_RESPONSE_KEY),
			request.requestId,
			'undo-active',
		);
		expect(response).toMatchObject({ status: 'succeeded', message: 'reversed' });
		expect(response?.snapshot?.batches.find(batch => batch.id === 'batch-active'))
			.toMatchObject({ status: 'reversed' });
		expect(handler).toHaveBeenCalledWith({ type: 'undo-batch', batchId: 'batch-active' });
		expect(host.close).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		event(host, request.requestId, { status: 'action', operationId: 'refresh', action: 'refresh' });
		await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ type: 'refresh' }));
		await vi.waitFor(() => expect(parseIFrameInventoryTransactionsResponse(
			host.values.get(INVENTORY_TRANSACTIONS_RESPONSE_KEY),
			request.requestId,
			'refresh',
		)).toMatchObject({ status: 'succeeded' }));

		const html = readFileSync(
			resolve('src/platform/jlceda-v3/iframe/inventory-transactions/inventory-transactions.html'),
			'utf8',
		);
		expect(html).toMatch(/__INVENTORY_TRANSACTIONS_INLINE_CSS__/);
		expect(html).toMatch(/__INVENTORY_TRANSACTIONS_INLINE_JS__/);
		expect(html).toMatch(/id="type-filter"/);
		expect(html).toMatch(/id="batch-filter"/);
		expect(html).toMatch(/id="batch-pager"/);
		expect(html).toMatch(/id="transaction-pager"/);
		expect(html).toMatch(/id="confirm-dialog"/);
		expect(html).not.toMatch(/<link[^>]+href|<script[^>]+src/i);

		await vi.advanceTimersByTimeAsync(1);
		event(host, request.requestId, { status: 'action', operationId: 'close', action: 'close' });
		await settle(pending);
	});
});
