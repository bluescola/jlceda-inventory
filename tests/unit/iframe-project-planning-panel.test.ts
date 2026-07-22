import type { ProcurementSuggestion } from '../../src/features/project-planning/application/analyze-project-demand';
import type { ProjectDemandSnapshot, PurchaseRecord } from '../../src/features/project-planning/domain/project-planning';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { ProjectPlanningIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-project-planning-panel';
import type { DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import type { ProjectPlanningPanelInput, ProjectPlanningViewState } from '../../src/platform/jlceda-v3/presentation/project-planning-panel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chineseMessagesJson from '../../locales/zh-Hans.json';
import { IFrameProjectPlanningPanel } from '../../src/platform/jlceda-v3/presentation/iframe-project-planning-panel';
import {
	parseIFrameProjectPlanningEvent,
	parseIFrameProjectPlanningRequest,
	parseIFrameProjectPlanningResponse,
	PROJECT_PLANNING_EVENT_KEY,
	PROJECT_PLANNING_PROTOCOL_VERSION,
	PROJECT_PLANNING_REQUEST_KEY,
	PROJECT_PLANNING_RESPONSE_KEY,
} from '../../src/platform/jlceda-v3/presentation/iframe-project-planning-protocol';

const t = ((key: string) => key) as Translate;
const chineseMessages = chineseMessagesJson as Record<string, string>;
const chineseTranslate = ((key: string) => chineseMessages[key] ?? key) as Translate;
const viewState: ProjectPlanningViewState = {
	tab: 'snapshots',
	snapshotPage: 1,
	procurementPage: 1,
	purchasePage: 1,
	pageSize: 25,
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class FakeHost implements ProjectPlanningIFrameHost {
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

function snapshot(id = 'snapshot-1'): ProjectDemandSnapshot {
	return {
		id,
		projectUuid: 'project-uuid-1',
		documentUuid: 'pcb-uuid-1',
		documentKind: 'pcb',
		label: 'Controller board',
		boardQuantity: 3,
		demands: [{
			key: 'lcsc:c1',
			identity: { lcscPartNumber: 'C1', name: 'Resistor' },
			designators: ['R1', 'R2'],
			unitQuantity: 2,
		}],
		sourceFingerprint: 'a'.repeat(64),
		capturedAt: '2026-07-22T01:00:00.000Z',
		revision: 4,
	};
}

function procurement(): ProcurementSuggestion {
	return {
		key: 'lcsc:c1',
		identity: { lcscPartNumber: 'C1', name: 'Resistor', manufacturerPartNumber: 'RC0603', package: '0603' },
		designators: ['R1', 'R2'],
		unitQuantity: 2,
		firstSourceIndex: 0,
		boardQuantity: 1,
		requiredQuantity: 6,
		inventoryItemIds: ['inventory-secret'],
		inventoryState: 'exact',
		availableQuantity: 1,
		shortageQuantity: 5,
		status: 'insufficient',
		suggestedQuantity: 5,
		sources: [{ snapshotId: 'snapshot-1', label: 'Controller board', boardQuantity: 3 }],
	};
}

function purchase(): PurchaseRecord {
	return {
		id: 'purchase-1',
		lcscPartNumber: 'C1',
		name: 'Resistor',
		quantity: 10,
		unitPriceMinor: 25,
		currency: 'CNY',
		platform: 'LCSC',
		productUrl: 'https://item.szlcsc.com/1.html',
		orderNumber: 'ORDER-1',
		purchasedAt: '2026-07-22',
		projectSnapshotIds: ['snapshot-1'],
		note: 'First batch',
		createdAt: '2026-07-22T02:01:00.000Z',
		revision: 2,
	};
}

function input(): ProjectPlanningPanelInput {
	return {
		snapshots: [snapshot()],
		procurement: [procurement()],
		purchases: [purchase()],
		initialState: viewState,
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
	await vi.waitFor(() => expect(host.values.has(PROJECT_PLANNING_REQUEST_KEY)).toBe(true));
	const request = parseIFrameProjectPlanningRequest(host.values.get(PROJECT_PLANNING_REQUEST_KEY));
	if (!request) {
		throw new Error('Expected a valid project planning request.');
	}
	return request;
}

function writeEvent(host: FakeHost, requestId: string, event: Record<string, unknown>): void {
	host.values.set(PROJECT_PLANNING_EVENT_KEY, {
		protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
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

describe('iframe project planning protocol', () => {
	it('publishes bounded display-only rows and verified purchase totals', async () => {
		const host = new FakeHost();
		const pending = new IFrameProjectPlanningPanel(chineseTranslate, host).open(
			input(),
			async () => ({ status: 'succeeded' }),
		);
		const request = await requestFrom(host);

		expect(request).toMatchObject({
			labels: {
				title: '项目需求与采购',
				tabSnapshots: '需求快照',
				addPurchase: '登记采购',
			},
			snapshots: [{
				id: 'snapshot-1',
				projectUuid: 'project-uuid-1',
				documentUuid: 'pcb-uuid-1',
				boardQuantity: 3,
				demandCount: 1,
				revision: 4,
			}],
			procurement: [{ lcscPartNumber: 'C1', requiredQuantity: 6, suggestedQuantity: 5 }],
			purchases: [{ id: 'purchase-1', unitPriceMinor: 25, totalMinor: 250, currency: 'CNY' }],
			costSummaries: [{ currency: 'CNY', recordCount: 1, totalQuantity: 10, totalMinor: 250 }],
		});
		expect(JSON.stringify(request)).not.toMatch(/inventory-secret|inventoryItemIds|sourceFingerprint|designators/);
		expect(parseIFrameProjectPlanningRequest({
			...request,
			purchases: [{ ...request.purchases[0], totalMinor: 251 }],
		})).toBeUndefined();
		expect(parseIFrameProjectPlanningRequest({
			...request,
			costSummaries: [{ ...request.costSummaries[0], totalMinor: 251 }],
		})).toBeUndefined();

		writeEvent(host, request.requestId, {
			status: 'operation',
			operationId: 'close-1',
			intent: { type: 'close', viewState },
		});
		await settle(pending);
	});

	it('accepts complete revision-checked intents and rejects unconfirmed mutations', () => {
		const base = {
			protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'operation',
			operationId: 'operation-1',
		};
		const setBoardQuantity = {
			...base,
			intent: {
				type: 'set-board-quantity',
				snapshot: {
					id: 'snapshot-1',
					expectedRevision: 4,
					projectUuid: 'project-uuid-1',
					documentUuid: 'pcb-uuid-1',
				},
				boardQuantity: 8,
				confirmed: true,
				viewState,
			},
		};
		expect(parseIFrameProjectPlanningEvent(setBoardQuantity, 'request-1')).toEqual(setBoardQuantity);
		expect(parseIFrameProjectPlanningEvent({
			...setBoardQuantity,
			intent: { ...setBoardQuantity.intent, confirmed: false },
		}, 'request-1')).toBeUndefined();
		expect(parseIFrameProjectPlanningEvent({
			...base,
			intent: {
				type: 'remove-purchase',
				purchase: { id: 'purchase-1', expectedRevision: 2, projectSnapshotIds: ['snapshot-1'] },
				confirmed: true,
				viewState,
			},
		}, 'request-1')).toBeDefined();
		expect(parseIFrameProjectPlanningEvent({
			...base,
			intent: {
				type: 'add-purchase',
				draft: {
					lcscPartNumber: 'C1',
					name: 'Resistor',
					quantity: 10,
					unitPriceMinor: 25,
					currency: 'CNY',
					purchasedAt: '2026-07-22',
					projectSnapshotIds: ['snapshot-1'],
				},
				viewState,
			},
		}, 'request-1')).toBeDefined();
		expect(parseIFrameProjectPlanningEvent({
			...base,
			intent: {
				type: 'add-purchase',
				draft: {
					name: 'Resistor',
					quantity: 10,
					unitPriceMinor: 25,
					currency: 'RMB',
					productUrl: 'javascript:alert(1)',
					purchasedAt: '2026-07-22',
					projectSnapshotIds: [],
				},
				viewState,
			},
		}, 'request-1')).toBeUndefined();
	});
});

describe('iframe project planning panel', () => {
	it('finishes an active refresh before settling a native close without writing to the closed IFrame', async () => {
		const host = new FakeHost();
		const outcome = deferred<{ status: 'succeeded' }>();
		const handleOperation = vi.fn(() => outcome.promise);
		const pending = new IFrameProjectPlanningPanel(t, host).open(input(), handleOperation);
		const request = await requestFrom(host);
		writeEvent(host, request.requestId, { status: 'ready' });
		writeEvent(host, request.requestId, {
			status: 'operation',
			operationId: 'refresh-active',
			intent: { type: 'refresh', viewState },
		});
		await vi.waitFor(() => expect(handleOperation).toHaveBeenCalledWith({
			operationId: 'refresh-active',
			intent: { type: 'refresh', viewState },
		}));

		host.onClose();
		expect(host.stopPolling).not.toHaveBeenCalled();
		outcome.resolve({ status: 'succeeded' });
		await settle(pending);

		expect(handleOperation).toHaveBeenCalledOnce();
		expect(host.write).not.toHaveBeenCalledWith(PROJECT_PLANNING_RESPONSE_KEY, expect.anything());
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
	});

	it('keeps the session open across operations, returns refreshed snapshots and closes explicitly', async () => {
		const host = new FakeHost();
		const diagnostic = trace();
		const refreshed = { ...input(), snapshots: [{ ...snapshot(), boardQuantity: 6, revision: 5 }] };
		const handleOperation = vi.fn(async (operation: { intent: { type: string } }) => {
			if (operation.intent.type === 'set-board-quantity') {
				return { status: 'succeeded' as const, message: 'updated', snapshot: refreshed };
			}
			return { status: 'succeeded' as const };
		});
		const panel = new IFrameProjectPlanningPanel(t, host);
		const pending = panel.open(input(), handleOperation, diagnostic);
		const request = await requestFrom(host);
		writeEvent(host, request.requestId, { status: 'ready' });
		writeEvent(host, request.requestId, {
			status: 'operation',
			operationId: 'set-board-1',
			intent: {
				type: 'set-board-quantity',
				snapshot: {
					id: 'snapshot-1',
					expectedRevision: 4,
					projectUuid: 'project-uuid-1',
					documentUuid: 'pcb-uuid-1',
				},
				boardQuantity: 6,
				confirmed: true,
				viewState,
			},
		});
		await vi.waitFor(() => expect(host.values.has(PROJECT_PLANNING_RESPONSE_KEY)).toBe(true));
		expect(parseIFrameProjectPlanningResponse(
			host.values.get(PROJECT_PLANNING_RESPONSE_KEY),
			request.requestId,
			'set-board-1',
		)).toMatchObject({
			result: {
				status: 'succeeded',
				message: 'updated',
				snapshot: { snapshots: [{ boardQuantity: 6, revision: 5 }] },
			},
		});
		expect(host.close).not.toHaveBeenCalled();

		writeEvent(host, request.requestId, {
			status: 'operation',
			operationId: 'close-2',
			intent: { type: 'close', viewState: { ...viewState, tab: 'procurement' } },
		});
		await settle(pending);

		expect(handleOperation).toHaveBeenCalledTimes(2);
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
		expect(host.values.has(PROJECT_PLANNING_REQUEST_KEY)).toBe(false);
		expect(host.values.has(PROJECT_PLANNING_EVENT_KEY)).toBe(false);
		expect(host.values.has(PROJECT_PLANNING_RESPONSE_KEY)).toBe(false);
	});

	it('shows the existing long-running session when the panel is opened again', async () => {
		const host = new FakeHost();
		const panel = new IFrameProjectPlanningPanel(t, host);
		const pending = panel.open(input(), async () => ({ status: 'succeeded' }));
		const request = await requestFrom(host);
		writeEvent(host, request.requestId, { status: 'ready' });

		await panel.open(input(), async () => ({ status: 'succeeded' }));

		expect(host.show).toHaveBeenCalledOnce();
		writeEvent(host, request.requestId, {
			status: 'operation',
			operationId: 'close-existing',
			intent: { type: 'close', viewState },
		});
		await settle(pending);
	});

	it('keeps the source template self-contained and exposes tabs, paging, forms and confirmations', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/project-planning/project-planning.html'), 'utf8');
		expect(html).toMatch(/__PROJECT_PLANNING_INLINE_CSS__/);
		expect(html).toMatch(/__PROJECT_PLANNING_INLINE_JS__/);
		expect(html).toMatch(/id="tab-snapshots"/);
		expect(html).toMatch(/id="tab-procurement"/);
		expect(html).toMatch(/id="tab-purchases"/);
		expect(html).toMatch(/id="snapshot-pager"/);
		expect(html).toMatch(/id="procurement-pager"/);
		expect(html).toMatch(/id="purchase-pager"/);
		expect(html).toMatch(/id="purchase-form"/);
		expect(html).toMatch(/id="dialog-backdrop"/);
		expect(html).not.toMatch(/<link[^>]+href|<script[^>]+src/i);
	});
});
