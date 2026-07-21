import type {
	IFrameInventoryItemRequest,
	IFrameInventoryItemResult,
	InventoryItemEditFormState,
	InventoryItemPanelLabels,
	InventoryItemPanelSnapshot,
	InventoryItemPanelStage,
	InventoryItemSuggestion,
} from '../../presentation/iframe-inventory-item-protocol';
import type { InventoryStockDraftValue } from './inventory-stock-draft';
import {
	INVENTORY_ITEM_IFRAME_ID,
	INVENTORY_ITEM_PROTOCOL_VERSION,
	INVENTORY_ITEM_REQUEST_KEY,
	INVENTORY_ITEM_RESULT_KEY,
	parseIFrameInventoryItemRequest,
} from '../../presentation/iframe-inventory-item-protocol';
import {
	createInventoryStockDraftSession,
	setInventoryStockDraftDepleted,
	updateInventoryStockDraftPrecision,
	updateInventoryStockDraftQuantity,
} from './inventory-stock-draft';

interface PanelElements {
	shell: HTMLElement;
	bootStatus: HTMLElement;
	bootMessage: HTMLElement;
	viewPanel: HTMLElement;
	viewDetails: HTMLDListElement;
	viewClose: HTMLButtonElement;
	viewEdit: HTMLButtonElement;
	editPanel: HTMLFormElement;
	editError: HTMLElement;
	editCancel: HTMLButtonElement;
	editSave: HTMLButtonElement;
	lcscPartNumber: HTMLInputElement;
	supplierId: HTMLInputElement;
	name: HTMLInputElement;
	manufacturer: HTMLInputElement;
	manufacturerPartNumber: HTMLInputElement;
	package: HTMLInputElement;
	description: HTMLTextAreaElement;
	quantity: HTMLInputElement;
	precisionExact: HTMLInputElement;
	precisionEstimated: HTMLInputElement;
	depleted: HTMLInputElement;
	location: HTMLInputElement;
	locationOptions: HTMLElement;
	chooseLocation: HTMLButtonElement;
	note: HTMLTextAreaElement;
	suggestionPanel: HTMLElement;
	suggestionList: HTMLElement;
	comparePanel: HTMLElement;
	existingDetails: HTMLDListElement;
	candidateDetails: HTMLDListElement;
	compareCancel: HTMLButtonElement;
	compareConfirm: HTMLButtonElement;
	connectionError: HTMLElement;
}

void bootstrap();

async function bootstrap(): Promise<void> {
	let elements: PanelElements | undefined;
	try {
		elements = getElements();
		localizeBootstrap(elements);
		await initialize(elements);
	}
	catch {
		showConnectionError(elements, fallbackConnectionError());
	}
}

async function initialize(elements: PanelElements): Promise<void> {
	let request: IFrameInventoryItemRequest | undefined;
	try {
		request = parseIFrameInventoryItemRequest(eda.sys_Storage.getExtensionUserConfig(INVENTORY_ITEM_REQUEST_KEY));
	}
	catch {
		request = undefined;
	}
	if (!request) {
		showConnectionError(elements, fallbackConnectionError());
		return;
	}

	elements.bootMessage.textContent = request.labels.loading;
	const writeResult = async (result: IFrameInventoryItemResult): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(INVENTORY_ITEM_RESULT_KEY, result);
		}
		catch {
			return false;
		}
	};
	let stage: InventoryItemPanelStage = 'script-started';
	try {
		await requireWrite(writeResult, progress(request.requestId, stage));
		stage = 'request-read';
		await requireWrite(writeResult, progress(request.requestId, stage));
		render(elements, request, writeResult);
		stage = 'panel-rendered';
		await requireWrite(writeResult, progress(request.requestId, stage));
		await requireWrite(writeResult, baseResult(request.requestId, 'ready'));
	}
	catch (error) {
		showConnectionError(elements, request.labels.connectionError);
		await writeResult({
			protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'failed',
			stage,
			errorName: diagnosticErrorName(error),
			error: diagnosticErrorMessage(error),
		});
	}
}

function render(
	elements: PanelElements,
	request: IFrameInventoryItemRequest,
	writeResult: (result: IFrameInventoryItemResult) => Promise<boolean>,
): void {
	document.title = request.mode === 'view'
		? request.labels.viewTitle
		: request.mode === 'edit' ? request.labels.editTitle : request.labels.compareTitle;
	document.documentElement.lang = inferLanguage(request.labels.save);
	elements.bootStatus.hidden = true;
	elements.shell.setAttribute('aria-busy', 'false');

	if (request.mode === 'view') {
		renderView(elements, request, writeResult);
		return;
	}
	if (request.mode === 'edit') {
		renderEdit(elements, request, writeResult);
		return;
	}
	renderCompare(elements, request, writeResult);
}

function renderView(
	elements: PanelElements,
	request: Extract<IFrameInventoryItemRequest, { mode: 'view' }>,
	writeResult: (result: IFrameInventoryItemResult) => Promise<boolean>,
): void {
	elements.viewPanel.hidden = false;
	renderDetails(elements.viewDetails, request.item, request.labels);
	elements.viewClose.textContent = request.labels.close;
	elements.viewEdit.textContent = request.labels.fullEdit;
	elements.viewClose.addEventListener('click', () => void finish(writeResult, baseResult(request.requestId, 'cancelled'), elements, request.labels));
	elements.viewEdit.addEventListener('click', () => void finish(writeResult, {
		protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
		requestId: request.requestId,
		status: 'edit',
	}, elements, request.labels));
}

function renderEdit(
	elements: PanelElements,
	request: Extract<IFrameInventoryItemRequest, { mode: 'edit' }>,
	writeResult: (result: IFrameInventoryItemResult) => Promise<boolean>,
): void {
	elements.editPanel.hidden = false;
	setText('label-lcsc', request.labels.lcscPartNumber);
	setText('label-supplier', request.labels.supplierId);
	setText('label-name', request.labels.name);
	setText('label-manufacturer', request.labels.manufacturer);
	setText('label-manufacturer-part', request.labels.manufacturerPartNumber);
	setText('label-package', request.labels.package);
	setText('label-description', request.labels.description);
	setText('label-quantity', request.labels.quantity);
	setText('label-precision', request.labels.precision);
	setText('label-exact', request.labels.exact);
	setText('label-estimated', request.labels.estimated);
	setText('label-depleted', request.labels.depleted);
	setText('label-location', request.labels.location);
	setText('label-note', request.labels.note);
	elements.editCancel.textContent = request.labels.cancel;
	elements.editSave.textContent = request.labels.save;
	let stockDraft = setEditState(elements, request.initial);
	renderLocationPicker(elements, request.locationOptions, request.labels.chooseLocation);
	renderSuggestions(elements, request.suggestion, request.labels);

	const clearError = (): void => {
		elements.editError.hidden = true;
		elements.editError.textContent = '';
	};
	for (const input of editInputs(elements)) {
		input.addEventListener('input', clearError);
	}
	elements.quantity.addEventListener('input', () => {
		stockDraft = updateInventoryStockDraftQuantity(stockDraft, elements.quantity.value);
		applyStockDraft(elements, stockDraft.value);
	});
	elements.depleted.addEventListener('change', () => {
		const depleted = elements.depleted.checked;
		stockDraft = setInventoryStockDraftDepleted(stockDraft, depleted);
		applyStockDraft(elements, stockDraft.value);
		if (!depleted) {
			elements.quantity.focus();
		}
	});
	for (const precision of [elements.precisionExact, elements.precisionEstimated]) {
		precision.addEventListener('change', () => {
			if (!precision.checked) {
				return;
			}
			stockDraft = updateInventoryStockDraftPrecision(
				stockDraft,
				precision === elements.precisionEstimated ? 'estimated' : 'exact',
			);
			applyStockDraft(elements, stockDraft.value);
		});
	}
	elements.chooseLocation.addEventListener('click', () => {
		const opening = elements.locationOptions.hidden;
		elements.locationOptions.hidden = !opening;
		elements.chooseLocation.setAttribute('aria-expanded', String(opening));
		if (opening) {
			elements.locationOptions.querySelector<HTMLButtonElement>('.location-option')?.focus();
		}
	});
	elements.locationOptions.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			closeLocationPicker(elements);
			elements.chooseLocation.focus();
		}
	});
	elements.editCancel.addEventListener('click', () => void finish(writeResult, baseResult(request.requestId, 'cancelled'), elements, request.labels));
	elements.editPanel.addEventListener('submit', (event) => {
		event.preventDefault();
		clearError();
		const validation = validateEditState(readEditState(elements), request.labels);
		if (!validation.ok) {
			elements.editError.textContent = validation.message;
			elements.editError.hidden = false;
			validation.focus.focus();
			return;
		}
		void finish(writeResult, {
			protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'submitted',
			value: validation.value,
		}, elements, request.labels);
	});
}

function renderCompare(
	elements: PanelElements,
	request: Extract<IFrameInventoryItemRequest, { mode: 'compare' }>,
	writeResult: (result: IFrameInventoryItemResult) => Promise<boolean>,
): void {
	elements.comparePanel.hidden = false;
	setText('existing-title', request.labels.existing);
	setText('candidate-title', request.labels.candidate);
	renderDetails(elements.existingDetails, request.existing, request.labels);
	renderDetails(elements.candidateDetails, request.candidate, request.labels);
	elements.compareCancel.textContent = request.labels.cancel;
	elements.compareConfirm.textContent = request.labels.confirmMerge;
	elements.compareCancel.addEventListener('click', () => void finish(writeResult, baseResult(request.requestId, 'cancelled'), elements, request.labels));
	elements.compareConfirm.addEventListener('click', () => void finish(writeResult, {
		protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION,
		requestId: request.requestId,
		status: 'confirmed',
	}, elements, request.labels));
}

function renderDetails(target: HTMLDListElement, item: InventoryItemPanelSnapshot, labels: InventoryItemPanelLabels): void {
	target.replaceChildren();
	const precision = item.precision === 'exact' ? labels.exact : item.precision === 'estimated' ? labels.estimated : labels.unknown;
	const rows: Array<[string, string]> = [
		[labels.lcscPartNumber, item.identity.lcscPartNumber],
		[labels.supplierId, item.identity.supplierId],
		[labels.name, item.identity.name],
		[labels.manufacturer, item.identity.manufacturer],
		[labels.manufacturerPartNumber, item.identity.manufacturerPartNumber],
		[labels.package, item.identity.package],
		[labels.description, item.identity.description],
		[labels.quantity, item.quantity === null ? labels.unknown : String(item.quantity)],
		[labels.precision, precision],
		[labels.stockState, item.state === 'depleted' ? labels.depleted : labels.inStock],
		[labels.location, item.location],
		[labels.note, item.note],
		[labels.marketplace, item.marketplaceStatus],
		[labels.edaModel, item.edaModelStatus],
		[labels.edaSymbol, item.edaSymbol],
		[labels.edaFootprint, item.edaFootprint],
		[labels.source, item.source],
		[labels.createdAt, item.createdAt],
		[labels.updatedAt, item.updatedAt],
		[labels.revision, String(item.revision)],
	];
	for (const [label, value] of rows) {
		const term = document.createElement('dt');
		term.textContent = label;
		const detail = document.createElement('dd');
		detail.textContent = value || labels.emptyValue;
		target.append(term, detail);
	}
}

function renderSuggestions(elements: PanelElements, suggestion: InventoryItemSuggestion | undefined, labels: InventoryItemPanelLabels): void {
	if (!suggestion) {
		return;
	}
	const definitions: Array<{
		field: keyof InventoryItemSuggestion;
		label: string;
		input: HTMLInputElement | HTMLTextAreaElement;
	}> = [
		{ field: 'lcscPartNumber', label: labels.lcscPartNumber, input: elements.lcscPartNumber },
		{ field: 'supplierId', label: labels.supplierId, input: elements.supplierId },
		{ field: 'name', label: labels.name, input: elements.name },
		{ field: 'manufacturer', label: labels.manufacturer, input: elements.manufacturer },
		{ field: 'manufacturerPartNumber', label: labels.manufacturerPartNumber, input: elements.manufacturerPartNumber },
		{ field: 'package', label: labels.package, input: elements.package },
		{ field: 'description', label: labels.description, input: elements.description },
	];
	let count = 0;
	setText('suggestion-title', labels.suggestionTitle);
	for (const definition of definitions) {
		const value = suggestion[definition.field];
		if (!value?.trim() || value === definition.input.value) {
			continue;
		}
		count += 1;
		const row = document.createElement('div');
		row.className = 'suggestion-row';
		const label = document.createElement('span');
		label.className = 'suggestion-label';
		label.textContent = definition.label;
		const text = document.createElement('p');
		text.className = 'suggestion-value';
		text.textContent = value;
		const apply = document.createElement('button');
		apply.type = 'button';
		apply.className = 'suggestion-apply';
		apply.textContent = labels.useSuggestion;
		apply.addEventListener('click', () => {
			definition.input.value = value;
			definition.input.focus();
		});
		row.append(label, text, apply);
		elements.suggestionList.append(row);
	}
	elements.suggestionPanel.hidden = count === 0;
}

type EditValidation
	= | { ok: true; value: InventoryItemEditFormState }
		| { ok: false; message: string; focus: HTMLInputElement };

function validateEditState(value: InventoryItemEditFormState, labels: InventoryItemPanelLabels): EditValidation {
	if (!value.name.trim()) {
		return { ok: false, message: labels.nameRequired, focus: element('edit-name', HTMLInputElement) };
	}
	const lcscPartNumber = value.lcscPartNumber.trim().replaceAll(/\s+/g, '').toUpperCase();
	if (lcscPartNumber && !/^C\d+$/.test(lcscPartNumber)) {
		return { ok: false, message: labels.lcscInvalid, focus: element('edit-lcsc', HTMLInputElement) };
	}
	const quantity = value.quantity.trim();
	if (!quantity) {
		return { ok: false, message: labels.quantityRequired, focus: element('edit-quantity', HTMLInputElement) };
	}
	if (quantity.startsWith('-') || Number(quantity) < 0) {
		return { ok: false, message: labels.quantityNonNegative, focus: element('edit-quantity', HTMLInputElement) };
	}
	if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(Number(quantity))) {
		return { ok: false, message: labels.quantityInteger, focus: element('edit-quantity', HTMLInputElement) };
	}
	const depleted = value.depleted || quantity === '0';
	return {
		ok: true,
		value: {
			...value,
			lcscPartNumber,
			quantity: depleted ? '0' : quantity,
			precision: depleted ? 'exact' : value.precision,
			depleted,
		},
	};
}

function setEditState(elements: PanelElements, value: InventoryItemEditFormState) {
	elements.lcscPartNumber.value = value.lcscPartNumber;
	elements.supplierId.value = value.supplierId;
	elements.name.value = value.name;
	elements.manufacturer.value = value.manufacturer;
	elements.manufacturerPartNumber.value = value.manufacturerPartNumber;
	elements.package.value = value.package;
	elements.description.value = value.description;
	elements.location.value = value.location;
	elements.note.value = value.note;
	const stockDraft = createInventoryStockDraftSession({
		quantity: value.quantity,
		precision: value.precision,
		depleted: value.depleted,
	});
	applyStockDraft(elements, stockDraft.value);
	return stockDraft;
}

function readEditState(elements: PanelElements): InventoryItemEditFormState {
	return {
		lcscPartNumber: elements.lcscPartNumber.value,
		supplierId: elements.supplierId.value,
		name: elements.name.value,
		manufacturer: elements.manufacturer.value,
		manufacturerPartNumber: elements.manufacturerPartNumber.value,
		package: elements.package.value,
		description: elements.description.value,
		quantity: elements.quantity.value,
		precision: elements.precisionEstimated.checked ? 'estimated' : 'exact',
		depleted: elements.depleted.checked,
		location: elements.location.value,
		note: elements.note.value,
	};
}

function applyStockDraft(elements: PanelElements, value: InventoryStockDraftValue): void {
	elements.quantity.value = value.quantity;
	elements.precisionExact.checked = value.precision === 'exact';
	elements.precisionEstimated.checked = value.precision === 'estimated';
	elements.precisionEstimated.disabled = value.depleted;
	elements.depleted.checked = value.depleted;
}

function renderLocationPicker(elements: PanelElements, locations: string[], label: string): void {
	elements.locationOptions.replaceChildren(...locations.map((location) => {
		const option = document.createElement('button');
		option.type = 'button';
		option.className = 'location-option';
		option.setAttribute('role', 'option');
		option.textContent = location;
		option.addEventListener('click', () => {
			elements.location.value = location;
			elements.location.dispatchEvent(new Event('input', { bubbles: true }));
			closeLocationPicker(elements);
			elements.location.focus();
		});
		return option;
	}));
	elements.chooseLocation.textContent = label;
	elements.chooseLocation.title = label;
	elements.chooseLocation.disabled = locations.length === 0;
}

function closeLocationPicker(elements: PanelElements): void {
	elements.locationOptions.hidden = true;
	elements.chooseLocation.setAttribute('aria-expanded', 'false');
}

async function finish(
	writeResult: (result: IFrameInventoryItemResult) => Promise<boolean>,
	result: IFrameInventoryItemResult,
	elements: PanelElements,
	labels: InventoryItemPanelLabels,
): Promise<void> {
	setButtonsDisabled(elements, true);
	if (!await writeResult(result)) {
		setButtonsDisabled(elements, false);
		if (!elements.editPanel.hidden) {
			elements.editError.textContent = labels.saveError;
			elements.editError.hidden = false;
		}
		else {
			showConnectionError(elements, labels.saveError);
		}
		return;
	}
	try {
		await eda.sys_IFrame.closeIFrame(INVENTORY_ITEM_IFRAME_ID);
	}
	catch {
		// The persisted result remains available to the host poller.
	}
}

function getElements(): PanelElements {
	return {
		shell: element('panel-shell', HTMLElement),
		bootStatus: element('boot-status', HTMLElement),
		bootMessage: element('boot-message', HTMLElement),
		viewPanel: element('view-panel', HTMLElement),
		viewDetails: element('view-details', HTMLDListElement),
		viewClose: element('view-close', HTMLButtonElement),
		viewEdit: element('view-edit', HTMLButtonElement),
		editPanel: element('edit-panel', HTMLFormElement),
		editError: element('edit-error', HTMLElement),
		editCancel: element('edit-cancel', HTMLButtonElement),
		editSave: element('edit-save', HTMLButtonElement),
		lcscPartNumber: element('edit-lcsc', HTMLInputElement),
		supplierId: element('edit-supplier', HTMLInputElement),
		name: element('edit-name', HTMLInputElement),
		manufacturer: element('edit-manufacturer', HTMLInputElement),
		manufacturerPartNumber: element('edit-manufacturer-part', HTMLInputElement),
		package: element('edit-package', HTMLInputElement),
		description: element('edit-description', HTMLTextAreaElement),
		quantity: element('edit-quantity', HTMLInputElement),
		precisionExact: element('precision-exact', HTMLInputElement),
		precisionEstimated: element('precision-estimated', HTMLInputElement),
		depleted: element('edit-depleted', HTMLInputElement),
		location: element('edit-location', HTMLInputElement),
		locationOptions: element('location-options', HTMLElement),
		chooseLocation: element('choose-location', HTMLButtonElement),
		note: element('edit-note', HTMLTextAreaElement),
		suggestionPanel: element('suggestion-panel', HTMLElement),
		suggestionList: element('suggestion-list', HTMLElement),
		comparePanel: element('compare-panel', HTMLElement),
		existingDetails: element('existing-details', HTMLDListElement),
		candidateDetails: element('candidate-details', HTMLDListElement),
		compareCancel: element('compare-cancel', HTMLButtonElement),
		compareConfirm: element('compare-confirm', HTMLButtonElement),
		connectionError: element('connection-error', HTMLElement),
	};
}

function editInputs(elements: PanelElements): Array<HTMLInputElement | HTMLTextAreaElement> {
	return [
		elements.lcscPartNumber,
		elements.supplierId,
		elements.name,
		elements.manufacturer,
		elements.manufacturerPartNumber,
		elements.package,
		elements.description,
		elements.quantity,
		elements.location,
		elements.note,
	];
}

function setButtonsDisabled(elements: PanelElements, disabled: boolean): void {
	for (const button of [elements.viewClose, elements.viewEdit, elements.editCancel, elements.editSave, elements.chooseLocation, elements.compareCancel, elements.compareConfirm]) {
		button.disabled = disabled || (button === elements.chooseLocation && elements.locationOptions.children.length === 0);
	}
}

function showConnectionError(elements: PanelElements | undefined, message: string): void {
	if (!elements) {
		return;
	}
	elements.shell.setAttribute('aria-busy', 'false');
	elements.bootStatus.hidden = true;
	elements.viewPanel.hidden = true;
	elements.editPanel.hidden = true;
	elements.comparePanel.hidden = true;
	elements.connectionError.textContent = message;
	elements.connectionError.hidden = false;
}

function setText(id: string, value: string): void {
	element(id, HTMLElement).textContent = value;
}

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
	const value = document.getElementById(id);
	if (!(value instanceof constructor)) {
		throw new TypeError(`Missing inventory item panel element: ${id}`);
	}
	return value;
}

function progress(requestId: string, stage: InventoryItemPanelStage): IFrameInventoryItemResult {
	return { protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION, requestId, status: 'progress', stage };
}

function baseResult(requestId: string, status: 'cancelled' | 'ready'): IFrameInventoryItemResult {
	return { protocolVersion: INVENTORY_ITEM_PROTOCOL_VERSION, requestId, status };
}

async function requireWrite(
	writeResult: (result: IFrameInventoryItemResult) => Promise<boolean>,
	result: IFrameInventoryItemResult,
): Promise<void> {
	if (!await writeResult(result)) {
		throw new Error('The host rejected the inventory item panel result.');
	}
}

function fallbackConnectionError(): string {
	return usesChineseBrowserLanguage() ? '表单连接失败。' : 'The form connection failed.';
}

function localizeBootstrap(elements: PanelElements): void {
	const chinese = usesChineseBrowserLanguage();
	document.documentElement.lang = chinese ? 'zh-Hans' : 'en';
	elements.bootMessage.textContent = chinese ? '正在加载表单...' : 'Loading form...';
}

function usesChineseBrowserLanguage(): boolean {
	return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
}

function inferLanguage(text: string): string {
	return /[\u3400-\u9FFF]/.test(text) ? 'zh-Hans' : 'en';
}

function diagnosticErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message.slice(0, 300);
	}
	return String(error).slice(0, 300);
}

function diagnosticErrorName(error: unknown): string {
	return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}
