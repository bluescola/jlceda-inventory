import type {
	BomDiffLabels,
	BomDiffPayloadEntry,
	BomDiffPayloadIssue,
	BomDiffPayloadUnmatchedRow,
	IFrameBomDiffEvent,
	IFrameBomDiffRequest,
	IFrameBomDiffResponse,
} from '../../presentation/iframe-bom-diff-protocol';
import {
	BOM_DIFF_EVENT_KEY,
	BOM_DIFF_IFRAME_ID,
	BOM_DIFF_PROTOCOL_VERSION,
	BOM_DIFF_REQUEST_KEY,
	BOM_DIFF_RESPONSE_KEY,
	parseIFrameBomDiffRequest,
	parseIFrameBomDiffResponse,
} from '../../presentation/iframe-bom-diff-protocol';

const DIFF_PAGE_SIZE = 100;
const REVIEW_PAGE_SIZE = 50;

type ChangeFilter = 'all' | BomDiffPayloadEntry['type'];
type ReviewKind = 'before-unmatched' | 'after-unmatched' | 'before-issues' | 'after-issues';

interface Elements {
	shell: HTMLElement;
	boot: HTMLElement;
	bootMessage: HTMLElement;
	report: HTMLElement;
	beforeFileValue: HTMLElement;
	afterFileValue: HTMLElement;
	totalChangesValue: HTMLElement;
	changeFilter: HTMLSelectElement;
	diffRows: HTMLTableSectionElement;
	diffEmpty: HTMLElement;
	diffPreviousPage: HTMLButtonElement;
	diffNextPage: HTMLButtonElement;
	diffPageStatus: HTMLElement;
	diffPager: HTMLElement;
	reviewKind: HTMLSelectElement;
	reviewRows: HTMLTableSectionElement;
	reviewEmpty: HTMLElement;
	reviewColumnSecond: HTMLElement;
	reviewColumnThird: HTMLElement;
	reviewColumnFourth: HTMLElement;
	reviewPreviousPage: HTMLButtonElement;
	reviewNextPage: HTMLButtonElement;
	reviewPageStatus: HTMLElement;
	reviewPager: HTMLElement;
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
		throw new TypeError('The BOM diff request is unavailable.');
	}
	const writeEvent = async (event: IFrameBomDiffEvent): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(BOM_DIFF_EVENT_KEY, event);
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
		protocolVersion: BOM_DIFF_PROTOCOL_VERSION,
		requestId: request.requestId,
		status: 'ready',
	});
}

function render(
	elements: Elements,
	request: IFrameBomDiffRequest,
	writeEvent: (event: IFrameBomDiffEvent) => Promise<boolean>,
): void {
	const { labels } = request;
	let active: ActiveOperation | undefined;
	let diffPage = 0;
	let changeFilter: ChangeFilter = 'all';
	let reviewPage = 0;
	let reviewKind = firstReviewKind(request);

	localize(elements, request);
	elements.beforeFileValue.textContent = request.beforeFileName;
	elements.afterFileValue.textContent = request.afterFileName;
	elements.totalChangesValue.textContent = String(request.entries.length);
	renderSummary(request);

	const renderDiffPage = (): void => {
		const filtered = changeFilter === 'all'
			? request.entries
			: request.entries.filter(entry => entry.type === changeFilter);
		const pageCount = Math.max(1, Math.ceil(filtered.length / DIFF_PAGE_SIZE));
		diffPage = Math.min(Math.max(diffPage, 0), pageCount - 1);
		const start = diffPage * DIFF_PAGE_SIZE;
		elements.diffRows.replaceChildren(...filtered.slice(start, start + DIFF_PAGE_SIZE)
			.map(entry => renderDiffRow(entry, labels)));
		elements.diffEmpty.hidden = filtered.length !== 0;
		elements.diffEmpty.textContent = request.entries.length === 0 ? labels.emptyReport : labels.emptyFiltered;
		elements.diffPreviousPage.disabled = diffPage === 0;
		elements.diffNextPage.disabled = diffPage >= pageCount - 1;
		elements.diffPageStatus.textContent = format(labels.pageStatus, diffPage + 1, pageCount);
		elements.diffPager.hidden = filtered.length <= DIFF_PAGE_SIZE;
	};

	const renderReviewPage = (): void => {
		const values = reviewValues(request, reviewKind);
		const pageCount = Math.max(1, Math.ceil(values.length / REVIEW_PAGE_SIZE));
		reviewPage = Math.min(Math.max(reviewPage, 0), pageCount - 1);
		const start = reviewPage * REVIEW_PAGE_SIZE;
		setReviewHeaders(elements, labels, reviewKind);
		elements.reviewRows.replaceChildren(...values.slice(start, start + REVIEW_PAGE_SIZE).map(value => (
			isIssueKind(reviewKind)
				? renderIssueRow(value as BomDiffPayloadIssue, labels)
				: renderUnmatchedRow(value as BomDiffPayloadUnmatchedRow, labels)
		)));
		elements.reviewEmpty.hidden = values.length !== 0;
		elements.reviewEmpty.textContent = labels.reviewEmpty;
		elements.reviewPreviousPage.disabled = reviewPage === 0;
		elements.reviewNextPage.disabled = reviewPage >= pageCount - 1;
		elements.reviewPageStatus.textContent = format(labels.pageStatus, reviewPage + 1, pageCount);
		elements.reviewPager.hidden = values.length <= REVIEW_PAGE_SIZE;
	};

	elements.changeFilter.addEventListener('change', () => {
		changeFilter = parseChangeFilter(elements.changeFilter.value);
		diffPage = 0;
		renderDiffPage();
	});
	elements.diffPreviousPage.addEventListener('click', () => {
		diffPage -= 1;
		renderDiffPage();
		elements.diffRows.parentElement?.scrollTo({ top: 0 });
	});
	elements.diffNextPage.addEventListener('click', () => {
		diffPage += 1;
		renderDiffPage();
		elements.diffRows.parentElement?.scrollTo({ top: 0 });
	});

	elements.reviewKind.value = reviewKind;
	elements.reviewKind.addEventListener('change', () => {
		reviewKind = parseReviewKind(elements.reviewKind.value);
		reviewPage = 0;
		renderReviewPage();
	});
	elements.reviewPreviousPage.addEventListener('click', () => {
		reviewPage -= 1;
		renderReviewPage();
		elements.reviewRows.parentElement?.scrollTo({ top: 0 });
	});
	elements.reviewNextPage.addEventListener('click', () => {
		reviewPage += 1;
		renderReviewPage();
		elements.reviewRows.parentElement?.scrollTo({ top: 0 });
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
			await eda.sys_Storage.deleteExtensionUserConfig(BOM_DIFF_RESPONSE_KEY);
			if (!await writeEvent({
				protocolVersion: BOM_DIFF_PROTOCOL_VERSION,
				requestId: request.requestId,
				status: 'action',
				operationId: active.id,
				action: type,
			})) {
				throw new Error('The host rejected the BOM diff action.');
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
		let response: IFrameBomDiffResponse | undefined;
		try {
			response = parseIFrameBomDiffResponse(
				eda.sys_Storage.getExtensionUserConfig(BOM_DIFF_RESPONSE_KEY),
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
	renderDiffPage();
	renderReviewPage();
}

function renderSummary(request: IFrameBomDiffRequest): void {
	const values = {
		added: request.summary.added,
		removed: request.summary.removed,
		increased: request.summary['quantity-increased'],
		decreased: request.summary['quantity-decreased'],
		identity: request.summary['identity-changed'],
	};
	for (const [id, value] of Object.entries(values)) {
		element(`summary-${id}-value`, HTMLElement).textContent = String(value);
	}
}

function renderDiffRow(entry: BomDiffPayloadEntry, labels: BomDiffLabels): HTMLTableRowElement {
	const row = document.createElement('tr');
	row.append(
		cell(entry.lcscPartNumber),
		changeTypeCell(entry.type, labels),
		cell(formatQuantity(entry.beforeQuantity, labels), true),
		cell(formatQuantity(entry.afterQuantity, labels), true),
		cell(formatDelta(entry.quantityDelta, labels), true),
		cell(formatValues(entry.beforeDesignators, labels)),
		cell(formatValues(entry.afterDesignators, labels)),
		identityChangesCell(entry, labels),
	);
	return row;
}

function changeTypeCell(type: BomDiffPayloadEntry['type'], labels: BomDiffLabels): HTMLTableCellElement {
	const value = document.createElement('td');
	const label = document.createElement('span');
	label.className = `change-label change-${type}`;
	label.textContent = changeTypeLabel(type, labels);
	value.append(label);
	return value;
}

function identityChangesCell(entry: BomDiffPayloadEntry, labels: BomDiffLabels): HTMLTableCellElement {
	const value = document.createElement('td');
	if (entry.identityChanges.length === 0) {
		value.textContent = labels.emptyValue;
		return value;
	}
	for (const change of entry.identityChanges) {
		const line = document.createElement('div');
		line.className = 'identity-change';
		const name = document.createElement('span');
		name.className = 'identity-change-name';
		name.textContent = `${identityFieldLabel(change.field, labels)}: `;
		const values = document.createElement('span');
		values.className = 'identity-change-values';
		values.textContent = `${formatValues(change.before, labels)} -> ${formatValues(change.after, labels)}`;
		line.append(name, values);
		value.append(line);
	}
	return value;
}

function renderUnmatchedRow(row: BomDiffPayloadUnmatchedRow, labels: BomDiffLabels): HTMLTableRowElement {
	const tableRow = document.createElement('tr');
	tableRow.append(
		cell(sourceRow(row.sheetName, row.rowNumber)),
		cell(String(row.quantity), true),
		cell(formatValues(row.designators, labels)),
		cell(formatIdentity(row.identity, labels)),
	);
	return tableRow;
}

function renderIssueRow(issue: BomDiffPayloadIssue, labels: BomDiffLabels): HTMLTableRowElement {
	const tableRow = document.createElement('tr');
	tableRow.append(
		cell(sourceRow(issue.sheetName, issue.rowNumber)),
		cell(issueLabel(issue.code, labels)),
		cell(issue.field ? issueFieldLabel(issue.field, labels) : labels.emptyValue),
		cell(issue.value || labels.emptyValue),
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

function setReviewHeaders(elements: Elements, labels: BomDiffLabels, kind: ReviewKind): void {
	if (isIssueKind(kind)) {
		elements.reviewColumnSecond.textContent = labels.columnIssue;
		elements.reviewColumnThird.textContent = labels.columnField;
		elements.reviewColumnFourth.textContent = labels.columnValue;
		return;
	}
	elements.reviewColumnSecond.textContent = labels.columnQuantity;
	elements.reviewColumnThird.textContent = labels.columnDesignators;
	elements.reviewColumnFourth.textContent = labels.columnIdentity;
}

function reviewValues(
	request: IFrameBomDiffRequest,
	kind: ReviewKind,
): BomDiffPayloadUnmatchedRow[] | BomDiffPayloadIssue[] {
	switch (kind) {
		case 'before-unmatched': return request.unmatchedBefore;
		case 'after-unmatched': return request.unmatchedAfter;
		case 'before-issues': return request.issuesBefore;
		case 'after-issues': return request.issuesAfter;
	}
}

function firstReviewKind(request: IFrameBomDiffRequest): ReviewKind {
	if (request.unmatchedBefore.length > 0) {
		return 'before-unmatched';
	}
	if (request.unmatchedAfter.length > 0) {
		return 'after-unmatched';
	}
	if (request.issuesBefore.length > 0) {
		return 'before-issues';
	}
	if (request.issuesAfter.length > 0) {
		return 'after-issues';
	}
	return 'before-unmatched';
}

function isIssueKind(kind: ReviewKind): boolean {
	return kind === 'before-issues' || kind === 'after-issues';
}

function formatIdentity(identity: BomDiffPayloadUnmatchedRow['identity'], labels: BomDiffLabels): string {
	const values = [
		[labels.identityName, identity.name],
		[labels.identityManufacturerPartNumber, identity.manufacturerPartNumber],
		[labels.identityManufacturer, identity.manufacturer],
		[labels.identityPackage, identity.package],
	].filter((item): item is [string, string] => Boolean(item[1]));
	return values.length === 0 ? labels.emptyValue : values.map(([name, value]) => `${name}: ${value}`).join('; ');
}

function formatQuantity(value: number | null, labels: BomDiffLabels): string {
	return value === null ? labels.emptyValue : String(value);
}

function formatDelta(value: number | null, labels: BomDiffLabels): string {
	if (value === null) {
		return labels.emptyValue;
	}
	return value > 0 ? `+${value}` : String(value);
}

function formatValues(values: readonly string[], labels: BomDiffLabels): string {
	return values.length === 0 ? labels.emptyValue : values.join(', ');
}

function sourceRow(sheetName: string, rowNumber: number): string {
	return `${sheetName} #${rowNumber}`;
}

function changeTypeLabel(type: BomDiffPayloadEntry['type'], labels: BomDiffLabels): string {
	switch (type) {
		case 'added': return labels.changeAdded;
		case 'removed': return labels.changeRemoved;
		case 'quantity-increased': return labels.changeQuantityIncreased;
		case 'quantity-decreased': return labels.changeQuantityDecreased;
		case 'identity-changed': return labels.changeIdentityChanged;
	}
}

function identityFieldLabel(field: BomDiffPayloadEntry['identityChanges'][number]['field'], labels: BomDiffLabels): string {
	switch (field) {
		case 'name': return labels.identityName;
		case 'manufacturerPartNumber': return labels.identityManufacturerPartNumber;
		case 'manufacturer': return labels.identityManufacturer;
		case 'package': return labels.identityPackage;
	}
}

function issueLabel(code: BomDiffPayloadIssue['code'], labels: BomDiffLabels): string {
	switch (code) {
		case 'invalid-exclusion': return labels.issueInvalidExclusion;
		case 'invalid-lcsc-part-number': return labels.issueInvalidLcscPartNumber;
		case 'invalid-quantity': return labels.issueInvalidQuantity;
		case 'missing-identity': return labels.issueMissingIdentity;
		case 'missing-lcsc-part-number': return labels.issueMissingLcscPartNumber;
		case 'missing-quantity': return labels.issueMissingQuantity;
		case 'quantity-designator-mismatch': return labels.issueQuantityDesignatorMismatch;
	}
}

function issueFieldLabel(field: NonNullable<BomDiffPayloadIssue['field']>, labels: BomDiffLabels): string {
	switch (field) {
		case 'lcscPartNumber': return labels.fieldLcscPartNumber;
		case 'designators': return labels.fieldDesignators;
		case 'quantity': return labels.fieldQuantity;
		case 'name': return labels.fieldName;
		case 'manufacturerPartNumber': return labels.fieldManufacturerPartNumber;
		case 'manufacturer': return labels.fieldManufacturer;
		case 'package': return labels.fieldPackage;
		case 'excludeFromBom': return labels.fieldExcludeFromBom;
	}
}

function parseChangeFilter(value: string): ChangeFilter {
	switch (value) {
		case 'added':
		case 'removed':
		case 'quantity-increased':
		case 'quantity-decreased':
		case 'identity-changed':
			return value;
		default:
			return 'all';
	}
}

function parseReviewKind(value: string): ReviewKind {
	switch (value) {
		case 'after-unmatched':
		case 'before-issues':
		case 'after-issues':
			return value;
		default:
			return 'before-unmatched';
	}
}

function localize(elements: Elements, request: IFrameBomDiffRequest): void {
	const { labels } = request;
	document.documentElement.lang = inferLanguage(labels.title);
	document.title = labels.title;
	setText('before-file-label', labels.beforeFile);
	setText('after-file-label', labels.afterFile);
	setText('total-changes-label', labels.totalChanges);
	setText('change-filter-label', labels.filterChangeType);
	elements.changeFilter.replaceChildren(
		option('all', labels.filterAll),
		option('added', labels.changeAdded),
		option('removed', labels.changeRemoved),
		option('quantity-increased', labels.changeQuantityIncreased),
		option('quantity-decreased', labels.changeQuantityDecreased),
		option('identity-changed', labels.changeIdentityChanged),
	);
	setText('summary-added-label', labels.changeAdded);
	setText('summary-removed-label', labels.changeRemoved);
	setText('summary-increased-label', labels.changeQuantityIncreased);
	setText('summary-decreased-label', labels.changeQuantityDecreased);
	setText('summary-identity-label', labels.changeIdentityChanged);
	setText('column-part-number', labels.columnPartNumber);
	setText('column-change-type', labels.columnChangeType);
	setText('column-before-quantity', labels.columnBeforeQuantity);
	setText('column-after-quantity', labels.columnAfterQuantity);
	setText('column-quantity-delta', labels.columnQuantityDelta);
	setText('column-before-designators', labels.columnBeforeDesignators);
	setText('column-after-designators', labels.columnAfterDesignators);
	setText('column-identity-changes', labels.columnIdentityChanges);
	setText('review-title', labels.reviewTitle);
	setText('review-kind-label', labels.reviewKind);
	setText('review-column-source', labels.columnSourceRow);
	elements.reviewKind.replaceChildren(
		option('before-unmatched', withCount(labels.reviewBeforeUnmatched, request.unmatchedBefore.length)),
		option('after-unmatched', withCount(labels.reviewAfterUnmatched, request.unmatchedAfter.length)),
		option('before-issues', withCount(labels.reviewBeforeIssues, request.issuesBefore.length)),
		option('after-issues', withCount(labels.reviewAfterIssues, request.issuesAfter.length)),
	);
	setPagerLabels(elements.diffPreviousPage, elements.diffNextPage, labels);
	setPagerLabels(elements.reviewPreviousPage, elements.reviewNextPage, labels);
	elements.exportCsv.textContent = labels.exportCsv;
	elements.close.textContent = labels.close;
}

function setPagerLabels(previous: HTMLButtonElement, next: HTMLButtonElement, labels: BomDiffLabels): void {
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
		report: element('report', HTMLElement),
		beforeFileValue: element('before-file-value', HTMLElement),
		afterFileValue: element('after-file-value', HTMLElement),
		totalChangesValue: element('total-changes-value', HTMLElement),
		changeFilter: element('change-filter', HTMLSelectElement),
		diffRows: element('diff-rows', HTMLTableSectionElement),
		diffEmpty: element('diff-empty', HTMLElement),
		diffPreviousPage: element('diff-previous-page', HTMLButtonElement),
		diffNextPage: element('diff-next-page', HTMLButtonElement),
		diffPageStatus: element('diff-page-status', HTMLElement),
		diffPager: element('diff-pager', HTMLElement),
		reviewKind: element('review-kind', HTMLSelectElement),
		reviewRows: element('review-rows', HTMLTableSectionElement),
		reviewEmpty: element('review-empty', HTMLElement),
		reviewColumnSecond: element('review-column-second', HTMLElement),
		reviewColumnThird: element('review-column-third', HTMLElement),
		reviewColumnFourth: element('review-column-fourth', HTMLElement),
		reviewPreviousPage: element('review-previous-page', HTMLButtonElement),
		reviewNextPage: element('review-next-page', HTMLButtonElement),
		reviewPageStatus: element('review-page-status', HTMLElement),
		reviewPager: element('review-pager', HTMLElement),
		exportCsv: element('export-csv', HTMLButtonElement),
		close: element('close', HTMLButtonElement),
		operationStatus: element('operation-status', HTMLElement),
		connectionError: element('connection-error', HTMLElement),
	};
}

function option(value: string, label: string): HTMLOptionElement {
	const result = document.createElement('option');
	result.value = value;
	result.textContent = label;
	return result;
}

function withCount(label: string, count: number): string {
	return `${label} (${count})`;
}

function readRequest(): IFrameBomDiffRequest | undefined {
	try {
		return parseIFrameBomDiffRequest(eda.sys_Storage.getExtensionUserConfig(BOM_DIFF_REQUEST_KEY));
	}
	catch {
		return undefined;
	}
}

async function reportFailure(error: unknown): Promise<void> {
	const request = readRequest();
	if (!request) {
		return;
	}
	try {
		await eda.sys_Storage.setExtensionUserConfig(BOM_DIFF_EVENT_KEY, {
			protocolVersion: BOM_DIFF_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'failed',
			stage: 'script-started',
			errorName: errorName(error),
			error: errorMessage(error),
		} satisfies IFrameBomDiffEvent);
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
		await eda.sys_IFrame.closeIFrame(BOM_DIFF_IFRAME_ID);
	}
	catch {
		// The host poller closes the panel after receiving the close action.
	}
}

function progress(requestId: string, stage: 'panel-rendered' | 'request-read' | 'script-started'): IFrameBomDiffEvent {
	return { protocolVersion: BOM_DIFF_PROTOCOL_VERSION, requestId, status: 'progress', stage };
}

async function requireWrite(
	writeEvent: (event: IFrameBomDiffEvent) => Promise<boolean>,
	event: IFrameBomDiffEvent,
): Promise<void> {
	if (!await writeEvent(event)) {
		throw new Error('The host rejected the BOM diff event.');
	}
}

function setText(id: string, value: string): void {
	element(id, HTMLElement).textContent = value;
}

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
	const value = document.getElementById(id);
	if (!(value instanceof constructor)) {
		throw new TypeError(`Missing BOM diff panel element: ${id}`);
	}
	return value;
}

function createOperationId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function format(template: string, ...values: Array<number | string>): string {
	const positional = values.reduce<string>(
		(result, value, index) => result.replaceAll(`\${${index + 1}}`, String(value)),
		template,
	);
	return positional
		.replaceAll('{page}', String(values[0] ?? ''))
		.replaceAll('{pages}', String(values[1] ?? ''));
}

function localizeBootstrap(elements: Elements): void {
	const chinese = usesChineseBrowserLanguage();
	document.documentElement.lang = chinese ? 'zh-Hans' : 'en';
	elements.bootMessage.textContent = chinese ? '正在加载 BOM 差异报告...' : 'Loading BOM diff report...';
}

function fallbackConnectionError(): string {
	return usesChineseBrowserLanguage() ? 'BOM 差异报告连接失败。' : 'The BOM diff report connection failed.';
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
