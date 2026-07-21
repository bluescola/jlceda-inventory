import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { OrderImportIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-order-import-panel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IFrameOrderImportPanel } from '../../src/platform/jlceda-v3/presentation/iframe-order-import-panel';
import {
	ORDER_IMPORT_EVENT_KEY,
	ORDER_IMPORT_PROTOCOL_VERSION,
	ORDER_IMPORT_REQUEST_KEY,
	parseIFrameOrderImportEvent,
	parseIFrameOrderImportRequest,
	parseIFrameOrderImportResponse,
} from '../../src/platform/jlceda-v3/presentation/iframe-order-import-protocol';

const t = ((key: string) => key) as Translate;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class FakeHost implements OrderImportIFrameHost {
	public readonly values = new Map<string, unknown>();
	public readonly write = vi.fn(async (key: string, value: unknown) => {
		this.values.set(key, value);
		return true;
	});

	public readonly remove = vi.fn(async (key: string) => this.values.delete(key));
	public readonly close = vi.fn(async () => true);
	public readonly open = vi.fn(async (options: { title: string; onClose: () => void }) => {
		this.onClose = options.onClose;
		return true;
	});

	public readonly startPolling = vi.fn((_id: string, _interval: number, callback: () => void) => {
		this.poll = callback;
		return true;
	});

	public readonly stopPolling = vi.fn(() => true);
	public poll: () => void = () => undefined;
	public onClose: () => void = () => undefined;

	public read(key: string): unknown {
		return this.values.get(key);
	}
}

async function requestFrom(host: FakeHost) {
	await vi.waitFor(() => expect(host.values.has(ORDER_IMPORT_REQUEST_KEY)).toBe(true));
	const request = parseIFrameOrderImportRequest(host.values.get(ORDER_IMPORT_REQUEST_KEY));
	if (!request) {
		throw new Error('Expected a valid order import request.');
	}
	return request;
}

describe('iframe order import protocol', () => {
	it('requires the preview token and isolates sequenced responses by operation', () => {
		const action = {
			protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'action',
			operationId: 'import-1',
			action: 'import',
			settings: { defaultState: 'in-stock', strategy: 'add' },
		};
		expect(parseIFrameOrderImportEvent(action, 'request-1')).toBeUndefined();
		expect(parseIFrameOrderImportEvent({ ...action, previewToken: 'opaque-preview' }, 'request-1')).toMatchObject({
			action: 'import',
			previewToken: 'opaque-preview',
		});
		const progress = {
			protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
			requestId: 'request-1',
			operationId: 'import-1',
			sequence: 2,
			stage: 'progress',
			progress: { phase: 'model-matching', completed: 3, total: 8 },
		};
		expect(parseIFrameOrderImportResponse(progress, 'request-1', 'import-1')).toMatchObject({ sequence: 2 });
		expect(parseIFrameOrderImportResponse(progress, 'request-1', 'stale')).toBeUndefined();
	});
});

describe('iframe order import panel', () => {
	it('does not return or clean bridge state while an import handler is still running', async () => {
		const host = new FakeHost();
		let finishImport: () => void = () => undefined;
		const importGate = new Promise<void>((resolve) => {
			finishImport = resolve;
		});
		const handler = vi.fn(async () => {
			await importGate;
			return {
				stage: 'completed' as const,
				summary: { importedFiles: 1, duplicateFiles: 0, added: 2, merged: 0, skipped: 0 },
			};
		});
		let resolved = false;
		const pending = new IFrameOrderImportPanel(t, host).open({ files: [{ name: 'order.csv' }] }, handler);
		void pending.then(() => {
			resolved = true;
		});
		const request = await requestFrom(host);
		host.values.set(ORDER_IMPORT_EVENT_KEY, {
			protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(ORDER_IMPORT_EVENT_KEY, {
			protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'action',
			operationId: 'import-1',
			action: 'import',
			settings: { defaultState: 'in-stock', strategy: 'add' },
			previewToken: 'opaque-preview',
		});
		host.poll();
		await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

		host.onClose();
		await vi.advanceTimersByTimeAsync(500);
		expect(resolved).toBe(false);
		expect(host.values.has(ORDER_IMPORT_REQUEST_KEY)).toBe(true);
		expect(host.stopPolling).not.toHaveBeenCalled();

		finishImport();
		await vi.advanceTimersByTimeAsync(500);
		await expect(pending).resolves.toBe('completed');
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.values.has(ORDER_IMPORT_REQUEST_KEY)).toBe(false);
	});
});
