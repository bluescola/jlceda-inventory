import type { BomDesignDemand, BomDiffResult, BomRowIssue } from '../../src/features/bom-analysis/domain/bom-analysis';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { BomDiffIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-bom-diff-panel';
import type { DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chineseMessagesJson from '../../locales/zh-Hans.json';
import { diffNormalizedBoms } from '../../src/features/bom-analysis/domain/diff-boms';
import { IFrameBomDiffPanel } from '../../src/platform/jlceda-v3/presentation/iframe-bom-diff-panel';
import {
	BOM_DIFF_EVENT_KEY,
	BOM_DIFF_PROTOCOL_VERSION,
	BOM_DIFF_REQUEST_KEY,
	BOM_DIFF_RESPONSE_KEY,
	parseIFrameBomDiffEvent,
	parseIFrameBomDiffRequest,
	parseIFrameBomDiffResponse,
} from '../../src/platform/jlceda-v3/presentation/iframe-bom-diff-protocol';

const t = ((key: string) => key) as Translate;
const chineseMessages = chineseMessagesJson as Record<string, string>;
const chineseTranslate = ((key: string) => chineseMessages[key] ?? key) as Translate;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class FakeHost implements BomDiffIFrameHost {
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
		return true;
	});

	public readonly open = vi.fn(async (options: { title: string; onClose: () => void }) => {
		this.onClose = options.onClose;
		return true;
	});

	public writeResult = true;
	public poll: () => void = () => undefined;
	public onClose: () => void = () => undefined;

	public read(key: string): unknown {
		return this.values.get(key);
	}
}

function demand(
	partNumber: string | undefined,
	quantity: number,
	designators: string[],
	name: string,
	rowNumber: number,
): BomDesignDemand {
	return {
		sheetName: 'Main',
		rowNumber,
		lcscPartNumber: partNumber,
		designators,
		quantity,
		identity: { name, manufacturerPartNumber: `${name}-MPN`, manufacturer: 'Vendor', package: '0603' },
	};
}

function report(): BomDiffResult {
	return diffNormalizedBoms(
		[
			demand('C1', 2, ['R1', 'R2'], 'Old resistor', 2),
			demand('C2', 1, ['C1'], 'Removed capacitor', 3),
			demand(undefined, 1, ['J1'], 'Custom connector', 4),
		],
		[
			demand('C1', 4, ['R1', 'R2', 'R3', 'R4'], 'New resistor', 2),
			demand('C3', 1, ['U1'], 'Added IC', 3),
			demand('supplier-only', 2, ['TP1', 'TP2'], 'Test point', 4),
		],
	);
}

function issues(): { before: BomRowIssue[]; after: BomRowIssue[] } {
	return {
		before: [{ code: 'missing-lcsc-part-number', sheetName: 'Main', rowNumber: 4, field: 'lcscPartNumber' }],
		after: [{ code: 'invalid-quantity', sheetName: 'Main', rowNumber: 8, field: 'quantity', value: 'two' }],
	};
}

function input() {
	const rowIssues = issues();
	return {
		result: report(),
		beforeFileName: 'baseline.csv',
		afterFileName: 'revision.xlsx',
		beforeIssues: rowIssues.before,
		afterIssues: rowIssues.after,
	};
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
	await vi.waitFor(() => expect(host.values.has(BOM_DIFF_REQUEST_KEY)).toBe(true));
	const request = parseIFrameBomDiffRequest(host.values.get(BOM_DIFF_REQUEST_KEY));
	if (!request) {
		throw new Error('Expected a valid BOM diff request.');
	}
	return request;
}

function writeEvent(host: FakeHost, requestId: string, event: Record<string, unknown>): void {
	host.values.set(BOM_DIFF_EVENT_KEY, {
		protocolVersion: BOM_DIFF_PROTOCOL_VERSION,
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

describe('iframe BOM diff protocol', () => {
	it('creates a bounded display snapshot with verified counts and no inventory content', async () => {
		const host = new FakeHost();
		const pending = new IFrameBomDiffPanel(chineseTranslate, host).open(
			input(),
			async () => ({ status: 'succeeded' }),
		);
		const request = await requestFrom(host);

		expect(request).toMatchObject({
			beforeFileName: 'baseline.csv',
			afterFileName: 'revision.xlsx',
			labels: {
				title: 'BOM 差异报告',
				changeIdentityChanged: '身份变化',
				reviewBeforeUnmatched: '基准 BOM 无 C 编号行',
				exportCsv: '导出差异 CSV',
			},
			summary: {
				'added': 1,
				'removed': 1,
				'quantity-increased': 1,
				'quantity-decreased': 0,
				'identity-changed': 1,
			},
		});
		expect(request.entries).toHaveLength(4);
		expect(request.unmatchedBefore).toHaveLength(1);
		expect(request.unmatchedAfter).toHaveLength(1);
		expect(request.issuesBefore).toHaveLength(1);
		expect(request.issuesAfter).toHaveLength(1);
		expect(JSON.stringify(request)).not.toMatch(/inventoryItemIds|sourceRows|edaModelStatus/);
		expect(parseIFrameBomDiffRequest({
			...request,
			summary: { ...request.summary, added: 2 },
		})).toBeUndefined();
		expect(parseIFrameBomDiffRequest({
			...request,
			entries: request.entries.map((entry, index) => index === 0 ? { ...entry, quantityDelta: 99 } : entry),
		})).toBeUndefined();
		expect(parseIFrameBomDiffRequest({
			...request,
			beforeFileName: 'x'.repeat(501),
		})).toBeUndefined();
		expect(parseIFrameBomDiffEvent({
			protocolVersion: BOM_DIFF_PROTOCOL_VERSION,
			requestId: 'stale',
			status: 'ready',
		}, request.requestId)).toBeUndefined();

		writeEvent(host, request.requestId, { status: 'action', operationId: 'close-1', action: 'close' });
		await settle(pending);
	});

	it('rejects reports beyond the row limit before publishing bridge data', async () => {
		const host = new FakeHost();
		const source = input();
		source.result.entries = Array.from({ length: 20_001 }, () => source.result.entries[0]);
		const pending = new IFrameBomDiffPanel(t, host).open(source, async () => ({ status: 'succeeded' }));

		await expect(pending).rejects.toThrow('20000-row limit');
		expect(host.values.has(BOM_DIFF_REQUEST_KEY)).toBe(false);
	});
});

describe('iframe BOM diff panel', () => {
	it('finishes an active export before settling a native close without writing to the closed IFrame', async () => {
		const host = new FakeHost();
		const outcome = deferred<{ status: 'failed'; message: string }>();
		const handleAction = vi.fn(() => outcome.promise);
		const pending = new IFrameBomDiffPanel(t, host).open(input(), handleAction);
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
		outcome.resolve({ status: 'failed', message: 'save failed' });
		await settle(pending);

		expect(handleAction).toHaveBeenCalledOnce();
		expect(host.write).not.toHaveBeenCalledWith(BOM_DIFF_RESPONSE_KEY, expect.anything());
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
	});

	it('keeps the report open after a failed export and closes only after the explicit close action', async () => {
		const host = new FakeHost();
		const diagnostic = trace();
		const handleAction = vi.fn(async (action: { type: 'close' | 'export-csv' }) => action.type === 'export-csv'
			? { status: 'failed' as const, message: 'save failed' }
			: { status: 'succeeded' as const });
		const pending = new IFrameBomDiffPanel(t, host).open(input(), handleAction, diagnostic);
		const request = await requestFrom(host);
		writeEvent(host, request.requestId, { status: 'ready' });
		writeEvent(host, request.requestId, {
			status: 'action',
			operationId: 'export-failed',
			action: 'export-csv',
		});
		await vi.waitFor(() => expect(host.values.has(BOM_DIFF_RESPONSE_KEY)).toBe(true));
		expect(parseIFrameBomDiffResponse(
			host.values.get(BOM_DIFF_RESPONSE_KEY),
			request.requestId,
			'export-failed',
		)).toMatchObject({ status: 'failed', message: 'save failed' });
		expect(host.close).not.toHaveBeenCalled();
		expect(diagnostic.info).toHaveBeenCalledWith(
			'bom-diff-panel.action.completed',
			{ action: 'export-csv', status: 'failed' },
		);

		writeEvent(host, request.requestId, { status: 'action', operationId: 'close-2', action: 'close' });
		await settle(pending);

		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
		expect(host.values.has(BOM_DIFF_REQUEST_KEY)).toBe(false);
		expect(host.values.has(BOM_DIFF_EVENT_KEY)).toBe(false);
		expect(host.values.has(BOM_DIFF_RESPONSE_KEY)).toBe(false);
	});

	it('keeps the source template self-contained and exposes both paged detail regions and two commands', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/bom-diff/bom-diff.html'), 'utf8');
		expect(html).toMatch(/__BOM_DIFF_INLINE_CSS__/);
		expect(html).toMatch(/__BOM_DIFF_INLINE_JS__/);
		expect(html).toMatch(/id="change-filter"/);
		expect(html).toMatch(/id="diff-pager"/);
		expect(html).toMatch(/id="review-kind"/);
		expect(html).toMatch(/id="review-pager"/);
		expect(html).toMatch(/id="export-csv"/);
		expect(html).toMatch(/id="close"/);
		expect(html).not.toMatch(/<link[^>]+href|<script[^>]+src/i);
	});
});
