import type { Translate } from '../eda/i18n-client';
import type { DiagnosticTrace } from './native-diagnostics';
import type { ProductDetailsDraft, ProductDetailsForm, ProductDetailsFormRequest } from './product-details-form';
import type { ProductDetailsField, ProductDetailsFormState } from './product-details-form-session';
import {
	createIFrameProductDetailsRequest,
	parseIFrameProductDetailsResult,
	PRODUCT_DETAILS_IFRAME_ID,
	PRODUCT_DETAILS_IFRAME_PATH,
	PRODUCT_DETAILS_REQUEST_KEY,
	PRODUCT_DETAILS_RESULT_KEY,
} from './iframe-product-details-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';
import { ProductDetailsFormUnavailableError } from './product-details-form';
import { ProductDetailsFormSession } from './product-details-form-session';

const FORM_WIDTH = 720;
const FORM_HEIGHT = 560;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;
const FORM_FIELDS: ProductDetailsField[] = [
	'name',
	'manufacturer',
	'manufacturerPartNumber',
	'package',
	'description',
];

interface IFrameOpenOptions {
	title: string;
	onClose: () => void;
}

export interface ProductDetailsIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

type BridgeOutcome
	= | { status: 'cancelled' }
		| { status: 'submitted'; value: ProductDetailsFormState }
		| { status: 'failed'; error: unknown; ready: boolean };

export class IFrameProductDetailsForm implements ProductDetailsForm {
	private queue: Promise<void> = Promise.resolve();

	public constructor(
		private readonly t: Translate,
		private readonly host: ProductDetailsIFrameHost = new EdaProductDetailsIFrameHost(),
	) {}

	public open(request: ProductDetailsFormRequest, trace?: DiagnosticTrace): Promise<ProductDetailsDraft | undefined> {
		const operation = this.queue.then(() => this.openExclusive(request, trace));
		this.queue = operation.then(() => undefined, () => undefined);
		return operation;
	}

	private async openExclusive(request: ProductDetailsFormRequest, trace?: DiagnosticTrace): Promise<ProductDetailsDraft | undefined> {
		const requestId = createRequestId();
		const timerId = `${PRODUCT_DETAILS_IFRAME_ID}.${requestId}`;
		const initial = createInitialState(request.initial);
		const title = this.t(request.marketplaceConfirmed ? 'marketplace.productDetails' : 'marketplace.customDetails');
		const bridgeRequest = createIFrameProductDetailsRequest(requestId, request.partNumber, initial, {
			title,
			lcsc: this.t('part.lcscLabel'),
			name: this.t('part.nameLabel'),
			manufacturer: this.t('part.manufacturerLabel'),
			manufacturerPartNumber: this.t('part.manufacturerPartLabel'),
			package: this.t('part.packageLabel'),
			description: this.t('part.descriptionLabel'),
			cancel: this.t('dialog.cancel'),
			confirm: this.t('dialog.confirm'),
			loading: this.t('productForm.loading'),
			nameRequired: this.t(request.marketplaceConfirmed ? 'marketplace.nameRequired' : 'part.inputRequired'),
			connectionError: this.t('productForm.connectionError'),
			saveError: this.t('productForm.saveError'),
		});
		let pollStarted = false;
		let opened = false;
		let ready = false;
		let settled = false;
		const observedStages = new Set<string>();
		let settleOutcome: (outcome: BridgeOutcome) => void = () => undefined;
		const outcomePromise = new Promise<BridgeOutcome>((resolve) => {
			settleOutcome = (outcome) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(outcome);
			};
		});
		const readResult = (): void => {
			try {
				const result = parseIFrameProductDetailsResult(this.host.read(PRODUCT_DETAILS_RESULT_KEY), requestId);
				if (!result) {
					return;
				}
				if (result.status === 'progress') {
					if (!observedStages.has(result.stage)) {
						observedStages.add(result.stage);
						trace?.info('product-form.iframe.stage', { stage: result.stage });
					}
					return;
				}
				if (result.status === 'failed') {
					trace?.error('product-form.iframe.bridge.error', {
						error: result.error,
						errorName: result.errorName,
						stage: result.stage,
					});
					settleOutcome({
						status: 'failed',
						error: new Error(result.error, { cause: result.errorName }),
						ready,
					});
					return;
				}
				if (result.status === 'ready') {
					if (!ready) {
						ready = true;
						trace?.info('product-form.iframe.bridge.ready');
					}
					return;
				}
				settleOutcome(result.status === 'submitted'
					? { status: 'submitted', value: result.value }
					: { status: 'cancelled' });
			}
			catch (error) {
				settleOutcome({ status: 'failed', error, ready });
			}
		};
		let readyDeadline: number | undefined;
		const poll = (): void => {
			readResult();
			if (!settled && !ready && readyDeadline !== undefined && Date.now() >= readyDeadline) {
				settleOutcome({ status: 'failed', error: new Error('IFrame form did not become ready.'), ready: false });
			}
		};

		try {
			await this.removeBridgeValue(PRODUCT_DETAILS_RESULT_KEY, trace);
			const stored = await this.host.write(PRODUCT_DETAILS_REQUEST_KEY, bridgeRequest);
			if (!stored) {
				throw new ProductDetailsFormUnavailableError('init-failed', {
					cause: new Error('The host rejected the IFrame form request.'),
				});
			}
			trace?.info('product-form.iframe.request.stored');

			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted) {
				throw new ProductDetailsFormUnavailableError('api-missing', {
					cause: new Error('The host timer API is unavailable.'),
				});
			}
			trace?.info('product-form.iframe.open.request', {
				height: FORM_HEIGHT,
				iframeId: PRODUCT_DETAILS_IFRAME_ID,
				path: PRODUCT_DETAILS_IFRAME_PATH,
				stage: 'openIFrame',
				width: FORM_WIDTH,
			});
			try {
				opened = await this.host.open({
					title,
					onClose: () => {
						// A submit writes storage before closing. Read once before treating the
						// title-bar close as cancellation so that fast closes cannot lose data.
						readResult();
						settleOutcome({ status: 'cancelled' });
					},
				});
				trace?.info('product-form.iframe.open.return', {
					opened,
					returnedType: typeof opened,
					stage: 'openIFrame',
				});
			}
			catch (error) {
				trace?.error('product-form.iframe.open.error', {
					error: errorMessage(error),
					errorName: errorName(error),
					stage: 'openIFrame',
				});
				throw error;
			}
			if (!opened) {
				throw new ProductDetailsFormUnavailableError('init-failed', {
					cause: new Error('The host rejected the IFrame window request.'),
				});
			}
			trace?.info('product-form.iframe.opened');
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			poll();

			const outcome = await outcomePromise;
			trace?.info('product-form.iframe.response', { status: outcome.status });
			if (outcome.status === 'failed') {
				if (outcome.ready) {
					throw new Error('The active IFrame form bridge failed.', { cause: outcome.error });
				}
				throw new ProductDetailsFormUnavailableError('render-failed', { cause: outcome.error });
			}
			if (outcome.status === 'cancelled') {
				trace?.info('product-form.cancelled', {
					...new ProductDetailsFormSession(initial).summary('iframe'),
				});
				return undefined;
			}
			return this.submit(outcome.value, initial, trace);
		}
		catch (error) {
			if (error instanceof ProductDetailsFormUnavailableError) {
				throw error;
			}
			if (ready) {
				throw error;
			}
			throw new ProductDetailsFormUnavailableError('init-failed', { cause: error });
		}
		finally {
			if (pollStarted) {
				this.host.stopPolling(timerId);
			}
			await this.removeBridgeValue(PRODUCT_DETAILS_REQUEST_KEY, trace);
			await this.removeBridgeValue(PRODUCT_DETAILS_RESULT_KEY, trace);
			if (opened) {
				try {
					const closed = await this.host.close();
					trace?.info('product-form.iframe.closed', { status: closed ? 'closed' : 'already-closed' });
				}
				catch (error) {
					trace?.warn('product-form.iframe.close.failed', { error: errorMessage(error) });
				}
			}
			await delay(DIALOG_SETTLE_DELAY_MS);
		}
	}

	private submit(value: ProductDetailsFormState, initial: ProductDetailsFormState, trace?: DiagnosticTrace): ProductDetailsDraft | undefined {
		const session = new ProductDetailsFormSession(initial);
		for (const field of FORM_FIELDS) {
			if (value[field] === initial[field]) {
				continue;
			}
			const diagnostic = session.applyChange(field, value[field]);
			session.recordFieldChange(trace, diagnostic);
		}
		const result = session.submit('iframe');
		session.recordSubmit(trace, result);
		return result.ok ? result.value : undefined;
	}

	private async removeBridgeValue(key: string, trace?: DiagnosticTrace): Promise<void> {
		try {
			await this.host.remove(key);
		}
		catch (error) {
			trace?.warn('product-form.iframe.cleanup.failed', { error: errorMessage(error) });
		}
	}
}

class EdaProductDetailsIFrameHost implements ProductDetailsIFrameHost {
	public read(key: string): unknown {
		return eda.sys_Storage.getExtensionUserConfig(key);
	}

	public write(key: string, value: unknown): Promise<boolean> {
		return eda.sys_Storage.setExtensionUserConfig(key, value);
	}

	public remove(key: string): Promise<boolean> {
		return eda.sys_Storage.deleteExtensionUserConfig(key);
	}

	public open(options: IFrameOpenOptions): Promise<boolean> {
		if (typeof eda.sys_IFrame?.openIFrame !== 'function') {
			throw new ProductDetailsFormUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(
			PRODUCT_DETAILS_IFRAME_PATH,
			FORM_WIDTH,
			FORM_HEIGHT,
			PRODUCT_DETAILS_IFRAME_ID,
			{
				grayscaleMask: true,
				title: options.title,
				buttonCallbackFn: button => button === 'close' ? options.onClose() : undefined,
			},
		);
	}

	public close(): Promise<boolean> {
		return eda.sys_IFrame.closeIFrame(PRODUCT_DETAILS_IFRAME_ID);
	}

	public startPolling(id: string, intervalMs: number, callback: () => void): boolean {
		if (typeof eda.sys_Timer?.setIntervalTimer !== 'function') {
			return false;
		}
		return eda.sys_Timer.setIntervalTimer(id, intervalMs, callback);
	}

	public stopPolling(id: string): boolean {
		return eda.sys_Timer.clearIntervalTimer(id);
	}
}

function createInitialState(initial?: Partial<ProductDetailsDraft>): ProductDetailsFormState {
	return {
		name: initial?.name ?? '',
		manufacturer: initial?.manufacturer ?? '',
		manufacturerPartNumber: initial?.manufacturerPartNumber ?? '',
		package: initial?.package ?? '',
		description: initial?.description ?? '',
	};
}

function createRequestId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
		return error.message;
	}
	return String(error);
}

function errorName(error: unknown): string {
	if (error instanceof Error) {
		return error.name;
	}
	if (error && typeof error === 'object' && 'name' in error && typeof error.name === 'string') {
		return error.name;
	}
	return typeof error;
}
