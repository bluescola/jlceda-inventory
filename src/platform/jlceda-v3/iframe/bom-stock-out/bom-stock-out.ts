import type {
	BomStockOutLabels,
	BomStockOutPayloadIssue,
	BomStockOutPayloadRow,
	IFrameBomStockOutEvent,
	IFrameBomStockOutRequest,
	IFrameBomStockOutResponse,
} from '../../presentation/iframe-bom-stock-out-protocol';
import {
	BOM_STOCK_OUT_EVENT_KEY,
	BOM_STOCK_OUT_IFRAME_ID,
	BOM_STOCK_OUT_PROTOCOL_VERSION,
	BOM_STOCK_OUT_REQUEST_KEY,
	BOM_STOCK_OUT_RESPONSE_KEY,
	parseIFrameBomStockOutRequest,
	parseIFrameBomStockOutResponse,
} from '../../presentation/iframe-bom-stock-out-protocol';

const PAGE_SIZE = 100;

interface Elements {
	shell: HTMLElement;
	boot: HTMLElement;
	bootMessage: HTMLElement;
	report: HTMLElement;
	sourceNameValue: HTMLElement;
	boardQuantityValue: HTMLElement;
	lineCountValue: HTMLElement;
	fingerprintValue: HTMLElement;
	statusBanner: HTMLElement;
	atomicNotice: HTMLElement;
	globalIssues: HTMLUListElement;
	rows: HTMLTableSectionElement;
	emptyRows: HTMLElement;
	previousPage: HTMLButtonElement;
	nextPage: HTMLButtonElement;
	pageStatus: HTMLElement;
	pager: HTMLElement;
	commit: HTMLButtonElement;
	close: HTMLButtonElement;
	operationStatus: HTMLElement;
	connectionError: HTMLElement;
	confirmDialog: HTMLDialogElement;
	confirmTitle: HTMLElement;
	confirmMessage: HTMLElement;
	confirmCancel: HTMLButtonElement;
	confirmSubmit: HTMLButtonElement;
}

interface ActiveOperation { id: string; type: 'close' | 'commit' }

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
		throw new TypeError('The BOM stock-out request is unavailable.');
	}
	const writeEvent = async (event: IFrameBomStockOutEvent): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(BOM_STOCK_OUT_EVENT_KEY, event);
		}
		catch {
			return false;
		}
	};
	await requireWrite(writeEvent, progress(request.requestId, 'script-started'));
	await requireWrite(writeEvent, progress(request.requestId, 'request-read'));
	render(elements, request, writeEvent);
	await requireWrite(writeEvent, progress(request.requestId, 'panel-rendered'));
	await requireWrite(writeEvent, { protocolVersion: 1, requestId: request.requestId, status: 'ready' });
}

function render(
	elements: Elements,
	request: IFrameBomStockOutRequest,
	writeEvent: (event: IFrameBomStockOutEvent) => Promise<boolean>,
): void {
	const { labels } = request;
	let active: ActiveOperation | undefined;
	let page = 0;
	localize(elements, request);
	elements.sourceNameValue.textContent = request.sourceName;
	elements.boardQuantityValue.textContent = String(request.boardQuantity);
	elements.lineCountValue.textContent = String(request.rows.length);
	elements.fingerprintValue.textContent = request.batchFingerprintShort;
	elements.statusBanner.className = `status-banner ${request.status}`;
	elements.statusBanner.textContent = statusLabel(request.status, labels);
	elements.atomicNotice.textContent = labels.atomicNotice;
	elements.globalIssues.hidden = request.globalIssues.length === 0;
	elements.globalIssues.replaceChildren(...request.globalIssues.map(issue => issueListItem(issue, labels)));
	elements.commit.disabled = request.status !== 'ready';

	const renderPage = (): void => {
		const pageCount = Math.max(1, Math.ceil(request.rows.length / PAGE_SIZE));
		page = Math.min(Math.max(page, 0), pageCount - 1);
		const start = page * PAGE_SIZE;
		elements.rows.replaceChildren(...request.rows.slice(start, start + PAGE_SIZE).map(row => renderRow(row, labels)));
		elements.emptyRows.hidden = request.rows.length !== 0;
		elements.emptyRows.textContent = labels.emptyRows;
		elements.previousPage.disabled = page === 0;
		elements.nextPage.disabled = page >= pageCount - 1;
		elements.pageStatus.textContent = formatPage(labels.pageStatus, page + 1, pageCount);
		elements.pager.hidden = request.rows.length <= PAGE_SIZE;
	};

	elements.previousPage.addEventListener('click', () => {
		page -= 1;
		renderPage();
		elements.rows.parentElement?.scrollTo({ top: 0 });
	});
	elements.nextPage.addEventListener('click', () => {
		page += 1;
		renderPage();
		elements.rows.parentElement?.scrollTo({ top: 0 });
	});

	const setPending = (pending: boolean): void => {
		elements.close.disabled = pending;
		elements.commit.disabled = pending || request.status !== 'ready';
	};
	const sendAction = async (type: ActiveOperation['type']): Promise<void> => {
		if (active || (type === 'commit' && request.status !== 'ready')) {
			return;
		}
		active = { id: createOperationId(), type };
		setPending(true);
		elements.operationStatus.classList.remove('error');
		elements.operationStatus.textContent = type === 'commit' ? labels.committing : '';
		try {
			await eda.sys_Storage.deleteExtensionUserConfig(BOM_STOCK_OUT_RESPONSE_KEY);
			if (!await writeEvent({
				protocolVersion: 1,
				requestId: request.requestId,
				status: 'action',
				operationId: active.id,
				action: type,
			})) {
				throw new Error('The host rejected the BOM stock-out action.');
			}
		}
		catch {
			active = undefined;
			setPending(false);
			showOperationError(elements, labels.operationError);
		}
	};

	elements.commit.addEventListener('click', () => elements.confirmDialog.showModal());
	elements.confirmCancel.addEventListener('click', () => elements.confirmDialog.close());
	elements.confirmSubmit.addEventListener('click', () => {
		elements.confirmDialog.close();
		void sendAction('commit');
	});
	elements.close.addEventListener('click', () => void sendAction('close'));
	const timer = window.setInterval(() => {
		if (!active)
			return;
		let response: IFrameBomStockOutResponse | undefined;
		try {
			response = parseIFrameBomStockOutResponse(
				eda.sys_Storage.getExtensionUserConfig(BOM_STOCK_OUT_RESPONSE_KEY),
				request.requestId,
				active.id,
			);
		}
		catch {
			response = undefined;
		}
		if (!response)
			return;
		const completed = active;
		active = undefined;
		if (response.status === 'failed') {
			setPending(false);
			showOperationError(elements, response.message ?? labels.operationError);
			return;
		}
		if (completed.type === 'commit') {
			elements.operationStatus.textContent = response.message || labels.commitSucceeded;
		}
		window.clearInterval(timer);
		void closePanel();
	}, 100);
	window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true });

	elements.shell.setAttribute('aria-busy', 'false');
	elements.boot.hidden = true;
	elements.report.hidden = false;
	renderPage();
}

function renderRow(row: BomStockOutPayloadRow, labels: BomStockOutLabels): HTMLTableRowElement {
	const result = document.createElement('tr');
	result.append(
		cell(row.lcscPartNumber || labels.emptyValue),
		cell(row.name),
		cell(row.manufacturerPartNumber || labels.emptyValue),
		cell(row.package || labels.emptyValue),
		cell(row.designators.join(', ') || labels.emptyValue),
		cell(String(row.requestedQuantity), true),
		cell(quantity(row.beforeQuantity, labels), true),
		cell(quantity(row.afterQuantity, labels), true),
		issuesCell(row.issues, labels),
	);
	return result;
}

function cell(text: string, numeric = false): HTMLTableCellElement {
	const result = document.createElement('td');
	result.textContent = text;
	if (numeric)
		result.className = 'numeric';
	return result;
}

function issuesCell(issues: readonly BomStockOutPayloadIssue[], labels: BomStockOutLabels): HTMLTableCellElement {
	const result = document.createElement('td');
	if (issues.length === 0) {
		result.textContent = labels.emptyValue;
		return result;
	}
	const list = document.createElement('ul');
	list.className = 'issue-list';
	list.append(...issues.map(issue => issueListItem(issue, labels)));
	result.append(list);
	return result;
}

function issueListItem(issue: BomStockOutPayloadIssue, labels: BomStockOutLabels): HTMLLIElement {
	const result = document.createElement('li');
	let text = issueLabel(issue.code, labels);
	if (issue.requestedQuantity !== undefined) {
		text += `; ${labels.columnRequestedQuantity}: ${issue.requestedQuantity}`;
	}
	if (issue.availableQuantity !== undefined) {
		text += `; ${labels.columnBeforeQuantity}: ${quantity(issue.availableQuantity, labels)}`;
	}
	result.textContent = text;
	return result;
}

function issueLabel(code: BomStockOutPayloadIssue['code'], labels: BomStockOutLabels): string {
	switch (code) {
		case 'duplicate-batch': return labels.issueDuplicateBatch;
		case 'item-missing': return labels.issueItemMissing;
		case 'quantity-not-exact': return labels.issueQuantityNotExact;
		case 'insufficient-stock': return labels.issueInsufficientStock;
	}
}

function statusLabel(status: IFrameBomStockOutRequest['status'], labels: BomStockOutLabels): string {
	return status === 'ready' ? labels.statusReady : status === 'blocked' ? labels.statusBlocked : labels.statusDuplicate;
}

function quantity(value: number | null, labels: BomStockOutLabels): string {
	return value === null ? labels.emptyValue : String(value);
}

function localize(elements: Elements, request: IFrameBomStockOutRequest): void {
	const { labels } = request;
	document.documentElement.lang = inferLanguage(labels.title);
	document.title = labels.title;
	setText('source-name-label', labels.sourceName);
	setText('board-quantity-label', labels.boardQuantity);
	setText('line-count-label', labels.lineCount);
	setText('fingerprint-label', labels.fingerprint);
	setText('column-part-number', labels.columnPartNumber);
	setText('column-name', labels.columnName);
	setText('column-manufacturer-part-number', labels.columnManufacturerPartNumber);
	setText('column-package', labels.columnPackage);
	setText('column-designators', labels.columnDesignators);
	setText('column-requested-quantity', labels.columnRequestedQuantity);
	setText('column-before-quantity', labels.columnBeforeQuantity);
	setText('column-after-quantity', labels.columnAfterQuantity);
	setText('column-issue', labels.columnIssue);
	elements.previousPage.title = labels.previousPage;
	elements.previousPage.setAttribute('aria-label', labels.previousPage);
	elements.nextPage.title = labels.nextPage;
	elements.nextPage.setAttribute('aria-label', labels.nextPage);
	elements.commit.textContent = labels.commit;
	elements.close.textContent = labels.close;
	elements.confirmTitle.textContent = labels.commit;
	elements.confirmMessage.textContent = labels.confirmCommit;
	elements.confirmCancel.textContent = labels.cancel;
	elements.confirmSubmit.textContent = labels.commit;
}

function getElements(): Elements {
	return {
		shell: element('panel-shell', HTMLElement),
		boot: element('boot-status', HTMLElement),
		bootMessage: element('boot-message', HTMLElement),
		report: element('report', HTMLElement),
		sourceNameValue: element('source-name-value', HTMLElement),
		boardQuantityValue: element('board-quantity-value', HTMLElement),
		lineCountValue: element('line-count-value', HTMLElement),
		fingerprintValue: element('fingerprint-value', HTMLElement),
		statusBanner: element('status-banner', HTMLElement),
		atomicNotice: element('atomic-notice', HTMLElement),
		globalIssues: element('global-issues', HTMLUListElement),
		rows: element('stock-out-rows', HTMLTableSectionElement),
		emptyRows: element('empty-rows', HTMLElement),
		previousPage: element('previous-page', HTMLButtonElement),
		nextPage: element('next-page', HTMLButtonElement),
		pageStatus: element('page-status', HTMLElement),
		pager: element('pager', HTMLElement),
		commit: element('commit', HTMLButtonElement),
		close: element('close', HTMLButtonElement),
		operationStatus: element('operation-status', HTMLElement),
		connectionError: element('connection-error', HTMLElement),
		confirmDialog: element('confirm-dialog', HTMLDialogElement),
		confirmTitle: element('confirm-title', HTMLElement),
		confirmMessage: element('confirm-message', HTMLElement),
		confirmCancel: element('confirm-cancel', HTMLButtonElement),
		confirmSubmit: element('confirm-submit', HTMLButtonElement),
	};
}

function readRequest(): IFrameBomStockOutRequest | undefined {
	try {
		return parseIFrameBomStockOutRequest(eda.sys_Storage.getExtensionUserConfig(BOM_STOCK_OUT_REQUEST_KEY));
	}
	catch {
		return undefined;
	}
}

async function reportFailure(error: unknown): Promise<void> {
	const request = readRequest();
	if (!request)
		return;
	try {
		await eda.sys_Storage.setExtensionUserConfig(BOM_STOCK_OUT_EVENT_KEY, {
			protocolVersion: 1,
			requestId: request.requestId,
			status: 'failed',
			stage: 'script-started',
			errorName: errorName(error),
			error: errorMessage(error),
		} satisfies IFrameBomStockOutEvent);
	}
	catch {
		// The host enforces its ready timeout when the bridge is unavailable.
	}
}

function showOperationError(elements: Elements, message: string): void {
	elements.operationStatus.classList.add('error');
	elements.operationStatus.textContent = message;
}

function showConnectionError(elements: Elements | undefined): void {
	if (!elements)
		return;
	elements.shell.setAttribute('aria-busy', 'false');
	elements.boot.hidden = true;
	elements.report.hidden = true;
	elements.connectionError.textContent = usesChineseLanguage() ? 'BOM 出库预览连接失败。' : 'The BOM stock-out preview connection failed.';
	elements.connectionError.hidden = false;
}

async function closePanel(): Promise<void> {
	try {
		await eda.sys_IFrame.closeIFrame(BOM_STOCK_OUT_IFRAME_ID);
	}
	catch {
		// The host closes the panel after processing the terminal action.
	}
}

function progress(requestId: string, stage: 'panel-rendered' | 'request-read' | 'script-started'): IFrameBomStockOutEvent {
	return { protocolVersion: BOM_STOCK_OUT_PROTOCOL_VERSION, requestId, status: 'progress', stage };
}

async function requireWrite(write: (event: IFrameBomStockOutEvent) => Promise<boolean>, event: IFrameBomStockOutEvent): Promise<void> {
	if (!await write(event))
		throw new Error('The host rejected the BOM stock-out event.');
}

function setText(id: string, text: string): void {
	element(id, HTMLElement).textContent = text;
}

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
	const result = document.getElementById(id);
	if (!(result instanceof constructor))
		throw new TypeError(`Missing BOM stock-out element: ${id}`);
	return result;
}

function createOperationId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function formatPage(template: string, page: number, pages: number): string {
	return template
		.replaceAll(`\${1}`, String(page))
		.replaceAll(`\${2}`, String(pages))
		.replaceAll('{page}', String(page))
		.replaceAll('{pages}', String(pages));
}

function localizeBootstrap(elements: Elements): void {
	const chinese = usesChineseLanguage();
	document.documentElement.lang = chinese ? 'zh-Hans' : 'en';
	elements.bootMessage.textContent = chinese ? '正在加载出库预览...' : 'Loading stock-out preview...';
}

function usesChineseLanguage(): boolean {
	return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
}

function inferLanguage(text: string): string {
	return /[\u3400-\u9FFF]/.test(text) ? 'zh-Hans' : 'en';
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
