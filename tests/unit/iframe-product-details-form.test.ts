import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { ProductDetailsIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-product-details-form';
import type { DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import type { ProductDetailsForm, SequentialProductDetailsForm } from '../../src/platform/jlceda-v3/presentation/product-details-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IFrameProductDetailsForm } from '../../src/platform/jlceda-v3/presentation/iframe-product-details-form';
import {
	createIFrameProductDetailsRequest,
	parseIFrameProductDetailsRequest,
	parseIFrameProductDetailsResult,
	PRODUCT_DETAILS_PROTOCOL_VERSION,
	PRODUCT_DETAILS_REQUEST_KEY,
	PRODUCT_DETAILS_RESULT_KEY,
} from '../../src/platform/jlceda-v3/presentation/iframe-product-details-protocol';
import { FallbackProductDetailsForm } from '../../src/platform/jlceda-v3/presentation/product-details-form';

const request = {
	partNumber: 'C233991',
	marketplaceConfirmed: true,
	initial: {
		name: 'Old name',
		manufacturer: 'Old maker',
	},
};

const t = ((key: string) => key) as Translate;

class FakeIFrameHost implements ProductDetailsIFrameHost {
	public readonly values = new Map<string, unknown>();
	public readonly write = vi.fn(async (key: string, value: unknown) => {
		this.values.set(key, value);
		return true;
	});

	public readonly remove = vi.fn(async (key: string) => this.values.delete(key));
	public readonly close = vi.fn(async () => true);
	public readonly stopPolling = vi.fn(() => true);
	public readonly startPolling = vi.fn((_id: string, _intervalMs: number, callback: () => void) => {
		this.poll = callback;
		return true;
	});

	public readonly open = vi.fn(async (options: { title: string; onClose: () => void }) => {
		this.onClose = options.onClose;
		if (this.openError) {
			throw this.openError;
		}
		return this.openResult;
	});

	public openError?: Error;
	public openResult = true;
	public poll: () => void = () => undefined;
	public onClose: () => void = () => undefined;

	public read(key: string): unknown {
		return this.values.get(key);
	}
}

function createTrace(): DiagnosticTrace {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		waitFor: vi.fn(async (_step: string, operation: () => Promise<unknown>) => operation()),
	} as unknown as DiagnosticTrace;
}

async function waitForRequest(host: FakeIFrameHost): Promise<ReturnType<typeof parseIFrameProductDetailsRequest>> {
	await vi.waitFor(() => expect(host.values.has(PRODUCT_DETAILS_REQUEST_KEY)).toBe(true));
	return parseIFrameProductDetailsRequest(host.values.get(PRODUCT_DETAILS_REQUEST_KEY));
}

async function settleForm<T>(promise: Promise<T>): Promise<T> {
	await vi.advanceTimersByTimeAsync(500);
	return promise;
}

describe('iframe product details protocol', () => {
	it('round-trips a valid localized request and rejects stale or malformed results', () => {
		const initial = {
			name: 'Microphone',
			manufacturer: 'INGHAi',
			manufacturerPartNumber: 'GMI9745',
			package: 'SMD',
			description: 'Electret microphone',
		};
		const labels = {
			title: 'Product details',
			lcsc: 'LCSC part number',
			name: 'Name',
			manufacturer: 'Manufacturer',
			manufacturerPartNumber: 'Manufacturer part number',
			package: 'Package',
			description: 'Description',
			cancel: 'Cancel',
			confirm: 'Confirm',
			loading: 'Loading form...',
			nameRequired: 'Name is required',
			connectionError: 'Connection failed',
			saveError: 'Save failed',
		};
		const value = createIFrameProductDetailsRequest('request-1', 'C233991', initial, labels);

		expect(parseIFrameProductDetailsRequest(value)).toEqual(value);
		expect(parseIFrameProductDetailsRequest({ ...value, protocolVersion: 1 })).toBeUndefined();
		expect(parseIFrameProductDetailsResult({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'submitted',
			value: initial,
		}, 'request-1')).toEqual({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'submitted',
			value: initial,
		});
		expect(parseIFrameProductDetailsResult({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: 'stale-request',
			status: 'cancelled',
		}, 'request-1')).toBeUndefined();
		expect(parseIFrameProductDetailsResult({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'submitted',
			value: { name: 42 },
		}, 'request-1')).toBeUndefined();
		expect(parseIFrameProductDetailsResult({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'progress',
			stage: 'script-started',
		}, 'request-1')).toEqual({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'progress',
			stage: 'script-started',
		});
		expect(parseIFrameProductDetailsResult({
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: 'request-1',
			status: 'failed',
			stage: 'not-a-stage',
			errorName: 'Error',
			error: 'Failed',
		}, 'request-1')).toBeUndefined();
	});
});

describe('iframeProductDetailsForm', () => {
	beforeEach(() => vi.useFakeTimers());

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it('opens one localized form, returns all submitted fields, and removes bridge data', async () => {
		const host = new FakeIFrameHost();
		const trace = createTrace();
		const openPromise = new IFrameProductDetailsForm(t, host).open(request, trace);
		const bridgeRequest = await waitForRequest(host);
		expect(bridgeRequest).toMatchObject({
			partNumber: 'C233991',
			initial: {
				name: 'Old name',
				manufacturer: 'Old maker',
				manufacturerPartNumber: '',
				package: '',
				description: '',
			},
			labels: {
				title: 'marketplace.productDetails',
				name: 'part.nameLabel',
				loading: 'productForm.loading',
			},
		});
		if (!bridgeRequest) {
			throw new Error('Expected a bridge request.');
		}
		host.values.set(PRODUCT_DETAILS_RESULT_KEY, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: bridgeRequest.requestId,
			status: 'progress',
			stage: 'form-rendered',
		});
		host.poll();
		host.values.set(PRODUCT_DETAILS_RESULT_KEY, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: bridgeRequest.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(PRODUCT_DETAILS_RESULT_KEY, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: bridgeRequest.requestId,
			status: 'submitted',
			value: {
				name: ' Microphone ',
				manufacturer: ' INGHAi ',
				manufacturerPartNumber: ' GMI9745 ',
				package: ' SMD ',
				description: ' Electret microphone ',
			},
		});
		host.poll();

		expect(await settleForm(openPromise)).toEqual({
			name: 'Microphone',
			manufacturer: 'INGHAi',
			manufacturerPartNumber: 'GMI9745',
			package: 'SMD',
			description: 'Electret microphone',
		});
		expect(host.open).toHaveBeenCalledWith(expect.objectContaining({ title: 'marketplace.productDetails' }));
		expect(host.stopPolling).toHaveBeenCalledTimes(1);
		expect(host.close).toHaveBeenCalledTimes(1);
		expect(host.values.has(PRODUCT_DETAILS_REQUEST_KEY)).toBe(false);
		expect(host.values.has(PRODUCT_DETAILS_RESULT_KEY)).toBe(false);
		expect(trace.info).toHaveBeenCalledWith('product-form.iframe.bridge.ready');
		expect(trace.info).toHaveBeenCalledWith('product-form.iframe.stage', { stage: 'form-rendered' });
		expect(trace.info).toHaveBeenCalledWith('product-form.iframe.open.request', {
			height: 560,
			iframeId: 'jlceda-inventory-product-details',
			path: '/iframe/product-details.html',
			stage: 'openIFrame',
			width: 720,
		});
		expect(trace.info).toHaveBeenCalledWith('product-form.iframe.open.return', {
			opened: true,
			returnedType: 'boolean',
			stage: 'openIFrame',
		});
		expect(trace.info).toHaveBeenCalledWith('product-form.submitted', expect.objectContaining({
			status: 'iframe',
			changedFields: 5,
		}));

		const diagnostics = JSON.stringify(vi.mocked(trace.info).mock.calls);
		expect(diagnostics).not.toMatch(/C233991|Old name|Old maker|Microphone|INGHAi|GMI9745|Electret/);
	});

	it('treats the title-bar close as cancellation without starting fallback', async () => {
		const host = new FakeIFrameHost();
		const trace = createTrace();
		const fallback = { open: vi.fn() } as unknown as ProductDetailsForm;
		const form = new FallbackProductDetailsForm(new IFrameProductDetailsForm(t, host), fallback);
		const openPromise = form.open(request, trace);
		await waitForRequest(host);
		host.onClose();

		expect(await settleForm(openPromise)).toBeUndefined();
		expect(fallback.open).not.toHaveBeenCalled();
		expect(trace.info).toHaveBeenCalledWith('product-form.iframe.response', { status: 'cancelled' });
	});

	it('falls back when the host rejects opening the IFrame window', async () => {
		const host = new FakeIFrameHost();
		host.openResult = false;
		const trace = createTrace();
		const fallback = {
			open: vi.fn().mockResolvedValue({ name: 'Fallback part' }),
		} as unknown as SequentialProductDetailsForm;
		const form = new FallbackProductDetailsForm(new IFrameProductDetailsForm(t, host), fallback);
		const openPromise = form.open(request, trace);
		await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1));

		expect(await settleForm(openPromise)).toEqual({ name: 'Fallback part' });
		expect(fallback.open).toHaveBeenCalledWith(request, trace);
		expect(trace.info).toHaveBeenCalledWith('product-form.iframe.open.return', {
			opened: false,
			returnedType: 'boolean',
			stage: 'openIFrame',
		});
		expect(trace.error).not.toHaveBeenCalledWith('product-form.iframe.open.error', expect.anything());
		expect(trace.warn).toHaveBeenCalledWith('product-form.primary.unavailable', { status: 'init-failed' });
	});

	it('records an IFrame bootstrap failure and immediately starts fallback', async () => {
		const host = new FakeIFrameHost();
		const trace = createTrace();
		const fallback = {
			open: vi.fn().mockResolvedValue({ name: 'Fallback part' }),
		} as unknown as SequentialProductDetailsForm;
		const form = new FallbackProductDetailsForm(new IFrameProductDetailsForm(t, host), fallback);
		const openPromise = form.open(request, trace);
		const bridgeRequest = await waitForRequest(host);
		if (!bridgeRequest) {
			throw new Error('Expected a bridge request.');
		}
		host.values.set(PRODUCT_DETAILS_RESULT_KEY, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: bridgeRequest.requestId,
			status: 'failed',
			stage: 'request-read',
			errorName: 'TypeError',
			error: 'Unable to render fields',
		});
		host.poll();

		expect(await settleForm(openPromise)).toEqual({ name: 'Fallback part' });
		expect(trace.error).toHaveBeenCalledWith('product-form.iframe.bridge.error', {
			error: 'Unable to render fields',
			errorName: 'TypeError',
			stage: 'request-read',
		});
		expect(trace.warn).toHaveBeenCalledWith('product-form.primary.unavailable', { status: 'render-failed' });
		const diagnostics = JSON.stringify(vi.mocked(trace.error).mock.calls);
		expect(diagnostics).not.toMatch(/C233991|Old name|Old maker/);
	});

	it('records the original openIFrame exception before starting fallback', async () => {
		const host = new FakeIFrameHost();
		host.openError = new TypeError('IFrame asset was not found');
		const trace = createTrace();
		const fallback = {
			open: vi.fn().mockResolvedValue({ name: 'Fallback part' }),
		} as unknown as SequentialProductDetailsForm;
		const form = new FallbackProductDetailsForm(new IFrameProductDetailsForm(t, host), fallback);
		const openPromise = form.open(request, trace);
		await vi.waitFor(() => expect(host.open).toHaveBeenCalledTimes(1));

		expect(await settleForm(openPromise)).toEqual({ name: 'Fallback part' });
		expect(trace.error).toHaveBeenCalledWith('product-form.iframe.open.error', {
			error: 'IFrame asset was not found',
			errorName: 'TypeError',
			stage: 'openIFrame',
		});
		expect(trace.info).not.toHaveBeenCalledWith('product-form.iframe.open.return', expect.anything());
		expect(trace.warn).toHaveBeenCalledWith('product-form.primary.unavailable', { status: 'init-failed' });
	});

	it('serializes concurrent forms so their fixed bridge keys cannot overwrite each other', async () => {
		const host = new FakeIFrameHost();
		const form = new IFrameProductDetailsForm(t, host);
		const first = form.open(request);
		const firstRequest = await waitForRequest(host);
		const second = form.open({ ...request, partNumber: 'C25804' });
		await Promise.resolve();
		expect(host.open).toHaveBeenCalledTimes(1);
		if (!firstRequest) {
			throw new Error('Expected the first bridge request.');
		}
		host.values.set(PRODUCT_DETAILS_RESULT_KEY, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: firstRequest.requestId,
			status: 'cancelled',
		});
		host.poll();
		await settleForm(first);
		const secondRequest = await waitForRequest(host);
		expect(secondRequest?.partNumber).toBe('C25804');
		if (!secondRequest) {
			throw new Error('Expected the second bridge request.');
		}
		host.values.set(PRODUCT_DETAILS_RESULT_KEY, {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: secondRequest.requestId,
			status: 'cancelled',
		});
		host.poll();
		expect(await settleForm(second)).toBeUndefined();
	});
});
