import type {
	IFrameInventoryOverviewRequest,
	IFrameInventoryOverviewResult,
	InventoryOverviewCategorySnapshot,
	InventoryOverviewItemSnapshot,
	InventoryOverviewLabels,
	InventoryOverviewPanelStage,
} from '../../presentation/iframe-inventory-overview-protocol';
import type {
	InventoryOverviewAction,
	InventoryOverviewIntent,
	InventoryOverviewViewState,
} from '../../presentation/inventory-overview-panel';
import {
	INVENTORY_OVERVIEW_IFRAME_ID,
	INVENTORY_OVERVIEW_PROTOCOL_VERSION,
	INVENTORY_OVERVIEW_REQUEST_KEY,
	INVENTORY_OVERVIEW_RESPONSE_KEY,
	INVENTORY_OVERVIEW_RESULT_KEY,
	INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY,
	parseIFrameInventoryOverviewOperationResponse,
	parseIFrameInventoryOverviewRequest,
} from '../../presentation/iframe-inventory-overview-protocol';
import {
	captureInventoryOverviewScroll,
	filterAndSortInventory,
	inventoryCategoryCounts,
	inventoryItemsForCategoryDrop,
	inventoryItemsForDrag,
	inventoryOverviewLcscPartNumber,
	inventoryOverviewPackageLabel,
	normalizeOverviewViewState,
	orderedCategorySiblings,
	paginateInventory,
	reorderCategorySiblings,
	reorderCategorySiblingsByDrop,
	resolveBulkCategoryTarget,
	restoreInventoryOverviewScroll,
	selectInventoryOverviewCategory,
	shouldAutoHideInventoryOverview,
	shouldClearAppliedSearch,
	shouldSuppressAutoHideForWindowControl,
	updateFilteredInventorySelection,
} from './inventory-overview-model';

interface PanelElements {
	shell: HTMLElement;
	bootStatus: HTMLElement;
	bootMessage: HTMLElement;
	app: HTMLElement;
	searchForm: HTMLFormElement;
	searchInput: HTMLInputElement;
	searchScope: HTMLSelectElement;
	clearSearch: HTMLButtonElement;
	stockFilter: HTMLSelectElement;
	modelFilter: HTMLSelectElement;
	sort: HTMLSelectElement;
	clearFilters: HTMLButtonElement;
	refresh: HTMLButtonElement;
	openCategories: HTMLButtonElement;
	closeCategories: HTMLButtonElement;
	categoryOverlay: HTMLButtonElement;
	categoryPanel: HTMLElement;
	categoryTree: HTMLElement;
	toggleCategoryManagement: HTMLButtonElement;
	categoryManagerBackdrop: HTMLElement;
	categoryManagerCloseIcon: HTMLButtonElement;
	categoryManagerClose: HTMLButtonElement;
	categoryManagerError: HTMLElement;
	categoryManagerStatus: HTMLElement;
	importEdaCategories: HTMLButtonElement;
	addRootCategory: HTMLButtonElement;
	renameRootCategory: HTMLButtonElement;
	moveRootUp: HTMLButtonElement;
	moveRootDown: HTMLButtonElement;
	deleteRootCategory: HTMLButtonElement;
	rootCategoryList: HTMLElement;
	addChildCategory: HTMLButtonElement;
	renameChildCategory: HTMLButtonElement;
	moveChildUp: HTMLButtonElement;
	moveChildDown: HTMLButtonElement;
	deleteChildCategory: HTMLButtonElement;
	childCategoryList: HTMLElement;
	resultSummary: HTMLElement;
	bulkToolbar: HTMLElement;
	selectedSummary: HTMLElement;
	selectFiltered: HTMLButtonElement;
	clearSelection: HTMLButtonElement;
	bulkRootCategory: HTMLSelectElement;
	bulkChildCategory: HTMLSelectElement;
	applyMove: HTMLButtonElement;
	selectPage: HTMLInputElement;
	rows: HTMLTableSectionElement;
	emptyResults: HTMLElement;
	pageSize: HTMLSelectElement;
	pageStatus: HTMLElement;
	firstPage: HTMLButtonElement;
	previousPage: HTMLButtonElement;
	nextPage: HTMLButtonElement;
	lastPage: HTMLButtonElement;
	operationBackdrop: HTMLElement;
	operationTitle: HTMLElement;
	operationMessage: HTMLElement;
	operationCancel: HTMLButtonElement;
	operationRetry: HTMLButtonElement;
	operationConfirm: HTMLButtonElement;
	connectionError: HTMLElement;
}

type CategoryEditState
	= | { type: 'create'; parentId?: string }
		| { type: 'rename'; category: InventoryOverviewCategorySnapshot };

interface PendingOperation {
	id: string;
	intent: InventoryOverviewIntent;
	trigger?: HTMLElement;
	onSucceeded?: (message?: string) => void;
	onFailed?: (message: string) => void;
}

interface InventoryItemDragState {
	captureTarget?: HTMLElement;
	cleanup?: () => void;
	item?: InventoryOverviewItemSnapshot;
	preview?: HTMLElement;
	pointerId?: number;
	sourceRow?: HTMLTableRowElement;
}

void bootstrap();

async function bootstrap(): Promise<void> {
	let elements: PanelElements | undefined;
	try {
		elements = getElements();
		await initialize(elements);
	}
	catch {
		showConnectionError(elements, '...');
	}
}

async function initialize(elements: PanelElements): Promise<void> {
	let request: IFrameInventoryOverviewRequest | undefined;
	try {
		request = parseIFrameInventoryOverviewRequest(eda.sys_Storage.getExtensionUserConfig(INVENTORY_OVERVIEW_REQUEST_KEY));
	}
	catch {
		request = undefined;
	}
	if (!request) {
		showConnectionError(elements, '...');
		return;
	}

	document.documentElement.lang = inferLanguage(request.labels.title);
	document.title = request.labels.title;
	elements.bootMessage.textContent = request.labels.loading;
	const writeResult = async (result: IFrameInventoryOverviewResult): Promise<boolean> => {
		try {
			return await eda.sys_Storage.setExtensionUserConfig(INVENTORY_OVERVIEW_RESULT_KEY, result);
		}
		catch {
			return false;
		}
	};
	let stage: InventoryOverviewPanelStage = 'script-started';
	try {
		await requireWrite(writeResult, progress(request.requestId, stage));
		stage = 'request-read';
		await requireWrite(writeResult, progress(request.requestId, stage));
		renderPanel(elements, request, writeResult);
		stage = 'panel-rendered';
		await requireWrite(writeResult, progress(request.requestId, stage));
		await requireWrite(writeResult, baseResult(request.requestId, 'ready'));
	}
	catch (error) {
		showConnectionError(elements, request.labels.connectionError);
		await writeResult({
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'failed',
			stage,
			errorName: errorName(error),
			error: errorMessage(error),
		});
	}
}

function renderPanel(
	elements: PanelElements,
	request: IFrameInventoryOverviewRequest,
	writeResult: (result: IFrameInventoryOverviewResult) => Promise<boolean>,
): void {
	const labels = request.labels;
	let state = normalizeOverviewViewState(request.initialState, request.categories);
	let draftQuery = state.query;
	let selectedIds = new Set<string>();
	let selectedRootId: string | undefined;
	let selectedChildId: string | undefined;
	let categoryEdit: CategoryEditState | undefined;
	const expandedRootIds = new Set<string>();
	const itemDrag: InventoryItemDragState = {};
	let pendingOperation: PendingOperation | undefined;
	let autoHideArmed = false;
	const ignoredOperationIds = new Set<string>();
	let render = (_preserveTableScroll?: boolean): void => undefined;

	localizeStaticElements(elements, labels);
	populateSelects(elements, labels, state);
	elements.searchInput.value = draftQuery;

	const viewState = (): InventoryOverviewViewState => ({ ...state });
	const closeOperationDialog = (restoreFocus = true): void => {
		elements.operationBackdrop.hidden = true;
		elements.operationConfirm.hidden = true;
		elements.operationRetry.hidden = true;
		if (restoreFocus) {
			pendingOperation?.trigger?.focus();
		}
	};
	const showOperationDialog = (title: string, message: string): void => {
		elements.operationTitle.textContent = title;
		elements.operationMessage.textContent = message;
		elements.operationBackdrop.hidden = false;
	};
	const dispatchIntent = (
		action: InventoryOverviewAction,
		options: Pick<PendingOperation, 'onSucceeded' | 'onFailed'> = {},
	): void => {
		if (pendingOperation) {
			return;
		}
		const intent = { ...action, viewState: viewState() } as InventoryOverviewIntent;
		const operationId = createOperationId();
		pendingOperation = {
			id: operationId,
			intent,
			trigger: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
			...options,
		};
		showOperationDialog(actionTitle(action, labels), labels.loading);
		elements.operationCancel.hidden = action.type !== 'retry-model';
		elements.operationRetry.hidden = true;
		elements.operationConfirm.hidden = true;
		void writeResult({
			protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION,
			requestId: request.requestId,
			status: 'operation',
			operation: { operationId, intent },
		}).then((written) => {
			if (!written && pendingOperation?.id === operationId) {
				pendingOperation = undefined;
				showOperationDialog(labels.title, labels.connectionError);
				elements.operationCancel.hidden = false;
			}
		});
	};
	const confirmIntent = (action: InventoryOverviewAction, message: string): void => {
		const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		showOperationDialog(actionTitle(action, labels), message);
		elements.operationCancel.hidden = false;
		elements.operationRetry.hidden = true;
		elements.operationConfirm.hidden = false;
		elements.operationConfirm.onclick = () => {
			closeOperationDialog(false);
			dispatchIntent(action);
		};
		elements.operationCancel.onclick = () => {
			closeOperationDialog(false);
			trigger?.focus();
		};
	};
	const requestIntent = (
		action: InventoryOverviewAction,
		options?: Pick<PendingOperation, 'onSucceeded' | 'onFailed'>,
	): void => {
		if (action.type === 'view-item') {
			const item = request.items.find(candidate => candidate.id === action.item.id);
			if (item) {
				const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
				showOperationDialog(labels.viewItem, '');
				showItemDetails(elements.operationMessage, item, request.categories, labels);
				elements.operationCancel.hidden = false;
				elements.operationRetry.hidden = true;
				elements.operationConfirm.hidden = false;
				elements.operationConfirm.textContent = labels.editItem;
				elements.operationConfirm.onclick = () => {
					elements.operationConfirm.textContent = labels.confirm;
					closeOperationDialog(false);
					dispatchIntent({ type: 'edit-item', item: action.item });
				};
				elements.operationCancel.onclick = () => {
					elements.operationConfirm.textContent = labels.confirm;
					closeOperationDialog(false);
					trigger?.focus();
				};
			}
			return;
		}
		if (action.type === 'edit-item') {
			const item = request.items.find(candidate => candidate.id === action.item.id);
			if (item) {
				showOverviewEditor(item, request.categories, labels, requestIntent);
			}
			return;
		}
		if (action.type === 'delete-item') {
			const item = request.items.find(candidate => candidate.id === action.item.id);
			confirmIntent(action, item ? deleteItemMessage(item, labels) : labels.deleteItem);
			return;
		}
		if (action.type === 'delete-category') {
			const category = request.categories.find(candidate => candidate.id === action.category.id);
			confirmIntent(action, category ? deleteCategoryMessage(category, request, labels) : labels.deleteCategory);
			return;
		}
		dispatchIntent(action, options);
	};
	const updateState = (patch: Partial<InventoryOverviewViewState>, resetPage = true): void => {
		state = { ...state, ...patch, page: resetPage ? 1 : (patch.page ?? state.page) };
		render(false);
	};
	const closeCategoryDrawer = (): void => {
		elements.categoryPanel.classList.remove('open');
		elements.categoryOverlay.hidden = true;
		elements.openCategories.setAttribute('aria-expanded', 'false');
	};
	const openCategoryDrawer = (): void => {
		elements.categoryPanel.classList.add('open');
		elements.categoryOverlay.hidden = false;
		elements.openCategories.setAttribute('aria-expanded', 'true');
	};
	const openCategoryManager = (): void => {
		const roots = orderedCategorySiblings(request.categories);
		if (!selectedRootId || !roots.some(category => category.id === selectedRootId)) {
			selectedRootId = roots[0]?.id;
		}
		categoryEdit = undefined;
		elements.categoryManagerError.hidden = true;
		elements.categoryManagerStatus.hidden = true;
		elements.categoryManagerBackdrop.hidden = false;
		render();
		setTimeout(() => elements.categoryManagerCloseIcon.focus(), 0);
	};
	const closeCategoryManager = (): void => {
		categoryEdit = undefined;
		elements.categoryManagerBackdrop.hidden = true;
		elements.toggleCategoryManagement.focus();
	};

	render = (preserveTableScroll = true): void => {
		const tableScroll = elements.rows.closest<HTMLElement>('.table-scroll');
		const scrollPosition = preserveTableScroll
			? captureInventoryOverviewScroll(tableScroll)
			: undefined;
		const filtered = filterAndSortInventory(request.items, request.categories, state);
		const filteredIds = new Set(filtered.map(item => item.id));
		selectedIds = new Set(Array.from(selectedIds).filter(id => filteredIds.has(id)));
		const page = paginateInventory(filtered, state.page, state.pageSize);
		if (page.page !== state.page) {
			state = { ...state, page: page.page };
		}
		renderCategoryTree(
			elements,
			request,
			state,
			expandedRootIds,
			closeCategoryDrawer,
			(categoryId) => {
				state = selectInventoryOverviewCategory(
					state,
					categoryId,
					elements.sort.value as InventoryOverviewViewState['sort'],
				);
				render(false);
			},
			render,
		);
		renderCategoryManager(elements, request, labels, {
			categoryEdit,
			requestIntent,
			selectedChildId,
			selectedRootId,
			setEdit: (value) => {
				categoryEdit = value;
				elements.categoryManagerError.hidden = true;
				elements.categoryManagerStatus.hidden = true;
				render();
			},
			setSelectedChild: (value) => {
				selectedChildId = value;
				categoryEdit = undefined;
				render();
			},
			setSelectedRoot: (value) => {
				selectedRootId = value;
				selectedChildId = undefined;
				categoryEdit = undefined;
				render();
			},
			startRename: (category) => {
				if (category.parentId) {
					selectedRootId = category.parentId;
					selectedChildId = category.id;
				}
				else {
					selectedRootId = category.id;
					selectedChildId = undefined;
				}
				categoryEdit = { type: 'rename', category };
				elements.categoryManagerError.hidden = true;
				render();
			},
		});
		renderRows(elements, request, page.items, selectedIds, labels, itemDrag, openCategoryDrawer, closeCategoryDrawer, requestIntent, render);
		renderBulkToolbar(elements, request.categories, filtered, selectedIds, labels, requestIntent, render);
		elements.resultSummary.textContent = formatLabel(labels.filteredCount, {
			count: page.total,
			total: request.items.length,
		});
		elements.emptyResults.hidden = page.total > 0;
		elements.rows.closest('table')!.hidden = page.total === 0;
		elements.pageStatus.textContent = formatLabel(labels.pageStatus, { page: page.page, pages: page.pageCount });
		elements.firstPage.disabled = page.page <= 1;
		elements.previousPage.disabled = page.page <= 1;
		elements.nextPage.disabled = page.page >= page.pageCount;
		elements.lastPage.disabled = page.page >= page.pageCount;
		elements.pageSize.value = String(state.pageSize);
		elements.stockFilter.value = state.stockFilter;
		elements.modelFilter.value = state.modelFilter;
		elements.sort.value = state.sort;
		elements.searchScope.value = state.searchScope;
		restoreInventoryOverviewScroll(tableScroll, scrollPosition);
	};

	elements.searchForm.addEventListener('submit', (event) => {
		event.preventDefault();
		draftQuery = elements.searchInput.value.trim();
		updateState({ query: draftQuery, searchScope: elements.searchScope.value as InventoryOverviewViewState['searchScope'] });
	});
	elements.searchInput.addEventListener('input', () => {
		draftQuery = elements.searchInput.value;
		if (shouldClearAppliedSearch(draftQuery, state.query)) {
			updateState({ query: '' });
		}
	});
	elements.searchScope.addEventListener('change', () => {
		updateState({ searchScope: elements.searchScope.value as InventoryOverviewViewState['searchScope'] });
	});
	elements.clearSearch.addEventListener('click', () => {
		draftQuery = '';
		elements.searchInput.value = '';
		updateState({ query: '' });
		elements.searchInput.focus();
	});
	elements.stockFilter.addEventListener('change', () => updateState({ stockFilter: elements.stockFilter.value as InventoryOverviewViewState['stockFilter'] }));
	elements.modelFilter.addEventListener('change', () => updateState({ modelFilter: elements.modelFilter.value as InventoryOverviewViewState['modelFilter'] }));
	const applySort = (): void => {
		const sort = elements.sort.value as InventoryOverviewViewState['sort'];
		if (sort !== state.sort) {
			updateState({ sort });
		}
	};
	elements.sort.addEventListener('input', applySort);
	elements.sort.addEventListener('change', applySort);
	elements.pageSize.addEventListener('change', () => updateState({ pageSize: Number(elements.pageSize.value) as InventoryOverviewViewState['pageSize'] }));
	elements.clearFilters.addEventListener('click', () => {
		draftQuery = '';
		elements.searchInput.value = '';
		updateState({
			query: '',
			searchScope: 'all',
			categoryId: 'all',
			stockFilter: 'all',
			modelFilter: 'all',
			sort: 'relevance',
		});
	});
	elements.refresh.addEventListener('click', () => requestIntent({ type: 'refresh' }));
	elements.firstPage.addEventListener('click', () => updateState({ page: 1 }, false));
	elements.previousPage.addEventListener('click', () => updateState({ page: Math.max(1, state.page - 1) }, false));
	elements.nextPage.addEventListener('click', () => updateState({ page: state.page + 1 }, false));
	elements.lastPage.addEventListener('click', () => {
		const filtered = filterAndSortInventory(request.items, request.categories, state);
		updateState({ page: Math.max(1, Math.ceil(filtered.length / state.pageSize)) }, false);
	});
	elements.openCategories.addEventListener('click', openCategoryDrawer);
	elements.closeCategories.addEventListener('click', closeCategoryDrawer);
	elements.categoryOverlay.addEventListener('click', closeCategoryDrawer);
	elements.toggleCategoryManagement.addEventListener('click', openCategoryManager);
	elements.importEdaCategories.addEventListener('click', () => {
		categoryEdit = undefined;
		elements.categoryManagerError.hidden = true;
		elements.categoryManagerStatus.hidden = true;
		render();
		requestIntent({ type: 'import-eda-categories' }, {
			onFailed: (message) => {
				elements.categoryManagerError.textContent = message;
				elements.categoryManagerError.hidden = false;
			},
			onSucceeded: (message) => {
				elements.categoryManagerStatus.textContent = message ?? labels.importEdaCategories;
				elements.categoryManagerStatus.hidden = false;
			},
		});
	});
	elements.categoryManagerClose.addEventListener('click', closeCategoryManager);
	elements.categoryManagerCloseIcon.addEventListener('click', closeCategoryManager);
	elements.categoryManagerBackdrop.addEventListener('click', event => event.target === elements.categoryManagerBackdrop ? closeCategoryManager() : undefined);
	window.addEventListener('blur', () => {
		const operationWasPending = Boolean(pendingOperation);
		window.setTimeout(() => {
			const windowControl = eda.sys_Storage.getExtensionUserConfig(INVENTORY_OVERVIEW_WINDOW_CONTROL_KEY);
			if (typeof eda.sys_IFrame?.hideIFrame !== 'function'
				|| shouldSuppressAutoHideForWindowControl(windowControl, request.requestId, Date.now())
				|| !shouldAutoHideInventoryOverview(
					autoHideArmed,
					operationWasPending || Boolean(pendingOperation),
					document.visibilityState === 'visible',
				)) {
				return;
			}
			void eda.sys_IFrame.hideIFrame(INVENTORY_OVERVIEW_IFRAME_ID).catch(() => undefined);
		}, 250);
	});
	elements.operationCancel.addEventListener('click', () => {
		if (pendingOperation?.id) {
			ignoredOperationIds.add(pendingOperation.id);
		}
		const trigger = pendingOperation?.trigger;
		closeOperationDialog(false);
		trigger?.focus();
	});
	window.setInterval(() => {
		const active = pendingOperation;
		if (!active?.id) {
			return;
		}
		const expected = active.id;
		const response = parseIFrameInventoryOverviewOperationResponse(
			eda.sys_Storage.getExtensionUserConfig(INVENTORY_OVERVIEW_RESPONSE_KEY),
			request.requestId,
			expected,
		);
		if (!response) {
			return;
		}
		if (ignoredOperationIds.has(response.operationId)) {
			ignoredOperationIds.delete(response.operationId);
			pendingOperation = undefined;
			return;
		}
		pendingOperation = undefined;
		const result = response.result;
		if ('snapshot' in result && result.snapshot) {
			request.categories = result.snapshot.categories;
			request.items = result.snapshot.items;
			state = normalizeOverviewViewState(state, request.categories);
			render();
		}
		if (result.status === 'model-match') {
			const match = result;
			showOperationDialog(labels.retryModel, match.message);
			elements.operationCancel.hidden = false;
			elements.operationRetry.hidden = true;
			elements.operationConfirm.hidden = false;
			elements.operationConfirm.onclick = () => {
				closeOperationDialog(false);
				dispatchIntent({
					type: 'attach-model',
					item: match.item,
					matchToken: match.matchToken,
				});
			};
			return;
		}
		if (result.status === 'duplicate-match' && active.intent.type === 'update-item') {
			const duplicate = result;
			const updateIntent = active.intent;
			const sourceItem = request.items.find(item => item.id === duplicate.source.id);
			showDuplicateComparison(duplicate, labels);
			elements.operationCancel.hidden = false;
			elements.operationRetry.hidden = true;
			elements.operationConfirm.hidden = false;
			elements.operationConfirm.textContent = labels.confirmMerge;
			elements.operationConfirm.onclick = () => {
				elements.operationConfirm.textContent = labels.confirm;
				closeOperationDialog(false);
				dispatchIntent({
					type: 'merge-items',
					categoryId: updateIntent.categoryId,
					matchToken: duplicate.matchToken,
					source: duplicate.source,
					target: duplicate.target,
				});
			};
			elements.operationCancel.onclick = () => {
				elements.operationConfirm.textContent = labels.confirm;
				closeOperationDialog(false);
				if (sourceItem) {
					setTimeout(() => showOverviewEditor(
						sourceItem,
						request.categories,
						labels,
						requestIntent,
						updateIntent.draft,
						updateIntent.categoryId,
					), 0);
				}
			};
			return;
		}
		if (result.status === 'failed' || result.status === 'model-missing') {
			if (active.onFailed) {
				closeOperationDialog(false);
				active.onFailed(result.message);
				return;
			}
			showOperationDialog(actionTitle(active.intent, labels), result.message);
			elements.operationCancel.hidden = false;
			elements.operationConfirm.hidden = true;
			elements.operationRetry.hidden = active.intent.type !== 'retry-model';
			if (active.intent.type === 'retry-model') {
				const retryItem = active.intent.item;
				elements.operationRetry.onclick = () => {
					closeOperationDialog(false);
					dispatchIntent({ type: 'retry-model', item: retryItem });
				};
			}
			return;
		}
		closeOperationDialog(false);
		if (result.status === 'succeeded') {
			active.onSucceeded?.(result.message);
		}
		active.trigger?.focus();
	}, 100);
	document.addEventListener('keydown', (event) => {
		if (event.key !== 'Escape' || elements.categoryManagerBackdrop.hidden) {
			return;
		}
		if (categoryEdit) {
			categoryEdit = undefined;
			render();
		}
		else {
			closeCategoryManager();
		}
	});

	elements.shell.setAttribute('aria-busy', 'false');
	elements.bootStatus.hidden = true;
	elements.app.hidden = false;
	render(false);
	window.setTimeout(() => {
		window.focus();
		elements.searchInput.focus({ preventScroll: true });
		autoHideArmed = true;
	}, 300);
}

function renderCategoryTree(
	elements: PanelElements,
	request: IFrameInventoryOverviewRequest,
	state: InventoryOverviewViewState,
	expandedRootIds: Set<string>,
	closeDrawer: () => void,
	selectCategory: (categoryId: InventoryOverviewViewState['categoryId']) => void,
	render: () => void,
): void {
	const counts = inventoryCategoryCounts(request.items, request.categories);
	const nodes: HTMLElement[] = [];
	const createSectionHeading = (label: string): HTMLElement => {
		const heading = document.createElement('h3');
		heading.className = 'category-section-heading';
		heading.textContent = label;
		return heading;
	};
	const createNode = (id: string, name: string, child = false): HTMLButtonElement => {
		const button = document.createElement('button');
		button.type = 'button';
		button.className = `category-node${child ? ' child' : ''}${state.categoryId === id ? ' active' : ''}`;
		button.setAttribute('aria-current', state.categoryId === id ? 'true' : 'false');
		const nameElement = document.createElement('span');
		nameElement.className = 'category-node-name';
		nameElement.textContent = name;
		const count = document.createElement('span');
		count.className = 'category-count';
		count.textContent = String(counts.get(id) ?? 0);
		button.append(nameElement, count);
		return button;
	};
	const systemNodes: HTMLElement[] = [];
	for (const [id, name] of [
		['all', request.labels.allCategories],
		['unclassified', request.labels.unclassified],
	] as const) {
		const button = createNode(id, name);
		button.addEventListener('click', () => {
			selectCategory(id);
			closeDrawer();
		});
		if (id === 'unclassified') {
			configureInventoryItemDropTarget(button, undefined, name, request.labels);
		}
		systemNodes.push(button);
	}
	const systemSection = document.createElement('section');
	systemSection.className = 'category-section system-category-section';
	systemSection.append(createSectionHeading(request.labels.systemCategories), ...systemNodes);
	nodes.push(systemSection);
	const userSection = document.createElement('section');
	userSection.className = 'category-section user-category-section';
	userSection.append(createSectionHeading(request.labels.userCategories));
	for (const parent of orderedCategorySiblings(request.categories)) {
		const children = orderedCategorySiblings(request.categories, parent.id);
		const hasHiddenChildren = children.length > 3;
		const selectedHiddenChild = children.findIndex(child => child.id === state.categoryId) >= 3;
		const expanded = expandedRootIds.has(parent.id) || selectedHiddenChild;
		const group = document.createElement('section');
		group.className = `category-root-group${expanded ? ' expanded' : ''}`;
		const rootRow = document.createElement('div');
		rootRow.className = 'category-root-row';
		const rootButton = createNode(parent.id, parent.name);
		configureInventoryItemDropTarget(rootButton, parent.id, parent.name, request.labels);
		rootButton.addEventListener('click', () => {
			if (hasHiddenChildren) {
				if (expanded) {
					expandedRootIds.delete(parent.id);
				}
				else {
					expandedRootIds.add(parent.id);
				}
			}
			selectCategory(parent.id);
			if (!hasHiddenChildren) {
				closeDrawer();
			}
		});
		if (hasHiddenChildren) {
			const expander = document.createElement('button');
			expander.type = 'button';
			expander.className = 'category-expander';
			expander.textContent = expanded ? '\u25B2' : `\u25BC +${children.length - 3}`;
			expander.title = expanded ? request.labels.collapseCategory : request.labels.expandCategory;
			expander.setAttribute('aria-label', expander.title);
			expander.setAttribute('aria-expanded', String(expanded));
			expander.addEventListener('click', () => {
				if (expanded) {
					expandedRootIds.delete(parent.id);
					if (selectedHiddenChild) {
						selectCategory(parent.id);
						return;
					}
				}
				else {
					expandedRootIds.add(parent.id);
				}
				render();
			});
			rootRow.append(rootButton, expander);
		}
		else {
			const placeholder = document.createElement('span');
			placeholder.className = 'category-expander-placeholder';
			placeholder.setAttribute('aria-hidden', 'true');
			rootRow.append(rootButton, placeholder);
		}
		group.append(rootRow);
		if (children.length > 0) {
			const childList = document.createElement('div');
			childList.className = 'category-children';
			for (const child of children) {
				const childButton = createNode(child.id, child.name, true);
				configureInventoryItemDropTarget(childButton, child.id, child.name, request.labels);
				childButton.addEventListener('click', () => {
					selectCategory(child.id);
					closeDrawer();
				});
				childList.append(childButton);
			}
			group.append(childList);
		}
		userSection.append(group);
	}
	nodes.push(userSection);
	elements.categoryTree.replaceChildren(...nodes);
}

function configureInventoryItemDropTarget(
	button: HTMLButtonElement,
	categoryId: string | undefined,
	categoryName: string,
	labels: InventoryOverviewLabels,
): void {
	button.classList.add('inventory-item-drop-target');
	button.dataset.categoryId = categoryId ?? '';
	button.dataset.dropLabel = formatLabel(labels.dropItemToCategory, { category: categoryName });
}

interface CategoryManagerRenderOptions {
	categoryEdit?: CategoryEditState;
	selectedRootId?: string;
	selectedChildId?: string;
	setEdit: (value: CategoryEditState | undefined) => void;
	setSelectedRoot: (value: string) => void;
	setSelectedChild: (value: string) => void;
	startRename: (category: InventoryOverviewCategorySnapshot) => void;
	requestIntent: (
		action: InventoryOverviewAction,
		options?: Pick<PendingOperation, 'onSucceeded' | 'onFailed'>,
	) => void;
}

function renderCategoryManager(
	elements: PanelElements,
	request: IFrameInventoryOverviewRequest,
	labels: InventoryOverviewLabels,
	options: CategoryManagerRenderOptions,
): void {
	const roots = orderedCategorySiblings(request.categories);
	const root = roots.find(category => category.id === options.selectedRootId) ?? roots[0];
	const children = root ? orderedCategorySiblings(request.categories, root.id) : [];
	const child = children.find(category => category.id === options.selectedChildId);
	elements.rootCategoryList.replaceChildren(...categoryColumnRows(
		roots,
		root?.id,
		options.setSelectedRoot,
		labels,
		options,
		request.categories,
	));
	elements.childCategoryList.replaceChildren(...categoryColumnRows(
		children,
		child?.id,
		options.setSelectedChild,
		labels,
		options,
		request.categories,
	));
	if (options.categoryEdit?.type === 'create') {
		const parentId = options.categoryEdit.parentId;
		const list = parentId ? elements.childCategoryList : elements.rootCategoryList;
		list.prepend(categoryInlineEditor(options.categoryEdit, labels, options));
	}

	configureCategoryToolbar(
		{
			add: elements.addRootCategory,
			delete: elements.deleteRootCategory,
			down: elements.moveRootDown,
			rename: elements.renameRootCategory,
			up: elements.moveRootUp,
		},
		root,
		roots,
		() => options.setEdit({ type: 'create' }),
		labels,
		options,
		request.categories,
	);
	configureCategoryToolbar(
		{
			add: elements.addChildCategory,
			delete: elements.deleteChildCategory,
			down: elements.moveChildDown,
			rename: elements.renameChildCategory,
			up: elements.moveChildUp,
		},
		child,
		children,
		() => root ? options.setEdit({ type: 'create', parentId: root.id }) : undefined,
		labels,
		options,
		request.categories,
	);
	elements.addChildCategory.disabled = !root;
}

function categoryColumnRows(
	categories: readonly InventoryOverviewCategorySnapshot[],
	selectedId: string | undefined,
	onSelect: (id: string) => void,
	labels: InventoryOverviewLabels,
	options: CategoryManagerRenderOptions,
	allCategories: readonly InventoryOverviewCategorySnapshot[],
): HTMLElement[] {
	let draggedCategoryId: string | undefined;
	return categories.map((category) => {
		if (options.categoryEdit?.type === 'rename' && options.categoryEdit.category.id === category.id) {
			return categoryInlineEditor(options.categoryEdit, labels, options);
		}
		const row = document.createElement('button');
		row.type = 'button';
		row.className = `category-manager-row${category.id === selectedId ? ' selected' : ''}`;
		row.role = 'option';
		row.setAttribute('aria-selected', String(category.id === selectedId));
		row.draggable = true;
		row.title = labels.dragCategory;
		const grip = document.createElement('span');
		grip.className = 'category-manager-grip';
		grip.textContent = '\u28FF';
		grip.setAttribute('aria-hidden', 'true');
		const name = document.createElement('span');
		name.className = 'category-manager-name';
		name.textContent = category.name;
		row.append(grip, name);
		let selectTimer: number | undefined;
		let suppressClick = false;
		row.addEventListener('click', (event) => {
			if (suppressClick) {
				return;
			}
			if (event.detail === 0) {
				onSelect(category.id);
				return;
			}
			window.clearTimeout(selectTimer);
			selectTimer = window.setTimeout(() => onSelect(category.id), 180);
		});
		row.addEventListener('dblclick', (event) => {
			event.preventDefault();
			window.clearTimeout(selectTimer);
			options.startRename(category);
		});
		row.addEventListener('dragstart', (event) => {
			suppressClick = true;
			draggedCategoryId = category.id;
			row.classList.add('dragging');
			event.dataTransfer?.setData('text/plain', category.id);
			if (event.dataTransfer) {
				event.dataTransfer.effectAllowed = 'move';
			}
		});
		row.addEventListener('dragend', () => {
			draggedCategoryId = undefined;
			row.classList.remove('dragging');
			clearCategoryDropIndicators();
			window.setTimeout(() => {
				suppressClick = false;
			}, 0);
		});
		row.addEventListener('dragover', (event) => {
			const draggedId = draggedCategoryId ?? event.dataTransfer?.getData('text/plain');
			const dragged = allCategories.find(candidate => candidate.id === draggedId);
			if (!dragged || dragged.id === category.id || dragged.parentId !== category.parentId) {
				return;
			}
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'move';
			}
			clearCategoryDropIndicators();
			row.classList.add(dropPlacement(event, row) === 'before' ? 'drag-before' : 'drag-after');
		});
		row.addEventListener('dragleave', () => row.classList.remove('drag-before', 'drag-after'));
		row.addEventListener('drop', (event) => {
			event.preventDefault();
			const draggedId = draggedCategoryId ?? event.dataTransfer?.getData('text/plain') ?? '';
			const reordered = reorderCategorySiblingsByDrop(
				allCategories,
				draggedId,
				category.id,
				dropPlacement(event, row),
			);
			clearCategoryDropIndicators();
			if (reordered) {
				options.requestIntent({
					type: 'reorder-categories',
					parentId: category.parentId,
					categories: reordered.map(entry => ({ id: entry.id, expectedRevision: entry.revision })),
				});
			}
		});
		return row;
	});
}

function dropPlacement(event: DragEvent, row: HTMLElement): 'after' | 'before' {
	const bounds = row.getBoundingClientRect();
	const verticalDistance = Math.abs(event.clientY - (bounds.top + bounds.height / 2));
	if (verticalDistance > bounds.height / 4) {
		return event.clientY > bounds.top + bounds.height / 2 ? 'after' : 'before';
	}
	return event.clientX > bounds.left + bounds.width / 2 ? 'after' : 'before';
}

function clearCategoryDropIndicators(): void {
	for (const row of Array.from(document.querySelectorAll('.category-manager-row.drag-before, .category-manager-row.drag-after'))) {
		row.classList.remove('drag-before', 'drag-after');
	}
}

function categoryInlineEditor(
	edit: CategoryEditState,
	labels: InventoryOverviewLabels,
	options: CategoryManagerRenderOptions,
): HTMLElement {
	const form = document.createElement('form');
	form.className = `category-inline-editor ${edit.type === 'create' ? 'creating' : 'renaming'}`;
	const input = document.createElement('input');
	input.type = 'text';
	input.maxLength = 200;
	input.required = true;
	input.placeholder = labels.categoryNamePlaceholder;
	input.value = edit.type === 'rename' ? edit.category.name : '';
	const submit = document.createElement('button');
	submit.type = 'submit';
	submit.className = 'button button-primary';
	submit.textContent = labels.confirm;
	form.append(input, submit);
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		const name = input.value.trim();
		if (!name) {
			return;
		}
		const onFailed = (message: string): void => {
			const error = document.getElementById('category-manager-error');
			if (error) {
				error.textContent = message;
				error.hidden = false;
			}
			setTimeout(() => input.focus(), 0);
		};
		options.requestIntent(edit.type === 'create'
			? { type: 'create-category', name, parentId: edit.parentId }
			: {
					type: 'rename-category',
					category: { id: edit.category.id, expectedRevision: edit.category.revision },
					name,
				}, {
			onFailed,
			onSucceeded: () => options.setEdit(undefined),
		});
	});
	form.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') {
			event.preventDefault();
			options.setEdit(undefined);
		}
	});
	setTimeout(() => input.focus(), 0);
	return form;
}

function configureCategoryToolbar(
	controls: { add: HTMLButtonElement; rename: HTMLButtonElement; delete: HTMLButtonElement; up: HTMLButtonElement; down: HTMLButtonElement },
	category: InventoryOverviewCategorySnapshot | undefined,
	siblings: readonly InventoryOverviewCategorySnapshot[],
	onAdd: () => void,
	labels: InventoryOverviewLabels,
	options: CategoryManagerRenderOptions,
	allCategories: readonly InventoryOverviewCategorySnapshot[],
): void {
	const index = category ? siblings.findIndex(candidate => candidate.id === category.id) : -1;
	controls.add.onclick = onAdd;
	controls.rename.disabled = !category;
	controls.delete.disabled = !category;
	controls.up.disabled = index <= 0;
	controls.down.disabled = index < 0 || index >= siblings.length - 1;
	controls.rename.onclick = () => category ? options.setEdit({ type: 'rename', category }) : undefined;
	controls.delete.onclick = () => category
		? options.requestIntent({
				type: 'delete-category',
				category: { id: category.id, expectedRevision: category.revision },
				confirmed: true,
			})
		: undefined;
	controls.up.onclick = () => category ? requestCategoryReorder(allCategories, category, -1, options.requestIntent) : undefined;
	controls.down.onclick = () => category ? requestCategoryReorder(allCategories, category, 1, options.requestIntent) : undefined;
	controls.add.title = category?.parentId ? labels.addChildCategory : labels.addRootCategory;
	controls.rename.title = labels.renameCategory;
	controls.delete.title = labels.deleteCategory;
	controls.up.title = labels.moveCategoryUp;
	controls.down.title = labels.moveCategoryDown;
}

function requestCategoryReorder(
	categories: readonly InventoryOverviewCategorySnapshot[],
	category: InventoryOverviewCategorySnapshot,
	direction: -1 | 1,
	requestIntent: (action: InventoryOverviewAction) => void,
): void {
	const reordered = reorderCategorySiblings(categories, category.id, direction);
	if (reordered) {
		requestIntent({
			type: 'reorder-categories',
			parentId: category.parentId,
			categories: reordered.map(entry => ({ id: entry.id, expectedRevision: entry.revision })),
		});
	}
}

function renderRows(
	elements: PanelElements,
	request: IFrameInventoryOverviewRequest,
	items: readonly InventoryOverviewItemSnapshot[],
	selectedIds: Set<string>,
	labels: InventoryOverviewLabels,
	dragState: InventoryItemDragState,
	openCategoryDrawer: () => void,
	closeCategoryDrawer: () => void,
	finishIntent: (intent: InventoryOverviewAction) => void,
	render: () => void,
): void {
	const categories = new Map(request.categories.map(category => [category.id, category.name]));
	const rows = items.map((item) => {
		const row = document.createElement('tr');
		const selectCell = document.createElement('td');
		selectCell.className = 'select-column';
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.checked = selectedIds.has(item.id);
		checkbox.setAttribute('aria-label', `${labels.selectAll}: ${item.name}`);
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) {
				selectedIds.add(item.id);
			}
			else {
				selectedIds.delete(item.id);
			}
			render();
		});
		selectCell.append(checkbox);

		const nameCell = document.createElement('td');
		nameCell.className = 'item-name-cell';
		const dragHandle = document.createElement('button');
		dragHandle.type = 'button';
		dragHandle.className = 'item-drag-handle';
		dragHandle.textContent = '\u28FF';
		dragHandle.title = labels.dragItem;
		dragHandle.setAttribute('aria-label', `${labels.dragItem}: ${item.name}`);
		const beginDrag = (event: PointerEvent, captureTarget: HTMLElement): void => {
			if (event.isPrimary === false || event.button !== 0) {
				return;
			}
			event.preventDefault();
			clearInventoryItemDrag(dragState);
			const dragItems = inventoryItemsForDrag(item, selectedIds, request.items);
			dragState.item = item;
			dragState.pointerId = event.pointerId;
			dragState.sourceRow = row;
			dragState.captureTarget = captureTarget;
			row.classList.add('inventory-row-dragging');
			document.body.classList.add('inventory-item-dragging');
			if (window.matchMedia('(max-width: 820px)').matches) {
				openCategoryDrawer();
			}
			const preview = createInventoryItemDragPreview(
				item,
				dragItems.length,
				categories.get(item.categoryId ?? '') ?? labels.unclassified,
				labels,
			);
			dragState.preview?.remove();
			dragState.preview = preview;
			document.body.append(preview);
			positionInventoryItemDragPreview(preview, event.clientX, event.clientY);
			try {
				captureTarget.setPointerCapture(event.pointerId);
			}
			catch {
				// Pointer capture is unavailable in some EDA embedded browser builds.
			}
			const handleMove = (moveEvent: PointerEvent): void => {
				if (dragState.pointerId !== moveEvent.pointerId || dragState.item?.id !== item.id) {
					return;
				}
				moveEvent.preventDefault();
				if (dragState.preview) {
					positionInventoryItemDragPreview(dragState.preview, moveEvent.clientX, moveEvent.clientY);
				}
				const target = inventoryItemDropTargetAt(moveEvent.clientX, moveEvent.clientY, dragItems);
				clearInventoryItemDropIndicators();
				target?.classList.add('inventory-item-drop-active');
			};
			const handleUp = (upEvent: PointerEvent): void => {
				if (dragState.pointerId !== upEvent.pointerId || dragState.item?.id !== item.id) {
					return;
				}
				upEvent.preventDefault();
				const target = inventoryItemDropTargetAt(upEvent.clientX, upEvent.clientY, dragItems);
				if (target) {
					const targetCategoryValue = target.dataset.categoryId ?? '';
					const movingItems = inventoryItemsForCategoryDrop(dragItems, targetCategoryValue);
					finishIntent({
						type: 'move-items',
						items: movingItems.map(moving => ({ id: moving.id, expectedRevision: moving.revision })),
						categoryId: targetCategoryValue || undefined,
					});
					if (window.matchMedia('(max-width: 820px)').matches) {
						closeCategoryDrawer();
					}
				}
				clearInventoryItemDrag(dragState);
			};
			const handleCancel = (cancelEvent: PointerEvent): void => {
				if (dragState.pointerId === cancelEvent.pointerId) {
					clearInventoryItemDrag(dragState);
				}
			};
			const handleWindowBlur = (): void => clearInventoryItemDrag(dragState);
			document.addEventListener('pointermove', handleMove, true);
			document.addEventListener('pointerup', handleUp, true);
			document.addEventListener('pointercancel', handleCancel, true);
			window.addEventListener('blur', handleWindowBlur);
			dragState.cleanup = () => {
				document.removeEventListener('pointermove', handleMove, true);
				document.removeEventListener('pointerup', handleUp, true);
				document.removeEventListener('pointercancel', handleCancel, true);
				window.removeEventListener('blur', handleWindowBlur);
			};
		};
		dragHandle.addEventListener('pointerdown', (event) => {
			event.stopPropagation();
			beginDrag(event, dragHandle);
		});
		row.addEventListener('pointerdown', (event) => {
			const target = event.target;
			if (!(target instanceof Element)
				|| target.closest('button, input, select, textarea, a, .select-column, .row-actions')) {
				return;
			}
			beginDrag(event, row);
		});
		const nameButton = document.createElement('button');
		nameButton.type = 'button';
		nameButton.className = 'item-name-button';
		nameButton.textContent = item.name;
		nameButton.addEventListener('click', () => finishIntent({
			type: 'view-item',
			item: { id: item.id, expectedRevision: item.revision },
		}));
		nameCell.append(dragHandle, nameButton);
		row.append(
			selectCell,
			nameCell,
			textCell(item.lcscPartNumber || item.manufacturerPartNumber || item.supplierId, labels.emptyValue),
			textCell(inventoryOverviewPackageLabel(item), labels.emptyValue),
			textCell(categories.get(item.categoryId ?? '') ?? labels.unclassified),
			statusCell(quantityLabel(item, labels), `stock-${item.state}`),
			textCell(item.location, labels.emptyValue),
			statusCell(modelLabel(item, labels), `model-${item.edaModelStatus}`),
			textCell(item.updatedAtLabel, labels.emptyValue),
			actionCell(item, labels, finishIntent),
		);
		return row;
	});
	elements.rows.replaceChildren(...rows);
	const allSelected = items.length > 0 && items.every(item => selectedIds.has(item.id));
	const someSelected = items.some(item => selectedIds.has(item.id));
	elements.selectPage.checked = allSelected;
	elements.selectPage.indeterminate = someSelected && !allSelected;
	elements.selectPage.onchange = () => {
		for (const item of items) {
			if (elements.selectPage.checked) {
				selectedIds.add(item.id);
			}
			else {
				selectedIds.delete(item.id);
			}
		}
		render();
	};
}

function createInventoryItemDragPreview(
	item: InventoryOverviewItemSnapshot,
	itemCount: number,
	categoryName: string,
	labels: InventoryOverviewLabels,
): HTMLElement {
	const preview = document.createElement('section');
	preview.className = 'inventory-drag-preview';
	const title = document.createElement('strong');
	title.textContent = item.name;
	preview.append(title);
	if (itemCount > 1) {
		const selectionSummary = document.createElement('small');
		selectionSummary.className = 'inventory-drag-selection-summary';
		selectionSummary.textContent = formatLabel(labels.selectedCount, { count: itemCount });
		preview.append(selectionSummary);
	}
	preview.append(
		dragPreviewRow(labels.columnNumber, item.lcscPartNumber || item.manufacturerPartNumber || item.supplierId || labels.emptyValue),
		dragPreviewRow(labels.columnQuantity, quantityLabel(item, labels)),
		dragPreviewRow(labels.columnCategory, categoryName),
	);
	if (item.location) {
		preview.append(dragPreviewRow(labels.columnLocation, item.location));
	}
	return preview;
}

function dragPreviewRow(label: string, value: string): HTMLElement {
	const row = document.createElement('span');
	const labelElement = document.createElement('span');
	labelElement.textContent = `${label}:`;
	const valueElement = document.createElement('span');
	valueElement.textContent = value;
	row.append(labelElement, valueElement);
	return row;
}

function clearInventoryItemDrag(dragState: InventoryItemDragState): void {
	const pointerId = dragState.pointerId;
	const captureTarget = dragState.captureTarget;
	dragState.cleanup?.();
	dragState.cleanup = undefined;
	if (pointerId !== undefined && captureTarget) {
		try {
			if (captureTarget.hasPointerCapture(pointerId)) {
				captureTarget.releasePointerCapture(pointerId);
			}
		}
		catch {
			// The pointer may already be released by the embedded browser.
		}
	}
	dragState.captureTarget = undefined;
	dragState.sourceRow?.classList.remove('inventory-row-dragging');
	dragState.item = undefined;
	dragState.preview?.remove();
	dragState.preview = undefined;
	dragState.pointerId = undefined;
	dragState.sourceRow = undefined;
	document.body.classList.remove('inventory-item-dragging');
	clearInventoryItemDropIndicators();
}

function positionInventoryItemDragPreview(preview: HTMLElement, clientX: number, clientY: number): void {
	const left = Math.max(8, Math.min(clientX + 16, window.innerWidth - preview.offsetWidth - 8));
	const top = Math.max(8, Math.min(clientY + 16, window.innerHeight - preview.offsetHeight - 8));
	preview.style.transform = `translate(${left}px, ${top}px)`;
}

function inventoryItemDropTargetAt(
	clientX: number,
	clientY: number,
	items: readonly InventoryOverviewItemSnapshot[],
): HTMLButtonElement | undefined {
	const hovered = document.elementFromPoint(clientX, clientY);
	const target = hovered?.closest<HTMLButtonElement>('.inventory-item-drop-target');
	if (!target) {
		return undefined;
	}
	return inventoryItemsForCategoryDrop(items, target.dataset.categoryId ?? '').length > 0
		? target
		: undefined;
}

function clearInventoryItemDropIndicators(): void {
	for (const node of Array.from(document.querySelectorAll('.inventory-item-drop-active'))) {
		node.classList.remove('inventory-item-drop-active');
	}
}

function renderBulkToolbar(
	elements: PanelElements,
	categories: readonly InventoryOverviewCategorySnapshot[],
	items: readonly InventoryOverviewItemSnapshot[],
	selectedIds: Set<string>,
	labels: InventoryOverviewLabels,
	finishIntent: (intent: InventoryOverviewAction) => void,
	render: () => void,
): void {
	elements.bulkToolbar.hidden = false;
	elements.selectedSummary.textContent = formatLabel(labels.selectedCount, { count: selectedIds.size });
	const allFilteredSelected = items.length > 0 && items.every(item => selectedIds.has(item.id));
	elements.selectFiltered.disabled = items.length === 0 || allFilteredSelected;
	elements.clearSelection.disabled = selectedIds.size === 0;
	elements.selectFiltered.onclick = () => {
		const nextSelection = updateFilteredInventorySelection(selectedIds, items, 'select-all');
		selectedIds.clear();
		for (const id of nextSelection) {
			selectedIds.add(id);
		}
		render();
	};
	elements.clearSelection.onclick = () => {
		const nextSelection = updateFilteredInventorySelection(selectedIds, items, 'clear');
		selectedIds.clear();
		for (const id of nextSelection) {
			selectedIds.add(id);
		}
		render();
	};
	elements.bulkRootCategory.disabled = selectedIds.size === 0;
	elements.bulkChildCategory.disabled = selectedIds.size === 0;
	elements.applyMove.disabled = selectedIds.size === 0;
	elements.applyMove.onclick = () => {
		const selectedItems = items
			.filter(item => selectedIds.has(item.id))
			.map(item => ({ id: item.id, expectedRevision: item.revision }));
		if (selectedItems.length === 0) {
			return;
		}
		const category = resolveBulkCategoryTarget(
			categories,
			elements.bulkRootCategory.value,
			elements.bulkChildCategory.value,
		);
		if (!category.valid) {
			return;
		}
		finishIntent({
			type: 'move-items',
			items: selectedItems,
			categoryId: category.categoryId,
		});
	};
	const selectedRoot = elements.bulkRootCategory.value;
	const selectedChild = elements.bulkChildCategory.value;
	fillOptions(elements.bulkRootCategory, [
		['', labels.unclassified],
		...orderedCategorySiblings(categories).map(category => [category.id, category.name] as const),
	]);
	if (Array.from(elements.bulkRootCategory.options).some(option => option.value === selectedRoot)) {
		elements.bulkRootCategory.value = selectedRoot;
	}
	const fillChildren = (): void => {
		const rootId = elements.bulkRootCategory.value;
		fillOptions(elements.bulkChildCategory, [
			['', labels.noSecondaryCategory],
			...orderedCategorySiblings(categories, rootId || undefined).map(category => [category.id, category.name] as const),
		]);
		if (Array.from(elements.bulkChildCategory.options).some(option => option.value === selectedChild)) {
			elements.bulkChildCategory.value = selectedChild;
		}
		elements.bulkChildCategory.disabled = selectedIds.size === 0 || !rootId;
	};
	fillChildren();
	elements.bulkRootCategory.onchange = fillChildren;
}

function actionCell(
	item: InventoryOverviewItemSnapshot,
	labels: InventoryOverviewLabels,
	finishIntent: (intent: InventoryOverviewAction) => void,
): HTMLTableCellElement {
	const cell = document.createElement('td');
	const actions = document.createElement('div');
	actions.className = 'row-actions';
	actions.append(
		rowAction(labels.viewItem, () => finishIntent({ type: 'view-item', item: { id: item.id, expectedRevision: item.revision } })),
		rowAction(labels.editItem, () => finishIntent({ type: 'edit-item', item: { id: item.id, expectedRevision: item.revision } })),
	);
	if (item.lcscPartNumber) {
		actions.append(rowAction(labels.openMarketplace, () => finishIntent({ type: 'open-marketplace', item: { id: item.id, expectedRevision: item.revision } })));
		if (!item.hasEdaModel) {
			actions.append(rowAction(labels.retryModel, () => finishIntent({ type: 'retry-model', item: { id: item.id, expectedRevision: item.revision } })));
		}
	}
	if (item.hasEdaModel) {
		actions.append(rowAction(labels.copyCommon, () => finishIntent({ type: 'copy-common', item: { id: item.id, expectedRevision: item.revision } })));
	}
	actions.append(rowAction(labels.deleteItem, () => finishIntent({
		type: 'delete-item',
		item: { id: item.id, expectedRevision: item.revision },
		confirmed: true,
	}), true));
	cell.append(actions);
	return cell;
}

function localizeStaticElements(elements: PanelElements, labels: InventoryOverviewLabels): void {
	setText('search-label', labels.searchLabel);
	elements.searchInput.placeholder = labels.searchPlaceholder;
	setText('search-scope-label', labels.searchScope);
	setText('search-submit', labels.search);
	elements.clearSearch.textContent = labels.clearSearch;
	elements.openCategories.textContent = '☰';
	elements.openCategories.title = labels.openCategories;
	elements.openCategories.setAttribute('aria-label', labels.openCategories);
	elements.closeCategories.textContent = '×';
	elements.closeCategories.title = labels.closeCategories;
	elements.closeCategories.setAttribute('aria-label', labels.closeCategories);
	elements.categoryOverlay.setAttribute('aria-label', labels.closeCategories);
	setText('stock-filter-label', labels.stockFilter);
	setText('model-filter-label', labels.modelFilter);
	setText('sort-label', labels.sortLabel);
	elements.clearFilters.textContent = labels.clearFilters;
	elements.refresh.textContent = labels.refresh;
	setText('category-heading-label', labels.title);
	elements.toggleCategoryManagement.textContent = labels.manageCategories;
	setText('category-manager-title', labels.manageCategories);
	elements.importEdaCategories.textContent = labels.importEdaCategories;
	setText('root-category-heading', labels.addRootCategory);
	setText('child-category-heading', labels.addChildCategory);
	elements.categoryManagerClose.textContent = labels.cancel;
	elements.categoryManagerCloseIcon.textContent = '×';
	elements.categoryManagerCloseIcon.title = labels.cancel;
	elements.operationCancel.textContent = labels.cancel;
	elements.operationRetry.textContent = labels.retryModel;
	elements.operationConfirm.textContent = labels.confirm;
	setText('bulk-category-label', labels.moveToCategory);
	setText('bulk-root-category-label', labels.primaryCategory);
	setText('bulk-child-category-label', labels.secondaryCategory);
	elements.applyMove.textContent = labels.applyMove;
	elements.selectFiltered.textContent = labels.selectAllFiltered;
	elements.clearSelection.textContent = labels.clearSelection;
	elements.selectPage.setAttribute('aria-label', labels.selectAll);
	setText('column-name', labels.columnName);
	setText('column-number', labels.columnNumber);
	setText('column-package', labels.package);
	setText('column-category', labels.columnCategory);
	setText('column-quantity', labels.columnQuantity);
	setText('column-location', labels.columnLocation);
	setText('column-model', labels.columnModel);
	setText('column-updated', labels.columnUpdatedAt);
	setText('column-actions', labels.columnActions);
	elements.emptyResults.textContent = labels.emptyResults;
	setText('page-size-label', labels.pageSize);
	elements.firstPage.textContent = '|<';
	elements.previousPage.textContent = '<';
	elements.nextPage.textContent = '>';
	elements.lastPage.textContent = '>|';
	for (const [button, label] of [
		[elements.firstPage, labels.firstPage],
		[elements.previousPage, labels.previousPage],
		[elements.nextPage, labels.nextPage],
		[elements.lastPage, labels.lastPage],
	] as const) {
		button.title = label;
		button.setAttribute('aria-label', label);
	}
}

function populateSelects(elements: PanelElements, labels: InventoryOverviewLabels, state: InventoryOverviewViewState): void {
	fillOptions(elements.searchScope, [
		['all', labels.searchAllCategories],
		['current', labels.searchCurrentCategory],
	]);
	fillOptions(elements.stockFilter, [
		['all', labels.stockAll],
		['in-stock', labels.stockInStock],
		['depleted', labels.stockDepleted],
	]);
	fillOptions(elements.modelFilter, [
		['all', labels.modelAll],
		['available', labels.modelAvailable],
		['missing', labels.modelMissing],
		['failed', labels.modelFailed],
		['unchecked', labels.modelUnchecked],
	]);
	fillOptions(elements.sort, [
		['relevance', labels.sortRelevance],
		['name', labels.sortName],
		['stock', labels.sortStock],
		['updated', labels.sortUpdated],
		['category', labels.sortCategory],
	]);
	fillOptions(elements.pageSize, [['25', '25'], ['50', '50'], ['100', '100']]);
	elements.searchScope.value = state.searchScope;
}

function fillCategoryOptions(
	select: HTMLSelectElement,
	categories: readonly InventoryOverviewCategorySnapshot[],
	labels: InventoryOverviewLabels,
): void {
	const options: Array<[string, string]> = [['', labels.unclassified]];
	for (const parent of orderedCategorySiblings(categories)) {
		options.push([parent.id, parent.name]);
		for (const child of orderedCategorySiblings(categories, parent.id)) {
			options.push([child.id, `  ${child.name}`]);
		}
	}
	fillOptions(select, options);
}

function fillOptions(select: HTMLSelectElement, options: ReadonlyArray<readonly [string, string]>): void {
	select.replaceChildren(...options.map(([value, label]) => {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = label;
		return option;
	}));
}

function rowAction(label: string, action: () => void, danger = false): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = `row-action${danger ? ' danger' : ''}`;
	button.textContent = label;
	button.addEventListener('click', action);
	return button;
}

function actionTitle(action: InventoryOverviewAction, labels: InventoryOverviewLabels): string {
	switch (action.type) {
		case 'view-item': return labels.viewItem;
		case 'edit-item': return labels.editItem;
		case 'update-item': return labels.editItem;
		case 'merge-items': return labels.confirmMerge;
		case 'open-marketplace': return labels.openMarketplace;
		case 'retry-model':
		case 'attach-model': return labels.retryModel;
		case 'copy-common': return labels.copyCommon;
		case 'delete-item': return labels.deleteItem;
		case 'create-category': return action.parentId ? labels.addChildCategory : labels.addRootCategory;
		case 'rename-category': return labels.renameCategory;
		case 'delete-category': return labels.deleteCategory;
		case 'reorder-categories': return action.parentId ? labels.addChildCategory : labels.manageCategories;
		case 'import-eda-categories': return labels.importEdaCategories;
		case 'move-items': return labels.moveToCategory;
		case 'refresh': return labels.refresh;
	}
}

function showItemDetails(
	target: HTMLElement,
	item: InventoryOverviewItemSnapshot,
	categories: readonly InventoryOverviewCategorySnapshot[],
	labels: InventoryOverviewLabels,
): void {
	const details = document.createElement('dl');
	details.className = 'overview-details-list';
	const copyStatus = document.createElement('p');
	copyStatus.className = 'overview-copy-status';
	copyStatus.setAttribute('aria-live', 'polite');
	const lcscPartNumber = inventoryOverviewLcscPartNumber(item);
	for (const [label, value, key] of inventoryItemDetailRows(item, categories, labels)) {
		const term = document.createElement('dt');
		term.textContent = label;
		const detail = document.createElement('dd');
		if (key === 'lcscPartNumber' && lcscPartNumber) {
			const code = document.createElement('code');
			code.className = 'overview-lcsc-number';
			code.textContent = lcscPartNumber;
			const copy = document.createElement('button');
			copy.type = 'button';
			copy.className = 'button button-secondary overview-copy-button';
			copy.textContent = labels.copyLcscPartNumber;
			copy.addEventListener('click', async () => {
				copy.disabled = true;
				const copied = await copyOverviewText(lcscPartNumber);
				copy.disabled = false;
				copyStatus.textContent = copied ? labels.copySucceeded : labels.copyFailed;
			});
			detail.className = 'overview-copy-value';
			detail.append(code, copy);
		}
		else {
			detail.textContent = value;
		}
		details.append(term, detail);
	}
	target.replaceChildren(details, copyStatus);
}

function inventoryItemDetailRows(
	item: InventoryOverviewItemSnapshot,
	categories: readonly InventoryOverviewCategorySnapshot[],
	labels: InventoryOverviewLabels,
): Array<[label: string, value: string, key?: 'lcscPartNumber']> {
	const category = item.categoryId ? categories.find(candidate => candidate.id === item.categoryId) : undefined;
	const parentCategory = category?.parentId
		? categories.find(candidate => candidate.id === category.parentId)
		: undefined;
	const categoryLabel = category
		? [parentCategory?.name, category.name].filter(Boolean).join(' / ')
		: item.categoryId || labels.unclassified;
	const precision = item.precision === 'exact'
		? labels.exact
		: item.precision === 'estimated' ? labels.estimated : labels.quantityUnknown;
	return [
		[labels.lcscPartNumber, inventoryOverviewLcscPartNumber(item) || '\u2014', 'lcscPartNumber'],
		[labels.supplierId, item.supplierId || labels.emptyValue],
		[labels.columnName, item.name || labels.emptyValue],
		[labels.manufacturer, item.manufacturer || labels.emptyValue],
		[labels.manufacturerPartNumber, item.manufacturerPartNumber || labels.emptyValue],
		[labels.package, item.package || '\u2014'],
		[labels.description, item.description || labels.emptyValue],
		[labels.columnQuantity, quantityLabel(item, labels)],
		[labels.precision, precision],
		[labels.stockState, item.state === 'depleted' ? labels.depleted : labels.inStock],
		[labels.columnCategory, categoryLabel],
		[labels.columnLocation, item.location || labels.emptyValue],
		[labels.note, item.note || labels.emptyValue],
		[labels.marketplace, marketplaceLabel(item, labels)],
		[labels.columnModel, modelLabel(item, labels)],
		[labels.edaSymbol, item.edaSymbol || labels.emptyValue],
		[labels.edaFootprint, item.edaFootprint || '\u2014'],
		[labels.source, sourceLabel(item, labels)],
		[labels.createdAt, item.createdAtLabel || labels.emptyValue],
		[labels.columnUpdatedAt, item.updatedAtLabel || labels.emptyValue],
		[labels.revision, String(item.revision)],
	];
}

function itemDetailsMessage(item: InventoryOverviewItemSnapshot, labels: InventoryOverviewLabels): string {
	return inventoryItemDetailRows(item, [], labels)
		.map(([label, value]) => `${label}: ${value}`)
		.join('\n');
}

function marketplaceLabel(item: InventoryOverviewItemSnapshot, labels: InventoryOverviewLabels): string {
	if (item.marketplaceEvidence === 'order-import') {
		return labels.marketplaceFromOrder;
	}
	if (item.marketplaceEvidence === 'user-confirmed') {
		return labels.marketplaceUserConfirmed;
	}
	return inventoryOverviewLcscPartNumber(item) ? labels.marketplaceUnconfirmed : labels.marketplaceNotLinked;
}

function sourceLabel(item: InventoryOverviewItemSnapshot, labels: InventoryOverviewLabels): string {
	switch (item.source) {
		case 'catalog': return labels.sourceCatalog;
		case 'marketplace': return labels.sourceMarketplace;
		case 'order': return labels.sourceOrder;
		case 'manual': return labels.sourceManual;
	}
}

async function copyOverviewText(value: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(value);
			return true;
		}
	}
	catch {
		// Embedded browser clipboard permissions vary; fall through to the selection-based API.
	}
	const input = document.createElement('textarea');
	input.value = value;
	input.readOnly = true;
	input.className = 'overview-copy-fallback';
	document.body.append(input);
	input.select();
	let copied = false;
	try {
		copied = document.execCommand('copy');
	}
	catch {
		copied = false;
	}
	input.remove();
	return copied;
}

function showOverviewEditor(
	item: InventoryOverviewItemSnapshot,
	categories: readonly InventoryOverviewCategorySnapshot[],
	labels: InventoryOverviewLabels,
	requestIntent: (
		action: InventoryOverviewAction,
		options?: Pick<PendingOperation, 'onSucceeded' | 'onFailed'>,
	) => void,
	initialDraft?: Extract<InventoryOverviewAction, { type: 'update-item' }>['draft'],
	initialCategoryId: string | undefined = item.categoryId,
): void {
	const backdrop = element('operation-backdrop', HTMLElement);
	const message = element('operation-message', HTMLElement);
	const cancel = element('operation-cancel', HTMLButtonElement);
	const retry = element('operation-retry', HTMLButtonElement);
	const confirm = element('operation-confirm', HTMLButtonElement);
	element('operation-title', HTMLElement).textContent = labels.editItem;
	const draft = initialDraft ?? {
		identity: {
			description: item.description,
			lcscPartNumber: item.lcscPartNumber,
			manufacturer: item.manufacturer,
			manufacturerPartNumber: item.manufacturerPartNumber,
			name: item.name,
			package: item.package,
			supplierId: item.supplierId,
		},
		location: item.location,
		note: item.note,
		precision: item.precision === 'estimated' ? 'estimated' as const : 'exact' as const,
		quantity: item.quantity ?? 0,
	};
	const form = document.createElement('form');
	form.className = 'overview-edit-form';
	const fields = [
		['lcscPartNumber', labels.lcscPartNumber, draft.identity.lcscPartNumber, 500],
		['supplierId', labels.supplierId, draft.identity.supplierId, 500],
		['name', labels.columnName, draft.identity.name, 500],
		['manufacturer', labels.manufacturer, draft.identity.manufacturer, 500],
		['manufacturerPartNumber', labels.manufacturerPartNumber, draft.identity.manufacturerPartNumber, 500],
		['package', labels.package, draft.identity.package, 500],
		['description', labels.description, draft.identity.description, 4000],
		['location', labels.columnLocation, draft.location, 1000],
		['note', labels.note, draft.note, 4000],
	] as const;
	const inputs = new Map<string, HTMLInputElement>();
	for (const [name, label, value, maxLength] of fields) {
		const row = document.createElement('label');
		row.textContent = label;
		const input = document.createElement('input');
		input.name = name;
		input.value = value;
		input.maxLength = maxLength;
		input.required = name === 'name';
		row.append(input);
		form.append(row);
		inputs.set(name, input);
	}
	const quantity = document.createElement('input');
	quantity.type = 'number';
	quantity.min = '0';
	quantity.step = '1';
	quantity.required = true;
	quantity.value = String(draft.quantity);
	const quantityRow = document.createElement('label');
	quantityRow.textContent = labels.columnQuantity;
	quantityRow.append(quantity);
	const precision = document.createElement('select');
	fillOptions(precision, [['exact', labels.exact], ['estimated', labels.estimated]]);
	precision.value = draft.precision;
	const precisionRow = document.createElement('label');
	precisionRow.textContent = labels.precision;
	precisionRow.append(precision);
	const depleted = document.createElement('input');
	depleted.type = 'checkbox';
	depleted.checked = item.state === 'depleted' || draft.quantity === 0;
	const depletedRow = document.createElement('label');
	depletedRow.className = 'overview-edit-checkbox';
	depletedRow.append(depleted, document.createTextNode(labels.depleted));
	const category = document.createElement('select');
	fillCategoryOptions(category, categories, labels);
	category.value = initialCategoryId ?? '';
	const categoryRow = document.createElement('label');
	categoryRow.textContent = labels.columnCategory;
	categoryRow.append(category);
	let previousStock = { quantity: quantity.value, precision: precision.value };
	depleted.addEventListener('change', () => {
		if (depleted.checked) {
			previousStock = { quantity: quantity.value, precision: precision.value };
			quantity.value = '0';
			precision.value = 'exact';
			precision.disabled = true;
		}
		else {
			quantity.value = previousStock.quantity;
			precision.value = previousStock.precision;
			precision.disabled = false;
		}
	});
	precision.disabled = depleted.checked;
	form.append(quantityRow, precisionRow, categoryRow, depletedRow);
	const error = document.createElement('p');
	error.className = 'inline-error';
	error.hidden = true;
	form.append(error);
	message.replaceChildren(form);
	backdrop.hidden = false;
	cancel.hidden = false;
	retry.hidden = true;
	confirm.hidden = false;
	confirm.textContent = labels.save;
	cancel.onclick = () => {
		backdrop.hidden = true;
		confirm.textContent = labels.confirm;
	};
	confirm.onclick = () => form.requestSubmit();
	form.addEventListener('submit', (event) => {
		event.preventDefault();
		const name = inputs.get('name')!.value.trim();
		const lcscPartNumber = inputs.get('lcscPartNumber')!.value.trim().replaceAll(/\s+/g, '').toUpperCase();
		const quantityText = quantity.value.trim();
		const quantityValue = Number(quantityText);
		const validation = !name
			? labels.nameRequired
			: lcscPartNumber && !/^C\d+$/.test(lcscPartNumber)
				? labels.lcscInvalid
				: !quantityText
						? labels.quantityRequired
						: quantityText.startsWith('-') || quantityValue < 0
							? labels.quantityNonNegative
							: !/^\d+$/.test(quantityText) || !Number.isSafeInteger(quantityValue)
									? labels.quantityInteger
									: undefined;
		if (validation) {
			error.textContent = validation;
			error.hidden = false;
			return;
		}
		const nextDraft = {
			identity: {
				description: inputs.get('description')!.value,
				lcscPartNumber,
				manufacturer: inputs.get('manufacturer')!.value,
				manufacturerPartNumber: inputs.get('manufacturerPartNumber')!.value,
				name,
				package: inputs.get('package')!.value,
				supplierId: inputs.get('supplierId')!.value,
			},
			location: inputs.get('location')!.value,
			note: inputs.get('note')!.value,
			precision: (depleted.checked ? 'exact' : precision.value) as 'exact' | 'estimated',
			quantity: depleted.checked ? 0 : quantityValue,
		};
		confirm.textContent = labels.confirm;
		requestIntent({
			type: 'update-item',
			item: { id: item.id, expectedRevision: item.revision },
			draft: nextDraft,
			categoryId: category.value || undefined,
		}, {
			onFailed: () => showOverviewEditor(item, categories, labels, requestIntent, nextDraft, category.value || undefined),
		});
	});
	setTimeout(() => inputs.get('name')?.focus(), 0);
}

function showDuplicateComparison(
	result: {
		candidate: InventoryOverviewItemSnapshot;
		existing: InventoryOverviewItemSnapshot;
	},
	labels: InventoryOverviewLabels,
): void {
	element('operation-title', HTMLElement).textContent = labels.confirmMerge;
	const layout = document.createElement('div');
	layout.className = 'overview-duplicate-compare';
	for (const [title, item] of [[labels.existing, result.existing], [labels.candidate, result.candidate]] as const) {
		const column = document.createElement('section');
		const heading = document.createElement('h3');
		heading.textContent = title;
		const details = document.createElement('p');
		details.textContent = itemDetailsMessage(item, labels);
		column.append(heading, details);
		layout.append(column);
	}
	element('operation-message', HTMLElement).replaceChildren(layout);
	element('operation-backdrop', HTMLElement).hidden = false;
}

function deleteItemMessage(item: InventoryOverviewItemSnapshot, labels: InventoryOverviewLabels): string {
	return `${item.name}\n${item.lcscPartNumber || item.manufacturerPartNumber || item.supplierId || labels.emptyValue}\n${quantityLabel(item, labels)}`;
}

function deleteCategoryMessage(
	category: InventoryOverviewCategorySnapshot,
	request: IFrameInventoryOverviewRequest,
	labels: InventoryOverviewLabels,
): string {
	const branchIds = new Set([category.id]);
	for (const child of request.categories) {
		if (child.parentId === category.id) {
			branchIds.add(child.id);
		}
	}
	const affected = request.items.filter(item => item.categoryId && branchIds.has(item.categoryId)).length;
	return `${category.name}\n${labels.itemsCount.replaceAll('{count}', String(affected))}`;
}

function createOperationId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function textCell(value: string, emptyValue?: string): HTMLTableCellElement {
	const cell = document.createElement('td');
	cell.textContent = value || emptyValue || '';
	if (!value) {
		cell.className = 'muted-value';
	}
	return cell;
}

function statusCell(value: string, className: string): HTMLTableCellElement {
	const cell = document.createElement('td');
	cell.textContent = value;
	cell.className = className;
	return cell;
}

function quantityLabel(item: InventoryOverviewItemSnapshot, labels: InventoryOverviewLabels): string {
	if (item.state === 'depleted') {
		return labels.stockDepleted;
	}
	if (item.quantity === null || item.precision === 'unknown') {
		return labels.quantityUnknown;
	}
	if (item.precision === 'estimated') {
		return formatLabel(labels.quantityEstimated, { count: item.quantity });
	}
	return String(item.quantity);
}

function modelLabel(item: InventoryOverviewItemSnapshot, labels: InventoryOverviewLabels): string {
	return item.edaModelStatus === 'available'
		? labels.modelAvailable
		: item.edaModelStatus === 'missing'
			? labels.modelMissing
			: item.edaModelStatus === 'failed'
				? labels.modelFailed
				: labels.modelUnchecked;
}

function formatLabel(template: string, values: Record<string, number | string>): string {
	return Object.entries(values).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
		template,
	);
}

function showConnectionError(elements: PanelElements | undefined, message: string): void {
	if (!elements) {
		return;
	}
	elements.shell.setAttribute('aria-busy', 'false');
	elements.bootStatus.hidden = true;
	elements.app.hidden = true;
	elements.connectionError.textContent = message;
	elements.connectionError.hidden = false;
}

function getElements(): PanelElements {
	return {
		shell: element('panel-shell', HTMLElement),
		bootStatus: element('boot-status', HTMLElement),
		bootMessage: element('boot-message', HTMLElement),
		app: element('overview-app', HTMLElement),
		searchForm: element('search-form', HTMLFormElement),
		searchInput: element('search-input', HTMLInputElement),
		searchScope: element('search-scope', HTMLSelectElement),
		clearSearch: element('clear-search', HTMLButtonElement),
		stockFilter: element('stock-filter', HTMLSelectElement),
		modelFilter: element('model-filter', HTMLSelectElement),
		sort: element('sort-select', HTMLSelectElement),
		clearFilters: element('clear-filters', HTMLButtonElement),
		refresh: element('refresh', HTMLButtonElement),
		openCategories: element('open-categories', HTMLButtonElement),
		closeCategories: element('close-categories', HTMLButtonElement),
		categoryOverlay: element('category-overlay', HTMLButtonElement),
		categoryPanel: element('category-panel', HTMLElement),
		categoryTree: element('category-tree', HTMLElement),
		toggleCategoryManagement: element('toggle-category-management', HTMLButtonElement),
		categoryManagerBackdrop: element('category-manager-backdrop', HTMLElement),
		categoryManagerCloseIcon: element('category-manager-close-icon', HTMLButtonElement),
		categoryManagerClose: element('category-manager-close', HTMLButtonElement),
		categoryManagerError: element('category-manager-error', HTMLElement),
		categoryManagerStatus: element('category-manager-status', HTMLElement),
		importEdaCategories: element('import-eda-categories', HTMLButtonElement),
		addRootCategory: element('add-root-category', HTMLButtonElement),
		renameRootCategory: element('rename-root-category', HTMLButtonElement),
		moveRootUp: element('move-root-up', HTMLButtonElement),
		moveRootDown: element('move-root-down', HTMLButtonElement),
		deleteRootCategory: element('delete-root-category', HTMLButtonElement),
		rootCategoryList: element('root-category-list', HTMLElement),
		addChildCategory: element('add-child-category', HTMLButtonElement),
		renameChildCategory: element('rename-child-category', HTMLButtonElement),
		moveChildUp: element('move-child-up', HTMLButtonElement),
		moveChildDown: element('move-child-down', HTMLButtonElement),
		deleteChildCategory: element('delete-child-category', HTMLButtonElement),
		childCategoryList: element('child-category-list', HTMLElement),
		resultSummary: element('result-summary', HTMLElement),
		bulkToolbar: element('bulk-toolbar', HTMLElement),
		selectedSummary: element('selected-summary', HTMLElement),
		selectFiltered: element('select-filtered', HTMLButtonElement),
		clearSelection: element('clear-selection', HTMLButtonElement),
		bulkRootCategory: element('bulk-root-category', HTMLSelectElement),
		bulkChildCategory: element('bulk-child-category', HTMLSelectElement),
		applyMove: element('apply-move', HTMLButtonElement),
		selectPage: element('select-page', HTMLInputElement),
		rows: element('inventory-rows', HTMLTableSectionElement),
		emptyResults: element('empty-results', HTMLElement),
		pageSize: element('page-size', HTMLSelectElement),
		pageStatus: element('page-status', HTMLElement),
		firstPage: element('first-page', HTMLButtonElement),
		previousPage: element('previous-page', HTMLButtonElement),
		nextPage: element('next-page', HTMLButtonElement),
		lastPage: element('last-page', HTMLButtonElement),
		operationBackdrop: element('operation-backdrop', HTMLElement),
		operationTitle: element('operation-title', HTMLElement),
		operationMessage: element('operation-message', HTMLElement),
		operationCancel: element('operation-cancel', HTMLButtonElement),
		operationRetry: element('operation-retry', HTMLButtonElement),
		operationConfirm: element('operation-confirm', HTMLButtonElement),
		connectionError: element('connection-error', HTMLElement),
	};
}

function setText(id: string, value: string): void {
	element(id, HTMLElement).textContent = value;
}

function element<T extends HTMLElement>(id: string, constructor: { new(): T }): T {
	const value = document.getElementById(id);
	if (!(value instanceof constructor)) {
		throw new TypeError(`Missing inventory overview panel element: ${id}`);
	}
	return value;
}

function progress(requestId: string, stage: InventoryOverviewPanelStage): IFrameInventoryOverviewResult {
	return { protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION, requestId, status: 'progress', stage };
}

function baseResult(requestId: string, status: 'cancelled' | 'ready'): IFrameInventoryOverviewResult {
	return { protocolVersion: INVENTORY_OVERVIEW_PROTOCOL_VERSION, requestId, status };
}

async function requireWrite(
	writeResult: (result: IFrameInventoryOverviewResult) => Promise<boolean>,
	result: IFrameInventoryOverviewResult,
): Promise<void> {
	if (!await writeResult(result)) {
		throw new Error('The host rejected the inventory overview panel result.');
	}
}

function inferLanguage(text: string): string {
	return /[\u3400-\u9FFF]/.test(text) ? 'zh-Hans' : 'en';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

function errorName(error: unknown): string {
	return error instanceof Error ? error.name.slice(0, 80) : typeof error;
}
