import type {
	IFrameOrderImportEvent,
	IFrameOrderImportRequest,
	IFrameOrderImportResponse,
	OrderImportLabels,
} from '../../presentation/iframe-order-import-protocol';
import type { OrderImportPanelFilePreview, OrderImportPanelSettings } from '../../presentation/order-import-panel';
import {
	ORDER_IMPORT_EVENT_KEY,
	ORDER_IMPORT_IFRAME_ID,
	ORDER_IMPORT_PROTOCOL_VERSION,
	ORDER_IMPORT_REQUEST_KEY,
	ORDER_IMPORT_RESPONSE_KEY,
	parseIFrameOrderImportRequest,
	parseIFrameOrderImportResponse,
} from '../../presentation/iframe-order-import-protocol';

interface Elements {
	shell: HTMLElement;
	boot: HTMLElement;
	bootMessage: HTMLElement;
	settingsView: HTMLElement;
	previewView: HTMLElement;
	progressView: HTMLElement;
	completedView: HTMLElement;
	defaultState: HTMLSelectElement;
	strategy: HTMLSelectElement;
	selectedFiles: HTMLUListElement;
	settingsError: HTMLElement;
	settingsCancel: HTMLButtonElement;
	previewButton: HTMLButtonElement;
	previewSummary: HTMLElement;
	previewBody: HTMLTableSectionElement;
	previewWarning: HTMLElement;
	previewBack: HTMLButtonElement;
	previewCancel: HTMLButtonElement;
	importButton: HTMLButtonElement;
	progressPhase: HTMLElement;
	progressFill: HTMLElement;
	progressStatus: HTMLElement;
	progressError: HTMLElement;
	completedSummary: HTMLElement;
	done: HTMLButtonElement;
	connectionError: HTMLElement;
}

interface ActiveOperation {
	id: string;
	type: 'import' | 'preview';
	lastSequence: number;
}

void bootstrap();

async function bootstrap(): Promise<void> {
	let elements: Elements | undefined;
	try {
		elements = getElements();
		localizeBootstrap(elements);
		await initialize(elements);
	}
	catch (error) {
		await reportFailure(error);
		showConnectionError(elements);
	}
}

async function initialize(elements: Elements): Promise<void> {
	const request = readRequest();
	if (!request) {
		throw new TypeError('The order import request is unavailable.');
	}
	const writeEvent = async (event: IFrameOrderImportEvent): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(ORDER_IMPORT_EVENT_KEY, event);
		}
		catch {
			return false;
		}
	};
	await requireWrite(writeEvent, progress(request.requestId, 'script-started'));
	await requireWrite(writeEvent, progress(request.requestId, 'request-read'));
	render(elements, request, writeEvent);
	await requireWrite(writeEvent, progress(request.requestId, 'panel-rendered'));
	await requireWrite(writeEvent, { protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION, requestId: request.requestId, status: 'ready' });
}

function render(
	elements: Elements,
	request: IFrameOrderImportRequest,
	writeEvent: (event: IFrameOrderImportEvent) => Promise<boolean>,
): void {
	const { labels } = request;
	let active: ActiveOperation | undefined;
	let previewToken: string | undefined;
	let previewReady = false;
	localize(elements, request);
	elements.selectedFiles.replaceChildren(...request.files.map((file) => {
		const item = document.createElement('li');
		item.textContent = file.name;
		return item;
	}));

	const settings = (): OrderImportPanelSettings => ({
		defaultState: elements.defaultState.value as OrderImportPanelSettings['defaultState'],
		strategy: elements.strategy.value as OrderImportPanelSettings['strategy'],
	});
	const setView = (view: HTMLElement): void => {
		for (const candidate of [elements.settingsView, elements.previewView, elements.progressView, elements.completedView]) {
			candidate.hidden = candidate !== view;
		}
	};
	const showProgress = (phase: 'model-matching' | 'parsing' | 'writing', completed: number, total: number, message?: string): void => {
		setView(elements.progressView);
		const phaseLabels = { 'parsing': labels.phaseParsing, 'model-matching': labels.phaseModelMatching, 'writing': labels.phaseWriting };
		elements.progressPhase.textContent = message || phaseLabels[phase];
		const percentage = total === 0 ? 0 : Math.min(100, Math.round(completed / total * 100));
		elements.progressFill.style.width = `${percentage}%`;
		elements.progressFill.parentElement?.setAttribute('aria-valuenow', String(percentage));
		elements.progressStatus.textContent = format(labels.progressStatus, completed, total);
	};
	const sendAction = async (type: 'import' | 'preview'): Promise<void> => {
		if (active || (type === 'import' && !previewToken)) {
			return;
		}
		active = { id: createOperationId(), type, lastSequence: -1 };
		elements.progressError.hidden = true;
		showProgress(type === 'preview' ? 'parsing' : 'model-matching', 0, type === 'preview' ? request.files.length : 1);
		try {
			await eda.sys_Storage.deleteExtensionUserConfig(ORDER_IMPORT_RESPONSE_KEY);
			const written = await writeEvent({
				protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
				requestId: request.requestId,
				status: 'action',
				operationId: active.id,
				action: type,
				settings: settings(),
				previewToken: type === 'import' ? previewToken : undefined,
			});
			if (!written) {
				throw new Error('The host rejected the order import action.');
			}
		}
		catch {
			active = undefined;
			elements.progressError.textContent = labels.operationError;
			elements.progressError.hidden = false;
		}
	};

	elements.previewButton.addEventListener('click', () => void sendAction('preview'));
	elements.importButton.addEventListener('click', () => void sendAction('import'));
	elements.previewBack.addEventListener('click', () => {
		previewToken = undefined;
		previewReady = false;
		setView(elements.settingsView);
	});
	for (const button of [elements.settingsCancel, elements.previewCancel]) {
		button.addEventListener('click', () => void finish(writeEvent, request.requestId, 'cancelled'));
	}
	elements.done.addEventListener('click', () => void finish(writeEvent, request.requestId, 'done'));
	for (const select of [elements.defaultState, elements.strategy]) {
		select.addEventListener('change', () => {
			previewToken = undefined;
			previewReady = false;
		});
	}

	const timer = window.setInterval(() => {
		if (!active) {
			return;
		}
		let response: IFrameOrderImportResponse | undefined;
		try {
			response = parseIFrameOrderImportResponse(
				eda.sys_Storage.getExtensionUserConfig(ORDER_IMPORT_RESPONSE_KEY),
				request.requestId,
				active.id,
			);
		}
		catch {
			response = undefined;
		}
		if (!response || response.sequence <= active.lastSequence) {
			return;
		}
		active.lastSequence = response.sequence;
		if (response.stage === 'progress') {
			showProgress(response.progress.phase, response.progress.completed, response.progress.total, response.progress.message);
			return;
		}
		const operationType = active.type;
		active = undefined;
		if (response.stage === 'failed') {
			elements.progressError.textContent = response.message;
			elements.progressError.hidden = false;
			const retry = document.createElement('button');
			retry.type = 'button';
			retry.className = 'button secondary';
			retry.textContent = operationType === 'preview' ? labels.backToSettings : labels.previewTitle;
			retry.addEventListener('click', () => setView(operationType === 'preview' ? elements.settingsView : elements.previewView));
			elements.progressError.append(document.createElement('br'), retry);
			return;
		}
		if (response.stage === 'preview') {
			previewToken = response.previewToken;
			previewReady = response.preview.files.some(file => file.status === 'ready');
			renderPreview(elements, response.preview, labels);
			elements.importButton.disabled = !previewReady;
			setView(elements.previewView);
			return;
		}
		if (response.stage === 'completed') {
			elements.completedSummary.textContent = format(
				labels.completedSummary,
				response.summary.importedFiles,
				response.summary.duplicateFiles,
				response.summary.added,
				response.summary.merged,
				response.summary.skipped,
			);
			setView(elements.completedView);
			window.clearInterval(timer);
		}
	}, 100);

	elements.boot.hidden = true;
	elements.shell.setAttribute('aria-busy', 'false');
	setView(elements.settingsView);
}

function renderPreview(
	elements: Elements,
	preview: Extract<IFrameOrderImportResponse, { stage: 'preview' }>['preview'],
	labels: OrderImportLabels,
): void {
	elements.previewSummary.textContent = `${labels.added}: ${preview.added} | ${labels.merged}: ${preview.merged} | ${labels.skipped}: ${preview.skipped}`;
	elements.previewBody.replaceChildren(...preview.files.map((file) => {
		const row = document.createElement('tr');
		row.append(
			cell(file.fileName),
			cell(file.orderNumber || labels.orderNumberMissing),
			cell(String(file.rowCount)),
			cell(String(file.totalQuantity)),
			statusCell(file, labels),
			cell(`${labels.added} ${file.added} / ${labels.merged} ${file.merged} / ${labels.skipped} ${file.skipped}`),
		);
		return row;
	}));
	const allDuplicate = !preview.files.some(file => file.status === 'ready');
	elements.previewWarning.textContent = allDuplicate ? labels.allFilesDuplicate : '';
	elements.previewWarning.hidden = !allDuplicate;
}

function statusCell(file: OrderImportPanelFilePreview, labels: OrderImportLabels): HTMLTableCellElement {
	const result = cell(file.status === 'ready' ? labels.ready : duplicateReason(file, labels));
	result.className = `status ${file.status}`;
	return result;
}

function duplicateReason(file: OrderImportPanelFilePreview, labels: OrderImportLabels): string {
	if (file.duplicateReason === 'historical-fingerprint')
		return labels.duplicateHistoricalFingerprint;
	if (file.duplicateReason === 'historical-order-number')
		return labels.duplicateHistoricalOrder;
	if (file.duplicateReason === 'batch-fingerprint')
		return labels.duplicateBatchFingerprint;
	if (file.duplicateReason === 'batch-order-number')
		return labels.duplicateBatchOrder;
	return labels.duplicate;
}

function localize(elements: Elements, request: IFrameOrderImportRequest): void {
	const { labels } = request;
	document.documentElement.lang = /[\u3400-\u9FFF]/.test(labels.title) ? 'zh-Hans' : 'en';
	document.title = labels.title;
	setText('title', labels.title);
	setText('settings-title', labels.settingsTitle);
	setText('default-state-label', labels.defaultState);
	optionLabel(elements.defaultState, 'in-stock', labels.inStock);
	optionLabel(elements.defaultState, 'depleted', labels.depleted);
	setText('strategy-label', labels.strategy);
	optionLabel(elements.strategy, 'add', labels.add);
	optionLabel(elements.strategy, 'replace', labels.replace);
	optionLabel(elements.strategy, 'skip', labels.skip);
	elements.settingsCancel.textContent = labels.cancel;
	elements.previewButton.textContent = labels.generatePreview;
	setText('preview-title', labels.previewTitle);
	setText('file-name-heading', labels.fileName);
	setText('order-number-heading', labels.orderNumber);
	setText('rows-heading', labels.rows);
	setText('quantity-heading', labels.quantity);
	setText('status-heading', labels.status);
	setText('changes-heading', labels.changes);
	elements.previewBack.textContent = labels.backToSettings;
	elements.previewCancel.textContent = labels.cancel;
	elements.importButton.textContent = labels.confirmImport;
	setText('progress-title', labels.progressTitle);
	setText('completed-title', labels.completedTitle);
	elements.done.textContent = labels.done;
}

async function finish(
	writeEvent: (event: IFrameOrderImportEvent) => Promise<boolean>,
	requestId: string,
	status: 'cancelled' | 'done',
): Promise<void> {
	const written = await writeEvent({
		protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
		requestId,
		status,
		operationId: createOperationId(),
	});
	if (!written) {
		return;
	}
	try {
		await eda.sys_IFrame.closeIFrame(ORDER_IMPORT_IFRAME_ID);
	}
	catch {
		// The persisted event remains available to the host.
	}
}

function readRequest(): IFrameOrderImportRequest | undefined {
	try {
		return parseIFrameOrderImportRequest(eda.sys_Storage.getExtensionUserConfig(ORDER_IMPORT_REQUEST_KEY));
	}
	catch {
		return undefined;
	}
}

function getElements(): Elements {
	return {
		shell: element('shell', HTMLElement),
		boot: element('boot', HTMLElement),
		bootMessage: element('boot-message', HTMLElement),
		settingsView: element('settings-view', HTMLElement),
		previewView: element('preview-view', HTMLElement),
		progressView: element('progress-view', HTMLElement),
		completedView: element('completed-view', HTMLElement),
		defaultState: element('default-state', HTMLSelectElement),
		strategy: element('strategy', HTMLSelectElement),
		selectedFiles: element('selected-files', HTMLUListElement),
		settingsError: element('settings-error', HTMLElement),
		settingsCancel: element('settings-cancel', HTMLButtonElement),
		previewButton: element('preview', HTMLButtonElement),
		previewSummary: element('preview-summary', HTMLElement),
		previewBody: element('preview-body', HTMLTableSectionElement),
		previewWarning: element('preview-warning', HTMLElement),
		previewBack: element('preview-back', HTMLButtonElement),
		previewCancel: element('preview-cancel', HTMLButtonElement),
		importButton: element('import', HTMLButtonElement),
		progressPhase: element('progress-phase', HTMLElement),
		progressFill: element('progress-fill', HTMLElement),
		progressStatus: element('progress-status', HTMLElement),
		progressError: element('progress-error', HTMLElement),
		completedSummary: element('completed-summary', HTMLElement),
		done: element('done', HTMLButtonElement),
		connectionError: element('connection-error', HTMLElement),
	};
}

function cell(text: string): HTMLTableCellElement {
	const value = document.createElement('td');
	value.textContent = text;
	return value;
}

function setText(id: string, text: string): void {
	element(id, HTMLElement).textContent = text;
}

function optionLabel(select: HTMLSelectElement, value: string, label: string): void {
	const option = Array.from(select.options).find(item => item.value === value);
	if (option) {
		option.textContent = label;
	}
}

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
	const value = document.getElementById(id);
	if (!(value instanceof constructor)) {
		throw new TypeError(`Missing order import element: ${id}`);
	}
	return value;
}

function progress(
	requestId: string,
	stage: 'panel-rendered' | 'request-read' | 'script-started',
): IFrameOrderImportEvent {
	return { protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION, requestId, status: 'progress', stage };
}

async function requireWrite(write: (event: IFrameOrderImportEvent) => Promise<boolean>, event: IFrameOrderImportEvent): Promise<void> {
	if (!await write(event)) {
		throw new Error('The host rejected the order import event.');
	}
}

function format(template: string, ...values: Array<number | string>): string {
	let result = template;
	for (const [index, value] of values.entries()) {
		result = result.replaceAll(`\${${index + 1}}`, String(value));
	}
	return result;
}

function createOperationId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function localizeBootstrap(elements: Elements): void {
	elements.bootMessage.textContent = navigator.language.toLowerCase().startsWith('zh')
		? '正在加载订单导入...'
		: 'Loading order import...';
}

function showConnectionError(elements?: Elements): void {
	if (!elements) {
		return;
	}
	elements.boot.hidden = true;
	elements.connectionError.textContent = navigator.language.toLowerCase().startsWith('zh')
		? '订单导入窗口连接失败。'
		: 'The order import window failed to connect.';
	elements.connectionError.hidden = false;
}

async function reportFailure(error: unknown): Promise<void> {
	try {
		const request = readRequest();
		if (!request) {
			return;
		}
		await eda.sys_Storage.setExtensionUserConfig(ORDER_IMPORT_EVENT_KEY, {
			protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'failed',
			stage: 'script-started',
			errorName: error instanceof Error ? error.name : typeof error,
			error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
		} satisfies IFrameOrderImportEvent);
	}
	catch {
		// No diagnostic bridge remains.
	}
}
