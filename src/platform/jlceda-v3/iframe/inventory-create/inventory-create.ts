import type {
	IFrameInventoryCreateEvent,
	IFrameInventoryCreateRequest,
	IFrameInventoryCreateResponse,
	InventoryCreateLabels,
	InventoryCreateOperationType,
} from '../../presentation/iframe-inventory-create-protocol';
import type {
	InventoryCreateDuplicateSnapshot,
	InventoryCreateFormState,
	InventoryCreateIdentitySuggestion,
	InventoryCreateQuantityMode,
} from '../../presentation/inventory-create-panel';
import type { InventoryCreateQuantityState } from './inventory-create-quantity-state';
import {
	INVENTORY_CREATE_EVENT_KEY,
	INVENTORY_CREATE_IFRAME_ID,
	INVENTORY_CREATE_PROTOCOL_VERSION,
	INVENTORY_CREATE_REQUEST_KEY,
	INVENTORY_CREATE_RESPONSE_KEY,
	parseIFrameInventoryCreateRequest,
	parseIFrameInventoryCreateResponse,
} from '../../presentation/iframe-inventory-create-protocol';
import {
	createInventoryCreateQuantityState,
	inventoryCreateQuantityFormValue,
	setInventoryCreateQuantityMode,
	updateInventoryCreateQuantity,
} from './inventory-create-quantity-state';

interface PanelElements {
	shell: HTMLElement;
	bootStatus: HTMLElement;
	bootMessage: HTMLElement;
	form: HTMLFormElement;
	title: HTMLElement;
	edaStatus: HTMLElement;
	lcscPartNumber: HTMLInputElement;
	supplierId: HTMLInputElement;
	name: HTMLInputElement;
	manufacturer: HTMLInputElement;
	manufacturerPartNumber: HTMLInputElement;
	package: HTMLInputElement;
	description: HTMLTextAreaElement;
	quantity: HTMLInputElement;
	modeExact: HTMLInputElement;
	modeEstimated: HTMLInputElement;
	modeUnknown: HTMLInputElement;
	modeDepleted: HTMLInputElement;
	primaryCategory: HTMLSelectElement;
	secondaryCategory: HTMLSelectElement;
	location: HTMLInputElement;
	chooseLocation: HTMLButtonElement;
	locationOptions: HTMLElement;
	note: HTMLTextAreaElement;
	queryEda: HTMLButtonElement;
	openMarketplace: HTMLButtonElement;
	marketplaceConfirmed: HTMLInputElement;
	cancel: HTMLButtonElement;
	save: HTMLButtonElement;
	error: HTMLElement;
	modalBackdrop: HTMLElement;
	suggestionModal: HTMLElement;
	suggestionList: HTMLElement;
	suggestionClose: HTMLButtonElement;
	duplicateModal: HTMLElement;
	duplicateMessage: HTMLElement;
	existingDetails: HTMLDListElement;
	pendingDetails: HTMLDListElement;
	duplicateCancel: HTMLButtonElement;
	duplicateConfirm: HTMLButtonElement;
	connectionError: HTMLElement;
}

interface ActiveOperation {
	id: string;
	type: InventoryCreateOperationType;
	queriedLcscPartNumber?: string;
}

interface DuplicateDecision {
	token: string;
	existing: InventoryCreateDuplicateSnapshot;
}

interface ModelBinding {
	lcscPartNumber: string;
	token: string;
}

const IDENTITY_FIELDS = [
	'lcscPartNumber',
	'supplierId',
	'name',
	'manufacturer',
	'manufacturerPartNumber',
	'package',
	'description',
] as const;

void bootstrap();

async function bootstrap(): Promise<void> {
	let elements: PanelElements | undefined;
	try {
		elements = getElements();
		localizeBootstrap(elements);
		await initialize(elements);
	}
	catch (error) {
		await reportBootstrapFailure(error);
		showConnectionError(elements, fallbackConnectionError());
	}
}

async function initialize(elements: PanelElements): Promise<void> {
	const writeEvent = async (event: IFrameInventoryCreateEvent): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(INVENTORY_CREATE_EVENT_KEY, event);
		}
		catch {
			return false;
		}
	};
	const request = readRequest();
	if (!request) {
		throw new TypeError('The inventory create request is unavailable.');
	}
	await requireWrite(writeEvent, progress(request.requestId, 'script-started'));
	await requireWrite(writeEvent, progress(request.requestId, 'request-read'));
	render(elements, request, writeEvent);
	await requireWrite(writeEvent, progress(request.requestId, 'panel-rendered'));
	await requireWrite(writeEvent, baseEvent(request.requestId, 'ready'));
}

function readRequest(): IFrameInventoryCreateRequest | undefined {
	try {
		return parseIFrameInventoryCreateRequest(eda.sys_Storage.getExtensionUserConfig(INVENTORY_CREATE_REQUEST_KEY));
	}
	catch {
		return undefined;
	}
}

function render(
	elements: PanelElements,
	request: IFrameInventoryCreateRequest,
	writeEvent: (event: IFrameInventoryCreateEvent) => Promise<boolean>,
): void {
	const { labels } = request;
	const touched = new Set<typeof IDENTITY_FIELDS[number]>();
	let quantityState = createInventoryCreateQuantityState(request.initial.quantityMode, request.initial.quantity);
	let activeOperation: ActiveOperation | undefined;
	let duplicateDecision: DuplicateDecision | undefined;
	let modelBinding: ModelBinding | undefined;
	let marketplaceAvailable = false;
	let marketplaceVisited = false;
	let acknowledgingTerminal = false;

	document.documentElement.lang = inferLanguage(labels.titleCustom);
	document.title = request.mode === 'lcsc' ? labels.titleLcsc : labels.titleCustom;
	localize(elements, request);
	fillForm(elements, request.initial);
	fillCategories(elements, request);
	renderLocationPicker(elements, request.locationOptions, labels.chooseLocation);
	applyQuantityState(elements, quantityState);
	setQueryStatus(elements, labels.queryIdle, 'idle');
	elements.openMarketplace.disabled = true;

	const hideError = (): void => {
		elements.error.hidden = true;
		elements.error.textContent = '';
	};
	const showError = (message: string): void => {
		elements.error.textContent = message;
		elements.error.hidden = false;
	};
	const setOperation = (operation: ActiveOperation | undefined): void => {
		activeOperation = operation;
		const busy = operation !== undefined;
		elements.queryEda.disabled = busy;
		elements.openMarketplace.disabled = busy || !marketplaceAvailable;
		elements.marketplaceConfirmed.disabled = busy || !marketplaceVisited;
		elements.save.disabled = busy;
		elements.cancel.disabled = busy;
		elements.lcscPartNumber.disabled = operation?.type === 'query-eda';
	};
	const sendAction = async (
		type: InventoryCreateOperationType,
		extra?: { duplicateToken: string; existing: { id: string; expectedRevision: number } },
	): Promise<void> => {
		if (activeOperation) {
			return;
		}
		const operation: ActiveOperation = {
			id: createOperationId(),
			type,
			queriedLcscPartNumber: type === 'query-eda' ? normalizeLcsc(elements.lcscPartNumber.value) : undefined,
		};
		setOperation(operation);
		hideError();
		if (type === 'query-eda') {
			setQueryStatus(elements, labels.queryRunning, 'running');
		}
		try {
			await eda.sys_Storage.deleteExtensionUserConfig(INVENTORY_CREATE_RESPONSE_KEY);
			const written = await writeEvent({
				protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
				requestId: request.requestId,
				status: 'action',
				operationId: operation.id,
				action: type,
				form: readForm(elements, quantityState),
				duplicateToken: extra?.duplicateToken,
				modelToken: (type === 'save' || type === 'confirm-merge')
					&& modelBinding?.lcscPartNumber === normalizeLcsc(elements.lcscPartNumber.value)
					? modelBinding.token
					: undefined,
				existing: extra?.existing,
			});
			if (!written) {
				throw new Error('The host rejected the inventory create action.');
			}
		}
		catch {
			setOperation(undefined);
			if (type === 'query-eda') {
				setQueryStatus(elements, labels.queryFailed, 'failed');
			}
			showError(labels.operationError);
		}
	};

	for (const field of IDENTITY_FIELDS) {
		identityElement(elements, field).addEventListener('input', () => touched.add(field));
	}
	elements.lcscPartNumber.addEventListener('input', () => {
		modelBinding = undefined;
		marketplaceAvailable = false;
		marketplaceVisited = false;
		elements.marketplaceConfirmed.checked = false;
		elements.marketplaceConfirmed.disabled = true;
		elements.openMarketplace.disabled = true;
		setQueryStatus(elements, labels.queryIdle, 'idle');
		closeModal(elements);
	});
	elements.lcscPartNumber.addEventListener('keydown', (event) => {
		if (event.key !== 'Enter') {
			return;
		}
		event.preventDefault();
		const error = validateLcsc(elements.lcscPartNumber.value, true, labels);
		if (error) {
			showError(error);
			return;
		}
		void sendAction('query-eda');
	});
	elements.queryEda.addEventListener('click', () => {
		const error = validateLcsc(elements.lcscPartNumber.value, true, labels);
		if (error) {
			showError(error);
			elements.lcscPartNumber.focus();
			return;
		}
		void sendAction('query-eda');
	});
	elements.openMarketplace.addEventListener('click', () => void sendAction('open-marketplace'));
	elements.primaryCategory.addEventListener('change', () => fillSecondaryCategories(elements, request));
	elements.chooseLocation.addEventListener('click', () => {
		const open = elements.locationOptions.hidden;
		elements.locationOptions.hidden = !open;
		elements.chooseLocation.setAttribute('aria-expanded', String(open));
		if (open) {
			(elements.locationOptions.querySelector('button') as HTMLButtonElement | null)?.focus();
		}
	});
	document.addEventListener('click', (event) => {
		if (!elements.locationOptions.hidden && !elements.locationOptions.parentElement?.contains(event.target as Node)) {
			closeLocationPicker(elements);
		}
	});

	for (const radio of [elements.modeExact, elements.modeEstimated, elements.modeUnknown, elements.modeDepleted]) {
		radio.addEventListener('change', () => {
			if (!radio.checked) {
				return;
			}
			quantityState = setInventoryCreateQuantityMode(quantityState, radio.value as InventoryCreateQuantityMode);
			applyQuantityState(elements, quantityState);
		});
	}
	elements.quantity.addEventListener('input', () => {
		quantityState = updateInventoryCreateQuantity(quantityState, elements.quantity.value);
		applyQuantityState(elements, quantityState);
	});

	elements.form.addEventListener('submit', (event) => {
		event.preventDefault();
		const form = readForm(elements, quantityState);
		const error = validateSave(form, request.mode, labels);
		if (error) {
			showError(error.message);
			error.field.focus();
			return;
		}
		void sendAction('save');
	});
	elements.cancel.addEventListener('click', () => void cancel(request, elements, writeEvent));
	elements.suggestionClose.addEventListener('click', () => closeModal(elements));
	elements.duplicateCancel.addEventListener('click', () => {
		duplicateDecision = undefined;
		closeModal(elements);
		elements.save.focus();
	});
	elements.duplicateConfirm.addEventListener('click', () => {
		if (!duplicateDecision) {
			return;
		}
		const decision = duplicateDecision;
		closeModal(elements);
		void sendAction('confirm-merge', {
			duplicateToken: decision.token,
			existing: { id: decision.existing.id, expectedRevision: decision.existing.revision },
		});
	});

	const responseTimer = window.setInterval(() => {
		if (!activeOperation) {
			return;
		}
		let response: IFrameInventoryCreateResponse | undefined;
		try {
			response = parseIFrameInventoryCreateResponse(
				eda.sys_Storage.getExtensionUserConfig(INVENTORY_CREATE_RESPONSE_KEY),
				request.requestId,
				activeOperation.id,
			);
		}
		catch {
			response = undefined;
		}
		if (!response || response.action !== activeOperation.type) {
			return;
		}
		const completedOperation = activeOperation;
		if (completedOperation.type === 'query-eda'
			&& completedOperation.queriedLcscPartNumber !== normalizeLcsc(elements.lcscPartNumber.value)) {
			setOperation(undefined);
			setQueryStatus(elements, labels.queryIdle, 'idle');
			return;
		}
		if (completedOperation.type === 'query-eda') {
			modelBinding = response.stage === 'succeeded' && response.modelToken
				? { token: response.modelToken, lcscPartNumber: completedOperation.queriedLcscPartNumber ?? '' }
				: undefined;
			marketplaceAvailable = response.stage === 'not-found' || response.stage === 'failed';
			if (response.stage === 'succeeded') {
				marketplaceVisited = false;
				elements.marketplaceConfirmed.checked = false;
			}
		}
		if (completedOperation.type === 'open-marketplace' && response.stage === 'succeeded') {
			marketplaceVisited = true;
			elements.marketplaceConfirmed.checked = true;
		}
		if (response.stage === 'succeeded'
			&& (completedOperation.type === 'save' || completedOperation.type === 'confirm-merge')) {
			if (acknowledgingTerminal) {
				return;
			}
			acknowledgingTerminal = true;
			void writeEvent({
				protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
				requestId: request.requestId,
				status: 'completed',
				operationId: completedOperation.id,
				action: completedOperation.type,
			}).then((written) => {
				acknowledgingTerminal = false;
				if (written) {
					window.clearInterval(responseTimer);
				}
			});
			return;
		}
		setOperation(undefined);
		handleResponse(elements, response, labels, touched, readForm(elements, quantityState), {
			onDuplicate: (decision) => {
				duplicateDecision = decision;
			},
		});
	}, 100);

	elements.bootStatus.hidden = true;
	elements.form.hidden = false;
	elements.shell.setAttribute('aria-busy', 'false');
	(request.mode === 'lcsc' ? elements.lcscPartNumber : elements.name).focus();
}

function handleResponse(
	elements: PanelElements,
	response: IFrameInventoryCreateResponse,
	labels: InventoryCreateLabels,
	touched: ReadonlySet<typeof IDENTITY_FIELDS[number]>,
	form: InventoryCreateFormState,
	handlers: { onDuplicate: (decision: DuplicateDecision) => void },
): void {
	if (response.action === 'query-eda') {
		if (response.stage === 'succeeded') {
			setQueryStatus(elements, response.message || labels.queryAvailable, 'available');
			if (response.suggestion) {
				applySafeSuggestions(elements, response.suggestion, touched, labels);
			}
			return;
		}
		if (response.stage === 'not-found') {
			setQueryStatus(elements, response.message || labels.queryMissing, 'missing');
			return;
		}
		setQueryStatus(elements, response.message || labels.queryFailed, 'failed');
	}
	if (response.stage === 'duplicate' && response.existing && response.duplicateToken) {
		handlers.onDuplicate({ token: response.duplicateToken, existing: response.existing });
		showDuplicate(elements, response.existing, response.message, form, labels);
		return;
	}
	if (response.stage === 'failed' || response.stage === 'cancelled') {
		elements.error.textContent = response.message || labels.operationError;
		elements.error.hidden = false;
	}
}

function applySafeSuggestions(
	elements: PanelElements,
	suggestion: InventoryCreateIdentitySuggestion,
	touched: ReadonlySet<typeof IDENTITY_FIELDS[number]>,
	labels: InventoryCreateLabels,
): void {
	const conflicts: Array<{ field: typeof IDENTITY_FIELDS[number]; current: string; suggested: string }> = [];
	for (const field of IDENTITY_FIELDS) {
		const suggested = suggestion[field]?.trim();
		if (!suggested) {
			continue;
		}
		const input = identityElement(elements, field);
		if (!input.value.trim() && !touched.has(field)) {
			input.value = suggested;
			continue;
		}
		if (input.value.trim() !== suggested) {
			conflicts.push({ field, current: input.value, suggested });
		}
	}
	if (conflicts.length === 0) {
		return;
	}
	elements.suggestionList.replaceChildren(...conflicts.map((conflict) => {
		const row = document.createElement('div');
		row.className = 'suggestion-row';
		const name = document.createElement('strong');
		name.textContent = identityLabel(conflict.field, labels);
		const current = suggestionValue(labels.currentValue, conflict.current || labels.emptyValue);
		const suggested = suggestionValue(labels.suggestedValue, conflict.suggested);
		const apply = document.createElement('button');
		apply.type = 'button';
		apply.className = 'suggestion-action';
		apply.textContent = labels.useSuggestion;
		apply.addEventListener('click', () => {
			identityElement(elements, conflict.field).value = conflict.suggested;
			row.remove();
			if (elements.suggestionList.childElementCount === 0) {
				closeModal(elements);
			}
		});
		row.append(name, current, suggested, apply);
		return row;
	}));
	showModal(elements, elements.suggestionModal);
}

function showDuplicate(
	elements: PanelElements,
	existing: InventoryCreateDuplicateSnapshot,
	message: string | undefined,
	form: InventoryCreateFormState,
	labels: InventoryCreateLabels,
): void {
	elements.duplicateMessage.textContent = message ?? '';
	elements.duplicateMessage.hidden = !message;
	renderDetails(elements.existingDetails, [
		[labels.name, existing.identity.name],
		[labels.lcscPartNumber, existing.identity.lcscPartNumber ?? ''],
		[labels.manufacturerPartNumber, existing.identity.manufacturerPartNumber ?? ''],
		[labels.quantity, existing.quantity === null ? labels.unknown : String(existing.quantity)],
		[labels.location, existing.location ?? ''],
	], labels.emptyValue);
	renderDetails(elements.pendingDetails, [
		[labels.name, form.name],
		[labels.lcscPartNumber, form.lcscPartNumber],
		[labels.manufacturerPartNumber, form.manufacturerPartNumber],
		[labels.quantity, form.quantityMode === 'unknown' ? labels.unknown : form.quantity],
		[labels.location, form.location],
	], labels.emptyValue);
	showModal(elements, elements.duplicateModal);
}

function localize(elements: PanelElements, request: IFrameInventoryCreateRequest): void {
	const { labels } = request;
	elements.title.textContent = request.mode === 'lcsc' ? labels.titleLcsc : labels.titleCustom;
	setText('identity-heading', labels.identitySection);
	setText('stock-heading', labels.stockSection);
	setText('lcsc-label', labels.lcscPartNumber);
	setText('supplier-label', labels.supplierId);
	setText('name-label', labels.name);
	setText('manufacturer-label', labels.manufacturer);
	setText('manufacturer-part-label', labels.manufacturerPartNumber);
	setText('package-label', labels.package);
	setText('description-label', labels.description);
	setText('quantity-mode-label', labels.quantityMode);
	setText('mode-exact-label', labels.exact);
	setText('mode-estimated-label', labels.estimated);
	setText('mode-unknown-label', labels.unknown);
	setText('mode-depleted-label', labels.depleted);
	setText('quantity-label', labels.quantity);
	setText('primary-category-label', labels.primaryCategory);
	setText('secondary-category-label', labels.secondaryCategory);
	setText('location-label', labels.location);
	setText('note-label', labels.note);
	elements.queryEda.textContent = labels.queryEda;
	elements.openMarketplace.textContent = labels.openMarketplace;
	setText('marketplace-confirmed-label', labels.marketplaceConfirmed);
	elements.chooseLocation.textContent = labels.chooseLocation;
	elements.chooseLocation.title = labels.chooseLocation;
	elements.cancel.textContent = labels.cancel;
	elements.save.textContent = labels.save;
	setText('suggestion-title', labels.suggestionTitle);
	elements.suggestionClose.textContent = labels.closeSuggestion;
	setText('duplicate-title', labels.duplicateTitle);
	setText('existing-title', labels.existingItem);
	setText('pending-title', labels.pendingItem);
	elements.duplicateCancel.textContent = labels.continueEditing;
	elements.duplicateConfirm.textContent = labels.confirmMerge;
}

function fillForm(elements: PanelElements, initial: InventoryCreateFormState): void {
	elements.lcscPartNumber.value = initial.lcscPartNumber;
	elements.marketplaceConfirmed.checked = initial.marketplaceConfirmed;
	elements.supplierId.value = initial.supplierId;
	elements.name.value = initial.name;
	elements.manufacturer.value = initial.manufacturer;
	elements.manufacturerPartNumber.value = initial.manufacturerPartNumber;
	elements.package.value = initial.package;
	elements.description.value = initial.description;
	elements.location.value = initial.location;
	elements.note.value = initial.note;
}

function fillCategories(elements: PanelElements, request: IFrameInventoryCreateRequest): void {
	const roots = request.categories
		.filter(category => category.parentId === undefined)
		.sort(compareCategory);
	elements.primaryCategory.replaceChildren(option('', request.labels.unclassified), ...roots.map(category => option(category.id, category.name)));
	const selected = request.categories.find(category => category.id === request.initial.categoryId);
	elements.primaryCategory.value = selected?.parentId ?? selected?.id ?? '';
	fillSecondaryCategories(elements, request, selected?.parentId ? selected.id : undefined);
}

function fillSecondaryCategories(
	elements: PanelElements,
	request: IFrameInventoryCreateRequest,
	selectedId?: string,
): void {
	const children = request.categories
		.filter(category => category.parentId === elements.primaryCategory.value)
		.sort(compareCategory);
	elements.secondaryCategory.replaceChildren(
		option('', request.labels.noSecondaryCategory),
		...children.map(category => option(category.id, category.name)),
	);
	elements.secondaryCategory.disabled = children.length === 0;
	elements.secondaryCategory.value = selectedId && children.some(category => category.id === selectedId) ? selectedId : '';
}

function renderLocationPicker(elements: PanelElements, locations: string[], label: string): void {
	elements.locationOptions.replaceChildren(...locations.map((location) => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = 'location-option';
		button.setAttribute('role', 'option');
		button.textContent = location;
		button.addEventListener('click', () => {
			elements.location.value = location;
			closeLocationPicker(elements);
			elements.location.focus();
		});
		return button;
	}));
	elements.chooseLocation.textContent = label;
	elements.chooseLocation.disabled = locations.length === 0;
}

function readForm(elements: PanelElements, quantityState: InventoryCreateQuantityState): InventoryCreateFormState {
	const quantity = inventoryCreateQuantityFormValue(quantityState);
	return {
		lcscPartNumber: elements.lcscPartNumber.value,
		marketplaceConfirmed: elements.marketplaceConfirmed.checked,
		supplierId: elements.supplierId.value,
		name: elements.name.value,
		manufacturer: elements.manufacturer.value,
		manufacturerPartNumber: elements.manufacturerPartNumber.value,
		package: elements.package.value,
		description: elements.description.value,
		quantityMode: quantity.mode,
		quantity: quantity.quantity,
		categoryId: elements.secondaryCategory.value || elements.primaryCategory.value,
		location: elements.location.value,
		note: elements.note.value,
	};
}

function applyQuantityState(elements: PanelElements, state: InventoryCreateQuantityState): void {
	const value = inventoryCreateQuantityFormValue(state);
	elements.modeExact.checked = value.mode === 'exact';
	elements.modeEstimated.checked = value.mode === 'estimated';
	elements.modeUnknown.checked = value.mode === 'unknown';
	elements.modeDepleted.checked = value.mode === 'depleted';
	elements.quantity.value = value.quantity;
	elements.quantity.disabled = value.mode === 'unknown' || value.mode === 'depleted';
}

function validateSave(
	form: InventoryCreateFormState,
	mode: IFrameInventoryCreateRequest['mode'],
	labels: InventoryCreateLabels,
): { message: string; field: HTMLElement } | undefined {
	const lcscError = validateLcsc(form.lcscPartNumber, mode === 'lcsc', labels);
	if (lcscError) {
		return { message: lcscError, field: element('lcsc', HTMLInputElement) };
	}
	if (!form.name.trim()) {
		return { message: labels.nameRequired, field: element('name', HTMLInputElement) };
	}
	if (form.quantityMode === 'unknown' || form.quantityMode === 'depleted') {
		return undefined;
	}
	const quantity = form.quantity.trim();
	if (!quantity) {
		return { message: labels.quantityRequired, field: element('quantity', HTMLInputElement) };
	}
	if (quantity.startsWith('-')) {
		return { message: labels.quantityNonNegative, field: element('quantity', HTMLInputElement) };
	}
	if (!/^\d+$/.test(quantity)) {
		return { message: labels.quantityInteger, field: element('quantity', HTMLInputElement) };
	}
	if (!Number.isSafeInteger(Number(quantity))) {
		return { message: labels.quantityTooLarge, field: element('quantity', HTMLInputElement) };
	}
	return undefined;
}

function validateLcsc(value: string, required: boolean, labels: InventoryCreateLabels): string | undefined {
	const normalized = normalizeLcsc(value);
	if (!normalized) {
		return required ? labels.lcscRequired : undefined;
	}
	return /^C\d+$/.test(normalized) ? undefined : labels.lcscInvalid;
}

async function cancel(
	request: IFrameInventoryCreateRequest,
	elements: PanelElements,
	writeEvent: (event: IFrameInventoryCreateEvent) => Promise<boolean>,
): Promise<void> {
	elements.cancel.disabled = true;
	const written = await writeEvent({
		protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
		requestId: request.requestId,
		status: 'cancelled',
		operationId: createOperationId(),
	});
	if (!written) {
		elements.cancel.disabled = false;
		elements.error.textContent = request.labels.operationError;
		elements.error.hidden = false;
		return;
	}
	try {
		await eda.sys_IFrame.closeIFrame(INVENTORY_CREATE_IFRAME_ID);
	}
	catch {
		// The host poller can still observe the persisted cancellation event.
	}
}

function showModal(elements: PanelElements, modal: HTMLElement): void {
	elements.modalBackdrop.hidden = false;
	elements.suggestionModal.hidden = modal !== elements.suggestionModal;
	elements.duplicateModal.hidden = modal !== elements.duplicateModal;
	(modal.querySelector('button') as HTMLButtonElement | null)?.focus();
}

function closeModal(elements: PanelElements): void {
	elements.modalBackdrop.hidden = true;
	elements.suggestionModal.hidden = true;
	elements.duplicateModal.hidden = true;
}

function closeLocationPicker(elements: PanelElements): void {
	elements.locationOptions.hidden = true;
	elements.chooseLocation.setAttribute('aria-expanded', 'false');
}

function setQueryStatus(elements: PanelElements, text: string, state: 'available' | 'failed' | 'idle' | 'missing' | 'running'): void {
	elements.edaStatus.textContent = text;
	elements.edaStatus.dataset.state = state;
}

function renderDetails(list: HTMLDListElement, entries: Array<[string, string]>, emptyValue: string): void {
	list.replaceChildren(...entries.flatMap(([label, value]) => {
		const term = document.createElement('dt');
		term.textContent = label;
		const detail = document.createElement('dd');
		detail.textContent = value || emptyValue;
		return [term, detail];
	}));
}

function suggestionValue(label: string, value: string): HTMLElement {
	const element = document.createElement('div');
	element.className = 'suggestion-value';
	const caption = document.createElement('small');
	caption.textContent = label;
	element.append(caption, document.createTextNode(value));
	return element;
}

function identityElement(elements: PanelElements, field: typeof IDENTITY_FIELDS[number]): HTMLInputElement | HTMLTextAreaElement {
	const fields = {
		lcscPartNumber: elements.lcscPartNumber,
		supplierId: elements.supplierId,
		name: elements.name,
		manufacturer: elements.manufacturer,
		manufacturerPartNumber: elements.manufacturerPartNumber,
		package: elements.package,
		description: elements.description,
	};
	return fields[field];
}

function identityLabel(field: typeof IDENTITY_FIELDS[number], labels: InventoryCreateLabels): string {
	const fieldLabels = {
		lcscPartNumber: labels.lcscPartNumber,
		supplierId: labels.supplierId,
		name: labels.name,
		manufacturer: labels.manufacturer,
		manufacturerPartNumber: labels.manufacturerPartNumber,
		package: labels.package,
		description: labels.description,
	};
	return fieldLabels[field];
}

function compareCategory(left: { name: string; sortOrder: number }, right: { name: string; sortOrder: number }): number {
	return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name);
}

function option(value: string, text: string): HTMLOptionElement {
	const result = document.createElement('option');
	result.value = value;
	result.textContent = text;
	return result;
}

function normalizeLcsc(value: string): string {
	const cleaned = value.trim().replaceAll(/\s+/g, '').toUpperCase();
	return /^\d+$/.test(cleaned) ? `C${cleaned}` : cleaned;
}

function getElements(): PanelElements {
	return {
		shell: element('panel-shell', HTMLElement),
		bootStatus: element('boot-status', HTMLElement),
		bootMessage: element('boot-message', HTMLElement),
		form: element('create-form', HTMLFormElement),
		title: element('panel-title', HTMLElement),
		edaStatus: element('eda-status', HTMLElement),
		lcscPartNumber: element('lcsc', HTMLInputElement),
		supplierId: element('supplier', HTMLInputElement),
		name: element('name', HTMLInputElement),
		manufacturer: element('manufacturer', HTMLInputElement),
		manufacturerPartNumber: element('manufacturer-part', HTMLInputElement),
		package: element('package', HTMLInputElement),
		description: element('description', HTMLTextAreaElement),
		quantity: element('quantity', HTMLInputElement),
		modeExact: element('mode-exact', HTMLInputElement),
		modeEstimated: element('mode-estimated', HTMLInputElement),
		modeUnknown: element('mode-unknown', HTMLInputElement),
		modeDepleted: element('mode-depleted', HTMLInputElement),
		primaryCategory: element('primary-category', HTMLSelectElement),
		secondaryCategory: element('secondary-category', HTMLSelectElement),
		location: element('location', HTMLInputElement),
		chooseLocation: element('choose-location', HTMLButtonElement),
		locationOptions: element('location-options', HTMLElement),
		note: element('note', HTMLTextAreaElement),
		queryEda: element('query-eda', HTMLButtonElement),
		openMarketplace: element('open-marketplace', HTMLButtonElement),
		marketplaceConfirmed: element('marketplace-confirmed', HTMLInputElement),
		cancel: element('cancel', HTMLButtonElement),
		save: element('save', HTMLButtonElement),
		error: element('form-error', HTMLElement),
		modalBackdrop: element('modal-backdrop', HTMLElement),
		suggestionModal: element('suggestion-modal', HTMLElement),
		suggestionList: element('suggestion-list', HTMLElement),
		suggestionClose: element('suggestion-close', HTMLButtonElement),
		duplicateModal: element('duplicate-modal', HTMLElement),
		duplicateMessage: element('duplicate-message', HTMLElement),
		existingDetails: element('existing-details', HTMLDListElement),
		pendingDetails: element('pending-details', HTMLDListElement),
		duplicateCancel: element('duplicate-cancel', HTMLButtonElement),
		duplicateConfirm: element('duplicate-confirm', HTMLButtonElement),
		connectionError: element('connection-error', HTMLElement),
	};
}

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
	const value = document.getElementById(id);
	if (!(value instanceof constructor)) {
		throw new TypeError(`Missing inventory create panel element: ${id}`);
	}
	return value;
}

function setText(id: string, value: string): void {
	element(id, HTMLElement).textContent = value;
}

function progress(requestId: string, stage: 'panel-rendered' | 'request-read' | 'script-started'): IFrameInventoryCreateEvent {
	return { protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION, requestId, status: 'progress', stage };
}

function baseEvent(requestId: string, status: 'ready'): IFrameInventoryCreateEvent {
	return { protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION, requestId, status };
}

async function requireWrite(
	writeEvent: (event: IFrameInventoryCreateEvent) => Promise<boolean>,
	event: IFrameInventoryCreateEvent,
): Promise<void> {
	if (!await writeEvent(event)) {
		throw new Error('The host rejected the inventory create panel event.');
	}
}

async function reportBootstrapFailure(error: unknown): Promise<void> {
	try {
		const request = readRequest();
		await eda.sys_Storage.setExtensionUserConfig(INVENTORY_CREATE_EVENT_KEY, {
			protocolVersion: INVENTORY_CREATE_PROTOCOL_VERSION,
			requestId: request?.requestId ?? '',
			status: 'failed',
			stage: 'script-started',
			errorName: error instanceof Error ? error.name.slice(0, 80) : typeof error,
			error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
		} satisfies IFrameInventoryCreateEvent);
	}
	catch {
		// There is no remaining bridge available for diagnostics.
	}
}

function showConnectionError(elements: PanelElements | undefined, message: string): void {
	if (!elements) {
		return;
	}
	elements.shell.setAttribute('aria-busy', 'false');
	elements.bootStatus.hidden = true;
	elements.form.hidden = true;
	elements.modalBackdrop.hidden = true;
	elements.connectionError.textContent = message;
	elements.connectionError.hidden = false;
}

function localizeBootstrap(elements: PanelElements): void {
	const chinese = usesChineseBrowserLanguage();
	document.documentElement.lang = chinese ? 'zh-Hans' : 'en';
	elements.bootMessage.textContent = chinese ? '正在加载表单...' : 'Loading form...';
}

function fallbackConnectionError(): string {
	return usesChineseBrowserLanguage() ? '表单连接失败。' : 'The form connection failed.';
}

function usesChineseBrowserLanguage(): boolean {
	return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
}

function inferLanguage(text: string): string {
	return /[\u3400-\u9FFF]/.test(text) ? 'zh-Hans' : 'en';
}

function createOperationId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
