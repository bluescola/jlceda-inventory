import type {
	IFrameProjectPlanningEvent,
	IFrameProjectPlanningRequest,
	IFrameProjectPlanningResponse,
	ProjectPlanningDataPayload,
	ProjectPlanningLabels,
	ProjectPlanningProcurementPayload,
	ProjectPlanningPurchasePayload,
	ProjectPlanningSnapshotPayload,
} from '../../presentation/iframe-project-planning-protocol';
import type {
	ProjectPlanningAction,
	ProjectPlanningIntent,
	ProjectPlanningTab,
	ProjectPlanningViewState,
} from '../../presentation/project-planning-panel';
import {
	parseIFrameProjectPlanningRequest,
	parseIFrameProjectPlanningResponse,
	PROJECT_PLANNING_EVENT_KEY,
	PROJECT_PLANNING_IFRAME_ID,
	PROJECT_PLANNING_PROTOCOL_VERSION,
	PROJECT_PLANNING_REQUEST_KEY,
	PROJECT_PLANNING_RESPONSE_KEY,
} from '../../presentation/iframe-project-planning-protocol';

interface Elements {
	shell: HTMLElement;
	boot: HTMLElement;
	bootMessage: HTMLElement;
	workspace: HTMLElement;
	tabs: Record<ProjectPlanningTab, HTMLButtonElement>;
	views: Record<ProjectPlanningTab, HTMLElement>;
	pageSize: HTMLSelectElement;
	refresh: HTMLButtonElement;
	close: HTMLButtonElement;
	captureCurrent: HTMLButtonElement;
	exportProcurement: HTMLButtonElement;
	addPurchase: HTMLButtonElement;
	snapshotRows: HTMLTableSectionElement;
	procurementRows: HTMLTableSectionElement;
	purchaseRows: HTMLTableSectionElement;
	empty: Record<ProjectPlanningTab, HTMLElement>;
	summary: Record<ProjectPlanningTab, HTMLElement>;
	pagers: Record<ProjectPlanningTab, PagerElements>;
	costSummary: HTMLElement;
	operationStatus: HTMLElement;
	connectionError: HTMLElement;
	dialogBackdrop: HTMLElement;
	dialogTitle: HTMLElement;
	dialogMessage: HTMLElement;
	dialogError: HTMLElement;
	boardQuantityField: HTMLElement;
	boardQuantityInput: HTMLInputElement;
	dialogCancel: HTMLButtonElement;
	dialogConfirm: HTMLButtonElement;
	purchaseBackdrop: HTMLElement;
	purchaseForm: HTMLFormElement;
	purchaseFormError: HTMLElement;
	purchaseCancel: HTMLButtonElement;
	purchaseSubmit: HTMLButtonElement;
	purchasePart: HTMLInputElement;
	purchaseName: HTMLInputElement;
	purchaseQuantity: HTMLInputElement;
	purchaseUnitPrice: HTMLInputElement;
	purchaseCurrency: HTMLInputElement;
	purchaseDate: HTMLInputElement;
	purchasePlatform: HTMLInputElement;
	purchaseOrder: HTMLInputElement;
	purchaseUrl: HTMLInputElement;
	purchaseSnapshots: HTMLSelectElement;
	purchaseNote: HTMLTextAreaElement;
}

interface PagerElements {
	container: HTMLElement;
	previous: HTMLButtonElement;
	next: HTMLButtonElement;
	status: HTMLElement;
}

interface ActiveOperation {
	id: string;
	intent: ProjectPlanningIntent;
}

const TABS: readonly ProjectPlanningTab[] = ['snapshots', 'procurement', 'purchases'];

void bootstrap();

async function bootstrap(): Promise<void> {
	let elements: Elements | undefined;
	let stage: 'panel-rendered' | 'request-read' | 'script-started' = 'script-started';
	try {
		elements = getElements();
		localizeBootstrap(elements);
		const request = readRequest();
		if (!request) {
			throw new TypeError('The project planning request is unavailable.');
		}
		const writeEvent = async (event: IFrameProjectPlanningEvent): Promise<boolean> => {
			try {
				return await eda.sys_Storage.setExtensionUserConfig(PROJECT_PLANNING_EVENT_KEY, event);
			}
			catch {
				return false;
			}
		};
		await requireWrite(writeEvent, progress(request.requestId, stage));
		stage = 'request-read';
		await requireWrite(writeEvent, progress(request.requestId, stage));
		renderPanel(elements, request, writeEvent);
		stage = 'panel-rendered';
		await requireWrite(writeEvent, progress(request.requestId, stage));
		await requireWrite(writeEvent, {
			protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'ready',
		});
	}
	catch (error) {
		showConnectionError(elements);
		await reportFailure(error, stage);
	}
}

function renderPanel(
	elements: Elements,
	request: IFrameProjectPlanningRequest,
	writeEvent: (event: IFrameProjectPlanningEvent) => Promise<boolean>,
): void {
	const labels = request.labels;
	let data: ProjectPlanningDataPayload = dataFromRequest(request);
	let state = normalizeState(request.initialState);
	let active: ActiveOperation | undefined;
	let confirmAction: (() => void) | undefined;
	let render = (): void => undefined;

	localize(elements, labels);

	const viewState = (): ProjectPlanningViewState => ({ ...state });
	const setPending = (pending: boolean): void => {
		elements.shell.setAttribute('aria-busy', String(pending));
		elements.workspace
			.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button, input, select, textarea')
			.forEach(control => control.disabled = pending);
	};
	const closeConfirmDialog = (): void => {
		elements.dialogBackdrop.hidden = true;
		elements.dialogError.hidden = true;
		confirmAction = undefined;
	};
	const showConfirmDialog = (
		title: string,
		message: string,
		onConfirm: () => void,
		options?: { boardQuantity?: number; destructive?: boolean },
	): void => {
		elements.dialogTitle.textContent = title;
		elements.dialogMessage.textContent = message;
		elements.dialogConfirm.textContent = title;
		elements.dialogConfirm.classList.toggle('button-danger', options?.destructive === true);
		elements.dialogConfirm.classList.toggle('button-primary', options?.destructive !== true);
		elements.boardQuantityField.hidden = options?.boardQuantity === undefined;
		if (options?.boardQuantity !== undefined) {
			elements.boardQuantityInput.value = String(options.boardQuantity);
		}
		elements.dialogError.hidden = true;
		confirmAction = onConfirm;
		elements.dialogBackdrop.hidden = false;
		window.setTimeout(() => (options?.boardQuantity === undefined ? elements.dialogConfirm : elements.boardQuantityInput).focus(), 0);
	};
	const dispatch = async (action: ProjectPlanningAction): Promise<void> => {
		if (active) {
			return;
		}
		const operationId = createOperationId();
		const intent = { ...action, viewState: viewState() } as ProjectPlanningIntent;
		active = { id: operationId, intent };
		setPending(true);
		showStatus(elements, labels.operationPending, false);
		try {
			await eda.sys_Storage.deleteExtensionUserConfig(PROJECT_PLANNING_RESPONSE_KEY);
			if (!await writeEvent({
				protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
				requestId: request.requestId,
				status: 'operation',
				operationId,
				intent,
			})) {
				throw new Error('The host rejected the project planning operation.');
			}
		}
		catch {
			active = undefined;
			setPending(false);
			render();
			showStatus(elements, labels.operationError, true);
		}
	};

	render = (): void => {
		state = clampPages(state, data);
		renderTabs(elements, state.tab);
		renderSnapshots(elements, data.snapshots, state, labels, dispatch, showConfirmDialog);
		renderProcurement(elements, data.procurement, state, labels);
		renderPurchases(elements, data, state, labels, dispatch, showConfirmDialog);
		elements.pageSize.value = String(state.pageSize);
	};
	const selectTab = (tab: ProjectPlanningTab): void => {
		state = { ...state, tab };
		render();
	};

	for (const tab of TABS) {
		elements.tabs[tab].addEventListener('click', () => selectTab(tab));
	}
	elements.pageSize.addEventListener('change', () => {
		const pageSize = Number(elements.pageSize.value);
		if (pageSize === 25 || pageSize === 50 || pageSize === 100) {
			state = { ...state, pageSize, snapshotPage: 1, procurementPage: 1, purchasePage: 1 };
			render();
		}
	});
	for (const tab of TABS) {
		const pager = elements.pagers[tab];
		pager.previous.addEventListener('click', () => {
			state = setPage(state, tab, Math.max(1, pageFor(state, tab) - 1));
			render();
		});
		pager.next.addEventListener('click', () => {
			state = setPage(state, tab, pageFor(state, tab) + 1);
			render();
		});
	}
	elements.captureCurrent.addEventListener('click', () => void dispatch({ type: 'capture-current' }));
	elements.exportProcurement.addEventListener('click', () => void dispatch({ type: 'export-procurement' }));
	elements.refresh.addEventListener('click', () => void dispatch({ type: 'refresh' }));
	elements.close.addEventListener('click', () => void dispatch({ type: 'close' }));
	elements.dialogCancel.addEventListener('click', closeConfirmDialog);
	elements.dialogConfirm.addEventListener('click', () => confirmAction?.());
	elements.dialogBackdrop.addEventListener('click', event => event.target === elements.dialogBackdrop ? closeConfirmDialog() : undefined);
	elements.addPurchase.addEventListener('click', () => openPurchaseForm(elements, data.snapshots));
	elements.purchaseCancel.addEventListener('click', () => closePurchaseForm(elements));
	elements.purchaseBackdrop.addEventListener('click', event => event.target === elements.purchaseBackdrop ? closePurchaseForm(elements) : undefined);
	elements.purchaseForm.addEventListener('submit', (event) => {
		event.preventDefault();
		const action = createPurchaseAction(elements, labels);
		if (!action) {
			return;
		}
		closePurchaseForm(elements);
		void dispatch(action);
	});

	const timer = window.setInterval(() => {
		if (!active) {
			return;
		}
		let response: IFrameProjectPlanningResponse | undefined;
		try {
			response = parseIFrameProjectPlanningResponse(
				eda.sys_Storage.getExtensionUserConfig(PROJECT_PLANNING_RESPONSE_KEY),
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
		setPending(false);
		if (response.result.snapshot) {
			data = response.result.snapshot;
		}
		render();
		if (response.result.status === 'failed') {
			showStatus(elements, response.result.message ?? labels.operationError, true);
			return;
		}
		showStatus(elements, response.result.message ?? '', false);
		if (completed.intent.type === 'close' && response.result.status === 'succeeded') {
			window.clearInterval(timer);
			void closePanel();
		}
	}, 100);
	window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true });

	elements.shell.setAttribute('aria-busy', 'false');
	elements.boot.hidden = true;
	elements.workspace.hidden = false;
	render();
}

function renderTabs(elements: Elements, selected: ProjectPlanningTab): void {
	for (const tab of TABS) {
		const active = tab === selected;
		elements.tabs[tab].setAttribute('aria-selected', String(active));
		elements.tabs[tab].tabIndex = active ? 0 : -1;
		elements.views[tab].hidden = !active;
	}
}

function renderSnapshots(
	elements: Elements,
	rows: readonly ProjectPlanningSnapshotPayload[],
	state: ProjectPlanningViewState,
	labels: ProjectPlanningLabels,
	dispatch: (action: ProjectPlanningAction) => Promise<void>,
	confirm: (title: string, message: string, action: () => void, options?: { boardQuantity?: number; destructive?: boolean }) => void,
): void {
	const pageRows = paginate(rows, state.snapshotPage, state.pageSize);
	elements.summary.snapshots.textContent = `${labels.tabSnapshots}: ${rows.length}`;
	elements.snapshotRows.replaceChildren(...pageRows.items.map((snapshot) => {
		const setQuantity = actionButton(labels.setBoardQuantity, () => confirm(
			labels.setBoardQuantity,
			formatLabel(labels.confirmSetBoardQuantity, { label: snapshot.label, boardQuantity: snapshot.boardQuantity }),
			() => {
				const boardQuantity = Number(elements.boardQuantityInput.value);
				if (!Number.isSafeInteger(boardQuantity) || boardQuantity <= 0) {
					elements.dialogError.textContent = labels.boardQuantityInvalid;
					elements.dialogError.hidden = false;
					return;
				}
				elements.dialogBackdrop.hidden = true;
				void dispatch({
					type: 'set-board-quantity',
					snapshot: snapshotRef(snapshot),
					boardQuantity,
					confirmed: true,
				});
			},
			{ boardQuantity: snapshot.boardQuantity },
		));
		const remove = actionButton(labels.removeSnapshot, () => confirm(
			labels.removeSnapshot,
			formatLabel(labels.confirmRemoveSnapshot, { label: snapshot.label }),
			() => {
				elements.dialogBackdrop.hidden = true;
				void dispatch({ type: 'remove-snapshot', snapshot: snapshotRef(snapshot), confirmed: true });
			},
			{ destructive: true },
		));
		remove.classList.add('danger-text');
		return tableRow(
			snapshot.label,
			snapshot.projectUuid ?? labels.emptyValue,
			snapshot.documentUuid,
			documentKindLabel(snapshot.documentKind, labels),
			numericCell(snapshot.boardQuantity),
			snapshot.capturedAtLabel,
			numericCell(snapshot.demandCount),
			actionsCell(setQuantity, remove),
		);
	}));
	updateEmptyAndPager(elements.empty.snapshots, elements.pagers.snapshots, rows.length, pageRows, labels.emptySnapshots, labels);
}

function renderProcurement(
	elements: Elements,
	rows: readonly ProjectPlanningProcurementPayload[],
	state: ProjectPlanningViewState,
	labels: ProjectPlanningLabels,
): void {
	const pageRows = paginate(rows, state.procurementPage, state.pageSize);
	elements.summary.procurement.textContent = `${labels.tabProcurement}: ${rows.length}`;
	elements.procurementRows.replaceChildren(...pageRows.items.map(row => tableRow(
		row.lcscPartNumber ?? labels.emptyValue,
		row.name ?? row.manufacturerPartNumber ?? row.package ?? labels.emptyValue,
		numericCell(row.requiredQuantity),
		numericCell(availableLabel(row, labels)),
		numericCell(row.suggestedQuantity ?? statusLabel(row.status, labels)),
		statusCell(row.status, labels),
		row.sources.map(source => `${source.label} (${source.boardQuantity})`).join(', ') || labels.emptyValue,
	)));
	updateEmptyAndPager(elements.empty.procurement, elements.pagers.procurement, rows.length, pageRows, labels.emptyProcurement, labels);
}

function renderPurchases(
	elements: Elements,
	data: ProjectPlanningDataPayload,
	state: ProjectPlanningViewState,
	labels: ProjectPlanningLabels,
	dispatch: (action: ProjectPlanningAction) => Promise<void>,
	confirm: (title: string, message: string, action: () => void, options?: { destructive?: boolean }) => void,
): void {
	const pageRows = paginate(data.purchases, state.purchasePage, state.pageSize);
	const snapshotLabels = new Map(data.snapshots.map(snapshot => [snapshot.id, snapshot.label]));
	elements.summary.purchases.textContent = `${labels.tabPurchases}: ${data.purchases.length}`;
	elements.purchaseRows.replaceChildren(...pageRows.items.map((record) => {
		const remove = actionButton(labels.removePurchase, () => confirm(
			labels.removePurchase,
			formatLabel(labels.confirmRemovePurchase, { name: record.name }),
			() => {
				elements.dialogBackdrop.hidden = true;
				void dispatch({
					type: 'remove-purchase',
					purchase: {
						id: record.id,
						expectedRevision: record.revision,
						projectSnapshotIds: [...record.projectSnapshotIds],
					},
					confirmed: true,
				});
			},
			{ destructive: true },
		));
		return tableRow(
			record.lcscPartNumber ?? labels.emptyValue,
			purchaseNameCell(record),
			numericCell(record.quantity),
			numericCell(`${record.unitPriceMinor} ${record.currency}`),
			numericCell(`${record.totalMinor} ${record.currency}`),
			record.platform ?? labels.emptyValue,
			record.orderNumber ?? labels.emptyValue,
			record.purchasedAtLabel,
			record.projectSnapshotIds.map(id => snapshotLabels.get(id) ?? id).join(', ') || labels.emptyValue,
			actionsCell(remove),
		);
	}));
	elements.costSummary.replaceChildren(...data.costSummaries.map((summary) => {
		const item = document.createElement('span');
		item.className = 'cost-item';
		item.textContent = `${labels.costSummary}: ${summary.currency} · ${labels.columnQuantity} ${summary.totalQuantity} · ${labels.columnTotalMinor} ${summary.totalMinor} (${summary.recordCount})`;
		return item;
	}));
	updateEmptyAndPager(elements.empty.purchases, elements.pagers.purchases, data.purchases.length, pageRows, labels.emptyPurchases, labels);
}

function createPurchaseAction(elements: Elements, labels: ProjectPlanningLabels): ProjectPlanningAction | undefined {
	const lcscPartNumber = optionalText(elements.purchasePart.value)?.toUpperCase();
	const name = elements.purchaseName.value.trim();
	const quantity = Number(elements.purchaseQuantity.value);
	const unitPriceMinor = Number(elements.purchaseUnitPrice.value);
	const currency = elements.purchaseCurrency.value.trim().toUpperCase();
	const purchasedDate = elements.purchaseDate.value;
	const purchasedAt = purchasedDate;
	let error: string | undefined;
	if (!name) {
		error = labels.purchaseNameRequired;
	}
	else if (lcscPartNumber && !/^C\d+$/.test(lcscPartNumber)) {
		error = labels.purchasePartNumberInvalid;
	}
	else if (!Number.isSafeInteger(quantity) || quantity <= 0) {
		error = labels.purchaseQuantityInvalid;
	}
	else if (!Number.isSafeInteger(unitPriceMinor) || unitPriceMinor < 0 || !Number.isSafeInteger(quantity * unitPriceMinor)) {
		error = labels.purchasePriceInvalid;
	}
	else if (!/^[A-Z]{3}$/.test(currency)) {
		error = labels.purchaseCurrencyInvalid;
	}
	else if (!isCalendarDate(purchasedAt)) {
		error = labels.purchaseDateInvalid;
	}
	if (error) {
		elements.purchaseFormError.textContent = error;
		elements.purchaseFormError.hidden = false;
		return undefined;
	}
	return {
		type: 'add-purchase',
		draft: {
			lcscPartNumber,
			name,
			quantity,
			unitPriceMinor,
			currency,
			platform: optionalText(elements.purchasePlatform.value),
			productUrl: optionalText(elements.purchaseUrl.value),
			orderNumber: optionalText(elements.purchaseOrder.value),
			purchasedAt,
			projectSnapshotIds: Array.from(elements.purchaseSnapshots.selectedOptions, option => option.value),
			note: optionalText(elements.purchaseNote.value),
		},
	};
}

function openPurchaseForm(elements: Elements, snapshots: readonly ProjectPlanningSnapshotPayload[]): void {
	elements.purchaseForm.reset();
	elements.purchaseCurrency.value = 'CNY';
	elements.purchaseDate.value = localDateValue(new Date());
	elements.purchaseSnapshots.replaceChildren(...snapshots.map((snapshot) => {
		const option = document.createElement('option');
		option.value = snapshot.id;
		option.textContent = snapshot.label;
		return option;
	}));
	elements.purchaseFormError.hidden = true;
	elements.purchaseBackdrop.hidden = false;
	window.setTimeout(() => elements.purchasePart.focus(), 0);
}

function closePurchaseForm(elements: Elements): void {
	elements.purchaseBackdrop.hidden = true;
	elements.purchaseFormError.hidden = true;
}

function updateEmptyAndPager<T>(
	empty: HTMLElement,
	pager: PagerElements,
	total: number,
	page: Page<T>,
	emptyLabel: string,
	labels: ProjectPlanningLabels,
): void {
	empty.textContent = emptyLabel;
	empty.hidden = total !== 0;
	pager.container.hidden = total <= page.pageSize;
	pager.previous.disabled = page.page <= 1;
	pager.next.disabled = page.page >= page.pages;
	pager.status.textContent = formatPageStatus(labels.pageStatus, page.page, page.pages);
}

interface Page<T> {
	items: readonly T[];
	page: number;
	pages: number;
	pageSize: number;
}

function paginate<T>(values: readonly T[], page: number, pageSize: number): Page<T> {
	const pages = Math.max(1, Math.ceil(values.length / pageSize));
	const normalizedPage = Math.min(Math.max(1, page), pages);
	const start = (normalizedPage - 1) * pageSize;
	return { items: values.slice(start, start + pageSize), page: normalizedPage, pages, pageSize };
}

function clampPages(state: ProjectPlanningViewState, data: ProjectPlanningDataPayload): ProjectPlanningViewState {
	return {
		...state,
		snapshotPage: paginate(data.snapshots, state.snapshotPage, state.pageSize).page,
		procurementPage: paginate(data.procurement, state.procurementPage, state.pageSize).page,
		purchasePage: paginate(data.purchases, state.purchasePage, state.pageSize).page,
	};
}

function pageFor(state: ProjectPlanningViewState, tab: ProjectPlanningTab): number {
	return tab === 'snapshots' ? state.snapshotPage : tab === 'procurement' ? state.procurementPage : state.purchasePage;
}

function setPage(state: ProjectPlanningViewState, tab: ProjectPlanningTab, page: number): ProjectPlanningViewState {
	return tab === 'snapshots'
		? { ...state, snapshotPage: page }
		: tab === 'procurement'
			? { ...state, procurementPage: page }
			: { ...state, purchasePage: page };
}

function normalizeState(state: ProjectPlanningViewState | undefined): ProjectPlanningViewState {
	return state
		? { ...state }
		: {
				tab: 'snapshots',
				snapshotPage: 1,
				procurementPage: 1,
				purchasePage: 1,
				pageSize: 25,
			};
}

function localize(elements: Elements, labels: ProjectPlanningLabels): void {
	document.documentElement.lang = inferLanguage(labels.title);
	document.title = labels.title;
	elements.tabs.snapshots.textContent = labels.tabSnapshots;
	elements.tabs.procurement.textContent = labels.tabProcurement;
	elements.tabs.purchases.textContent = labels.tabPurchases;
	setText('page-size-label', labels.pageSize);
	elements.refresh.textContent = labels.refresh;
	elements.close.textContent = labels.close;
	setText('snapshots-title', labels.tabSnapshots);
	elements.captureCurrent.textContent = labels.captureCurrent;
	setText('snapshot-column-label', labels.columnLabel);
	setText('snapshot-column-project', labels.columnProjectUuid);
	setText('snapshot-column-document', labels.columnDocumentUuid);
	setText('snapshot-column-kind', labels.columnDocumentKind);
	setText('snapshot-column-board', labels.columnBoardQuantity);
	setText('snapshot-column-captured', labels.columnCapturedAt);
	setText('snapshot-column-lines', labels.columnDemandLines);
	setText('snapshot-column-actions', labels.columnActions);
	setText('procurement-title', labels.tabProcurement);
	elements.exportProcurement.textContent = labels.exportProcurement;
	setText('procurement-column-part', labels.columnPartNumber);
	setText('procurement-column-name', labels.columnName);
	setText('procurement-column-required', labels.columnRequiredQuantity);
	setText('procurement-column-available', labels.columnAvailableQuantity);
	setText('procurement-column-shortage', labels.columnSuggestedQuantity);
	setText('procurement-column-status', labels.columnStatus);
	setText('procurement-column-sources', labels.columnSources);
	setText('purchases-title', labels.tabPurchases);
	elements.addPurchase.textContent = labels.addPurchase;
	setText('purchase-column-part', labels.columnPartNumber);
	setText('purchase-column-name', labels.columnName);
	setText('purchase-column-quantity', labels.columnQuantity);
	setText('purchase-column-unit-price', `${labels.columnUnitPriceMinor} / ${labels.columnCurrency}`);
	setText('purchase-column-total', `${labels.columnTotalMinor} / ${labels.columnCurrency}`);
	setText('purchase-column-platform', labels.columnPlatform);
	setText('purchase-column-order', labels.columnOrderNumber);
	setText('purchase-column-date', labels.columnPurchasedAt);
	setText('purchase-column-sources', labels.columnSources);
	setText('purchase-column-actions', labels.columnActions);
	setText('board-quantity-label', labels.boardQuantity);
	elements.dialogCancel.textContent = labels.cancel;
	setText('purchase-form-title', labels.addPurchase);
	setText('purchase-part-label', labels.fieldPartNumber);
	setText('purchase-name-label', labels.fieldName);
	setText('purchase-quantity-label', labels.fieldQuantity);
	setText('purchase-unit-price-label', labels.fieldUnitPriceMinor);
	setText('purchase-currency-label', labels.fieldCurrency);
	setText('purchase-platform-label', labels.fieldPlatform);
	setText('purchase-url-label', labels.fieldProductUrl);
	setText('purchase-order-label', labels.fieldOrderNumber);
	setText('purchase-date-label', labels.fieldPurchasedAt);
	setText('purchase-snapshots-label', labels.fieldSnapshots);
	setText('purchase-note-label', labels.fieldNote);
	elements.purchaseCancel.textContent = labels.cancel;
	elements.purchaseSubmit.textContent = labels.savePurchase;
	for (const pager of Object.values(elements.pagers)) {
		pager.previous.title = labels.previousPage;
		pager.previous.setAttribute('aria-label', labels.previousPage);
		pager.next.title = labels.nextPage;
		pager.next.setAttribute('aria-label', labels.nextPage);
	}
}

function getElements(): Elements {
	return {
		shell: element('panel-shell', HTMLElement),
		boot: element('boot-status', HTMLElement),
		bootMessage: element('boot-message', HTMLElement),
		workspace: element('workspace', HTMLElement),
		tabs: {
			snapshots: element('tab-snapshots', HTMLButtonElement),
			procurement: element('tab-procurement', HTMLButtonElement),
			purchases: element('tab-purchases', HTMLButtonElement),
		},
		views: {
			snapshots: element('view-snapshots', HTMLElement),
			procurement: element('view-procurement', HTMLElement),
			purchases: element('view-purchases', HTMLElement),
		},
		pageSize: element('page-size', HTMLSelectElement),
		refresh: element('refresh', HTMLButtonElement),
		close: element('close', HTMLButtonElement),
		captureCurrent: element('capture-current', HTMLButtonElement),
		exportProcurement: element('export-procurement', HTMLButtonElement),
		addPurchase: element('add-purchase', HTMLButtonElement),
		snapshotRows: element('snapshot-rows', HTMLTableSectionElement),
		procurementRows: element('procurement-rows', HTMLTableSectionElement),
		purchaseRows: element('purchase-rows', HTMLTableSectionElement),
		empty: {
			snapshots: element('snapshots-empty', HTMLElement),
			procurement: element('procurement-empty', HTMLElement),
			purchases: element('purchases-empty', HTMLElement),
		},
		summary: {
			snapshots: element('snapshots-summary', HTMLElement),
			procurement: element('procurement-summary', HTMLElement),
			purchases: element('purchases-summary', HTMLElement),
		},
		pagers: {
			snapshots: pager('snapshot'),
			procurement: pager('procurement'),
			purchases: pager('purchase'),
		},
		costSummary: element('cost-summary', HTMLElement),
		operationStatus: element('operation-status', HTMLElement),
		connectionError: element('connection-error', HTMLElement),
		dialogBackdrop: element('dialog-backdrop', HTMLElement),
		dialogTitle: element('dialog-title', HTMLElement),
		dialogMessage: element('dialog-message', HTMLElement),
		dialogError: element('dialog-error', HTMLElement),
		boardQuantityField: element('board-quantity-field', HTMLElement),
		boardQuantityInput: element('board-quantity-input', HTMLInputElement),
		dialogCancel: element('dialog-cancel', HTMLButtonElement),
		dialogConfirm: element('dialog-confirm', HTMLButtonElement),
		purchaseBackdrop: element('purchase-backdrop', HTMLElement),
		purchaseForm: element('purchase-form', HTMLFormElement),
		purchaseFormError: element('purchase-form-error', HTMLElement),
		purchaseCancel: element('purchase-cancel', HTMLButtonElement),
		purchaseSubmit: element('purchase-submit', HTMLButtonElement),
		purchasePart: element('purchase-part', HTMLInputElement),
		purchaseName: element('purchase-name', HTMLInputElement),
		purchaseQuantity: element('purchase-quantity', HTMLInputElement),
		purchaseUnitPrice: element('purchase-unit-price', HTMLInputElement),
		purchaseCurrency: element('purchase-currency', HTMLInputElement),
		purchaseDate: element('purchase-date', HTMLInputElement),
		purchasePlatform: element('purchase-platform', HTMLInputElement),
		purchaseOrder: element('purchase-order', HTMLInputElement),
		purchaseUrl: element('purchase-url', HTMLInputElement),
		purchaseSnapshots: element('purchase-snapshots', HTMLSelectElement),
		purchaseNote: element('purchase-note', HTMLTextAreaElement),
	};
}

function pager(prefix: 'procurement' | 'purchase' | 'snapshot'): PagerElements {
	return {
		container: element(`${prefix}-pager`, HTMLElement),
		previous: element(`${prefix}-previous`, HTMLButtonElement),
		next: element(`${prefix}-next`, HTMLButtonElement),
		status: element(`${prefix}-page-status`, HTMLElement),
	};
}

function tableRow(...values: Array<Node | number | string>): HTMLTableRowElement {
	const row = document.createElement('tr');
	row.append(...values.map(value => value instanceof Node ? asTableCell(value) : cell(String(value))));
	return row;
}

function cell(value: string): HTMLTableCellElement {
	const result = document.createElement('td');
	result.textContent = value;
	return result;
}

function asTableCell(value: Node): HTMLTableCellElement {
	if (value instanceof HTMLTableCellElement) {
		return value;
	}
	const result = document.createElement('td');
	result.append(value);
	return result;
}

function numericCell(value: number | string): HTMLTableCellElement {
	const result = cell(String(value));
	result.className = 'numeric';
	return result;
}

function actionsCell(...buttons: HTMLButtonElement[]): HTMLTableCellElement {
	const result = document.createElement('td');
	const actions = document.createElement('div');
	actions.className = 'row-actions';
	actions.append(...buttons);
	result.append(actions);
	return result;
}

function actionButton(label: string, action: () => void): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = 'button button-secondary row-action';
	button.textContent = label;
	button.addEventListener('click', action);
	return button;
}

function purchaseNameCell(record: ProjectPlanningPurchasePayload): HTMLTableCellElement {
	const result = document.createElement('td');
	if (record.productUrl) {
		const link = document.createElement('a');
		link.href = record.productUrl;
		link.target = '_blank';
		link.rel = 'noreferrer noopener';
		link.textContent = record.name;
		result.append(link);
	}
	else {
		result.textContent = record.name;
	}
	return result;
}

function statusCell(status: ProjectPlanningProcurementPayload['status'], labels: ProjectPlanningLabels): HTMLTableCellElement {
	const result = document.createElement('td');
	const badge = document.createElement('span');
	badge.className = `status ${status}`;
	badge.textContent = statusLabel(status, labels);
	result.append(badge);
	return result;
}

function statusLabel(status: ProjectPlanningProcurementPayload['status'], labels: ProjectPlanningLabels): string {
	return {
		'sufficient': labels.statusSufficient,
		'insufficient': labels.statusInsufficient,
		'review-required': labels.statusReviewRequired,
		'stocktake-required': labels.statusStocktakeRequired,
		'inventory-missing': labels.statusInventoryMissing,
		'identity-unmatched': labels.statusIdentityUnmatched,
	}[status];
}

function availableLabel(row: ProjectPlanningProcurementPayload, labels: ProjectPlanningLabels): number | string {
	if (row.availableQuantity === null) {
		return labels.quantityUnknown;
	}
	return row.status === 'review-required'
		? formatQuantityTemplate(labels.quantityEstimated, row.availableQuantity)
		: row.availableQuantity;
}

function formatQuantityTemplate(template: string, quantity: number): string {
	return template
		.replaceAll(['$', '{1}'].join(''), String(quantity))
		.replaceAll('{count}', String(quantity));
}

function snapshotRef(snapshot: ProjectPlanningSnapshotPayload): {
	id: string;
	expectedRevision: number;
	projectUuid?: string;
	documentUuid: string;
} {
	return {
		id: snapshot.id,
		expectedRevision: snapshot.revision,
		projectUuid: snapshot.projectUuid,
		documentUuid: snapshot.documentUuid,
	};
}

function documentKindLabel(kind: ProjectPlanningSnapshotPayload['documentKind'], labels: ProjectPlanningLabels): string {
	return kind === 'schematic' ? labels.documentSchematic : kind === 'pcb' ? labels.documentPcb : labels.documentFile;
}

function dataFromRequest(request: IFrameProjectPlanningRequest): ProjectPlanningDataPayload {
	return {
		snapshots: request.snapshots,
		procurement: request.procurement,
		purchases: request.purchases,
		costSummaries: request.costSummaries,
	};
}

function formatPageStatus(template: string, page: number, pages: number): string {
	return template
		.replaceAll(['$', '{1}'].join(''), String(page))
		.replaceAll(['$', '{2}'].join(''), String(pages))
		.replaceAll('{page}', String(page))
		.replaceAll('{pages}', String(pages));
}

function formatLabel(template: string, values: Record<string, number | string>): string {
	return Object.entries(values).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
		template,
	);
}

function optionalText(value: string): string | undefined {
	const normalized = value.trim();
	return normalized || undefined;
}

function localDateValue(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isCalendarDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value)
		&& new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function showStatus(elements: Elements, message: string, failed: boolean): void {
	elements.operationStatus.classList.toggle('error', failed);
	elements.operationStatus.textContent = message;
}

function setText(id: string, value: string): void {
	element(id, HTMLElement).textContent = value;
}

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
	const value = document.getElementById(id);
	if (!(value instanceof constructor)) {
		throw new TypeError(`Missing project planning panel element: ${id}`);
	}
	return value;
}

function readRequest(): IFrameProjectPlanningRequest | undefined {
	try {
		return parseIFrameProjectPlanningRequest(eda.sys_Storage.getExtensionUserConfig(PROJECT_PLANNING_REQUEST_KEY));
	}
	catch {
		return undefined;
	}
}

async function reportFailure(error: unknown, stage: 'panel-rendered' | 'request-read' | 'script-started'): Promise<void> {
	const request = readRequest();
	if (!request) {
		return;
	}
	try {
		await eda.sys_Storage.setExtensionUserConfig(PROJECT_PLANNING_EVENT_KEY, {
			protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'failed',
			stage,
			errorName: errorName(error),
			error: errorMessage(error),
		} satisfies IFrameProjectPlanningEvent);
	}
	catch {
		// The host enforces its ready timeout when the bridge is unavailable.
	}
}

function progress(
	requestId: string,
	stage: 'panel-rendered' | 'request-read' | 'script-started',
): IFrameProjectPlanningEvent {
	return { protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION, requestId, status: 'progress', stage };
}

async function requireWrite(
	writeEvent: (event: IFrameProjectPlanningEvent) => Promise<boolean>,
	event: IFrameProjectPlanningEvent,
): Promise<void> {
	if (!await writeEvent(event)) {
		throw new Error('The host rejected the project planning event.');
	}
}

function showConnectionError(elements: Elements | undefined): void {
	if (!elements) {
		return;
	}
	elements.shell.setAttribute('aria-busy', 'false');
	elements.boot.hidden = true;
	elements.workspace.hidden = true;
	elements.connectionError.textContent = readRequest()?.labels.connectionError ?? fallbackConnectionError();
	elements.connectionError.hidden = false;
}

async function closePanel(): Promise<void> {
	try {
		await eda.sys_IFrame.closeIFrame(PROJECT_PLANNING_IFRAME_ID);
	}
	catch {
		// The host closes the panel after receiving the close operation.
	}
}

function localizeBootstrap(elements: Elements): void {
	const chinese = usesChineseBrowserLanguage();
	document.documentElement.lang = chinese ? 'zh-Hans' : 'en';
	elements.bootMessage.textContent = chinese ? '正在加载项目规划...' : 'Loading project planning...';
}

function fallbackConnectionError(): string {
	return usesChineseBrowserLanguage() ? '项目规划面板连接失败。' : 'The project planning panel connection failed.';
}

function usesChineseBrowserLanguage(): boolean {
	return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh');
}

function inferLanguage(text: string): string {
	return /[\u3400-\u9FFF]/.test(text) ? 'zh-Hans' : 'en';
}

function createOperationId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500);
}
