import type {
	BomDiffChangeType,
	BomIdentityField,
	BomRowIssueCode,
} from '../../../features/bom-analysis/domain/bom-analysis';
import type {
	BomDiffPanelActionOutcome,
	BomDiffPanelInput,
} from './bom-diff-panel';

export const BOM_DIFF_IFRAME_ID = 'jlceda-bom-diff-panel';
export const BOM_DIFF_IFRAME_PATH = '/iframe/bom-diff.html';
export const BOM_DIFF_REQUEST_KEY = 'bom-diff-panel.v1.request';
export const BOM_DIFF_EVENT_KEY = 'bom-diff-panel.v1.event';
export const BOM_DIFF_RESPONSE_KEY = 'bom-diff-panel.v1.response';
export const BOM_DIFF_PROTOCOL_VERSION = 1;

const MAX_REPORT_ROWS = 20_000;
const MAX_VALUES_PER_FIELD = 10_000;
const MAX_FILE_NAME_LENGTH = 500;
const MAX_SHEET_NAME_LENGTH = 500;
const MAX_DESIGNATOR_LENGTH = 200;
const MAX_VALUE_LENGTH = 500;
const MAX_BRIDGE_TEXT = 5_000_000;

const CHANGE_TYPES: readonly BomDiffChangeType[] = [
	'added',
	'removed',
	'quantity-increased',
	'quantity-decreased',
	'identity-changed',
];

const IDENTITY_FIELDS: readonly BomIdentityField[] = [
	'name',
	'manufacturerPartNumber',
	'manufacturer',
	'package',
];

const ISSUE_CODES: readonly BomRowIssueCode[] = [
	'invalid-exclusion',
	'invalid-lcsc-part-number',
	'invalid-quantity',
	'missing-identity',
	'missing-lcsc-part-number',
	'missing-quantity',
	'quantity-designator-mismatch',
];

const ISSUE_FIELDS = [
	'lcscPartNumber',
	'designators',
	'quantity',
	'name',
	'manufacturerPartNumber',
	'manufacturer',
	'package',
	'excludeFromBom',
] as const;

const LABEL_KEYS = [
	'title',
	'beforeFile',
	'afterFile',
	'totalChanges',
	'filterChangeType',
	'filterAll',
	'changeAdded',
	'changeRemoved',
	'changeQuantityIncreased',
	'changeQuantityDecreased',
	'changeIdentityChanged',
	'columnPartNumber',
	'columnChangeType',
	'columnBeforeQuantity',
	'columnAfterQuantity',
	'columnQuantityDelta',
	'columnBeforeDesignators',
	'columnAfterDesignators',
	'columnIdentityChanges',
	'identityName',
	'identityManufacturerPartNumber',
	'identityManufacturer',
	'identityPackage',
	'emptyValue',
	'emptyReport',
	'emptyFiltered',
	'reviewTitle',
	'reviewKind',
	'reviewBeforeUnmatched',
	'reviewAfterUnmatched',
	'reviewBeforeIssues',
	'reviewAfterIssues',
	'reviewEmpty',
	'columnSourceRow',
	'columnQuantity',
	'columnDesignators',
	'columnIdentity',
	'columnIssue',
	'columnField',
	'columnValue',
	'issueInvalidExclusion',
	'issueInvalidLcscPartNumber',
	'issueInvalidQuantity',
	'issueMissingIdentity',
	'issueMissingLcscPartNumber',
	'issueMissingQuantity',
	'issueQuantityDesignatorMismatch',
	'fieldLcscPartNumber',
	'fieldDesignators',
	'fieldQuantity',
	'fieldName',
	'fieldManufacturerPartNumber',
	'fieldManufacturer',
	'fieldPackage',
	'fieldExcludeFromBom',
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

export type BomDiffLabels = Record<typeof LABEL_KEYS[number], string>;
export type BomDiffPanelStage = 'panel-rendered' | 'request-read' | 'script-started';
export type BomDiffSummary = Record<BomDiffChangeType, number>;

export interface BomDiffPayloadIdentityChange {
	field: BomIdentityField;
	before: string[];
	after: string[];
}

export interface BomDiffPayloadEntry {
	type: BomDiffChangeType;
	lcscPartNumber: string;
	beforeQuantity: number | null;
	afterQuantity: number | null;
	quantityDelta: number | null;
	beforeDesignators: string[];
	afterDesignators: string[];
	identityChanges: BomDiffPayloadIdentityChange[];
}

export interface BomDiffPayloadUnmatchedRow {
	sheetName: string;
	rowNumber: number;
	quantity: number;
	designators: string[];
	identity: {
		name?: string;
		manufacturerPartNumber?: string;
		manufacturer?: string;
		package?: string;
	};
}

export interface BomDiffPayloadIssue {
	code: BomRowIssueCode;
	sheetName: string;
	rowNumber: number;
	field?: typeof ISSUE_FIELDS[number];
	value?: string;
}

export interface IFrameBomDiffRequest {
	protocolVersion: 1;
	requestId: string;
	labels: BomDiffLabels;
	beforeFileName: string;
	afterFileName: string;
	summary: BomDiffSummary;
	entries: BomDiffPayloadEntry[];
	unmatchedBefore: BomDiffPayloadUnmatchedRow[];
	unmatchedAfter: BomDiffPayloadUnmatchedRow[];
	issuesBefore: BomDiffPayloadIssue[];
	issuesAfter: BomDiffPayloadIssue[];
}

export type IFrameBomDiffEvent
	= | { protocolVersion: 1; requestId: string; status: 'ready' }
		| { protocolVersion: 1; requestId: string; status: 'progress'; stage: BomDiffPanelStage }
		| { protocolVersion: 1; requestId: string; status: 'failed'; stage: BomDiffPanelStage; errorName: string; error: string }
		| {
			protocolVersion: 1;
			requestId: string;
			status: 'action';
			operationId: string;
			action: 'close' | 'export-csv';
		};

export interface IFrameBomDiffResponse {
	protocolVersion: 1;
	requestId: string;
	operationId: string;
	status: 'failed' | 'succeeded';
	message?: string;
}

export function createIFrameBomDiffRequest(
	requestId: string,
	labels: BomDiffLabels,
	input: BomDiffPanelInput,
): IFrameBomDiffRequest {
	if (!isNonEmptyText(requestId, 200) || !isLabels(labels)) {
		throw new TypeError('Invalid BOM diff panel request metadata.');
	}
	const beforeFileName = cleanRequiredText(input.beforeFileName, MAX_FILE_NAME_LENGTH, 'before BOM filename');
	const afterFileName = cleanRequiredText(input.afterFileName, MAX_FILE_NAME_LENGTH, 'after BOM filename');
	const rowCount = input.result.entries.length
		+ input.result.unmatchedBefore.length
		+ input.result.unmatchedAfter.length
		+ input.beforeIssues.length
		+ input.afterIssues.length;
	if (rowCount > MAX_REPORT_ROWS) {
		throw new RangeError(`BOM diff report exceeds the ${MAX_REPORT_ROWS}-row limit.`);
	}
	const budget = { text: beforeFileName.length + afterFileName.length };
	const entries = input.result.entries.map(entry => cloneEntry(entry, budget));
	const unmatchedBefore = input.result.unmatchedBefore.map(row => cloneUnmatchedRow(row, budget));
	const unmatchedAfter = input.result.unmatchedAfter.map(row => cloneUnmatchedRow(row, budget));
	const issuesBefore = input.beforeIssues.map(issue => cloneIssue(issue, budget));
	const issuesAfter = input.afterIssues.map(issue => cloneIssue(issue, budget));
	return {
		protocolVersion: BOM_DIFF_PROTOCOL_VERSION,
		requestId,
		labels: { ...labels },
		beforeFileName,
		afterFileName,
		summary: summarizeEntries(entries),
		entries,
		unmatchedBefore,
		unmatchedAfter,
		issuesBefore,
		issuesAfter,
	};
}

export function parseIFrameBomDiffRequest(value: unknown): IFrameBomDiffRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== BOM_DIFF_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isLabels(value.labels)
		|| !isNonEmptyText(value.beforeFileName, MAX_FILE_NAME_LENGTH)
		|| !isNonEmptyText(value.afterFileName, MAX_FILE_NAME_LENGTH)
		|| !isSummary(value.summary)
		|| !Array.isArray(value.entries)
		|| !Array.isArray(value.unmatchedBefore)
		|| !Array.isArray(value.unmatchedAfter)
		|| !Array.isArray(value.issuesBefore)
		|| !Array.isArray(value.issuesAfter)) {
		return undefined;
	}
	const rowCount = value.entries.length + value.unmatchedBefore.length + value.unmatchedAfter.length
		+ value.issuesBefore.length + value.issuesAfter.length;
	if (rowCount > MAX_REPORT_ROWS) {
		return undefined;
	}
	try {
		const budget = { text: value.beforeFileName.length + value.afterFileName.length };
		if (!value.entries.every(entry => isPayloadEntry(entry, budget))
			|| !value.unmatchedBefore.every(row => isUnmatchedRow(row, budget))
			|| !value.unmatchedAfter.every(row => isUnmatchedRow(row, budget))
			|| !value.issuesBefore.every(issue => isIssue(issue, budget))
			|| !value.issuesAfter.every(issue => isIssue(issue, budget))) {
			return undefined;
		}
		const entries = value.entries.map(clonePayloadEntry);
		if (!summaryEquals(value.summary, summarizeEntries(entries))) {
			return undefined;
		}
		return {
			protocolVersion: BOM_DIFF_PROTOCOL_VERSION,
			requestId: value.requestId,
			labels: { ...value.labels },
			beforeFileName: value.beforeFileName,
			afterFileName: value.afterFileName,
			summary: { ...value.summary },
			entries,
			unmatchedBefore: value.unmatchedBefore.map(clonePayloadUnmatchedRow),
			unmatchedAfter: value.unmatchedAfter.map(clonePayloadUnmatchedRow),
			issuesBefore: value.issuesBefore.map(issue => ({ ...issue })),
			issuesAfter: value.issuesAfter.map(issue => ({ ...issue })),
		};
	}
	catch {
		return undefined;
	}
}

export function parseIFrameBomDiffEvent(value: unknown, requestId: string): IFrameBomDiffEvent | undefined {
	if (!isRecord(value) || value.protocolVersion !== BOM_DIFF_PROTOCOL_VERSION || value.requestId !== requestId) {
		return undefined;
	}
	const base = { protocolVersion: BOM_DIFF_PROTOCOL_VERSION, requestId } as const;
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

export function createIFrameBomDiffResponse(
	requestId: string,
	operationId: string,
	outcome: BomDiffPanelActionOutcome,
): IFrameBomDiffResponse {
	return {
		protocolVersion: BOM_DIFF_PROTOCOL_VERSION,
		requestId,
		operationId,
		status: outcome.status,
		message: outcome.message?.slice(0, 1000),
	};
}

export function parseIFrameBomDiffResponse(
	value: unknown,
	requestId: string,
	operationId: string,
): IFrameBomDiffResponse | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== BOM_DIFF_PROTOCOL_VERSION
		|| value.requestId !== requestId
		|| value.operationId !== operationId
		|| (value.status !== 'failed' && value.status !== 'succeeded')
		|| (value.message !== undefined && !isText(value.message, 1000))
		|| (value.status === 'failed' && !isNonEmptyText(value.message, 1000))) {
		return undefined;
	}
	return {
		protocolVersion: BOM_DIFF_PROTOCOL_VERSION,
		requestId,
		operationId,
		status: value.status,
		message: value.message,
	};
}

function cloneEntry(entry: BomDiffPanelInput['result']['entries'][number], budget: { text: number }): BomDiffPayloadEntry {
	if (!isRecord(entry) || !isChangeType(entry.type) || !/^C\d+$/.test(entry.lcscPartNumber)) {
		throw new TypeError('Invalid BOM diff entry.');
	}
	addTextBudget(budget, entry.lcscPartNumber.length);
	const beforeQuantity = entry.before?.quantity ?? null;
	const afterQuantity = entry.after?.quantity ?? null;
	const quantityDelta = entry.quantityDelta ?? null;
	const result: BomDiffPayloadEntry = {
		type: entry.type,
		lcscPartNumber: entry.lcscPartNumber,
		beforeQuantity,
		afterQuantity,
		quantityDelta,
		beforeDesignators: cloneTextArray(entry.before?.designators ?? [], MAX_DESIGNATOR_LENGTH, budget),
		afterDesignators: cloneTextArray(entry.after?.designators ?? [], MAX_DESIGNATOR_LENGTH, budget),
		identityChanges: (entry.identityChanges ?? []).map(change => ({
			field: change.field,
			before: cloneTextArray(change.before, MAX_VALUE_LENGTH, budget),
			after: cloneTextArray(change.after, MAX_VALUE_LENGTH, budget),
		})),
	};
	if (!isPayloadEntry(result, { text: 0 })) {
		throw new TypeError('Invalid BOM diff entry values.');
	}
	return result;
}

function cloneUnmatchedRow(
	row: BomDiffPanelInput['result']['unmatchedBefore'][number],
	budget: { text: number },
): BomDiffPayloadUnmatchedRow {
	const result: BomDiffPayloadUnmatchedRow = {
		sheetName: cleanRequiredText(row.sheetName, MAX_SHEET_NAME_LENGTH, 'BOM sheet name'),
		rowNumber: row.rowNumber,
		quantity: row.quantity,
		designators: cloneTextArray(row.designators, MAX_DESIGNATOR_LENGTH, budget),
		identity: {
			name: cleanOptionalText(row.identity.name, MAX_VALUE_LENGTH),
			manufacturerPartNumber: cleanOptionalText(row.identity.manufacturerPartNumber, MAX_VALUE_LENGTH),
			manufacturer: cleanOptionalText(row.identity.manufacturer, MAX_VALUE_LENGTH),
			package: cleanOptionalText(row.identity.package, MAX_VALUE_LENGTH),
		},
	};
	addTextBudget(budget, result.sheetName.length + Object.values(result.identity).reduce((sum, text) => sum + (text?.length ?? 0), 0));
	if (!isUnmatchedRow(result, { text: 0 })) {
		throw new TypeError('Invalid unmatched BOM row.');
	}
	return result;
}

function cloneIssue(issue: BomDiffPanelInput['beforeIssues'][number], budget: { text: number }): BomDiffPayloadIssue {
	const result: BomDiffPayloadIssue = {
		code: issue.code,
		sheetName: cleanRequiredText(issue.sheetName, MAX_SHEET_NAME_LENGTH, 'BOM issue sheet name'),
		rowNumber: issue.rowNumber,
		field: issue.field,
		value: cleanOptionalText(issue.value, MAX_VALUE_LENGTH),
	};
	addTextBudget(budget, result.sheetName.length + (result.value?.length ?? 0));
	if (!isIssue(result, { text: 0 })) {
		throw new TypeError('Invalid BOM row issue.');
	}
	return result;
}

function isPayloadEntry(value: unknown, budget: { text: number }): value is BomDiffPayloadEntry {
	if (!isRecord(value)
		|| !isChangeType(value.type)
		|| !isNonEmptyText(value.lcscPartNumber, MAX_VALUE_LENGTH)
		|| !/^C\d+$/.test(value.lcscPartNumber)
		|| !isNullablePositiveSafeInteger(value.beforeQuantity)
		|| !isNullablePositiveSafeInteger(value.afterQuantity)
		|| !isNullableSafeInteger(value.quantityDelta)
		|| !isTextArray(value.beforeDesignators, MAX_DESIGNATOR_LENGTH, budget)
		|| !isTextArray(value.afterDesignators, MAX_DESIGNATOR_LENGTH, budget)
		|| !Array.isArray(value.identityChanges)
		|| value.identityChanges.length > IDENTITY_FIELDS.length
		|| !value.identityChanges.every(change => isIdentityChange(change, budget))
		|| new Set(value.identityChanges.map(change => isRecord(change) ? change.field : undefined)).size
		!== value.identityChanges.length) {
		return false;
	}
	addTextBudget(budget, value.lcscPartNumber.length);
	return hasValidEntryShape(value as unknown as BomDiffPayloadEntry);
}

function hasValidEntryShape(value: BomDiffPayloadEntry): boolean {
	if (value.type === 'added') {
		return value.beforeQuantity === null && value.afterQuantity !== null
			&& value.quantityDelta === value.afterQuantity && value.identityChanges.length === 0;
	}
	if (value.type === 'removed') {
		return value.beforeQuantity !== null && value.afterQuantity === null
			&& value.quantityDelta === -value.beforeQuantity && value.identityChanges.length === 0;
	}
	if (value.type === 'quantity-increased' || value.type === 'quantity-decreased') {
		return value.beforeQuantity !== null && value.afterQuantity !== null
			&& value.quantityDelta === value.afterQuantity - value.beforeQuantity
			&& (value.type === 'quantity-increased' ? value.quantityDelta > 0 : value.quantityDelta < 0)
			&& value.identityChanges.length === 0;
	}
	return value.beforeQuantity !== null && value.afterQuantity !== null
		&& value.quantityDelta === null && value.identityChanges.length > 0;
}

function isIdentityChange(value: unknown, budget: { text: number }): value is BomDiffPayloadIdentityChange {
	return isRecord(value)
		&& IDENTITY_FIELDS.includes(value.field as BomIdentityField)
		&& isTextArray(value.before, MAX_VALUE_LENGTH, budget)
		&& isTextArray(value.after, MAX_VALUE_LENGTH, budget);
}

function isUnmatchedRow(value: unknown, budget: { text: number }): value is BomDiffPayloadUnmatchedRow {
	const identity = isRecord(value) && isRecord(value.identity) ? value.identity : undefined;
	if (!isRecord(value)
		|| !isNonEmptyText(value.sheetName, MAX_SHEET_NAME_LENGTH)
		|| !isPositiveSafeInteger(value.rowNumber)
		|| !isPositiveSafeInteger(value.quantity)
		|| !isTextArray(value.designators, MAX_DESIGNATOR_LENGTH, budget)
		|| !identity
		|| !IDENTITY_FIELDS.every(field => isOptionalText(identity[field], MAX_VALUE_LENGTH))) {
		return false;
	}
	addTextBudget(budget, value.sheetName.length + IDENTITY_FIELDS.reduce(
		(sum, field) => sum + ((identity[field] as string | undefined)?.length ?? 0),
		0,
	));
	return true;
}

function isIssue(value: unknown, budget: { text: number }): value is BomDiffPayloadIssue {
	if (!isRecord(value)
		|| !ISSUE_CODES.includes(value.code as BomRowIssueCode)
		|| !isNonEmptyText(value.sheetName, MAX_SHEET_NAME_LENGTH)
		|| !isPositiveSafeInteger(value.rowNumber)
		|| (value.field !== undefined && !ISSUE_FIELDS.includes(value.field as typeof ISSUE_FIELDS[number]))
		|| !isOptionalText(value.value, MAX_VALUE_LENGTH)) {
		return false;
	}
	addTextBudget(budget, value.sheetName.length + ((value.value as string | undefined)?.length ?? 0));
	return true;
}

function clonePayloadEntry(value: BomDiffPayloadEntry): BomDiffPayloadEntry {
	return {
		...value,
		beforeDesignators: [...value.beforeDesignators],
		afterDesignators: [...value.afterDesignators],
		identityChanges: value.identityChanges.map(change => ({
			field: change.field,
			before: [...change.before],
			after: [...change.after],
		})),
	};
}

function clonePayloadUnmatchedRow(value: BomDiffPayloadUnmatchedRow): BomDiffPayloadUnmatchedRow {
	return { ...value, designators: [...value.designators], identity: { ...value.identity } };
}

function cloneTextArray(value: readonly string[], maximumLength: number, budget: { text: number }): string[] {
	if (!Array.isArray(value) || value.length > MAX_VALUES_PER_FIELD) {
		throw new RangeError(`BOM diff value list exceeds the ${MAX_VALUES_PER_FIELD}-item limit.`);
	}
	return value.map((item) => {
		const text = cleanRequiredText(item, maximumLength, 'BOM diff text');
		addTextBudget(budget, text.length);
		return text;
	});
}

function isTextArray(value: unknown, maximumLength: number, budget: { text: number }): value is string[] {
	if (!Array.isArray(value)
		|| value.length > MAX_VALUES_PER_FIELD
		|| !value.every(item => isNonEmptyText(item, maximumLength))) {
		return false;
	}
	addTextBudget(budget, value.reduce((sum, text) => sum + text.length, 0));
	return true;
}

function summarizeEntries(entries: readonly BomDiffPayloadEntry[]): BomDiffSummary {
	const summary = Object.fromEntries(CHANGE_TYPES.map(type => [type, 0])) as BomDiffSummary;
	for (const entry of entries) {
		summary[entry.type] += 1;
	}
	return summary;
}

function summaryEquals(left: BomDiffSummary, right: BomDiffSummary): boolean {
	return CHANGE_TYPES.every(type => left[type] === right[type]);
}

function isSummary(value: unknown): value is BomDiffSummary {
	return isRecord(value) && CHANGE_TYPES.every(type => isSafeNonNegativeInteger(value[type]));
}

function isLabels(value: unknown): value is BomDiffLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isNonEmptyText(value[key], 2000));
}

function isChangeType(value: unknown): value is BomDiffChangeType {
	return CHANGE_TYPES.includes(value as BomDiffChangeType);
}

function isPanelStage(value: unknown): value is BomDiffPanelStage {
	return value === 'script-started' || value === 'request-read' || value === 'panel-rendered';
}

function cleanRequiredText(value: unknown, maximumLength: number, label: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`Invalid ${label}.`);
	}
	const cleaned = value.trim();
	if (!cleaned || cleaned.length > maximumLength) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return cleaned;
}

function cleanOptionalText(value: unknown, maximumLength: number): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new TypeError('Invalid optional BOM diff text.');
	}
	const cleaned = value.trim();
	if (!cleaned) {
		return undefined;
	}
	if (cleaned.length > maximumLength) {
		throw new RangeError(`BOM diff text exceeds the ${maximumLength}-character limit.`);
	}
	return cleaned;
}

function addTextBudget(budget: { text: number }, length: number): void {
	budget.text += length;
	if (budget.text > MAX_BRIDGE_TEXT) {
		throw new RangeError('The BOM diff report exceeds the IFrame bridge text limit.');
	}
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullablePositiveSafeInteger(value: unknown): value is number | null {
	return value === null || isPositiveSafeInteger(value);
}

function isNullableSafeInteger(value: unknown): value is number | null {
	return value === null || Number.isSafeInteger(value);
}

function isOptionalText(value: unknown, maximumLength: number): value is string | undefined {
	return value === undefined || isText(value, maximumLength);
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
