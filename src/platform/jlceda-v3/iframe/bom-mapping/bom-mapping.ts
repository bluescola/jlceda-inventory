import type { BomColumnField, BomColumnMapping } from '../../../../features/bom-analysis/domain/bom-analysis';
import type {
	BomMappingPanelStage,
	IFrameBomMappingRequest,
	IFrameBomMappingResult,
	IFrameBomMappingSheet,
} from '../../presentation/iframe-bom-mapping-protocol';
import { BOM_COLUMN_FIELDS } from '../../../../features/bom-analysis/domain/bom-analysis';
import {
	BOM_MAPPING_IFRAME_ID,
	BOM_MAPPING_PROTOCOL_VERSION,
	BOM_MAPPING_REQUEST_KEY,
	BOM_MAPPING_RESULT_KEY,
	parseIFrameBomMappingRequest,
	parseIFrameBomMappingResult,
} from '../../presentation/iframe-bom-mapping-protocol';

interface BomMappingElements {
	shell: HTMLElement;
	bootStatus: HTMLElement;
	bootMessage: HTMLElement;
	panel: HTMLElement;
	fileTabs: HTMLElement;
	fileName: HTMLElement;
	fileFormat: HTMLElement;
	fileLabel: HTMLElement;
	formatLabel: HTMLElement;
	worksheetLabel: HTMLElement;
	worksheet: HTMLSelectElement;
	headerCandidateLabel: HTMLElement;
	headerCandidate: HTMLSelectElement;
	headerRowLabel: HTMLElement;
	headerRow: HTMLInputElement;
	mappingTitle: HTMLElement;
	mappingHint: HTMLElement;
	mappingRows: HTMLElement;
	warning: HTMLElement;
	previewTitle: HTMLElement;
	previewTable: HTMLTableElement;
	previewHead: HTMLElement;
	previewBody: HTMLElement;
	formError: HTMLElement;
	connectionError: HTMLElement;
	cancel: HTMLButtonElement;
	confirm: HTMLButtonElement;
}

interface FileDraft {
	sheetIndex: number;
	headerRowIndex: number;
	mapping: BomColumnMapping;
}

const FIELD_LABEL_KEYS: Readonly<Record<BomColumnField, keyof IFrameBomMappingRequest['labels']>> = {
	lcscPartNumber: 'fieldLcscPartNumber',
	designators: 'fieldDesignators',
	quantity: 'fieldQuantity',
	name: 'fieldName',
	manufacturerPartNumber: 'fieldManufacturerPartNumber',
	manufacturer: 'fieldManufacturer',
	package: 'fieldPackage',
	excludeFromBom: 'fieldExcludeFromBom',
};

void bootstrap();

async function bootstrap(): Promise<void> {
	let elements: BomMappingElements | undefined;
	try {
		elements = getElements();
		await initialize(elements);
	}
	catch (error) {
		showBootstrapError(elements, diagnosticErrorMessage(error));
	}
}

async function initialize(elements: BomMappingElements): Promise<void> {
	let request: IFrameBomMappingRequest | undefined;
	try {
		request = parseIFrameBomMappingRequest(eda.sys_Storage.getExtensionUserConfig(BOM_MAPPING_REQUEST_KEY));
	}
	catch {
		request = undefined;
	}
	if (!request) {
		showConnectionError(elements, connectionErrorMessage());
		return;
	}

	elements.bootMessage.textContent = request.labels.loading;
	let stage: BomMappingPanelStage = 'script-started';
	const writeResult = async (result: IFrameBomMappingResult): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(BOM_MAPPING_RESULT_KEY, result);
		}
		catch {
			return false;
		}
	};
	try {
		await requireBridgeWrite(writeResult, progress(request, stage));
		stage = 'request-read';
		await requireBridgeWrite(writeResult, progress(request, stage));
		renderPanel(elements, request, writeResult);
		stage = 'panel-rendered';
		await requireBridgeWrite(writeResult, progress(request, stage));
		await requireBridgeWrite(writeResult, {
			protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
	}
	catch (error) {
		showConnectionError(elements, request.labels.connectionError);
		await writeResult({
			protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'failed',
			stage,
			errorName: diagnosticErrorName(error),
			error: diagnosticErrorMessage(error),
		});
	}
}

function renderPanel(
	elements: BomMappingElements,
	request: IFrameBomMappingRequest,
	writeResult: (result: IFrameBomMappingResult) => Promise<boolean>,
): void {
	document.title = request.mode === 'compare' ? request.labels.titleCompare : request.labels.titleStockCheck;
	document.documentElement.lang = inferLanguage(request.labels.confirm);
	elements.fileLabel.textContent = request.labels.file;
	elements.formatLabel.textContent = request.labels.format;
	elements.worksheetLabel.textContent = request.labels.worksheet;
	elements.headerCandidateLabel.textContent = request.labels.headerCandidate;
	elements.headerRowLabel.textContent = request.labels.headerRow;
	elements.mappingTitle.textContent = request.labels.mapping;
	elements.mappingHint.textContent = request.labels.mappingHint;
	elements.previewTitle.textContent = request.labels.rawPreview;
	elements.fileTabs.setAttribute('aria-label', request.labels.file);
	elements.cancel.textContent = request.labels.cancel;
	elements.confirm.textContent = request.labels.confirm;

	const drafts = request.files.map(file => createInitialDraft(file.sheets[0]));
	let activeFileIndex = 0;
	const render = (): void => {
		renderFileTabs(elements, request, activeFileIndex, (index) => {
			activeFileIndex = index;
			render();
		});
		const file = request.files[activeFileIndex];
		const draft = drafts[activeFileIndex];
		const sheet = file.sheets[draft.sheetIndex];
		elements.fileName.textContent = file.fileName;
		elements.fileFormat.textContent = [file.format.toUpperCase(), file.encoding?.toUpperCase()]
			.filter(Boolean)
			.join(' / ');
		renderWorksheetOptions(elements, file.sheets, draft.sheetIndex);
		renderHeaderOptions(elements, request, sheet, draft);
		renderMappingRows(elements, request, sheet, draft, () => {
			renderWarning(elements, request, sheet, draft);
			elements.confirm.disabled = drafts.some(item => hasDuplicateColumns(item.mapping));
		});
		renderWarning(elements, request, sheet, draft);
		renderPreview(elements, request, sheet, draft.headerRowIndex);
		elements.confirm.disabled = drafts.some(item => hasDuplicateColumns(item.mapping));
	};

	elements.worksheet.addEventListener('change', () => {
		const sheetIndex = Number(elements.worksheet.value);
		if (drafts[activeFileIndex].sheetIndex !== sheetIndex) {
			drafts[activeFileIndex] = createInitialDraft(request.files[activeFileIndex].sheets[sheetIndex]);
			drafts[activeFileIndex].sheetIndex = sheetIndex;
		}
		render();
	});
	elements.headerCandidate.addEventListener('change', () => {
		if (elements.headerCandidate.value === 'manual') {
			elements.headerRow.focus();
			return;
		}
		const draft = drafts[activeFileIndex];
		const sheet = request.files[activeFileIndex].sheets[draft.sheetIndex];
		const candidate = sheet.headerCandidates.find(item => item.rowIndex === Number(elements.headerCandidate.value));
		if (candidate) {
			draft.headerRowIndex = candidate.rowIndex;
			draft.mapping = { ...candidate.suggestedMapping };
			render();
		}
	});
	elements.headerRow.addEventListener('change', () => {
		const draft = drafts[activeFileIndex];
		const sheet = request.files[activeFileIndex].sheets[draft.sheetIndex];
		const rowIndex = Math.max(0, Math.min(Number(elements.headerRow.value) - 1, Math.min(sheet.rowCount, 100) - 1));
		draft.headerRowIndex = Number.isSafeInteger(rowIndex) ? rowIndex : 0;
		const candidate = sheet.headerCandidates.find(item => item.rowIndex === draft.headerRowIndex);
		draft.mapping = candidate ? { ...candidate.suggestedMapping } : {};
		render();
	});

	const setBusy = (busy: boolean): void => {
		elements.cancel.disabled = busy;
		elements.confirm.disabled = busy || drafts.some(draft => hasDuplicateColumns(draft.mapping));
	};
	const finish = async (result: IFrameBomMappingResult): Promise<void> => {
		setBusy(true);
		elements.formError.hidden = true;
		if (!parseIFrameBomMappingResult(result, request) || !await writeResult(result)) {
			setBusy(false);
			elements.formError.textContent = request.labels.saveError;
			elements.formError.hidden = false;
			return;
		}
		await eda.sys_IFrame.closeIFrame(BOM_MAPPING_IFRAME_ID);
	};
	elements.confirm.addEventListener('click', () => {
		void finish({
			protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'submitted',
			files: drafts.map((draft, fileIndex) => ({
				fileIndex,
				sheetIndex: draft.sheetIndex,
				headerRowIndex: draft.headerRowIndex,
				mapping: { ...draft.mapping },
			})),
		});
	});
	elements.cancel.addEventListener('click', () => {
		void finish({
			protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'cancelled',
		});
	});

	render();
	elements.bootStatus.hidden = true;
	elements.panel.hidden = false;
	elements.shell.setAttribute('aria-busy', 'false');
}

function renderFileTabs(
	elements: BomMappingElements,
	request: IFrameBomMappingRequest,
	activeFileIndex: number,
	activate: (index: number) => void,
): void {
	elements.fileTabs.replaceChildren();
	elements.fileTabs.hidden = request.files.length < 2;
	request.files.forEach((file, index) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'file-tab';
		button.textContent = `${index + 1}. ${file.fileName}`;
		button.setAttribute('aria-pressed', String(index === activeFileIndex));
		button.addEventListener('click', () => activate(index));
		elements.fileTabs.append(button);
	});
}

function renderWorksheetOptions(
	elements: BomMappingElements,
	sheets: IFrameBomMappingSheet[],
	selectedIndex: number,
): void {
	elements.worksheet.replaceChildren(...sheets.map((sheet, index) => createOption(String(index), sheet.name)));
	elements.worksheet.value = String(selectedIndex);
}

function renderHeaderOptions(
	elements: BomMappingElements,
	request: IFrameBomMappingRequest,
	sheet: IFrameBomMappingSheet,
	draft: FileDraft,
): void {
	const options = sheet.headerCandidates.map(candidate => createOption(
		String(candidate.rowIndex),
		`${request.labels.detectedCandidate} ${candidate.rowNumber} (${candidate.recognizedColumnCount})`,
	));
	if (options.length === 0) {
		const empty = createOption('none', request.labels.noCandidate);
		empty.disabled = true;
		options.push(empty);
	}
	options.push(createOption('manual', request.labels.manualHeader));
	elements.headerCandidate.replaceChildren(...options);
	elements.headerCandidate.value = sheet.headerCandidates.some(candidate => candidate.rowIndex === draft.headerRowIndex)
		? String(draft.headerRowIndex)
		: 'manual';
	elements.headerRow.min = '1';
	elements.headerRow.max = String(Math.min(sheet.rowCount, 100));
	elements.headerRow.value = String(draft.headerRowIndex + 1);
}

function renderMappingRows(
	elements: BomMappingElements,
	request: IFrameBomMappingRequest,
	sheet: IFrameBomMappingSheet,
	draft: FileDraft,
	onChange: () => void,
): void {
	const header = sheet.rows[draft.headerRowIndex] ?? [];
	elements.mappingRows.replaceChildren(...BOM_COLUMN_FIELDS.map((field) => {
		const row = document.createElement('label');
		row.className = 'mapping-row';
		const name = document.createElement('span');
		name.textContent = request.labels[FIELD_LABEL_KEYS[field]];
		const select = document.createElement('select');
		select.dataset.field = field;
		select.append(createOption('', request.labels.notMapped));
		for (let columnIndex = 0; columnIndex < sheet.columnCount; columnIndex += 1) {
			select.append(createOption(String(columnIndex), formatColumnLabel(request, header, columnIndex)));
		}
		select.value = draft.mapping[field] === undefined ? '' : String(draft.mapping[field]);
		select.addEventListener('change', () => {
			if (select.value === '') {
				delete draft.mapping[field];
			}
			else {
				draft.mapping[field] = Number(select.value);
			}
			onChange();
		});
		row.append(name, select);
		return row;
	}));
}

function renderWarning(
	elements: BomMappingElements,
	request: IFrameBomMappingRequest,
	sheet: IFrameBomMappingSheet,
	draft: FileDraft,
): void {
	const messages: string[] = [];
	const candidate = sheet.headerCandidates.find(item => item.rowIndex === draft.headerRowIndex);
	if (candidate?.duplicateFields.length) {
		messages.push(`${request.labels.duplicateWarning}: ${candidate.duplicateFields
			.map(field => request.labels[FIELD_LABEL_KEYS[field]])
			.join(', ')}`);
	}
	if (hasDuplicateColumns(draft.mapping)) {
		messages.push(request.labels.duplicateAssignmentWarning);
	}
	elements.warning.textContent = messages.join(' ');
	elements.warning.hidden = messages.length === 0;
}

function renderPreview(
	elements: BomMappingElements,
	request: IFrameBomMappingRequest,
	sheet: IFrameBomMappingSheet,
	headerRowIndex: number,
): void {
	const header = sheet.rows[headerRowIndex] ?? [];
	const heading = document.createElement('tr');
	const rowNumberHeading = document.createElement('th');
	rowNumberHeading.textContent = '#';
	heading.append(rowNumberHeading);
	for (let columnIndex = 0; columnIndex < sheet.columnCount; columnIndex += 1) {
		const cell = document.createElement('th');
		cell.textContent = formatColumnLabel(request, header, columnIndex);
		heading.append(cell);
	}
	elements.previewHead.replaceChildren(heading);
	const rows = sheet.rows.slice(headerRowIndex, headerRowIndex + 6);
	elements.previewBody.replaceChildren(...rows.map((source, offset) => {
		const row = document.createElement('tr');
		if (offset === 0) {
			row.className = 'header-row';
		}
		const rowNumber = document.createElement('th');
		rowNumber.scope = 'row';
		rowNumber.textContent = String(headerRowIndex + offset + 1);
		row.append(rowNumber);
		for (let columnIndex = 0; columnIndex < sheet.columnCount; columnIndex += 1) {
			const cell = document.createElement('td');
			cell.textContent = source[columnIndex] ?? '';
			row.append(cell);
		}
		return row;
	}));
	elements.previewTable.style.setProperty('--preview-columns', String(sheet.columnCount));
}

function createInitialDraft(sheet: IFrameBomMappingSheet): FileDraft {
	const candidate = sheet.headerCandidates[0];
	return {
		sheetIndex: 0,
		headerRowIndex: candidate?.rowIndex ?? 0,
		mapping: { ...candidate?.suggestedMapping },
	};
}

function hasDuplicateColumns(mapping: BomColumnMapping): boolean {
	const values = Object.values(mapping);
	return new Set(values).size !== values.length;
}

function formatColumnLabel(request: IFrameBomMappingRequest, header: string[], columnIndex: number): string {
	const coordinate = columnCoordinate(columnIndex);
	const value = header[columnIndex]?.trim();
	return value
		? `${coordinate}: ${value.slice(0, 80)}`
		: `${request.labels.columnFallback} ${coordinate}`;
}

function columnCoordinate(index: number): string {
	let value = index + 1;
	let result = '';
	while (value > 0) {
		value -= 1;
		result = String.fromCharCode(65 + value % 26) + result;
		value = Math.floor(value / 26);
	}
	return result;
}

function createOption(value: string, label: string): HTMLOptionElement {
	const option = document.createElement('option');
	option.value = value;
	option.textContent = label;
	return option;
}

function progress(
	request: IFrameBomMappingRequest,
	stage: Extract<IFrameBomMappingResult, { status: 'progress' }>['stage'],
): IFrameBomMappingResult {
	return {
		protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
		requestId: request.requestId,
		status: 'progress',
		stage,
	};
}

async function requireBridgeWrite(
	writeResult: (result: IFrameBomMappingResult) => Promise<boolean>,
	result: IFrameBomMappingResult,
): Promise<void> {
	if (!await writeResult(result)) {
		throw new Error('The host rejected an IFrame bridge write.');
	}
}

function getElements(): BomMappingElements {
	return {
		shell: getElement('panel-shell'),
		bootStatus: getElement('boot-status'),
		bootMessage: getElement('boot-message'),
		panel: getElement('mapping-panel'),
		fileTabs: getElement('file-tabs'),
		fileName: getElement('file-name'),
		fileFormat: getElement('file-format'),
		fileLabel: getElement('file-label'),
		formatLabel: getElement('format-label'),
		worksheetLabel: getElement('worksheet-label'),
		worksheet: getElement('worksheet'),
		headerCandidateLabel: getElement('header-candidate-label'),
		headerCandidate: getElement('header-candidate'),
		headerRowLabel: getElement('header-row-label'),
		headerRow: getElement('header-row'),
		mappingTitle: getElement('mapping-title'),
		mappingHint: getElement('mapping-hint'),
		mappingRows: getElement('mapping-rows'),
		warning: getElement('mapping-warning'),
		previewTitle: getElement('preview-title'),
		previewTable: getElement('preview-table'),
		previewHead: getElement('preview-head'),
		previewBody: getElement('preview-body'),
		formError: getElement('form-error'),
		connectionError: getElement('connection-error'),
		cancel: getElement('cancel'),
		confirm: getElement('confirm'),
	};
}

function getElement<T extends HTMLElement>(id: string): T {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing BOM mapping panel element: ${id}`);
	}
	return element as T;
}

function showConnectionError(elements: BomMappingElements, message: string): void {
	elements.bootStatus.hidden = true;
	elements.panel.hidden = true;
	elements.shell.setAttribute('aria-busy', 'false');
	elements.connectionError.textContent = message;
	elements.connectionError.hidden = false;
}

function showBootstrapError(elements: BomMappingElements | undefined, detail: string): void {
	const message = `${connectionErrorMessage()} ${detail}`.trim();
	if (elements) {
		showConnectionError(elements, message);
		return;
	}
	document.body.textContent = message;
	document.body.setAttribute('role', 'alert');
}

function inferLanguage(confirmLabel: string): string {
	return /[\u3400-\u9FFF]/.test(confirmLabel) ? 'zh-Hans' : 'en';
}

function connectionErrorMessage(): string {
	try {
		return eda.sys_I18n.text('productForm.connectionError');
	}
	catch {
		return 'The BOM mapping panel connection failed.';
	}
}

function diagnosticErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

function diagnosticErrorName(error: unknown): string {
	return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}
