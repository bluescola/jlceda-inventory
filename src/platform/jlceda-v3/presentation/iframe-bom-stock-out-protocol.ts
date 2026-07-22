import type { BomStockOutIssueCode } from '../../../features/inventory/application/bom-stock-out';
import type { BomStockOutPanelActionOutcome, BomStockOutPanelInput } from './bom-stock-out-panel';

export const BOM_STOCK_OUT_IFRAME_ID = 'jlceda-bom-stock-out-panel';
export const BOM_STOCK_OUT_IFRAME_PATH = '/iframe/bom-stock-out.html';
export const BOM_STOCK_OUT_REQUEST_KEY = 'bom-stock-out-panel.v1.request';
export const BOM_STOCK_OUT_EVENT_KEY = 'bom-stock-out-panel.v1.event';
export const BOM_STOCK_OUT_RESPONSE_KEY = 'bom-stock-out-panel.v1.response';
export const BOM_STOCK_OUT_PROTOCOL_VERSION = 1;

const MAX_ROWS = 10_000;
const MAX_DESIGNATORS_PER_ROW = 10_000;
const MAX_TEXT_LENGTH = 500;
const MAX_DESIGNATOR_LENGTH = 200;
const MAX_BRIDGE_TEXT = 5_000_000;

const ISSUE_CODES: readonly BomStockOutIssueCode[] = [
	'duplicate-batch',
	'item-missing',
	'quantity-not-exact',
	'insufficient-stock',
];

const LABEL_KEYS = [
	'title',
	'sourceName',
	'boardQuantity',
	'lineCount',
	'fingerprint',
	'statusReady',
	'statusBlocked',
	'statusDuplicate',
	'atomicNotice',
	'columnPartNumber',
	'columnName',
	'columnManufacturerPartNumber',
	'columnPackage',
	'columnDesignators',
	'columnRequestedQuantity',
	'columnBeforeQuantity',
	'columnAfterQuantity',
	'columnIssue',
	'issueDuplicateBatch',
	'issueItemMissing',
	'issueQuantityNotExact',
	'issueInsufficientStock',
	'emptyValue',
	'emptyRows',
	'previousPage',
	'nextPage',
	'pageStatus',
	'commit',
	'confirmCommit',
	'committing',
	'commitSucceeded',
	'cancel',
	'close',
	'operationError',
	'loading',
	'connectionError',
] as const;

export type BomStockOutLabels = Record<typeof LABEL_KEYS[number], string>;
export type BomStockOutPanelStage = 'panel-rendered' | 'request-read' | 'script-started';

export interface BomStockOutPayloadIssue {
	code: BomStockOutIssueCode;
	requestedQuantity?: number;
	availableQuantity?: number | null;
}

export interface BomStockOutPayloadRow {
	lineIndex: number;
	lcscPartNumber?: string;
	name: string;
	manufacturerPartNumber?: string;
	package?: string;
	designators: string[];
	requestedQuantity: number;
	beforeQuantity: number | null;
	afterQuantity: number | null;
	issues: BomStockOutPayloadIssue[];
}

export interface IFrameBomStockOutRequest {
	protocolVersion: 1;
	requestId: string;
	labels: BomStockOutLabels;
	sourceName: string;
	boardQuantity: number;
	status: 'blocked' | 'duplicate' | 'ready';
	batchFingerprintShort: string;
	rows: BomStockOutPayloadRow[];
	globalIssues: BomStockOutPayloadIssue[];
}

export type IFrameBomStockOutEvent
	= | { protocolVersion: 1; requestId: string; status: 'ready' }
		| { protocolVersion: 1; requestId: string; status: 'progress'; stage: BomStockOutPanelStage }
		| { protocolVersion: 1; requestId: string; status: 'failed'; stage: BomStockOutPanelStage; errorName: string; error: string }
		| { protocolVersion: 1; requestId: string; status: 'action'; operationId: string; action: 'close' | 'commit' };

export interface IFrameBomStockOutResponse {
	protocolVersion: 1;
	requestId: string;
	operationId: string;
	status: 'failed' | 'succeeded';
	message?: string;
}

export function createIFrameBomStockOutRequest(
	requestId: string,
	labels: BomStockOutLabels,
	input: BomStockOutPanelInput,
): IFrameBomStockOutRequest {
	if (!isNonEmptyText(requestId, 200)
		|| !isLabels(labels)
		|| !isNonEmptyTrimmedText(input.sourceName, MAX_TEXT_LENGTH)
		|| !isPositiveSafeInteger(input.boardQuantity)
		|| !Array.isArray(input.itemSummaries)
		|| input.itemSummaries.length > MAX_ROWS
		|| !Array.isArray(input.preview.lines)
		|| input.preview.lines.length > MAX_ROWS
		|| !Array.isArray(input.preview.issues)
		|| input.preview.issues.length > MAX_ROWS
		|| !isPreviewStatus(input.preview.status)
		|| !isSafeNonNegativeInteger(input.preview.documentRevision)
		|| !/^[a-f\d]{64}$/.test(input.preview.batchFingerprint)) {
		throw new TypeError('Invalid BOM stock-out panel input.');
	}
	const summaryByLine = new Map<number, BomStockOutPanelInput['itemSummaries'][number]>();
	const summaryItemIds = new Set<string>();
	for (const summary of input.itemSummaries) {
		if (!isSafeNonNegativeInteger(summary.lineIndex)
			|| summaryByLine.has(summary.lineIndex)
			|| !isNonEmptyText(summary.itemId, 4096)
			|| summaryItemIds.has(summary.itemId)
			|| !isPositiveSafeInteger(summary.requestedQuantity)) {
			throw new TypeError('Invalid or duplicate BOM stock-out line summary.');
		}
		summaryByLine.set(summary.lineIndex, summary);
		summaryItemIds.add(summary.itemId);
	}
	const previewLineByIndex = new Map(input.preview.lines.map(line => [line.lineIndex, line]));
	if (previewLineByIndex.size !== input.preview.lines.length) {
		throw new TypeError('BOM stock-out preview contains duplicate line indexes.');
	}
	for (const line of input.preview.lines) {
		const summary = summaryByLine.get(line.lineIndex);
		if (!summary
			|| line.itemId !== summary.itemId
			|| line.requestedQuantity !== summary.requestedQuantity
			|| !isSafeNonNegativeInteger(line.itemRevision)
			|| !isSafeNonNegativeInteger(line.beforeQuantity)
			|| !isSafeNonNegativeInteger(line.afterQuantity)
			|| line.beforeQuantity - line.requestedQuantity !== line.afterQuantity) {
			throw new TypeError('BOM stock-out preview line does not match a display summary.');
		}
	}
	const issuesByLine = new Map<number, BomStockOutPayloadIssue[]>();
	const globalIssues: BomStockOutPayloadIssue[] = [];
	for (const issue of input.preview.issues) {
		if (!ISSUE_CODES.includes(issue.code)) {
			throw new TypeError('BOM stock-out preview contains an unsupported issue.');
		}
		const cloned = cloneIssue(issue);
		if (issue.lineIndex === undefined) {
			globalIssues.push(cloned);
			continue;
		}
		const summary = summaryByLine.get(issue.lineIndex);
		if (!summary || (issue.itemId !== undefined && issue.itemId !== summary.itemId)) {
			throw new TypeError('BOM stock-out issue does not match a display line.');
		}
		const lineIssues = issuesByLine.get(issue.lineIndex) ?? [];
		lineIssues.push(cloned);
		issuesByLine.set(issue.lineIndex, lineIssues);
	}
	const budget = { text: input.sourceName.length };
	const rows = [...input.itemSummaries]
		.toSorted((left, right) => left.lineIndex - right.lineIndex)
		.map((summary): BomStockOutPayloadRow => {
			const previewLine = previewLineByIndex.get(summary.lineIndex);
			const rowIssues = issuesByLine.get(summary.lineIndex) ?? [];
			const issueQuantity = rowIssues.find(issue => issue.availableQuantity !== undefined)?.availableQuantity;
			if (previewLine && (previewLine.itemId !== summary.itemId
				|| previewLine.requestedQuantity !== summary.requestedQuantity)) {
				throw new TypeError('BOM stock-out preview line does not match its display summary.');
			}
			const row: BomStockOutPayloadRow = {
				lineIndex: summary.lineIndex,
				lcscPartNumber: cloneOptionalText(summary.identity.lcscPartNumber, budget),
				name: cloneRequiredText(summary.identity.name, budget),
				manufacturerPartNumber: cloneOptionalText(summary.identity.manufacturerPartNumber, budget),
				package: cloneOptionalText(summary.identity.package, budget),
				designators: cloneDesignators(summary.designators, budget),
				requestedQuantity: summary.requestedQuantity,
				beforeQuantity: previewLine?.beforeQuantity ?? issueQuantity ?? null,
				afterQuantity: previewLine?.afterQuantity ?? null,
				issues: rowIssues,
			};
			if (!isPayloadRow(row, { text: 0 })) {
				throw new TypeError('Invalid BOM stock-out display row.');
			}
			return row;
		});
	assertPreviewCoverage(input, previewLineByIndex, issuesByLine, globalIssues);
	return {
		protocolVersion: BOM_STOCK_OUT_PROTOCOL_VERSION,
		requestId,
		labels: { ...labels },
		sourceName: input.sourceName.trim(),
		boardQuantity: input.boardQuantity,
		status: input.preview.status,
		batchFingerprintShort: input.preview.batchFingerprint.slice(0, 12),
		rows,
		globalIssues,
	};
}

export function parseIFrameBomStockOutRequest(value: unknown): IFrameBomStockOutRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== BOM_STOCK_OUT_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isLabels(value.labels)
		|| !isNonEmptyTrimmedText(value.sourceName, MAX_TEXT_LENGTH)
		|| !isPositiveSafeInteger(value.boardQuantity)
		|| !isPreviewStatus(value.status)
		|| !/^[a-f\d]{12}$/.test(String(value.batchFingerprintShort))
		|| !Array.isArray(value.rows)
		|| value.rows.length > MAX_ROWS
		|| !Array.isArray(value.globalIssues)
		|| value.globalIssues.length > MAX_ROWS) {
		return undefined;
	}
	try {
		const budget = { text: value.sourceName.length };
		const hasIssues = value.globalIssues.length > 0
			|| value.rows.some(row => isRecord(row) && Array.isArray(row.issues) && row.issues.length > 0);
		if (!value.rows.every(row => isPayloadRow(row, budget))
			|| !value.globalIssues.every(isPayloadIssue)
			|| new Set(value.rows.map(row => isRecord(row) ? row.lineIndex : undefined)).size !== value.rows.length
			|| (value.status === 'ready' && hasIssues)
			|| (value.status === 'blocked' && !hasIssues)
			|| (value.status === 'duplicate'
				&& !value.globalIssues.some(issue => isRecord(issue) && issue.code === 'duplicate-batch'))) {
			return undefined;
		}
		return {
			protocolVersion: BOM_STOCK_OUT_PROTOCOL_VERSION,
			requestId: value.requestId,
			labels: { ...value.labels },
			sourceName: value.sourceName,
			boardQuantity: value.boardQuantity,
			status: value.status,
			batchFingerprintShort: value.batchFingerprintShort as string,
			rows: value.rows.map(clonePayloadRow),
			globalIssues: value.globalIssues.map(issue => ({ ...issue })),
		};
	}
	catch {
		return undefined;
	}
}

export function parseIFrameBomStockOutEvent(
	value: unknown,
	requestId: string,
): IFrameBomStockOutEvent | undefined {
	if (!isRecord(value) || value.protocolVersion !== BOM_STOCK_OUT_PROTOCOL_VERSION || value.requestId !== requestId) {
		return undefined;
	}
	const base = { protocolVersion: BOM_STOCK_OUT_PROTOCOL_VERSION, requestId } as const;
	if (value.status === 'ready')
		return { ...base, status: 'ready' };
	if (value.status === 'progress' && isPanelStage(value.stage)) {
		return { ...base, status: 'progress', stage: value.stage };
	}
	if (value.status === 'failed' && isPanelStage(value.stage)
		&& isText(value.errorName, 100) && isText(value.error, 500)) {
		return { ...base, status: 'failed', stage: value.stage, errorName: value.errorName, error: value.error };
	}
	if (value.status === 'action' && isNonEmptyText(value.operationId, 200)
		&& (value.action === 'close' || value.action === 'commit')) {
		return { ...base, status: 'action', operationId: value.operationId, action: value.action };
	}
	return undefined;
}

export function createIFrameBomStockOutResponse(
	requestId: string,
	operationId: string,
	outcome: BomStockOutPanelActionOutcome,
): IFrameBomStockOutResponse {
	return {
		protocolVersion: BOM_STOCK_OUT_PROTOCOL_VERSION,
		requestId,
		operationId,
		status: outcome.status,
		message: outcome.message?.slice(0, 1000),
	};
}

export function parseIFrameBomStockOutResponse(
	value: unknown,
	requestId: string,
	operationId: string,
): IFrameBomStockOutResponse | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== BOM_STOCK_OUT_PROTOCOL_VERSION
		|| value.requestId !== requestId
		|| value.operationId !== operationId
		|| (value.status !== 'failed' && value.status !== 'succeeded')
		|| (value.message !== undefined && !isText(value.message, 1000))
		|| (value.status === 'failed' && !isNonEmptyText(value.message, 1000))) {
		return undefined;
	}
	return { protocolVersion: 1, requestId, operationId, status: value.status, message: value.message };
}

function assertPreviewCoverage(
	input: BomStockOutPanelInput,
	previewLines: ReadonlyMap<number, unknown>,
	issuesByLine: ReadonlyMap<number, BomStockOutPayloadIssue[]>,
	globalIssues: readonly BomStockOutPayloadIssue[],
): void {
	if (input.preview.status === 'ready') {
		if (previewLines.size !== input.itemSummaries.length || issuesByLine.size > 0 || globalIssues.length > 0) {
			throw new TypeError('A ready BOM stock-out preview must cover every line without issues.');
		}
		return;
	}
	if (input.preview.status === 'duplicate'
		&& (previewLines.size > 0 || !globalIssues.some(issue => issue.code === 'duplicate-batch'))) {
		throw new TypeError('A duplicate BOM stock-out preview must expose its duplicate issue.');
	}
	if (input.preview.status === 'blocked' && issuesByLine.size === 0 && globalIssues.length === 0) {
		throw new TypeError('A blocked BOM stock-out preview must expose at least one issue.');
	}
}

function cloneIssue(issue: {
	code: BomStockOutIssueCode;
	requestedQuantity?: number;
	availableQuantity?: number | null;
}): BomStockOutPayloadIssue {
	const result = {
		code: issue.code,
		requestedQuantity: issue.requestedQuantity,
		availableQuantity: issue.availableQuantity,
	};
	if (!isPayloadIssue(result))
		throw new TypeError('Invalid BOM stock-out issue quantities.');
	return result;
}

function isPayloadRow(value: unknown, budget: { text: number }): value is BomStockOutPayloadRow {
	if (!isRecord(value)
		|| !isSafeNonNegativeInteger(value.lineIndex)
		|| !isOptionalText(value.lcscPartNumber, MAX_TEXT_LENGTH)
		|| !isNonEmptyText(value.name, MAX_TEXT_LENGTH)
		|| !isOptionalText(value.manufacturerPartNumber, MAX_TEXT_LENGTH)
		|| !isOptionalText(value.package, MAX_TEXT_LENGTH)
		|| !Array.isArray(value.designators)
		|| value.designators.length > MAX_DESIGNATORS_PER_ROW
		|| !value.designators.every(item => isNonEmptyText(item, MAX_DESIGNATOR_LENGTH))
		|| !isPositiveSafeInteger(value.requestedQuantity)
		|| !isNullableNonNegativeSafeInteger(value.beforeQuantity)
		|| !isNullableNonNegativeSafeInteger(value.afterQuantity)
		|| !Array.isArray(value.issues)
		|| value.issues.length > ISSUE_CODES.length
		|| !value.issues.every(isPayloadIssue)) {
		return false;
	}
	const beforeQuantity = value.beforeQuantity as number | null;
	const afterQuantity = value.afterQuantity as number | null;
	if ((afterQuantity !== null && beforeQuantity === null)
		|| (afterQuantity !== null && beforeQuantity! - (value.requestedQuantity as number) !== afterQuantity)) {
		return false;
	}
	addBudget(budget, value.name.length
	+ ((value.lcscPartNumber as string | undefined)?.length ?? 0)
	+ ((value.manufacturerPartNumber as string | undefined)?.length ?? 0)
	+ ((value.package as string | undefined)?.length ?? 0)
	+ value.designators.reduce((sum, item) => sum + item.length, 0));
	return true;
}

function isPayloadIssue(value: unknown): value is BomStockOutPayloadIssue {
	return isRecord(value)
		&& ISSUE_CODES.includes(value.code as BomStockOutIssueCode)
		&& (value.requestedQuantity === undefined || isPositiveSafeInteger(value.requestedQuantity))
		&& (value.availableQuantity === undefined || isNullableNonNegativeSafeInteger(value.availableQuantity));
}

function clonePayloadRow(row: BomStockOutPayloadRow): BomStockOutPayloadRow {
	return { ...row, designators: [...row.designators], issues: row.issues.map(issue => ({ ...issue })) };
}

function cloneRequiredText(value: unknown, budget: { text: number }): string {
	if (!isNonEmptyTrimmedText(value, 16_384))
		throw new TypeError('Invalid BOM stock-out identity name.');
	const result = value.trim().slice(0, MAX_TEXT_LENGTH);
	addBudget(budget, result.length);
	return result;
}

function cloneOptionalText(value: unknown, budget: { text: number }): string | undefined {
	if (value === undefined)
		return undefined;
	if (typeof value !== 'string')
		throw new TypeError('Invalid BOM stock-out identity text.');
	const result = value.trim().slice(0, MAX_TEXT_LENGTH) || undefined;
	addBudget(budget, result?.length ?? 0);
	return result;
}

function cloneDesignators(values: readonly string[], budget: { text: number }): string[] {
	if (!Array.isArray(values) || values.length > MAX_DESIGNATORS_PER_ROW) {
		throw new RangeError('BOM stock-out designator list is too large.');
	}
	return values.map((value) => {
		if (!isNonEmptyTrimmedText(value, MAX_DESIGNATOR_LENGTH))
			throw new TypeError('Invalid BOM designator.');
		const result = value.trim();
		addBudget(budget, result.length);
		return result;
	});
}

function addBudget(budget: { text: number }, length: number): void {
	budget.text += length;
	if (budget.text > MAX_BRIDGE_TEXT)
		throw new RangeError('BOM stock-out report exceeds the bridge text limit.');
}

function isLabels(value: unknown): value is BomStockOutLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isNonEmptyText(value[key], 2000));
}

function isPreviewStatus(value: unknown): value is IFrameBomStockOutRequest['status'] {
	return value === 'ready' || value === 'blocked' || value === 'duplicate';
}

function isPanelStage(value: unknown): value is BomStockOutPanelStage {
	return value === 'script-started' || value === 'request-read' || value === 'panel-rendered';
}

function isNullableNonNegativeSafeInteger(value: unknown): value is number | null {
	return value === null || isSafeNonNegativeInteger(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOptionalText(value: unknown, maximumLength: number): value is string | undefined {
	return value === undefined || isText(value, maximumLength);
}

function isNonEmptyTrimmedText(value: unknown, maximumLength: number): value is string {
	return isNonEmptyText(value, maximumLength) && value.trim().length > 0;
}

function isNonEmptyText(value: unknown, maximumLength: number): value is string {
	return isText(value, maximumLength) && value.length > 0;
}

function isText(value: unknown, maximumLength: number): value is string {
	return typeof value === 'string' && value.length <= maximumLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
