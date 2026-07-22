import type {
	IFrameInventoryTransactionsEvent,
	IFrameInventoryTransactionsRequest,
	IFrameInventoryTransactionsResponse,
	InventoryTransactionsBatchPayload,
	InventoryTransactionsEntryPayload,
	InventoryTransactionsLabels,
	InventoryTransactionsSnapshotPayload,
} from '../../presentation/iframe-inventory-transactions-protocol';
import {
	INVENTORY_TRANSACTIONS_EVENT_KEY,
	INVENTORY_TRANSACTIONS_IFRAME_ID,
	INVENTORY_TRANSACTIONS_PROTOCOL_VERSION,
	INVENTORY_TRANSACTIONS_REQUEST_KEY,
	INVENTORY_TRANSACTIONS_RESPONSE_KEY,
	parseIFrameInventoryTransactionsRequest,
	parseIFrameInventoryTransactionsResponse,
} from '../../presentation/iframe-inventory-transactions-protocol';

const BATCH_PAGE_SIZE = 50;
const TRANSACTION_PAGE_SIZE = 100;

type TypeFilter = 'all' | InventoryTransactionsEntryPayload['kind'];

interface Elements {
	shell: HTMLElement;
	boot: HTMLElement;
	bootMessage: HTMLElement;
	history: HTMLElement;
	batchCountValue: HTMLElement;
	transactionCountValue: HTMLElement;
	batchRows: HTMLTableSectionElement;
	emptyBatches: HTMLElement;
	batchPreviousPage: HTMLButtonElement;
	batchNextPage: HTMLButtonElement;
	batchPageStatus: HTMLElement;
	batchPager: HTMLElement;
	typeFilter: HTMLSelectElement;
	batchFilter: HTMLSelectElement;
	transactionRows: HTMLTableSectionElement;
	emptyTransactions: HTMLElement;
	transactionPreviousPage: HTMLButtonElement;
	transactionNextPage: HTMLButtonElement;
	transactionPageStatus: HTMLElement;
	transactionPager: HTMLElement;
	refresh: HTMLButtonElement;
	close: HTMLButtonElement;
	operationStatus: HTMLElement;
	connectionError: HTMLElement;
	confirmDialog: HTMLDialogElement;
	confirmTitle: HTMLElement;
	confirmMessage: HTMLElement;
	confirmCancel: HTMLButtonElement;
	confirmSubmit: HTMLButtonElement;
}

interface ActiveOperation {
	id: string;
	type: 'close' | 'refresh' | 'undo-batch';
	batchId?: string;
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
		throw new TypeError('The inventory transactions request is unavailable.');
	}
	const writeEvent = async (event: IFrameInventoryTransactionsEvent): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(INVENTORY_TRANSACTIONS_EVENT_KEY, event);
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
	request: IFrameInventoryTransactionsRequest,
	writeEvent: (event: IFrameInventoryTransactionsEvent) => Promise<boolean>,
): void {
	const { labels } = request;
	let snapshot = request.snapshot;
	let active: ActiveOperation | undefined;
	let batchPage = 0;
	let transactionPage = 0;
	let typeFilter: TypeFilter = 'all';
	let batchFilter = 'all';
	let pendingUndoBatchId: string | undefined;
	localize(elements, labels);

	const setPending = (pending: boolean): void => {
		elements.refresh.disabled = pending;
		elements.close.disabled = pending;
		document.querySelectorAll<HTMLButtonElement>('.row-action').forEach((button) => {
			button.disabled = pending;
		});
	};

	const sendAction = async (type: ActiveOperation['type'], batchId?: string): Promise<void> => {
		if (active)
			return;
		if (type === 'undo-batch') {
			const batch = snapshot.batches.find(candidate => candidate.id === batchId);
			if (!batch || batch.status !== 'active')
				return;
		}
		active = { id: createOperationId(), type, batchId };
		setPending(true);
		elements.operationStatus.classList.remove('error');
		elements.operationStatus.textContent = type === 'undo-batch'
			? labels.undoing
			: type === 'refresh' ? labels.refreshing : '';
		try {
			await eda.sys_Storage.deleteExtensionUserConfig(INVENTORY_TRANSACTIONS_RESPONSE_KEY);
			const event: IFrameInventoryTransactionsEvent = type === 'undo-batch'
				? {
						protocolVersion: 1,
						requestId: request.requestId,
						status: 'action',
						operationId: active.id,
						action: 'undo-batch',
						batchId: batchId!,
					}
				: {
						protocolVersion: 1,
						requestId: request.requestId,
						status: 'action',
						operationId: active.id,
						action: type,
					};
			if (!await writeEvent(event))
				throw new Error('The host rejected the inventory transactions action.');
		}
		catch {
			active = undefined;
			setPending(false);
			showOperationError(elements, labels.operationError);
		}
	};

	const renderBatchPage = (): void => {
		const pageCount = Math.max(1, Math.ceil(snapshot.batches.length / BATCH_PAGE_SIZE));
		batchPage = Math.min(Math.max(batchPage, 0), pageCount - 1);
		const start = batchPage * BATCH_PAGE_SIZE;
		elements.batchRows.replaceChildren(...snapshot.batches.slice(start, start + BATCH_PAGE_SIZE)
			.map(batch => renderBatchRow(batch, labels, (batchId) => {
				pendingUndoBatchId = batchId;
				elements.confirmDialog.showModal();
			})));
		elements.emptyBatches.hidden = snapshot.batches.length !== 0;
		elements.emptyBatches.textContent = labels.emptyBatches;
		elements.batchPreviousPage.disabled = batchPage === 0;
		elements.batchNextPage.disabled = batchPage >= pageCount - 1;
		elements.batchPageStatus.textContent = formatPage(labels.pageStatus, batchPage + 1, pageCount);
		elements.batchPager.hidden = snapshot.batches.length <= BATCH_PAGE_SIZE;
	};

	const renderTransactionPage = (): void => {
		const filtered = snapshot.transactions.filter(transaction => (
			(typeFilter === 'all' || transaction.kind === typeFilter)
			&& (batchFilter === 'all' || transaction.batchId === batchFilter)
		));
		const pageCount = Math.max(1, Math.ceil(filtered.length / TRANSACTION_PAGE_SIZE));
		transactionPage = Math.min(Math.max(transactionPage, 0), pageCount - 1);
		const start = transactionPage * TRANSACTION_PAGE_SIZE;
		elements.transactionRows.replaceChildren(...filtered.slice(start, start + TRANSACTION_PAGE_SIZE)
			.map(transaction => renderTransactionRow(transaction, snapshot, labels)));
		elements.emptyTransactions.hidden = filtered.length !== 0;
		elements.emptyTransactions.textContent = snapshot.transactions.length === 0
			? labels.emptyTransactions
			: labels.emptyFiltered;
		elements.transactionPreviousPage.disabled = transactionPage === 0;
		elements.transactionNextPage.disabled = transactionPage >= pageCount - 1;
		elements.transactionPageStatus.textContent = formatPage(labels.pageStatus, transactionPage + 1, pageCount);
		elements.transactionPager.hidden = filtered.length <= TRANSACTION_PAGE_SIZE;
	};

	const renderAll = (): void => {
		elements.batchCountValue.textContent = String(snapshot.batches.length);
		elements.transactionCountValue.textContent = String(snapshot.transactions.length);
		const currentBatch = batchFilter;
		elements.batchFilter.replaceChildren(
			option('all', labels.filterAll),
			...snapshot.batches.map(batch => option(batch.id, batchOptionLabel(batch, labels))),
		);
		batchFilter = snapshot.batches.some(batch => batch.id === currentBatch) ? currentBatch : 'all';
		elements.batchFilter.value = batchFilter;
		renderBatchPage();
		renderTransactionPage();
		setPending(Boolean(active));
	};

	elements.typeFilter.addEventListener('change', () => {
		typeFilter = parseTypeFilter(elements.typeFilter.value);
		transactionPage = 0;
		renderTransactionPage();
	});
	elements.batchFilter.addEventListener('change', () => {
		batchFilter = elements.batchFilter.value;
		transactionPage = 0;
		renderTransactionPage();
	});
	elements.batchPreviousPage.addEventListener('click', () => {
		batchPage -= 1;
		renderBatchPage();
	});
	elements.batchNextPage.addEventListener('click', () => {
		batchPage += 1;
		renderBatchPage();
	});
	elements.transactionPreviousPage.addEventListener('click', () => {
		transactionPage -= 1;
		renderTransactionPage();
	});
	elements.transactionNextPage.addEventListener('click', () => {
		transactionPage += 1;
		renderTransactionPage();
	});
	elements.refresh.addEventListener('click', () => void sendAction('refresh'));
	elements.close.addEventListener('click', () => void sendAction('close'));
	elements.confirmCancel.addEventListener('click', () => {
		pendingUndoBatchId = undefined;
		elements.confirmDialog.close();
	});
	elements.confirmSubmit.addEventListener('click', () => {
		const batchId = pendingUndoBatchId;
		pendingUndoBatchId = undefined;
		elements.confirmDialog.close();
		if (batchId)
			void sendAction('undo-batch', batchId);
	});

	const timer = window.setInterval(() => {
		if (!active)
			return;
		let response: IFrameInventoryTransactionsResponse | undefined;
		try {
			response = parseIFrameInventoryTransactionsResponse(
				eda.sys_Storage.getExtensionUserConfig(INVENTORY_TRANSACTIONS_RESPONSE_KEY),
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
		if (completed.type === 'close') {
			window.clearInterval(timer);
			void closePanel();
			return;
		}
		if (response.snapshot) {
			snapshot = response.snapshot;
			renderAll();
		}
		setPending(false);
		elements.operationStatus.classList.remove('error');
		elements.operationStatus.textContent = response.message
			|| (completed.type === 'undo-batch' ? labels.undoSucceeded : labels.refreshSucceeded);
	}, 100);
	window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true });

	elements.shell.setAttribute('aria-busy', 'false');
	elements.boot.hidden = true;
	elements.history.hidden = false;
	renderAll();
}

function renderBatchRow(
	batch: InventoryTransactionsBatchPayload,
	labels: InventoryTransactionsLabels,
	onUndo: (batchId: string) => void,
): HTMLTableRowElement {
	const row = document.createElement('tr');
	const actions = document.createElement('td');
	if (batch.status === 'active') {
		const undo = document.createElement('button');
		undo.className = 'row-action';
		undo.type = 'button';
		undo.textContent = labels.undoBatch;
		undo.addEventListener('click', () => onUndo(batch.id));
		actions.append(undo);
	}
	else {
		actions.textContent = labels.emptyValue;
	}
	row.append(
		cell(batch.sourceName || labels.emptyValue),
		cell(`${batch.fingerprintShort} / ${batch.sourceFingerprintShort}`),
		cell(formatTimestamp(batch.createdAt)),
		statusCell(batch, labels),
		cell(String(batch.lineCount), true),
		cell(String(batch.totalQuantity), true),
		actions,
	);
	return row;
}

function renderTransactionRow(
	transaction: InventoryTransactionsEntryPayload,
	snapshot: InventoryTransactionsSnapshotPayload,
	labels: InventoryTransactionsLabels,
): HTMLTableRowElement {
	const batch = snapshot.batches.find(candidate => candidate.id === transaction.batchId);
	const row = document.createElement('tr');
	row.append(
		cell(formatTimestamp(transaction.createdAt)),
		cell(transaction.kind === 'bom-stock-out' ? labels.typeStockOut : labels.typeReversal),
		cell(transaction.lcscPartNumber || labels.emptyValue),
		cell(transaction.name),
		cell(transaction.manufacturerPartNumber || labels.emptyValue),
		cell(transaction.package || labels.emptyValue),
		deltaCell(transaction.delta),
		cell(String(transaction.beforeQuantity), true),
		cell(String(transaction.afterQuantity), true),
		cell(batch?.fingerprintShort ?? labels.emptyValue),
		cell(transaction.note || labels.emptyValue),
	);
	return row;
}

function cell(text: string, numeric = false): HTMLTableCellElement {
	const result = document.createElement('td');
	result.textContent = text;
	if (numeric)
		result.className = 'numeric';
	return result;
}

function deltaCell(delta: number): HTMLTableCellElement {
	const result = cell(delta > 0 ? `+${delta}` : String(delta), true);
	result.classList.add(delta > 0 ? 'delta-positive' : 'delta-negative');
	return result;
}

function statusCell(batch: InventoryTransactionsBatchPayload, labels: InventoryTransactionsLabels): HTMLTableCellElement {
	const result = document.createElement('td');
	const status = document.createElement('span');
	status.className = `status-label ${batch.status}`;
	status.textContent = batch.status === 'active' ? labels.statusActive : labels.statusReversed;
	result.append(status);
	if (batch.reversedAt) {
		result.append(document.createElement('br'), document.createTextNode(formatTimestamp(batch.reversedAt)));
	}
	return result;
}

function batchOptionLabel(batch: InventoryTransactionsBatchPayload, labels: InventoryTransactionsLabels): string {
	return `${batch.sourceName || labels.emptyValue} (${batch.fingerprintShort})`;
}

function parseTypeFilter(value: string): TypeFilter {
	return value === 'bom-stock-out' || value === 'bom-stock-out-reversal' ? value : 'all';
}

function option(value: string, text: string): HTMLOptionElement {
	const result = document.createElement('option');
	result.value = value;
	result.textContent = text;
	return result;
}

function localize(elements: Elements, labels: InventoryTransactionsLabels): void {
	document.documentElement.lang = inferLanguage(labels.title);
	document.title = labels.title;
	setText('batch-count-label', labels.batchCount);
	setText('transaction-count-label', labels.transactionCount);
	setText('batches-title', labels.batchesTitle);
	setText('transactions-title', labels.transactionsTitle);
	setText('type-filter-label', labels.filterType);
	setText('batch-filter-label', labels.filterBatch);
	elements.typeFilter.replaceChildren(
		option('all', labels.filterAll),
		option('bom-stock-out', labels.typeStockOut),
		option('bom-stock-out-reversal', labels.typeReversal),
	);
	setText('batch-column-source', labels.columnSource);
	setText('batch-column-fingerprint', labels.columnFingerprint);
	setText('batch-column-created-at', labels.columnCreatedAt);
	setText('batch-column-status', labels.columnStatus);
	setText('batch-column-line-count', labels.columnLineCount);
	setText('batch-column-total-quantity', labels.columnTotalQuantity);
	setText('batch-column-actions', labels.columnActions);
	setText('transaction-column-created-at', labels.columnCreatedAt);
	setText('transaction-column-type', labels.columnType);
	setText('transaction-column-part-number', labels.columnPartNumber);
	setText('transaction-column-name', labels.columnName);
	setText('transaction-column-manufacturer-part-number', labels.columnManufacturerPartNumber);
	setText('transaction-column-package', labels.columnPackage);
	setText('transaction-column-delta', labels.columnDelta);
	setText('transaction-column-before-quantity', labels.columnBeforeQuantity);
	setText('transaction-column-after-quantity', labels.columnAfterQuantity);
	setText('transaction-column-batch', labels.columnBatch);
	setText('transaction-column-note', labels.columnNote);
	setPagerLabels(elements.batchPreviousPage, elements.batchNextPage, labels);
	setPagerLabels(elements.transactionPreviousPage, elements.transactionNextPage, labels);
	elements.refresh.textContent = labels.refresh;
	elements.close.textContent = labels.close;
	elements.confirmTitle.textContent = labels.undoBatch;
	elements.confirmMessage.textContent = labels.confirmUndoBatch;
	elements.confirmCancel.textContent = labels.cancel;
	elements.confirmSubmit.textContent = labels.undoBatch;
}

function setPagerLabels(
	previous: HTMLButtonElement,
	next: HTMLButtonElement,
	labels: InventoryTransactionsLabels,
): void {
	previous.title = labels.previousPage;
	previous.setAttribute('aria-label', labels.previousPage);
	next.title = labels.nextPage;
	next.setAttribute('aria-label', labels.nextPage);
}

function getElements(): Elements {
	return {
		shell: element('panel-shell', HTMLElement),
		boot: element('boot-status', HTMLElement),
		bootMessage: element('boot-message', HTMLElement),
		history: element('history', HTMLElement),
		batchCountValue: element('batch-count-value', HTMLElement),
		transactionCountValue: element('transaction-count-value', HTMLElement),
		batchRows: element('batch-rows', HTMLTableSectionElement),
		emptyBatches: element('empty-batches', HTMLElement),
		batchPreviousPage: element('batch-previous-page', HTMLButtonElement),
		batchNextPage: element('batch-next-page', HTMLButtonElement),
		batchPageStatus: element('batch-page-status', HTMLElement),
		batchPager: element('batch-pager', HTMLElement),
		typeFilter: element('type-filter', HTMLSelectElement),
		batchFilter: element('batch-filter', HTMLSelectElement),
		transactionRows: element('transaction-rows', HTMLTableSectionElement),
		emptyTransactions: element('empty-transactions', HTMLElement),
		transactionPreviousPage: element('transaction-previous-page', HTMLButtonElement),
		transactionNextPage: element('transaction-next-page', HTMLButtonElement),
		transactionPageStatus: element('transaction-page-status', HTMLElement),
		transactionPager: element('transaction-pager', HTMLElement),
		refresh: element('refresh', HTMLButtonElement),
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

function readRequest(): IFrameInventoryTransactionsRequest | undefined {
	try {
		return parseIFrameInventoryTransactionsRequest(
			eda.sys_Storage.getExtensionUserConfig(INVENTORY_TRANSACTIONS_REQUEST_KEY),
		);
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
		await eda.sys_Storage.setExtensionUserConfig(INVENTORY_TRANSACTIONS_EVENT_KEY, {
			protocolVersion: 1,
			requestId: request.requestId,
			status: 'failed',
			stage: 'script-started',
			errorName: errorName(error),
			error: errorMessage(error),
		} satisfies IFrameInventoryTransactionsEvent);
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
	elements.history.hidden = true;
	elements.connectionError.textContent = usesChineseLanguage() ? '库存流水连接失败。' : 'The inventory history connection failed.';
	elements.connectionError.hidden = false;
}

async function closePanel(): Promise<void> {
	try {
		await eda.sys_IFrame.closeIFrame(INVENTORY_TRANSACTIONS_IFRAME_ID);
	}
	catch {
		// The host closes the panel after processing the close action.
	}
}

function progress(
	requestId: string,
	stage: 'panel-rendered' | 'request-read' | 'script-started',
): IFrameInventoryTransactionsEvent {
	return { protocolVersion: INVENTORY_TRANSACTIONS_PROTOCOL_VERSION, requestId, status: 'progress', stage };
}

async function requireWrite(
	write: (event: IFrameInventoryTransactionsEvent) => Promise<boolean>,
	event: IFrameInventoryTransactionsEvent,
): Promise<void> {
	if (!await write(event))
		throw new Error('The host rejected the inventory transactions event.');
}

function setText(id: string, text: string): void {
	element(id, HTMLElement).textContent = text;
}

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
	const result = document.getElementById(id);
	if (!(result instanceof constructor))
		throw new TypeError(`Missing inventory transactions element: ${id}`);
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

function formatTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime()))
		return value;
	const datePart = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
		.map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
		.join('-');
	const timePart = [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map(part => String(part).padStart(2, '0'))
		.join(':');
	return `${datePart} ${timePart}`;
}

function localizeBootstrap(elements: Elements): void {
	const chinese = usesChineseLanguage();
	document.documentElement.lang = chinese ? 'zh-Hans' : 'en';
	elements.bootMessage.textContent = chinese ? '正在加载库存流水...' : 'Loading inventory history...';
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
