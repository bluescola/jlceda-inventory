import type { Translate } from '../eda/i18n-client';
import type { BomMappingPanel, BomMappingPanelInput, BomMappingPanelResult } from './bom-mapping-panel';
import type { BomMappingLabels, IFrameBomMappingRequest } from './iframe-bom-mapping-protocol';
import type { DiagnosticTrace } from './native-diagnostics';
import {
	BOM_MAPPING_IFRAME_ID,
	BOM_MAPPING_IFRAME_PATH,
	BOM_MAPPING_REQUEST_KEY,
	BOM_MAPPING_RESULT_KEY,
	createIFrameBomMappingRequest,
	parseIFrameBomMappingRequest,
	parseIFrameBomMappingResult,
} from './iframe-bom-mapping-protocol';
import { DIALOG_SETTLE_DELAY_MS } from './native-dialog';

const PANEL_WIDTH = 1120;
const PANEL_HEIGHT = 780;
const POLL_INTERVAL_MS = 100;
const READY_TIMEOUT_MS = 10_000;

interface IFrameOpenOptions {
	title: string;
	onClose: () => void;
}

export interface BomMappingIFrameHost {
	read: (key: string) => unknown;
	write: (key: string, value: unknown) => Promise<boolean>;
	remove: (key: string) => Promise<boolean>;
	open: (options: IFrameOpenOptions) => Promise<boolean>;
	close: () => Promise<boolean>;
	startPolling: (id: string, intervalMs: number, callback: () => void) => boolean;
	stopPolling: (id: string) => boolean;
}

export class BomMappingPanelUnavailableError extends Error {
	public constructor(
		public readonly status: 'api-missing' | 'init-failed' | 'render-failed',
		options?: ErrorOptions,
	) {
		super(`BOM mapping panel unavailable: ${status}`, options);
		this.name = 'BomMappingPanelUnavailableError';
	}
}

type BridgeOutcome
	= | BomMappingPanelResult
		| { status: 'failed'; error: unknown; ready: boolean };

export class IFrameBomMappingPanel implements BomMappingPanel {
	private queue: Promise<void> = Promise.resolve();

	public constructor(
		private readonly t: Translate,
		private readonly host: BomMappingIFrameHost = new EdaBomMappingIFrameHost(),
	) {}

	public open(input: BomMappingPanelInput, trace?: DiagnosticTrace): Promise<BomMappingPanelResult> {
		return this.enqueue(async () => {
			const request = createIFrameBomMappingRequest(createRequestId(), this.labels(), input);
			if (!parseIFrameBomMappingRequest(request)) {
				throw new TypeError('Invalid BOM mapping panel request.');
			}
			return this.openExclusive(request, trace);
		});
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.queue.then(operation);
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}

	private async openExclusive(
		request: IFrameBomMappingRequest,
		trace?: DiagnosticTrace,
	): Promise<BomMappingPanelResult> {
		const timerId = `${BOM_MAPPING_IFRAME_ID}.${request.requestId}`;
		let opened = false;
		let pollStarted = false;
		let ready = false;
		let settled = false;
		let readyDeadline: number | undefined;
		let settleOutcome: (outcome: BridgeOutcome) => void = () => undefined;
		const outcomePromise = new Promise<BridgeOutcome>((resolve) => {
			settleOutcome = (outcome) => {
				if (!settled) {
					settled = true;
					resolve(outcome);
				}
			};
		});
		const observedStages = new Set<string>();
		const readResult = (): void => {
			try {
				const result = parseIFrameBomMappingResult(this.host.read(BOM_MAPPING_RESULT_KEY), request);
				if (!result) {
					return;
				}
				if (result.status === 'progress') {
					if (!observedStages.has(result.stage)) {
						observedStages.add(result.stage);
						trace?.info('bom-mapping-panel.iframe.stage', { stage: result.stage });
					}
					return;
				}
				if (result.status === 'ready') {
					if (!ready) {
						ready = true;
						trace?.info('bom-mapping-panel.iframe.ready');
					}
					return;
				}
				if (result.status === 'failed') {
					trace?.error('bom-mapping-panel.iframe.failed', {
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
				settleOutcome(result.status === 'submitted'
					? { status: 'submitted', files: result.files }
					: { status: 'cancelled' });
			}
			catch (error) {
				settleOutcome({ status: 'failed', error, ready });
			}
		};
		const poll = (): void => {
			readResult();
			if (!settled && !ready && readyDeadline !== undefined && Date.now() >= readyDeadline) {
				settleOutcome({
					status: 'failed',
					error: new Error('The BOM mapping IFrame did not become ready.'),
					ready: false,
				});
			}
		};

		try {
			await this.removeBridgeValue(BOM_MAPPING_RESULT_KEY, trace);
			if (!await this.host.write(BOM_MAPPING_REQUEST_KEY, request)) {
				throw new BomMappingPanelUnavailableError('init-failed');
			}
			pollStarted = this.host.startPolling(timerId, POLL_INTERVAL_MS, poll);
			if (!pollStarted) {
				throw new BomMappingPanelUnavailableError('api-missing');
			}
			opened = await this.host.open({
				title: request.mode === 'compare' ? request.labels.titleCompare : request.labels.titleStockCheck,
				onClose: () => {
					readResult();
					settleOutcome({ status: 'cancelled' });
				},
			});
			if (!opened) {
				throw new BomMappingPanelUnavailableError('init-failed');
			}
			readyDeadline = Date.now() + READY_TIMEOUT_MS;
			poll();
			const outcome = await outcomePromise;
			trace?.info('bom-mapping-panel.response', { status: outcome.status });
			if (outcome.status === 'failed') {
				if (outcome.ready) {
					throw outcome.error;
				}
				throw new BomMappingPanelUnavailableError('render-failed', { cause: outcome.error });
			}
			return outcome;
		}
		catch (error) {
			if (error instanceof BomMappingPanelUnavailableError || ready) {
				throw error;
			}
			throw new BomMappingPanelUnavailableError('init-failed', { cause: error });
		}
		finally {
			if (pollStarted) {
				this.host.stopPolling(timerId);
			}
			await Promise.all([
				this.removeBridgeValue(BOM_MAPPING_REQUEST_KEY, trace),
				this.removeBridgeValue(BOM_MAPPING_RESULT_KEY, trace),
			]);
			if (opened) {
				try {
					await this.host.close();
				}
				catch (error) {
					trace?.warn('bom-mapping-panel.iframe.close.failed', { errorName: errorName(error) });
				}
			}
			await delay(DIALOG_SETTLE_DELAY_MS);
		}
	}

	private async removeBridgeValue(key: string, trace?: DiagnosticTrace): Promise<void> {
		try {
			await this.host.remove(key);
		}
		catch (error) {
			trace?.warn('bom-mapping-panel.iframe.cleanup.failed', { errorName: errorName(error) });
		}
	}

	private labels(): BomMappingLabels {
		return {
			titleStockCheck: this.t('bomMapping.title.stockCheck'),
			titleCompare: this.t('bomMapping.title.compare'),
			file: this.t('bomMapping.file'),
			format: this.t('bomMapping.format'),
			worksheet: this.t('bomMapping.worksheet'),
			headerCandidate: this.t('bomMapping.headerCandidate'),
			headerRow: this.t('bomMapping.headerRow'),
			detectedCandidate: this.t('bomMapping.detectedCandidate'),
			manualHeader: this.t('bomMapping.manualHeader'),
			noCandidate: this.t('bomMapping.noCandidate'),
			mapping: this.t('bomMapping.mapping'),
			mappingHint: this.t('bomMapping.mappingHint'),
			notMapped: this.t('bomMapping.notMapped'),
			rawPreview: this.t('bomMapping.rawPreview'),
			duplicateWarning: this.t('bomMapping.duplicateWarning'),
			duplicateAssignmentWarning: this.t('bomMapping.duplicateAssignmentWarning'),
			fieldLcscPartNumber: this.t('bomMapping.field.lcscPartNumber'),
			fieldDesignators: this.t('bomMapping.field.designators'),
			fieldQuantity: this.t('bomMapping.field.quantity'),
			fieldName: this.t('bomMapping.field.name'),
			fieldManufacturerPartNumber: this.t('bomMapping.field.manufacturerPartNumber'),
			fieldManufacturer: this.t('bomMapping.field.manufacturer'),
			fieldPackage: this.t('bomMapping.field.package'),
			fieldExcludeFromBom: this.t('bomMapping.field.excludeFromBom'),
			columnFallback: this.t('bomMapping.columnFallback'),
			cancel: this.t('dialog.cancel'),
			confirm: this.t('dialog.confirm'),
			loading: this.t('productForm.loading'),
			connectionError: this.t('productForm.connectionError'),
			saveError: this.t('productForm.saveError'),
		};
	}
}

class EdaBomMappingIFrameHost implements BomMappingIFrameHost {
	public read(key: string): unknown { return eda.sys_Storage.getExtensionUserConfig(key); }
	public write(key: string, value: unknown): Promise<boolean> { return eda.sys_Storage.setExtensionUserConfig(key, value); }
	public remove(key: string): Promise<boolean> { return eda.sys_Storage.deleteExtensionUserConfig(key); }
	public close(): Promise<boolean> { return eda.sys_IFrame.closeIFrame(BOM_MAPPING_IFRAME_ID); }
	public startPolling(id: string, intervalMs: number, callback: () => void): boolean {
		return typeof eda.sys_Timer?.setIntervalTimer === 'function'
			&& eda.sys_Timer.setIntervalTimer(id, intervalMs, callback);
	}

	public stopPolling(id: string): boolean { return eda.sys_Timer.clearIntervalTimer(id); }
	public open(options: IFrameOpenOptions): Promise<boolean> {
		if (typeof eda.sys_IFrame?.openIFrame !== 'function') {
			throw new BomMappingPanelUnavailableError('api-missing');
		}
		return eda.sys_IFrame.openIFrame(
			BOM_MAPPING_IFRAME_PATH,
			PANEL_WIDTH,
			PANEL_HEIGHT,
			BOM_MAPPING_IFRAME_ID,
			{
				grayscaleMask: true,
				maximizeButton: true,
				title: options.title,
				buttonCallbackFn: button => button === 'close' ? options.onClose() : undefined,
			},
		);
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
