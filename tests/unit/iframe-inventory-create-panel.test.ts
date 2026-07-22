import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { InventoryCreateIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-inventory-create-panel';
import type { InventoryCreateLabels } from '../../src/platform/jlceda-v3/presentation/iframe-inventory-create-protocol';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	IFrameInventoryCreatePanel,
	InventoryCreateValidationError,
	normalizeInventoryCreateDraft,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-create-panel';
import {
	INVENTORY_CREATE_EVENT_KEY,
	INVENTORY_CREATE_PROTOCOL_VERSION,
	INVENTORY_CREATE_REQUEST_KEY,
	INVENTORY_CREATE_RESPONSE_KEY,
	parseIFrameInventoryCreateEvent,
	parseIFrameInventoryCreateRequest,
	parseIFrameInventoryCreateResponse,
} from '../../src/platform/jlceda-v3/presentation/iframe-inventory-create-protocol';

const t = ((key: string) => key) as Translate;
const labelKeys = [
	'titleCustom',
	'titleLcsc',
	'identitySection',
	'stockSection',
	'lcscPartNumber',
	'supplierId',
	'name',
	'manufacturer',
	'manufacturerPartNumber',
	'package',
	'description',
	'quantityMode',
	'quantity',
	'minimumQuantity',
	'favorite',
	'exact',
	'estimated',
	'unknown',
	'depleted',
	'primaryCategory',
	'secondaryCategory',
	'unclassified',
	'noSecondaryCategory',
	'location',
	'chooseLocation',
	'datasheet',
	'structuredLocation',
	'locationCabinet',
	'locationBox',
	'locationRow',
	'locationColumn',
	'note',
	'queryEda',
	'openMarketplace',
	'marketplaceConfirmed',
	'queryIdle',
	'queryRunning',
	'queryAvailable',
	'queryMissing',
	'queryFailed',
	'suggestionTitle',
	'currentValue',
	'suggestedValue',
	'useSuggestion',
	'closeSuggestion',
	'duplicateTitle',
	'existingItem',
	'pendingItem',
	'confirmMerge',
	'continueEditing',
	'cancel',
	'save',
	'nameRequired',
	'lcscRequired',
	'lcscInvalid',
	'quantityRequired',
	'quantityInteger',
	'quantityNonNegative',
	'quantityTooLarge',
	'minimumQuantityPositive',
	'datasheetInvalid',
	'loading',
	'connectionError',
	'operationError',
	'emptyValue',
] as const;

const labels = Object.fromEntries(labelKeys.map(key => [key, key])) as InventoryCreateLabels;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class FakeHost implements InventoryCreateIFrameHost {
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

async function readRequest(host: FakeHost) {
	await vi.waitFor(() => expect(host.values.has(INVENTORY_CREATE_REQUEST_KEY)).toBe(true));
	const request = parseIFrameInventoryCreateRequest(host.values.get(INVENTORY_CREATE_REQUEST_KEY));
	if (!request) {
		throw new Error('Expected a valid inventory create request.');
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

function validForm() {
	return {
		lcscPartNumber: 'C233991',
		marketplaceConfirmed: false,
		supplierId: 'C233991',
		name: 'Microphone',
		manufacturer: 'Maker',
		manufacturerPartNumber: 'MPN-1',
		package: 'SMD',
		description: 'Description',
		quantityMode: 'estimated' as const,
		quantity: '12',
		minimumQuantity: '5',
		favorite: true,
		categoryId: 'child',
		location: 'Drawer A',
		datasheetUrl: 'https://example.com/microphone.pdf',
		locationCabinet: 'A',
		locationBox: '1',
		locationRow: '2',
		locationColumn: '3',
		note: 'Note',
	};
}

describe('iframe inventory create protocol', () => {
	it('isolates action responses by request and operation IDs and requires a duplicate token', () => {
		const request = parseIFrameInventoryCreateRequest({
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId: 'request-1',
			mode: 'lcsc',
			labels,
			initial: validForm(),
			categories: [
				{ id: 'root', name: 'Root', sortOrder: 0 },
				{ id: 'child', name: 'Child', parentId: 'root', sortOrder: 0 },
			],
			locationOptions: ['Drawer A'],
		});
		expect(request?.categories).toHaveLength(2);

		const action = {
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'action',
			operationId: 'operation-1',
			action: 'confirm-merge',
			form: validForm(),
			existing: { id: 'item-1', expectedRevision: 2 },
		};
		expect(parseIFrameInventoryCreateEvent(action, 'request-1')).toBeUndefined();
		expect(parseIFrameInventoryCreateEvent({ ...action, duplicateToken: 'opaque-token' }, 'request-1')).toMatchObject({
			status: 'action',
			action: 'confirm-merge',
			duplicateToken: 'opaque-token',
		});

		const duplicate = {
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId: 'request-1',
			operationId: 'operation-1',
			action: 'save',
			stage: 'duplicate',
			existing: {
				id: 'item-1',
				revision: 2,
				identity: { name: 'Existing' },
				quantity: 2,
				precision: 'exact',
				state: 'in-stock',
			},
		};
		expect(parseIFrameInventoryCreateResponse(duplicate, 'request-1', 'operation-1')).toBeUndefined();
		expect(parseIFrameInventoryCreateResponse({ ...duplicate, duplicateToken: 'opaque-token' }, 'request-1', 'operation-1')).toMatchObject({
			stage: 'duplicate',
			duplicateToken: 'opaque-token',
		});
		expect(parseIFrameInventoryCreateResponse({ ...duplicate, duplicateToken: 'opaque-token' }, 'request-1', 'stale')).toBeUndefined();
	});
});

describe('inventory create form markup', () => {
	it('exposes minimum-stock and favorite controls', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/inventory-create/inventory-create.html'), 'utf8');

		expect(html).toContain('id="minimum-quantity"');
		expect(html).toContain('id="favorite"');
		expect(html).toContain('id="datasheet"');
		expect(html).toContain('id="location-cabinet"');
	});
});

describe('iframe inventory create panel', () => {
	it.each([
		{ action: 'save' as const, merged: false },
		{ action: 'confirm-merge' as const, merged: true },
	])('returns saved after an active $action succeeds during a native close', async ({ action, merged }) => {
		const host = new FakeHost();
		const outcome = deferred<{ stage: 'succeeded' }>();
		const handler = vi.fn(() => outcome.promise);
		const pending = new IFrameInventoryCreatePanel(t, host).open({ mode: 'lcsc' }, handler);
		const request = await readRequest(host);
		host.values.set(INVENTORY_CREATE_EVENT_KEY, {
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(INVENTORY_CREATE_EVENT_KEY, {
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'action',
			operationId: `${action}-active`,
			action,
			form: validForm(),
			...(action === 'confirm-merge'
				? { duplicateToken: 'duplicate-token', existing: { id: 'item-existing', expectedRevision: 2 } }
				: {}),
		});
		host.poll();
		await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

		host.onClose();
		expect(host.stopPolling).not.toHaveBeenCalled();
		outcome.resolve({ stage: 'succeeded' });
		const result = await settle(pending);

		expect(result).toMatchObject({ status: 'saved', merged, draft: { quantity: 12 } });
		expect(handler).toHaveBeenCalledOnce();
		expect(host.write).not.toHaveBeenCalledWith(INVENTORY_CREATE_RESPONSE_KEY, expect.anything());
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
	});

	it('keeps the form session open until the IFrame acknowledges a successful save', async () => {
		const host = new FakeHost();
		const handler = vi.fn(async () => ({ stage: 'succeeded' as const }));
		const pending = new IFrameInventoryCreatePanel(t, host).open({
			mode: 'lcsc',
			categories: [
				{ id: 'root', name: ' Root ', sortOrder: 0 },
				{ id: 'child', name: 'Child', parentId: 'root', sortOrder: 0 },
			],
			locationOptions: [' Drawer A ', 'Drawer A'],
		}, handler);
		const request = await readRequest(host);
		expect(request.locationOptions).toEqual(['Drawer A']);

		host.values.set(INVENTORY_CREATE_EVENT_KEY, {
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(INVENTORY_CREATE_EVENT_KEY, {
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'action',
			operationId: 'save-1',
			action: 'save',
			form: validForm(),
		});
		host.poll();
		await vi.waitFor(() => expect(host.values.get(INVENTORY_CREATE_RESPONSE_KEY)).toMatchObject({
			operationId: 'save-1',
			stage: 'succeeded',
		}));
		expect(host.close).not.toHaveBeenCalled();

		host.values.set(INVENTORY_CREATE_EVENT_KEY, {
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'completed',
			operationId: 'save-1',
			action: 'save',
		});
		host.poll();
		await vi.advanceTimersByTimeAsync(500);
		await expect(pending).resolves.toMatchObject({
			status: 'saved',
			merged: false,
			draft: {
				quantity: 12,
				precision: 'estimated',
				state: 'in-stock',
				minimumQuantity: 5,
				favorite: true,
				categoryId: 'child',
				datasheetUrl: 'https://example.com/microphone.pdf',
				structuredLocation: { cabinet: 'A', box: '1', row: '2', column: '3' },
			},
		});
		expect(handler).toHaveBeenCalledTimes(1);
		expect(host.close).toHaveBeenCalledTimes(1);
	});

	it('normalizes unknown and depleted stock without persisting from the panel itself', () => {
		expect(normalizeInventoryCreateDraft({
			...validForm(),
			lcscPartNumber: '',
			quantityMode: 'unknown',
			quantity: '',
		}, 'custom')).toMatchObject({ quantity: null, precision: 'unknown', state: 'in-stock' });
		expect(normalizeInventoryCreateDraft({
			...validForm(),
			quantityMode: 'exact',
			quantity: '0',
		}, 'lcsc')).toMatchObject({ quantity: 0, precision: 'exact', state: 'depleted' });
		expect(() => normalizeInventoryCreateDraft({
			...validForm(),
			quantity: '-2',
		}, 'lcsc')).toThrowError(InventoryCreateValidationError);
		expect(() => normalizeInventoryCreateDraft({
			...validForm(),
			minimumQuantity: '0',
		}, 'lcsc')).toThrowError(InventoryCreateValidationError);
		expect(() => normalizeInventoryCreateDraft({
			...validForm(),
			datasheetUrl: 'file:///tmp/data.pdf',
		}, 'lcsc')).toThrowError(InventoryCreateValidationError);
	});
});
