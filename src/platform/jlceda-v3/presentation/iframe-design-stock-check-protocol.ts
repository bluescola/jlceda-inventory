import type { DesignStockCheckStatus, DesignStockInventoryState } from '../../../features/design-stock-check/domain/design-stock-check';
import type {
	DesignStockCheckPanelActionOutcome,
	DesignStockCheckPanelInput,
	DesignStockCheckSource,
} from './design-stock-check-panel';

export const DESIGN_STOCK_CHECK_IFRAME_ID = 'jlceda-design-stock-check-panel';
export const DESIGN_STOCK_CHECK_IFRAME_PATH = '/iframe/design-stock-check.html';
export const DESIGN_STOCK_CHECK_REQUEST_KEY = 'design-stock-check-panel.v1.request';
export const DESIGN_STOCK_CHECK_EVENT_KEY = 'design-stock-check-panel.v1.event';
export const DESIGN_STOCK_CHECK_RESPONSE_KEY = 'design-stock-check-panel.v1.response';
export const DESIGN_STOCK_CHECK_PROTOCOL_VERSION = 1;

const MAX_ROWS = 10_000;
const MAX_DESIGNATORS_PER_ROW = 10_000;

const LABEL_KEYS = [
	'title',
	'source',
	'sourceSchematic',
	'sourcePcb',
	'sourceFile',
	'boardQuantity',
	'totalRows',
	'filterStatus',
	'filterAll',
	'sufficient',
	'insufficient',
	'reviewRequired',
	'stocktakeRequired',
	'inventoryMissing',
	'identityUnmatched',
	'columnPartNumber',
	'columnName',
	'columnManufacturerPart',
	'columnPackage',
	'columnDesignators',
	'columnUnitQuantity',
	'columnRequiredQuantity',
	'columnAvailableQuantity',
	'columnShortageQuantity',
	'columnStatus',
	'quantityEstimated',
	'quantityUnknown',
	'emptyValue',
	'emptyReport',
	'emptyFiltered',
	'previousPage',
	'nextPage',
	'pageStatus',
	'exportCsv',
	'exporting',
	'exportSucceeded',
	'close',
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

const INVENTORY_STATES: readonly DesignStockInventoryState[] = [
	'exact',
	'estimated',
	'unknown',
	'depleted',
	'missing',
	'identity-unmatched',
];

export type DesignStockCheckLabels = Record<typeof LABEL_KEYS[number], string>;
export type DesignStockCheckPanelStage = 'panel-rendered' | 'request-read' | 'script-started';
export type DesignStockCheckSummary = Record<DesignStockCheckStatus, number>;

export interface DesignStockCheckPayloadRow {
	lcscPartNumber?: string;
	name?: string;
	manufacturerPartNumber?: string;
	package?: string;
	designators: string[];
	unitQuantity: number;
	requiredQuantity: number;
	inventoryState: DesignStockInventoryState;
	availableQuantity: number | null;
	shortageQuantity: number | null;
	status: DesignStockCheckStatus;
}

export interface IFrameDesignStockCheckRequest {
	protocolVersion: 1;
	requestId: string;
	labels: DesignStockCheckLabels;
	source: DesignStockCheckSource;
	boardQuantity: number;
	summary: DesignStockCheckSummary;
	rows: DesignStockCheckPayloadRow[];
}

export type IFrameDesignStockCheckEvent
	= | { protocolVersion: 1; requestId: string; status: 'ready' }
		| { protocolVersion: 1; requestId: string; status: 'progress'; stage: DesignStockCheckPanelStage }
		| { protocolVersion: 1; requestId: string; status: 'failed'; stage: DesignStockCheckPanelStage; errorName: string; error: string }
		| {
			protocolVersion: 1;
			requestId: string;
			status: 'action';
			operationId: string;
			action: 'close' | 'export-csv';
		};

export interface IFrameDesignStockCheckResponse {
	protocolVersion: 1;
	requestId: string;
	operationId: string;
	status: 'failed' | 'succeeded';
	message?: string;
}

export function createDesignStockCheckRequest(
	requestId: string,
	labels: DesignStockCheckLabels,
	input: DesignStockCheckPanelInput,
): IFrameDesignStockCheckRequest {
	if (input.report.rows.length > MAX_ROWS) {
		throw new RangeError(`Design stock check report exceeds the ${MAX_ROWS}-row limit.`);
	}
	const rows = input.report.rows.map((row): DesignStockCheckPayloadRow => ({
		lcscPartNumber: cleanOptionalText(row.identity.lcscPartNumber, 500),
		name: cleanOptionalText(row.identity.name, 500),
		manufacturerPartNumber: cleanOptionalText(row.identity.manufacturerPartNumber, 500),
		package: cleanOptionalText(row.identity.package, 500),
		designators: cloneDesignators(row.designators),
		unitQuantity: row.unitQuantity,
		requiredQuantity: row.requiredQuantity,
		inventoryState: row.inventoryState,
		availableQuantity: row.availableQuantity,
		shortageQuantity: row.shortageQuantity,
		status: row.status,
	}));
	return {
		protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
		requestId,
		labels: { ...labels },
		source: input.source,
		boardQuantity: input.report.boardQuantity,
		summary: summarizeRows(rows),
		rows,
	};
}

export function parseIFrameDesignStockCheckRequest(value: unknown): IFrameDesignStockCheckRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== DESIGN_STOCK_CHECK_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isLabels(value.labels)
		|| !isSource(value.source)
		|| !isPositiveSafeInteger(value.boardQuantity)
		|| !isSummary(value.summary)
		|| !Array.isArray(value.rows)
		|| value.rows.length > MAX_ROWS
		|| !value.rows.every(isPayloadRow)) {
		return undefined;
	}
	const rows = value.rows.map(clonePayloadRow);
	if (!summaryEquals(value.summary, summarizeRows(rows))) {
		return undefined;
	}
	return {
		protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
		requestId: value.requestId,
		labels: { ...value.labels },
		source: value.source,
		boardQuantity: value.boardQuantity,
		summary: { ...value.summary },
		rows,
	};
}

export function parseIFrameDesignStockCheckEvent(
	value: unknown,
	requestId: string,
): IFrameDesignStockCheckEvent | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== DESIGN_STOCK_CHECK_PROTOCOL_VERSION
		|| value.requestId !== requestId) {
		return undefined;
	}
	const base = { protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION, requestId } as const;
	if (value.status === 'ready') {
		return { ...base, status: 'ready' };
	}
	if (value.status === 'progress' && isPanelStage(value.stage)) {
		return { ...base, status: 'progress', stage: value.stage };
	}
	if (value.status === 'failed'
		&& isPanelStage(value.stage)
		&& isText(value.errorName, 100)
		&& isText(value.error, 500)) {
		return { ...base, status: 'failed', stage: value.stage, errorName: value.errorName, error: value.error };
	}
	if (value.status === 'action'
		&& isNonEmptyText(value.operationId, 200)
		&& (value.action === 'close' || value.action === 'export-csv')) {
		return { ...base, status: 'action', operationId: value.operationId, action: value.action };
	}
	return undefined;
}

export function createDesignStockCheckResponse(
	requestId: string,
	operationId: string,
	outcome: DesignStockCheckPanelActionOutcome,
): IFrameDesignStockCheckResponse {
	return {
		protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
		requestId,
		operationId,
		status: outcome.status,
		message: outcome.message?.slice(0, 1000),
	};
}

export function parseIFrameDesignStockCheckResponse(
	value: unknown,
	requestId: string,
	operationId: string,
): IFrameDesignStockCheckResponse | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== DESIGN_STOCK_CHECK_PROTOCOL_VERSION
		|| value.requestId !== requestId
		|| value.operationId !== operationId
		|| (value.status !== 'failed' && value.status !== 'succeeded')
		|| (value.message !== undefined && !isText(value.message, 1000))
		|| (value.status === 'failed' && !isNonEmptyText(value.message, 1000))) {
		return undefined;
	}
	return {
		protocolVersion: DESIGN_STOCK_CHECK_PROTOCOL_VERSION,
		requestId,
		operationId,
		status: value.status,
		message: value.message,
	};
}

function summarizeRows(rows: readonly DesignStockCheckPayloadRow[]): DesignStockCheckSummary {
	const summary = Object.fromEntries(CHECK_STATUSES.map(status => [status, 0])) as DesignStockCheckSummary;
	for (const row of rows) {
		summary[row.status] += 1;
	}
	return summary;
}

function summaryEquals(left: DesignStockCheckSummary, right: DesignStockCheckSummary): boolean {
	return CHECK_STATUSES.every(status => left[status] === right[status]);
}

function isSummary(value: unknown): value is DesignStockCheckSummary {
	return isRecord(value) && CHECK_STATUSES.every(status => isSafeNonNegativeInteger(value[status]));
}

function isPayloadRow(value: unknown): value is DesignStockCheckPayloadRow {
	return isRecord(value)
		&& isOptionalText(value.lcscPartNumber, 500)
		&& isOptionalText(value.name, 500)
		&& isOptionalText(value.manufacturerPartNumber, 500)
		&& isOptionalText(value.package, 500)
		&& Array.isArray(value.designators)
		&& value.designators.length <= MAX_DESIGNATORS_PER_ROW
		&& value.designators.every(designator => isNonEmptyText(designator, 200))
		&& isPositiveSafeInteger(value.unitQuantity)
		&& isPositiveSafeInteger(value.requiredQuantity)
		&& isInventoryState(value.inventoryState)
		&& isNullableSafeNonNegativeInteger(value.availableQuantity)
		&& isNullableSafeNonNegativeInteger(value.shortageQuantity)
		&& isCheckStatus(value.status);
}

function clonePayloadRow(value: DesignStockCheckPayloadRow): DesignStockCheckPayloadRow {
	return { ...value, designators: [...value.designators] };
}

function cloneDesignators(values: readonly string[]): string[] {
	if (values.length > MAX_DESIGNATORS_PER_ROW) {
		throw new RangeError(`Design stock check row exceeds the ${MAX_DESIGNATORS_PER_ROW}-designator limit.`);
	}
	return values.map((value) => {
		const cleaned = value.trim().slice(0, 200);
		if (!cleaned) {
			throw new TypeError('Designator must not be empty.');
		}
		return cleaned;
	});
}

function cleanOptionalText(value: string | undefined, maximumLength: number): string | undefined {
	const cleaned = value?.trim().slice(0, maximumLength);
	return cleaned || undefined;
}

function isLabels(value: unknown): value is DesignStockCheckLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isNonEmptyText(value[key], 2000));
}

function isPanelStage(value: unknown): value is DesignStockCheckPanelStage {
	return value === 'panel-rendered' || value === 'request-read' || value === 'script-started';
}

function isSource(value: unknown): value is DesignStockCheckSource {
	return value === 'file' || value === 'pcb' || value === 'schematic';
}

function isInventoryState(value: unknown): value is DesignStockInventoryState {
	return INVENTORY_STATES.includes(value as DesignStockInventoryState);
}

function isCheckStatus(value: unknown): value is DesignStockCheckStatus {
	return CHECK_STATUSES.includes(value as DesignStockCheckStatus);
}

function isNullableSafeNonNegativeInteger(value: unknown): value is number | null {
	return value === null || isSafeNonNegativeInteger(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isOptionalText(value: unknown, maximumLength: number): value is string | undefined {
	return value === undefined || isNonEmptyText(value, maximumLength);
}

function isNonEmptyText(value: unknown, maximumLength: number): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function isText(value: unknown, maximumLength: number): value is string {
	return typeof value === 'string' && value.length <= maximumLength;
}

function isRecord(value: unknown): value is Record<string, any> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
