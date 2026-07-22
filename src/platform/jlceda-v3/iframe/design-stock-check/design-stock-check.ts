import type {
	DesignStockCheckLabels,
	DesignStockCheckPayloadRow,
	IFrameDesignStockCheckEvent,
	IFrameDesignStockCheckRequest,
	IFrameDesignStockCheckResponse,
} from '../../presentation/iframe-design-stock-check-protocol';
import {
	DESIGN_STOCK_CHECK_EVENT_KEY,
	DESIGN_STOCK_CHECK_IFRAME_ID,
	DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
	DESIGN_STOCK_CHECK_REQUEST_KEY,
	DESIGN_STOCK_CHECK_RESPONSE_KEY,
	parseIFrameDesignStockCheckRequest,
	parseIFrameDesignStockCheckResponse,
} from '../../presentation/iframe-design-stock-check-protocol';

const PAGE_SIZE = 100;

interface Elements {
	shell: HTMLElement;
	boot: HTMLElement;
	bootMessage: HTMLElement;
	report: HTMLElement;
	sourceValue: HTMLElement;
	boardQuantityValue: HTMLElement;
	totalRowsValue: HTMLElement;
	statusFilter: HTMLSelectElement;
	rows: HTMLTableSectionElement;
	emptyReport: HTMLElement;
	previousPage: HTMLButtonElement;
	nextPage: HTMLButtonElement;
	pageStatus: HTMLElement;
	pager: HTMLElement;
	exportCsv: HTMLButtonElement;
	close: HTMLButtonElement;
	operationStatus: HTMLElement;
	connectionError: HTMLElement;
}

interface ActiveOperation {
	id: string;
	type: 'close' | 'export-csv';
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
		throw new TypeError('The design stock check request is unavailable.');
	}
	const writeEvent = async (event: IFrameDesignStockCheckEvent): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(DESIGN_STOCK_CHECK_EVENT_KEY, event);
		}
		catch {
			return false;
		}
	};
	await requireWrite(writeEvent, progress(request.requestId, 'script-started'));
	await requireWrite(writeEvent, progress(request.requestId, 'request-read'));
	render(elements, request, writeEvent);
	await requireWrite(writeEvent, progress(request.requestId, 'panel-rendered'));
	await requireWrite(writeEvent, {
		protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
		requestId: request.requestId,
		status: 'ready',
	});
}

function render(
	elements: Elements,
	request: IFrameDesignStockCheckRequest,
	writeEvent: (event: IFrameDesignStockCheckEvent) => Promise<boolean>,
): void {
	const { labels } = request;
	let active: ActiveOperation | undefined;
	let page = 0;
	let statusFilter: 'all' | DesignStockCheckPayloadRow['status'] = 'all';
	localize(elements, request);
	elements.sourceValue.textContent = sourceLabel(request, labels);
	elements.boardQuantityValue.textContent = String(request.boardQuantity);
	elements.totalRowsValue.textContent = String(request.rows.length);
	renderSummary(request);

	const renderPage = (): void => {
		const filteredRows = statusFilter === 'all'
			? request.rows
			: request.rows.filter(row => row.status === statusFilter);
		const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
		page = Math.min(Math.max(0, page), pageCount - 1);
		const start = page * PAGE_SIZE;
		const rows = filteredRows.slice(start, start + PAGE_SIZE);
		elements.rows.replaceChildren(...rows.map(row => renderRow(row, labels)));
		elements.emptyReport.hidden = filteredRows.length !== 0;
		elements.emptyReport.textContent = request.rows.length === 0 ? labels.emptyReport : labels.emptyFiltered;
		elements.previousPage.disabled = page === 0;
		elements.nextPage.disabled = page >= pageCount - 1;
		elements.pageStatus.textContent = format(labels.pageStatus, page + 1, pageCount);
		elements.pager.hidden = filteredRows.length <= PAGE_SIZE;
	};

	elements.statusFilter.addEventListener('change', () => {
		statusFilter = parseStatusFilter(elements.statusFilter.value);
		page = 0;
		renderPage();
	});

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
		elements.exportCsv.disabled = pending;
		elements.close.disabled = pending;
	};
	const sendAction = async (type: ActiveOperation['type']): Promise<void> => {
		if (active) {
			return;
		}
		active = { id: createOperationId(), type };
		setPending(true);
		elements.operationStatus.classList.remove('error');
		elements.operationStatus.textContent = type === 'export-csv' ? labels.exporting : '';
		try {
			await eda.sys_Storage.deleteExtensionUserConfig(DESIGN_STOCK_CHECK_RESPONSE_KEY);
			if (!await writeEvent({
				protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
				requestId: request.requestId,
				status: 'action',
				operationId: active.id,
				action: type,
			})) {
				throw new Error('The host rejected the design stock check action.');
			}
		}
		catch {
			active = undefined;
			setPending(false);
			showOperationError(elements, labels.operationError);
		}
	};

	elements.exportCsv.addEventListener('click', () => void sendAction('export-csv'));
	elements.close.addEventListener('click', () => void sendAction('close'));
	const timer = window.setInterval(() => {
		if (!active) {
			return;
		}
		let response: IFrameDesignStockCheckResponse | undefined;
		try {
			response = parseIFrameDesignStockCheckResponse(
				eda.sys_Storage.getExtensionUserConfig(DESIGN_STOCK_CHECK_RESPONSE_KEY),
				request.requestId,
				active.id,
			);
		}
		catch {
			response = undefined;
		}
		if (!response) {
			return;
		}
		const completed = active;
		active = undefined;
		if (response.status === 'failed') {
			setPending(false);
			showOperationError(elements, response.message ?? labels.operationError);
			return;
		}
		if (completed.type === 'close') {
			window.clearInterval(timer);
			void closePanel();
			return;
		}
		setPending(false);
		elements.operationStatus.classList.remove('error');
		elements.operationStatus.textContent = response.message || labels.exportSucceeded;
	}, 100);
	window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true });

	elements.shell.setAttribute('aria-busy', 'false');
	elements.boot.hidden = true;
	elements.report.hidden = false;
	renderPage();
}

function renderSummary(request: IFrameDesignStockCheckRequest): void {
	const values = {
		sufficient: request.summary.sufficient,
		insufficient: request.summary.insufficient,
		review: request.summary['review-required'],
		stocktake: request.summary['stocktake-required'],
		missing: request.summary['inventory-missing'],
		unmatched: request.summary['identity-unmatched'],
	};
	for (const [id, value] of Object.entries(values)) {
		element(`summary-${id}-value`, HTMLElement).textContent = String(value);
	}
}

function renderRow(row: DesignStockCheckPayloadRow, labels: DesignStockCheckLabels): HTMLTableRowElement {
	const tableRow = document.createElement('tr');
	tableRow.append(
		cell(row.lcscPartNumber || labels.emptyValue),
		cell(row.name || labels.emptyValue),
		cell(row.manufacturerPartNumber || labels.emptyValue),
		cell(row.package || labels.emptyValue),
		cell(row.designators.join(', ') || labels.emptyValue),
		cell(String(row.unitQuantity), true),
		cell(String(row.requiredQuantity), true),
		cell(availableQuantity(row, labels), true),
		cell(row.shortageQuantity === null ? labels.emptyValue : String(row.shortageQuantity), true),
		statusCell(row.status, labels),
	);
	return tableRow;
}

function cell(text: string, numeric = false): HTMLTableCellElement {
	const value = document.createElement('td');
	value.textContent = text;
	if (numeric) {
		value.className = 'numeric';
	}
	return value;
}

function statusCell(status: DesignStockCheckPayloadRow['status'], labels: DesignStockCheckLabels): HTMLTableCellElement {
	const value = document.createElement('td');
	const label = document.createElement('span');
	label.className = `status-label status-${status}`;
	label.textContent = statusLabel(status, labels);
	value.append(label);
	return value;
}

function availableQuantity(row: DesignStockCheckPayloadRow, labels: DesignStockCheckLabels): string {
	if (row.inventoryState === 'unknown') {
		return labels.quantityUnknown;
	}
	if (row.availableQuantity === null) {
		return labels.emptyValue;
	}
	return row.inventoryState === 'estimated'
		? format(labels.quantityEstimated, row.availableQuantity)
		: String(row.availableQuantity);
}

function statusLabel(status: DesignStockCheckPayloadRow['status'], labels: DesignStockCheckLabels): string {
	switch (status) {
		case 'sufficient': return labels.sufficient;
		case 'insufficient': return labels.insufficient;
		case 'review-required': return labels.reviewRequired;
		case 'stocktake-required': return labels.stocktakeRequired;
		case 'inventory-missing': return labels.inventoryMissing;
		case 'identity-unmatched': return labels.identityUnmatched;
	}
}

function parseStatusFilter(value: string): 'all' | DesignStockCheckPayloadRow['status'] {
	switch (value) {
		case 'sufficient':
		case 'insufficient':
		case 'review-required':
		case 'stocktake-required':
		case 'inventory-missing':
		case 'identity-unmatched':
			return value;
		default:
			return 'all';
	}
}

function sourceLabel(request: IFrameDesignStockCheckRequest, labels: DesignStockCheckLabels): string {
	return request.source === 'schematic'
		? labels.sourceSchematic
		: request.source === 'pcb' ? labels.sourcePcb : labels.sourceFile;
}

function localize(elements: Elements, request: IFrameDesignStockCheckRequest): void {
	const { labels } = request;
	document.documentElement.lang = inferLanguage(labels.title);
	document.title = labels.title;
	setText('source-label', labels.source);
	setText('board-quantity-label', labels.boardQuantity);
	setText('total-rows-label', labels.totalRows);
	setText('status-filter-label', labels.filterStatus);
	elements.statusFilter.replaceChildren(
		option('all', labels.filterAll),
		option('sufficient', labels.sufficient),
		option('insufficient', labels.insufficient),
		option('review-required', labels.reviewRequired),
		option('stocktake-required', labels.stocktakeRequired),
		option('inventory-missing', labels.inventoryMissing),
		option('identity-unmatched', labels.identityUnmatched),
	);
	setText('summary-sufficient-label', labels.sufficient);
	setText('summary-insufficient-label', labels.insufficient);
	setText('summary-review-label', labels.reviewRequired);
	setText('summary-stocktake-label', labels.stocktakeRequired);
	setText('summary-missing-label', labels.inventoryMissing);
	setText('summary-unmatched-label', labels.identityUnmatched);
	setText('column-part-number', labels.columnPartNumber);
	setText('column-name', labels.columnName);
	setText('column-manufacturer-part', labels.columnManufacturerPart);
	setText('column-package', labels.columnPackage);
	setText('column-designators', labels.columnDesignators);
	setText('column-unit-quantity', labels.columnUnitQuantity);
	setText('column-required-quantity', labels.columnRequiredQuantity);
	setText('column-available-quantity', labels.columnAvailableQuantity);
	setText('column-shortage-quantity', labels.columnShortageQuantity);
	setText('column-status', labels.columnStatus);
	elements.previousPage.title = labels.previousPage;
	elements.previousPage.setAttribute('aria-label', labels.previousPage);
	elements.nextPage.title = labels.nextPage;
	elements.nextPage.setAttribute('aria-label', labels.nextPage);
	elements.exportCsv.textContent = labels.exportCsv;
	elements.close.textContent = labels.close;
}

function getElements(): Elements {
	return {
		shell: element('panel-shell', HTMLElement),
		boot: element('boot-status', HTMLElement),
		bootMessage: element('boot-message', HTMLElement),
		report: element('report', HTMLElement),
		sourceValue: element('source-value', HTMLElement),
		boardQuantityValue: element('board-quantity-value', HTMLElement),
		totalRowsValue: element('total-rows-value', HTMLElement),
		statusFilter: element('status-filter', HTMLSelectElement),
		rows: element('report-rows', HTMLTableSectionElement),
		emptyReport: element('empty-report', HTMLElement),
		previousPage: element('previous-page', HTMLButtonElement),
		nextPage: element('next-page', HTMLButtonElement),
		pageStatus: element('page-status', HTMLElement),
		pager: element('pager', HTMLElement),
		exportCsv: element('export-csv', HTMLButtonElement),
		close: element('close', HTMLButtonElement),
		operationStatus: element('operation-status', HTMLElement),
		connectionError: element('connection-error', HTMLElement),
	};
}

function option(value: string, label: string): HTMLOptionElement {
	const element = document.createElement('option');
	element.value = value;
	element.textContent = label;
	return element;
}

function readRequest(): IFrameDesignStockCheckRequest | undefined {
	try {
		return parseIFrameDesignStockCheckRequest(
			eda.sys_Storage.getExtensionUserConfig(DESIGN_STOCK_CHECK_REQUEST_KEY),
		);
	}
	catch {
		return undefined;
	}
}

async function reportFailure(error: unknown): Promise<void> {
	let request: IFrameDesignStockCheckRequest | undefined;
	try {
		request = readRequest();
	}
	catch {
		request = undefined;
	}
	if (!request) {
		return;
	}
	try {
		await eda.sys_Storage.setExtensionUserConfig(DESIGN_STOCK_CHECK_EVENT_KEY, {
			protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'failed',
			stage: 'script-started',
			errorName: errorName(error),
			error: errorMessage(error),
		} satisfies IFrameDesignStockCheckEvent);
	}
	catch {
		// The host will enforce its ready timeout if the bridge is unavailable.
	}
}

function showOperationError(elements: Elements, message: string): void {
	elements.operationStatus.classList.add('error');
	elements.operationStatus.textContent = message;
}

function showConnectionError(elements: Elements | undefined): void {
	if (!elements) {
		return;
	}
	elements.shell.setAttribute('aria-busy', 'false');
	elements.boot.hidden = true;
	elements.report.hidden = true;
	elements.connectionError.textContent = fallbackConnectionError();
	elements.connectionError.hidden = false;
}

async function closePanel(): Promise<void> {
	try {
		await eda.sys_IFrame.closeIFrame(DESIGN_STOCK_CHECK_IFRAME_ID);
	}
	catch {
		// The host poller will close the panel after receiving the close action.
	}
}

function progress(
	requestId: string,
	stage: 'panel-rendered' | 'request-read' | 'script-started',
): IFrameDesignStockCheckEvent {
	return { protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION, requestId, status: 'progress', stage };
}

async function requireWrite(
	writeEvent: (event: IFrameDesignStockCheckEvent) => Promise<boolean>,
	event: IFrameDesignStockCheckEvent,
): Promise<void> {
	if (!await writeEvent(event)) {
		throw new Error('The host rejected the design stock check event.');
	}
}

function setText(id: string, value: string): void {
	element(id, HTMLElement).textContent = value;
}

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
	const value = document.getElementById(id);
	if (!(value instanceof constructor)) {
		throw new TypeError(`Missing design stock check panel element: ${id}`);
	}
	return value;
}

function createOperationId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function format(template: string, ...values: Array<number | string>): string {
	return values.reduce<string>(
		(result, value, index) => result.replaceAll(`\${${index + 1}}`, String(value)),
		template,
	);
}

function localizeBootstrap(elements: Elements): void {
	const chinese = usesChineseBrowserLanguage();
	document.documentElement.lang = chinese ? 'zh-Hans' : 'en';
	elements.bootMessage.textContent = chinese ? '正在加载报告...' : 'Loading report...';
}

function fallbackConnectionError(): string {
	return usesChineseBrowserLanguage() ? '报告连接失败。' : 'The report connection failed.';
}

function usesChineseBrowserLanguage(): boolean {
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
