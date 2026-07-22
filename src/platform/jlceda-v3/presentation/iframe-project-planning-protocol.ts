import type { DesignStockCheckStatus } from '../../../features/design-stock-check/domain/design-stock-check';
import type { DesignDocumentKind } from '../../../features/design-stock-check/ports/design-component-reader';
import type { ProjectPlanningIntent, ProjectPlanningOperationResult, ProjectPlanningPanelInput, ProjectPlanningPanelSnapshot, ProjectPlanningViewState } from './project-planning-panel';
import { MAX_INVENTORY_DOCUMENT_PROJECT_DEMAND_LINES, MAX_INVENTORY_DOCUMENT_PROJECT_SNAPSHOTS, MAX_INVENTORY_DOCUMENT_PURCHASE_RECORDS } from '../../../features/inventory/application/inventory-document-limits';
import { summarizePurchaseCosts } from '../../../features/project-planning/application/purchase-cost';

export const PROJECT_PLANNING_IFRAME_ID = 'jlceda-project-planning-panel';
export const PROJECT_PLANNING_IFRAME_PATH = '/iframe/project-planning.html';
export const PROJECT_PLANNING_REQUEST_KEY = 'project-planning-panel.v1.request';
export const PROJECT_PLANNING_EVENT_KEY = 'project-planning-panel.v1.event';
export const PROJECT_PLANNING_RESPONSE_KEY = 'project-planning-panel.v1.response';
export const PROJECT_PLANNING_PROTOCOL_VERSION = 1;

const MAX_SNAPSHOTS = MAX_INVENTORY_DOCUMENT_PROJECT_SNAPSHOTS;
const MAX_PROCUREMENT_ROWS = MAX_INVENTORY_DOCUMENT_PROJECT_DEMAND_LINES;
const MAX_PURCHASES = MAX_INVENTORY_DOCUMENT_PURCHASE_RECORDS;
const MAX_TEXT_BUDGET = 2_000_000;
const MAX_TEXT_LENGTH = 4_096;

const LABEL_KEYS = [
	'title',
	'tabSnapshots',
	'tabProcurement',
	'tabPurchases',
	'captureCurrent',
	'refresh',
	'close',
	'pageSize',
	'previousPage',
	'nextPage',
	'pageStatus',
	'emptyValue',
	'emptySnapshots',
	'emptyProcurement',
	'emptyPurchases',
	'columnLabel',
	'columnProjectUuid',
	'columnDocumentUuid',
	'columnDocumentKind',
	'columnBoardQuantity',
	'columnCapturedAt',
	'columnDemandLines',
	'columnActions',
	'documentSchematic',
	'documentPcb',
	'documentFile',
	'setBoardQuantity',
	'boardQuantity',
	'boardQuantityInvalid',
	'confirmSetBoardQuantity',
	'removeSnapshot',
	'confirmRemoveSnapshot',
	'columnPartNumber',
	'columnName',
	'columnRequiredQuantity',
	'columnAvailableQuantity',
	'columnSuggestedQuantity',
	'columnStatus',
	'columnSources',
	'statusSufficient',
	'statusInsufficient',
	'statusReviewRequired',
	'statusStocktakeRequired',
	'statusInventoryMissing',
	'statusIdentityUnmatched',
	'quantityEstimated',
	'quantityUnknown',
	'exportProcurement',
	'addPurchase',
	'costSummary',
	'columnQuantity',
	'columnUnitPriceMinor',
	'columnTotalMinor',
	'columnCurrency',
	'columnPlatform',
	'columnOrderNumber',
	'columnPurchasedAt',
	'removePurchase',
	'confirmRemovePurchase',
	'fieldPartNumber',
	'fieldName',
	'fieldQuantity',
	'fieldUnitPriceMinor',
	'fieldCurrency',
	'fieldPlatform',
	'fieldProductUrl',
	'fieldOrderNumber',
	'fieldPurchasedAt',
	'fieldSnapshots',
	'fieldNote',
	'savePurchase',
	'cancel',
	'purchaseNameRequired',
	'purchasePartNumberInvalid',
	'purchaseQuantityInvalid',
	'purchasePriceInvalid',
	'purchaseCurrencyInvalid',
	'purchaseDateInvalid',
	'operationPending',
	'operationError',
	'loading',
	'connectionError',
] as const;

const CHECK_STATUSES: readonly DesignStockCheckStatus[] = [
	'sufficient',
	'insufficient',
	'review-required',
	'stocktake-required',
	'inventory-missing',
	'identity-unmatched',
];

export type ProjectPlanningLabels = Record<typeof LABEL_KEYS[number], string>;
export type ProjectPlanningPanelStage = 'panel-rendered' | 'request-read' | 'script-started';

export interface ProjectPlanningSnapshotPayload {
	id: string;
	projectUuid?: string;
	documentUuid: string;
	documentKind: DesignDocumentKind | 'file';
	label: string;
	boardQuantity: number;
	capturedAt: string;
	capturedAtLabel: string;
	demandCount: number;
	revision: number;
}

export interface ProjectPlanningSourcePayload {
	snapshotId: string;
	label: string;
	boardQuantity: number;
}

export interface ProjectPlanningProcurementPayload {
	key: string;
	lcscPartNumber?: string;
	name?: string;
	manufacturerPartNumber?: string;
	package?: string;
	requiredQuantity: number;
	availableQuantity: number | null;
	shortageQuantity: number | null;
	suggestedQuantity: number | null;
	status: DesignStockCheckStatus;
	sources: ProjectPlanningSourcePayload[];
}

export interface ProjectPlanningPurchasePayload {
	id: string;
	lcscPartNumber?: string;
	name: string;
	quantity: number;
	unitPriceMinor: number;
	totalMinor: number;
	currency: string;
	platform?: string;
	productUrl?: string;
	orderNumber?: string;
	purchasedAt: string;
	purchasedAtLabel: string;
	projectSnapshotIds: string[];
	note?: string;
	revision: number;
}

export interface ProjectPlanningCostSummaryPayload {
	currency: string;
	recordCount: number;
	totalQuantity: number;
	totalMinor: number;
}

export interface ProjectPlanningDataPayload {
	snapshots: ProjectPlanningSnapshotPayload[];
	procurement: ProjectPlanningProcurementPayload[];
	purchases: ProjectPlanningPurchasePayload[];
	costSummaries: ProjectPlanningCostSummaryPayload[];
}

export interface IFrameProjectPlanningRequest extends ProjectPlanningDataPayload {
	protocolVersion: 1;
	requestId: string;
	labels: ProjectPlanningLabels;
	initialState?: ProjectPlanningViewState;
}

export type IFrameProjectPlanningEvent
	= | { protocolVersion: 1; requestId: string; status: 'ready' }
		| { protocolVersion: 1; requestId: string; status: 'progress'; stage: ProjectPlanningPanelStage }
		| { protocolVersion: 1; requestId: string; status: 'failed'; stage: ProjectPlanningPanelStage; errorName: string; error: string }
		| { protocolVersion: 1; requestId: string; status: 'operation'; operationId: string; intent: ProjectPlanningIntent };

export interface IFrameProjectPlanningResponse {
	protocolVersion: 1;
	requestId: string;
	operationId: string;
	status: 'operation-response';
	result: {
		status: 'cancelled' | 'failed' | 'succeeded';
		message?: string;
		snapshot?: ProjectPlanningDataPayload;
	};
}

export function createIFrameProjectPlanningRequest(
	requestId: string,
	labels: ProjectPlanningLabels,
	input: ProjectPlanningPanelInput,
): IFrameProjectPlanningRequest {
	if (!isNonEmptyText(requestId, 200) || !isLabels(labels)) {
		throw new TypeError('Invalid project planning panel request metadata.');
	}
	const payload = createDataPayload(input);
	if (input.initialState !== undefined && !isViewState(input.initialState)) {
		throw new TypeError('Invalid project planning panel view state.');
	}
	return {
		protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
		requestId,
		labels: { ...labels },
		...payload,
		initialState: input.initialState ? { ...input.initialState } : undefined,
	};
}

export function createIFrameProjectPlanningResponse(
	requestId: string,
	operationId: string,
	result: ProjectPlanningOperationResult,
): IFrameProjectPlanningResponse {
	if (!isNonEmptyText(requestId, 200) || !isNonEmptyText(operationId, 200)) {
		throw new TypeError('Invalid project planning operation response metadata.');
	}
	return {
		protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
		requestId,
		operationId,
		status: 'operation-response',
		result: {
			status: result.status,
			message: result.message === undefined ? undefined : cleanText(result.message, 2_000, 'operation message'),
			snapshot: result.snapshot ? createDataPayload(result.snapshot) : undefined,
		},
	};
}

export function parseIFrameProjectPlanningRequest(value: unknown): IFrameProjectPlanningRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== PROJECT_PLANNING_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isLabels(value.labels)
		|| (value.initialState !== undefined && !isViewState(value.initialState))) {
		return undefined;
	}
	const payload = parseDataPayload(value);
	if (!payload) {
		return undefined;
	}
	return {
		protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
		requestId: value.requestId,
		labels: { ...value.labels },
		...payload,
		initialState: value.initialState ? { ...value.initialState } : undefined,
	};
}

export function parseIFrameProjectPlanningEvent(
	value: unknown,
	requestId: string,
): IFrameProjectPlanningEvent | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== PROJECT_PLANNING_PROTOCOL_VERSION
		|| value.requestId !== requestId) {
		return undefined;
	}
	if (value.status === 'ready') {
		return { protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION, requestId, status: 'ready' };
	}
	if (value.status === 'progress'
		&& (value.stage === 'panel-rendered' || value.stage === 'request-read' || value.stage === 'script-started')) {
		return { protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION, requestId, status: 'progress', stage: value.stage };
	}
	if (value.status === 'failed'
		&& (value.stage === 'panel-rendered' || value.stage === 'request-read' || value.stage === 'script-started')
		&& isText(value.errorName, 80)
		&& isText(value.error, 2_000)) {
		return {
			protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
			requestId,
			status: 'failed',
			stage: value.stage,
			errorName: value.errorName,
			error: value.error,
		};
	}
	if (value.status !== 'operation'
		|| !isNonEmptyText(value.operationId, 200)
		|| !isIntent(value.intent)) {
		return undefined;
	}
	return {
		protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
		requestId,
		status: 'operation',
		operationId: value.operationId,
		intent: cloneIntent(value.intent),
	};
}

export function parseIFrameProjectPlanningResponse(
	value: unknown,
	requestId: string,
	operationId: string,
): IFrameProjectPlanningResponse | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== PROJECT_PLANNING_PROTOCOL_VERSION
		|| value.requestId !== requestId
		|| value.operationId !== operationId
		|| value.status !== 'operation-response'
		|| !isRecord(value.result)
		|| (value.result.status !== 'cancelled' && value.result.status !== 'failed' && value.result.status !== 'succeeded')
		|| (value.result.status === 'failed' && !isNonEmptyText(value.result.message, 2_000))
		|| (value.result.message !== undefined && !isText(value.result.message, 2_000))) {
		return undefined;
	}
	const snapshot = value.result.snapshot === undefined ? undefined : parseDataPayload(value.result.snapshot);
	if (value.result.snapshot !== undefined && !snapshot) {
		return undefined;
	}
	return {
		protocolVersion: PROJECT_PLANNING_PROTOCOL_VERSION,
		requestId,
		operationId,
		status: 'operation-response',
		result: {
			status: value.result.status,
			message: value.result.message,
			snapshot,
		},
	};
}

function createDataPayload(input: ProjectPlanningPanelSnapshot): ProjectPlanningDataPayload {
	if (input.snapshots.length > MAX_SNAPSHOTS
		|| input.procurement.length > MAX_PROCUREMENT_ROWS
		|| input.purchases.length > MAX_PURCHASES) {
		throw new RangeError('Project planning panel data exceeds the row limit.');
	}
	const budget = { value: 0 };
	const snapshots = input.snapshots.map(snapshot => ({
		id: budgetText(snapshot.id, 256, budget, 'snapshot ID'),
		projectUuid: optionalBudgetText(snapshot.projectUuid, 256, budget, 'project UUID'),
		documentUuid: budgetText(snapshot.documentUuid, 256, budget, 'document UUID'),
		documentKind: snapshot.documentKind,
		label: budgetText(snapshot.label, 128, budget, 'snapshot label'),
		boardQuantity: positiveInteger(snapshot.boardQuantity, 'snapshot board quantity'),
		capturedAt: timestamp(snapshot.capturedAt, 'snapshot capture time'),
		capturedAtLabel: formatTimestamp(snapshot.capturedAt),
		demandCount: nonNegativeInteger(snapshot.demands.length, 'snapshot demand count'),
		revision: nonNegativeInteger(snapshot.revision, 'snapshot revision'),
	} satisfies ProjectPlanningSnapshotPayload));
	const procurement = input.procurement.map(row => ({
		key: budgetText(row.key, 512, budget, 'procurement key'),
		lcscPartNumber: optionalBudgetText(row.identity.lcscPartNumber, 128, budget, 'procurement C number'),
		name: optionalBudgetText(row.identity.name, 512, budget, 'procurement name'),
		manufacturerPartNumber: optionalBudgetText(row.identity.manufacturerPartNumber, 512, budget, 'procurement MPN'),
		package: optionalBudgetText(row.identity.package, 256, budget, 'procurement package'),
		requiredQuantity: positiveInteger(row.requiredQuantity, 'procurement required quantity'),
		availableQuantity: nullableNonNegativeInteger(row.availableQuantity, 'procurement available quantity'),
		shortageQuantity: nullableNonNegativeInteger(row.shortageQuantity, 'procurement shortage quantity'),
		suggestedQuantity: nullableNonNegativeInteger(row.suggestedQuantity, 'procurement suggested quantity'),
		status: checkStatus(row.status),
		sources: row.sources.map(source => ({
			snapshotId: budgetText(source.snapshotId, 256, budget, 'procurement snapshot ID'),
			label: budgetText(source.label, 128, budget, 'procurement source label'),
			boardQuantity: positiveInteger(source.boardQuantity, 'procurement source board quantity'),
		})),
	} satisfies ProjectPlanningProcurementPayload));
	const purchases = input.purchases.map((record) => {
		const quantity = positiveInteger(record.quantity, 'purchase quantity');
		const unitPriceMinor = nonNegativeInteger(record.unitPriceMinor, 'purchase unit price');
		return {
			id: budgetText(record.id, 256, budget, 'purchase ID'),
			lcscPartNumber: optionalBudgetText(record.lcscPartNumber, 128, budget, 'purchase C number'),
			name: budgetText(record.name, 256, budget, 'purchase name'),
			quantity,
			unitPriceMinor,
			totalMinor: safeProduct(quantity, unitPriceMinor),
			currency: currency(record.currency),
			platform: optionalBudgetText(record.platform, 128, budget, 'purchase platform'),
			productUrl: optionalHttpUrl(record.productUrl, budget),
			orderNumber: optionalBudgetText(record.orderNumber, 256, budget, 'purchase order number'),
			purchasedAt: calendarDate(record.purchasedAt, 'purchase date'),
			purchasedAtLabel: calendarDate(record.purchasedAt, 'purchase date'),
			projectSnapshotIds: record.projectSnapshotIds.map(id => budgetText(id, 256, budget, 'purchase snapshot ID')),
			note: optionalBudgetText(record.note, MAX_TEXT_LENGTH, budget, 'purchase note'),
			revision: nonNegativeInteger(record.revision, 'purchase revision'),
		};
	});
	const costSummaries = summarizePurchaseCosts(input.purchases).map(summary => ({ ...summary }));
	return { snapshots, procurement, purchases, costSummaries };
}

function parseDataPayload(value: unknown): ProjectPlanningDataPayload | undefined {
	if (!isRecord(value)
		|| !Array.isArray(value.snapshots)
		|| !Array.isArray(value.procurement)
		|| !Array.isArray(value.purchases)
		|| !Array.isArray(value.costSummaries)
		|| value.snapshots.length > MAX_SNAPSHOTS
		|| value.procurement.length > MAX_PROCUREMENT_ROWS
		|| value.purchases.length > MAX_PURCHASES) {
		return undefined;
	}
	const budget = { value: 0 };
	if (!value.snapshots.every(item => isSnapshotPayload(item, budget))
		|| !value.procurement.every(item => isProcurementPayload(item, budget))
		|| !value.purchases.every(item => isPurchasePayload(item, budget))
		|| !value.costSummaries.every(isCostSummaryPayload)) {
		return undefined;
	}
	const snapshots = value.snapshots.map(item => ({ ...item }));
	const procurement = value.procurement.map(item => ({
		...item,
		sources: item.sources.map(source => ({ ...source })),
	}));
	const purchases = value.purchases.map(item => ({
		...item,
		projectSnapshotIds: [...item.projectSnapshotIds],
	}));
	const calculatedSummaries = summarizePayloadCosts(purchases);
	if (value.costSummaries.length !== calculatedSummaries.length
		|| !calculatedSummaries.every((summary, index) => {
			const received = value.costSummaries[index];
			return received.currency === summary.currency
				&& received.recordCount === summary.recordCount
				&& received.totalQuantity === summary.totalQuantity
				&& received.totalMinor === summary.totalMinor;
		})) {
		return undefined;
	}
	return { snapshots, procurement, purchases, costSummaries: calculatedSummaries };
}

function isIntent(value: unknown): value is Record<string, unknown> & { type: string; viewState: ProjectPlanningViewState } {
	if (!isRecord(value) || !isViewState(value.viewState) || typeof value.type !== 'string') {
		return false;
	}
	if (value.type === 'capture-current'
		|| value.type === 'export-procurement'
		|| value.type === 'refresh'
		|| value.type === 'close') {
		return true;
	}
	if (value.type === 'set-board-quantity') {
		return value.confirmed === true && isSnapshotRef(value.snapshot) && isPositiveInteger(value.boardQuantity);
	}
	if (value.type === 'remove-snapshot') {
		return value.confirmed === true && isSnapshotRef(value.snapshot);
	}
	if (value.type === 'remove-purchase') {
		return value.confirmed === true && isPurchaseRef(value.purchase);
	}
	return value.type === 'add-purchase' && isPurchaseDraft(value.draft);
}

function cloneIntent(intent: Record<string, unknown> & { type: string; viewState: ProjectPlanningViewState }): ProjectPlanningIntent {
	return structuredClone(intent) as ProjectPlanningIntent;
}

function isSnapshotRef(value: unknown): boolean {
	return isRecord(value)
		&& isNonEmptyText(value.id, 256)
		&& isNonNegativeInteger(value.expectedRevision)
		&& isNonEmptyText(value.documentUuid, 256)
		&& (value.projectUuid === undefined || isNonEmptyText(value.projectUuid, 256));
}

function isPurchaseRef(value: unknown): boolean {
	return isRecord(value)
		&& isNonEmptyText(value.id, 256)
		&& isNonNegativeInteger(value.expectedRevision)
		&& isTextArray(value.projectSnapshotIds, 2_000, 256);
}

function isPurchaseDraft(value: unknown): boolean {
	return isRecord(value)
		&& (value.lcscPartNumber === undefined || (isText(value.lcscPartNumber, 128) && /^C\d+$/.test(value.lcscPartNumber)))
		&& isNonEmptyText(value.name, 256)
		&& isPositiveInteger(value.quantity)
		&& isNonNegativeInteger(value.unitPriceMinor)
		&& isText(value.currency, 3)
		&& /^[A-Z]{3}$/.test(value.currency)
		&& (value.platform === undefined || isText(value.platform, 128))
		&& (value.productUrl === undefined || isHttpUrl(value.productUrl))
		&& (value.orderNumber === undefined || isText(value.orderNumber, 256))
		&& isCalendarDate(value.purchasedAt)
		&& isTextArray(value.projectSnapshotIds, MAX_SNAPSHOTS, 256)
		&& (value.note === undefined || isText(value.note, MAX_TEXT_LENGTH))
		&& safeProduct(value.quantity, value.unitPriceMinor) >= 0;
}

function isViewState(value: unknown): value is ProjectPlanningViewState {
	return isRecord(value)
		&& (value.tab === 'snapshots' || value.tab === 'procurement' || value.tab === 'purchases')
		&& isPositiveInteger(value.snapshotPage)
		&& isPositiveInteger(value.procurementPage)
		&& isPositiveInteger(value.purchasePage)
		&& (value.pageSize === 25 || value.pageSize === 50 || value.pageSize === 100);
}

function isSnapshotPayload(value: unknown, budget: { value: number }): value is ProjectPlanningSnapshotPayload {
	return isRecord(value)
		&& budgetValidText(value.id, 256, budget, false)
		&& (value.projectUuid === undefined || budgetValidText(value.projectUuid, 256, budget, false))
		&& budgetValidText(value.documentUuid, 256, budget, false)
		&& (value.documentKind === 'schematic' || value.documentKind === 'pcb' || value.documentKind === 'file')
		&& budgetValidText(value.label, 128, budget, false)
		&& isPositiveInteger(value.boardQuantity)
		&& isTimestamp(value.capturedAt)
		&& isText(value.capturedAtLabel, 100)
		&& isNonNegativeInteger(value.demandCount)
		&& isNonNegativeInteger(value.revision);
}

function isProcurementPayload(value: unknown, budget: { value: number }): value is ProjectPlanningProcurementPayload {
	return isRecord(value)
		&& budgetValidText(value.key, 512, budget, false)
		&& (value.lcscPartNumber === undefined || budgetValidText(value.lcscPartNumber, 128, budget, true))
		&& (value.name === undefined || budgetValidText(value.name, 512, budget, true))
		&& (value.manufacturerPartNumber === undefined || budgetValidText(value.manufacturerPartNumber, 512, budget, true))
		&& (value.package === undefined || budgetValidText(value.package, 256, budget, true))
		&& isPositiveInteger(value.requiredQuantity)
		&& isNullableNonNegativeInteger(value.availableQuantity)
		&& isNullableNonNegativeInteger(value.shortageQuantity)
		&& isNullableNonNegativeInteger(value.suggestedQuantity)
		&& isCheckStatus(value.status)
		&& Array.isArray(value.sources)
		&& value.sources.length <= MAX_SNAPSHOTS
		&& value.sources.every(source => isRecord(source)
			&& budgetValidText(source.snapshotId, 256, budget, false)
			&& budgetValidText(source.label, 128, budget, false)
			&& isPositiveInteger(source.boardQuantity));
}

function isPurchasePayload(value: unknown, budget: { value: number }): value is ProjectPlanningPurchasePayload {
	return isRecord(value)
		&& budgetValidText(value.id, 256, budget, false)
		&& (value.lcscPartNumber === undefined || budgetValidText(value.lcscPartNumber, 128, budget, true))
		&& budgetValidText(value.name, 256, budget, false)
		&& isPositiveInteger(value.quantity)
		&& isNonNegativeInteger(value.unitPriceMinor)
		&& value.totalMinor === safeProduct(value.quantity, value.unitPriceMinor)
		&& isText(value.currency, 3)
		&& /^[A-Z]{3}$/.test(value.currency)
		&& (value.platform === undefined || budgetValidText(value.platform, 128, budget, true))
		&& (value.productUrl === undefined || (budgetValidText(value.productUrl, 2_048, budget, true) && isHttpUrl(value.productUrl)))
		&& (value.orderNumber === undefined || budgetValidText(value.orderNumber, 256, budget, true))
		&& isCalendarDate(value.purchasedAt)
		&& isText(value.purchasedAtLabel, 100)
		&& isTextArray(value.projectSnapshotIds, MAX_SNAPSHOTS, 256)
		&& value.projectSnapshotIds.every(id => budgetValidText(id, 256, budget, false))
		&& (value.note === undefined || budgetValidText(value.note, MAX_TEXT_LENGTH, budget, true))
		&& isNonNegativeInteger(value.revision);
}

function isCostSummaryPayload(value: unknown): value is ProjectPlanningCostSummaryPayload {
	return isRecord(value)
		&& isText(value.currency, 3)
		&& /^[A-Z]{3}$/.test(value.currency)
		&& isNonNegativeInteger(value.recordCount)
		&& isNonNegativeInteger(value.totalQuantity)
		&& isNonNegativeInteger(value.totalMinor);
}

function summarizePayloadCosts(records: readonly ProjectPlanningPurchasePayload[]): ProjectPlanningCostSummaryPayload[] {
	const summaries = new Map<string, ProjectPlanningCostSummaryPayload>();
	for (const record of records) {
		const existing = summaries.get(record.currency) ?? {
			currency: record.currency,
			recordCount: 0,
			totalQuantity: 0,
			totalMinor: 0,
		};
		existing.recordCount = safeSum(existing.recordCount, 1);
		existing.totalQuantity = safeSum(existing.totalQuantity, record.quantity);
		existing.totalMinor = safeSum(existing.totalMinor, record.totalMinor);
		summaries.set(record.currency, existing);
	}
	return [...summaries.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

function isLabels(value: unknown): value is ProjectPlanningLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isText(value[key], 2_000));
}

function checkStatus(value: DesignStockCheckStatus): DesignStockCheckStatus {
	if (!isCheckStatus(value)) {
		throw new TypeError('Invalid procurement status.');
	}
	return value;
}

function isCheckStatus(value: unknown): value is DesignStockCheckStatus {
	return typeof value === 'string' && CHECK_STATUSES.includes(value as DesignStockCheckStatus);
}

function budgetText(value: string, maximum: number, budget: { value: number }, label: string): string {
	const text = cleanText(value, maximum, label);
	budget.value += text.length;
	if (budget.value > MAX_TEXT_BUDGET) {
		throw new RangeError('Project planning panel text exceeds the transfer limit.');
	}
	return text;
}

function optionalBudgetText(
	value: string | undefined,
	maximum: number,
	budget: { value: number },
	label: string,
): string | undefined {
	return value === undefined ? undefined : budgetText(value, maximum, budget, label);
}

function budgetValidText(value: unknown, maximum: number, budget: { value: number }, allowEmpty: boolean): value is string {
	if (!isText(value, maximum) || (!allowEmpty && value.length === 0)) {
		return false;
	}
	budget.value += value.length;
	return budget.value <= MAX_TEXT_BUDGET;
}

function cleanText(value: string, maximum: number, label: string): string {
	if (typeof value !== 'string' || value.length > maximum) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return value;
}

function positiveInteger(value: number, label: string): number {
	if (!isPositiveInteger(value)) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return value;
}

function nonNegativeInteger(value: number, label: string): number {
	if (!isNonNegativeInteger(value)) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return value;
}

function nullableNonNegativeInteger(value: number | null, label: string): number | null {
	if (!isNullableNonNegativeInteger(value)) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return value;
}

function currency(value: string): string {
	if (!/^[A-Z]{3}$/.test(value)) {
		throw new TypeError('Invalid purchase currency.');
	}
	return value;
}

function optionalHttpUrl(value: string | undefined, budget: { value: number }): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const text = budgetText(value, 2_048, budget, 'purchase product URL');
	if (!isHttpUrl(text)) {
		throw new TypeError('Invalid purchase product URL.');
	}
	return text;
}

function timestamp(value: string, label: string): string {
	if (!isTimestamp(value)) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return new Date(value).toISOString();
}

function calendarDate(value: string, label: string): string {
	if (!isCalendarDate(value)) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return value;
}

function safeProduct(left: number, right: number): number {
	const value = left * right;
	if (!Number.isSafeInteger(value)) {
		throw new RangeError('Project planning amount exceeds the safe integer range.');
	}
	return value;
}

function safeSum(left: number, right: number): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) {
		throw new RangeError('Project planning summary exceeds the safe integer range.');
	}
	return value;
}

function formatTimestamp(value: string): string {
	const date = new Date(value);
	const datePart = [date.getFullYear(), date.getMonth() + 1, date.getDate()]
		.map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
		.join('-');
	const timePart = [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map(part => String(part).padStart(2, '0'))
		.join(':');
	return `${datePart} ${timePart}`;
}

function isHttpUrl(value: unknown): value is string {
	if (typeof value !== 'string' || value.length > 2_048) {
		return false;
	}
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	}
	catch {
		return false;
	}
}

function isTimestamp(value: unknown): value is string {
	return typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value));
}

function isCalendarDate(value: unknown): value is string {
	return typeof value === 'string'
		&& /^\d{4}-\d{2}-\d{2}$/.test(value)
		&& new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function isTextArray(value: unknown, maximumItems: number, maximumText: number): value is string[] {
	return Array.isArray(value)
		&& value.length <= maximumItems
		&& value.every(item => isNonEmptyText(item, maximumText));
}

function isNullableNonNegativeInteger(value: unknown): value is number | null {
	return value === null || isNonNegativeInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isNonEmptyText(value: unknown, maximum: number): value is string {
	return isText(value, maximum) && value.length > 0;
}

function isText(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, any> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
