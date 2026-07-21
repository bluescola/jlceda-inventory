import type { Translate } from '../eda/i18n-client';
import type {
	IFrameOrderImportRequest,
	IFrameOrderImportResponse,
	OrderImportLabels,
} from './iframe-order-import-protocol';
import type { DiagnosticTrace } from './native-diagnostics';
import type {
	OrderImportPanel,
	OrderImportPanelAction,
	OrderImportPanelActionHandler,
	OrderImportPanelInput,
	OrderImportPanelProgress,
} from './order-import-panel';
import {
	createOrderImportRequest,
	ORDER_IMPORT_EVENT_KEY,
	ORDER_IMPORT_IFRAME_ID,
	ORDER_IMPORT_IFRAME_PATH,
	ORDER_IMPORT_PROTOCOL_VERSION,
	ORDER_IMPORT_REQUEST_KEY,
	ORDER_IMPORT_RESPONSE_KEY,
	orderImportOutcomeResponse,
	parseIFrameOrderImportEvent,
	parseIFrameOrderImportResponse,
} from './iframe-order-import-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 1060;
const PANEL_HEIGHT = 760;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions {
	title: string;
	onClose: () => void;
}

export interface OrderImportIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

export class OrderImportPanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`Order import panel unavailable: ${status}`, options);
		this.name = 'OrderImportPanelUnavailableError';
	}
}

type PanelResult = 'cancelled' | 'completed' | { error: unknown; ready: boolean };

export class IFrameOrderImportPanel implements OrderImportPanel {
	private queue: Promise<void> = Promise.resolve();

	public constructor(
		private readonly t: Translate,
		private readonly host: OrderImportIFrameHost = new EdaOrderImportIFrameHost(),
	) {}

	public open(
		input: OrderImportPanelInput,
		handleAction: OrderImportPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<'cancelled' | 'completed'> {
		return this.enqueue(() => this.openExclusive(
			createOrderImportRequest(createRequestId(), this.labels(), input),
			handleAction,
			trace,
		));
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async openExclusive(
		request: IFrameOrderImportRequest,
		handleAction: OrderImportPanelActionHandler,
		trace?: DiagnosticTrace,
	): Promise<'cancelled' | 'completed'> {
		const timerId = `${ORDER_IMPORT_IFRAME_ID}.${request.requestId}`;
		const processedOperations = new Set<string>();
		let opened = false;
		let pollStarted = false;
		let ready = false;
		let completed = false;
		let closeRequested = false;
		let settled = false;
		let activeActionPromise: Promise<void> | undefined;
		let readyDeadline: number | undefined;
		let resolveResult: (result: PanelResult) => void = () => undefined;
		const resultPromise = new Promise<PanelResult>((resolve) => {
			resolveResult = (result) => {
				if (!settled) {
					settled = true;
					resolve(result);
				}
			};
		});
		const processAction = async (action: OrderImportPanelAction): Promise<void> => {
			let sequence = 0;
			let responseQueue = Promise.resolve();
			const writeResponse = (response: IFrameOrderImportResponse): Promise<void> => {
				responseQueue = responseQueue.then(async () => {
					if (!settled && !await this.host.write(ORDER_IMPORT_RESPONSE_KEY, response)) {
						throw new Error('The host rejected the order import response.');
					}
				});
				return responseQueue;
			};
			const reportProgress = async (progress: OrderImportPanelProgress): Promise<void> => {
				sequence += 1;
				const response: IFrameOrderImportResponse = {
					protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
					requestId: request.requestId,
					operationId: action.operationId,
					sequence,
					stage: 'progress',
					progress,
				};
				if (!parseIFrameOrderImportResponse(response, request.requestId, action.operationId)) {
					throw new TypeError('Invalid order import progress response.');
				}
				await writeResponse(response);
			};
			trace?.info('order-import-panel.action.started', { action: action.type });
			try {
				const outcome = await handleAction(action, reportProgress);
				sequence += 1;
				const response = orderImportOutcomeResponse(request.requestId, action.operationId, sequence, outcome);
				if (!parseIFrameOrderImportResponse(response, request.requestId, action.operationId)) {
					throw new TypeError('Invalid order import action response.');
				}
				await writeResponse(response);
				completed = outcome.stage === 'completed' || completed;
				trace?.info('order-import-panel.action.completed', { action: action.type, stage: outcome.stage });
			}
			catch (error) {
				trace?.error('order-import-panel.action.failed', { action: action.type, errorName: errorName(error) });
				sequence += 1;
				await this.host.write(ORDER_IMPORT_RESPONSE_KEY, {
					protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
					requestId: request.requestId,
					operationId: action.operationId,
					sequence,
					stage: 'failed',
					message: request.labels.operationError,
				} satisfies IFrameOrderImportResponse);
			}
		};
		const readEvent = (): void => {
			try {
				const event = parseIFrameOrderImportEvent(this.host.read(ORDER_IMPORT_EVENT_KEY), request.requestId);
				if (!event) {
					return;
				}
				if (event.status === 'ready') {
					ready = true;
					return;
				}
				if (event.status === 'progress') {
					trace?.info('order-import-panel.iframe.stage', { stage: event.stage });
					return;
				}
				if (event.status === 'failed') {
					resolveResult({ error: new Error('The order import IFrame failed.'), ready });
					return;
				}
				if (event.status === 'done') {
					if (completed) {
						resolveResult('completed');
					}
					return;
				}
				if (event.status === 'cancelled') {
					closeRequested = true;
					if (!activeActionPromise) {
						resolveResult(completed ? 'completed' : 'cancelled');
					}
					return;
				}
				if (event.status !== 'action') {
					return;
				}
				if (activeActionPromise) {
					processedOperations.add(event.operationId);
					return;
				}
				if (processedOperations.has(event.operationId)) {
					return;
				}
				processedOperations.add(event.operationId);
				const action: OrderImportPanelAction = event.action === 'preview'
					? { type: 'preview', operationId: event.operationId, settings: event.settings }
					: { type: 'import', operationId: event.operationId, settings: event.settings, previewToken: event.previewToken ?? '' };
				activeActionPromise = processAction(action).finally(() => {
					activeActionPromise = undefined;
					if (closeRequested) {
						resolveResult(completed ? 'completed' : 'cancelled');
					}
				});
			}
			catch (error) {
				resolveResult({ error, ready });
			}
		};
		const poll = (): void => {
			readEvent();
			if (!settled && !ready && readyDeadline !== undefined && Date.now() >= readyDeadline) {
				resolveResult({ error: new Error('The order import IFrame did not become ready.'), ready: false });
			}
		};

		try {
			await Promise.all([
				this.removeBridgeValue(ORDER_IMPORT_EVENT_KEY),
				this.removeBridgeValue(ORDER_IMPORT_RESPONSE_KEY),
			]);
			if (!await this.host.write(ORDER_IMPORT_REQUEST_KEY, request)) {
				throw new OrderImportPanelUnavailableError('init-failed');
			}
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted) {
				throw new OrderImportPanelUnavailableError('api-missing');
			}
			opened = await this.host.open({
				title: request.labels.title,
				onClose: () => {
					closeRequested = true;
					if (!activeActionPromise) {
						resolveResult(completed ? 'completed' : 'cancelled');
					}
				},
			});
			if (!opened) {
				throw new OrderImportPanelUnavailableError('init-failed');
			}
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			poll();
			const result = await resultPromise;
			if (typeof result !== 'string') {
				if (result.ready) {
					throw result.error;
				}
				throw new OrderImportPanelUnavailableError('render-failed', { cause: result.error });
			}
			return result;
		}
		catch (error) {
			if (error instanceof OrderImportPanelUnavailableError || ready) {
				throw error;
			}
			throw new OrderImportPanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			if (pollStarted) {
				this.host.stopPolling(timerId);
			}
			await Promise.all([
				this.removeBridgeValue(ORDER_IMPORT_REQUEST_KEY),
				this.removeBridgeValue(ORDER_IMPORT_EVENT_KEY),
				this.removeBridgeValue(ORDER_IMPORT_RESPONSE_KEY),
			]);
			if (opened) {
				try {
					await this.host.close();
				}
				catch {
					// The user may already have closed the IFrame.
				}
			}
			await delay(DIALOG_SETTLE_DELAY_MS);
		}
	}

	private async removeBridgeValue(key: string): Promise<void> {
		try {
			await this.host.remove(key);
		}
		catch {
			// Best-effort cleanup; fixed keys are overwritten on the next session.
		}
	}

	private labels(): OrderImportLabels {
		return {
			title: this.t('import.title'),
			settingsTitle: this.t('import.settingsTitle'),
			defaultState: this.t('import.defaultStatus'),
			inStock: this.t('inventory.inStock'),
			depleted: this.t('inventory.depleted'),
			strategy: this.t('import.strategy'),
			add: this.t('import.add'),
			replace: this.t('import.replace'),
			skip: this.t('import.skip'),
			generatePreview: this.t('import.generatePreview'),
			previewTitle: this.t('import.previewTitle'),
			fileName: this.t('import.fileName'),
			orderNumber: this.t('import.orderNumber'),
			rows: this.t('import.rows'),
			quantity: this.t('inventory.quantityLabel'),
			status: this.t('import.status'),
			changes: this.t('import.changes'),
			ready: this.t('import.ready'),
			duplicate: this.t('import.duplicate'),
			added: this.t('import.added'),
			merged: this.t('import.merged'),
			skipped: this.t('import.skipped'),
			orderNumberMissing: this.t('import.orderNumberMissing'),
			duplicateHistoricalFingerprint: this.t('import.duplicateHistoricalFingerprint'),
			duplicateHistoricalOrder: this.t('import.duplicateHistoricalOrder'),
			duplicateBatchFingerprint: this.t('import.duplicateBatchFingerprint'),
			duplicateBatchOrder: this.t('import.duplicateBatchOrder'),
			allFilesDuplicate: this.t('import.allFilesDuplicate'),
			confirmImport: this.t('import.confirmImport'),
			backToSettings: this.t('import.backToSettings'),
			progressTitle: this.t('import.progressTitle'),
			phaseParsing: this.t('import.phaseParsing'),
			phaseModelMatching: this.t('import.phaseModelMatching'),
			phaseWriting: this.t('import.phaseWriting'),
			progressStatus: this.t('import.progressStatus'),
			completedTitle: this.t('import.completedTitle'),
			completedSummary: this.t('import.batchCompleted'),
			cancel: this.t('dialog.cancel'),
			done: this.t('import.done'),
			operationError: this.t('import.operationError'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
		};
	}
}

class EdaOrderImportIFrameHost implements OrderImportIFrameHost {
	public read(key: string): unknown { return eda.sys_Storage.getExtensionUserConfig(key); }
	public write(key: string, value: unknown): Promise<boolean> { return eda.sys_Storage.setExtensionUserConfig(key, value); }
	public remove(key: string): Promise<boolean> { return eda.sys_Storage.deleteExtensionUserConfig(key); }
	public close(): Promise<boolean> { return eda.sys_IFrame.closeIFrame(ORDER_IMPORT_IFRAME_ID); }
	public startPolling(id: string, intervalMs: number, callback: () => void): boolean {
		return typeof eda.sys_Timer?.setIntervalTimer === 'function' && eda.sys_Timer.setIntervalTimer(id, intervalMs, callback);
	}

	public stopPolling(id: string): boolean { return eda.sys_Timer.clearIntervalTimer(id); }
	public open(options: IFrameOpenOptions): Promise<boolean> {
		if (typeof eda.sys_IFrame?.openIFrame !== 'function') {
			throw new OrderImportPanelUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(ORDER_IMPORT_IFRAME_PATH, PANEL_WIDTH, PANEL_HEIGHT, ORDER_IMPORT_IFRAME_ID, {
			grayscaleMask: true,
			maximizeButton: true,
			title: options.title,
			buttonCallbackFn: button => button === 'close' ? options.onClose() : undefined,
		});
	}
}

function createRequestId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}
