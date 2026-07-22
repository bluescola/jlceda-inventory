import type {
	BomColumnField,
	BomColumnMapping,
	BomHeaderCandidate,
	ParsedBomFile,
} from '../../../features/bom-analysis/domain/bom-analysis';
import type {
	BomFileMappingSelection,
	BomMappingMode,
	BomMappingPanelInput,
} from './bom-mapping-panel';
import { BOM_COLUMN_FIELDS } from '../../../features/bom-analysis/domain/bom-analysis';

export const BOM_MAPPING_IFRAME_ID = 'jlceda-bom-mapping-panel';
export const BOM_MAPPING_IFRAME_PATH = '/iframe/bom-mapping.html';
export const BOM_MAPPING_REQUEST_KEY = 'bom-mapping-panel.v1.request';
export const BOM_MAPPING_RESULT_KEY = 'bom-mapping-panel.v1.result';
export const BOM_MAPPING_PROTOCOL_VERSION = 1;

export const MAX_BOM_MAPPING_FILES = 2;
export const MAX_BOM_MAPPING_SHEETS = 32;
export const MAX_BOM_MAPPING_HEADER_ROWS = 100;
export const MAX_BOM_MAPPING_PREVIEW_ROWS = 106;
export const MAX_BOM_MAPPING_COLUMNS = 128;
export const MAX_BOM_MAPPING_BRIDGE_CELLS = 50_000;
export const MAX_BOM_MAPPING_BRIDGE_TEXT = 1_000_000;

const MAX_FILE_NAME_LENGTH = 500;
const MAX_SHEET_NAME_LENGTH = 500;
const MAX_CELL_LENGTH = 500;
const MAX_WORKSHEET_ROWS = 10_100;

const LABEL_KEYS = [
	'titleStockCheck',
	'titleCompare',
	'file',
	'format',
	'worksheet',
	'headerCandidate',
	'headerRow',
	'detectedCandidate',
	'manualHeader',
	'noCandidate',
	'mapping',
	'mappingHint',
	'notMapped',
	'rawPreview',
	'duplicateWarning',
	'duplicateAssignmentWarning',
	'fieldLcscPartNumber',
	'fieldDesignators',
	'fieldQuantity',
	'fieldName',
	'fieldManufacturerPartNumber',
	'fieldManufacturer',
	'fieldPackage',
	'fieldExcludeFromBom',
	'columnFallback',
	'cancel',
	'confirm',
	'loading',
	'connectionError',
	'saveError',
] as const;

export type BomMappingLabels = Record<typeof LABEL_KEYS[number], string>;
export type BomMappingPanelStage = 'panel-rendered' | 'request-read' | 'script-started';

export interface IFrameBomMappingHeaderCandidate {
	rowIndex: number;
	rowNumber: number;
	score: number;
	recognizedColumnCount: number;
	suggestedMapping: BomColumnMapping;
	duplicateFields: BomColumnField[];
}

export interface IFrameBomMappingSheet {
	name: string;
	rowCount: number;
	columnCount: number;
	rows: string[][];
	headerCandidates: IFrameBomMappingHeaderCandidate[];
}

export interface IFrameBomMappingFile {
	fileName: string;
	format: ParsedBomFile['format'];
	encoding?: ParsedBomFile['encoding'];
	sheets: IFrameBomMappingSheet[];
}

export interface IFrameBomMappingRequest {
	protocolVersion: 1;
	requestId: string;
	mode: BomMappingMode;
	labels: BomMappingLabels;
	files: IFrameBomMappingFile[];
}

export type IFrameBomMappingResult
	= | { protocolVersion: 1; requestId: string; status: 'ready' | 'cancelled' }
		| { protocolVersion: 1; requestId: string; status: 'progress'; stage: BomMappingPanelStage }
		| {
			protocolVersion: 1;
			requestId: string;
			status: 'failed';
			stage: BomMappingPanelStage;
			errorName: string;
			error: string;
		}
		| {
			protocolVersion: 1;
			requestId: string;
			status: 'submitted';
			files: BomFileMappingSelection[];
		};

export function createIFrameBomMappingRequest(
	requestId: string,
	labels: BomMappingLabels,
	input: BomMappingPanelInput,
): IFrameBomMappingRequest {
	assertPanelInput(input);
	const budget = { cells: 0, text: 0 };
	const files = input.files.map(file => cloneFileForBridge(file, budget));
	return {
		protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
		requestId: assertText(requestId, 'request ID', 200),
		mode: input.mode,
		labels: cloneLabels(labels),
		files,
	};
}

export function parseIFrameBomMappingRequest(value: unknown): IFrameBomMappingRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== BOM_MAPPING_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isMode(value.mode)
		|| !isLabels(value.labels)
		|| !Array.isArray(value.files)
		|| !hasExpectedFileCount(value.mode, value.files.length)) {
		return undefined;
	}
	const budget = { cells: 0, text: 0 };
	if (!value.files.every(file => isBridgeFile(file, budget))) {
		return undefined;
	}
	return {
		protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
		requestId: value.requestId,
		mode: value.mode,
		labels: { ...value.labels },
		files: value.files.map(cloneBridgeFile),
	};
}

export function parseIFrameBomMappingResult(
	value: unknown,
	request: Pick<IFrameBomMappingRequest, 'files' | 'requestId'>,
): IFrameBomMappingResult | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== BOM_MAPPING_PROTOCOL_VERSION
		|| value.requestId !== request.requestId) {
		return undefined;
	}
	const base = { protocolVersion: BOM_MAPPING_PROTOCOL_VERSION, requestId: request.requestId } as const;
	if (value.status === 'ready' || value.status === 'cancelled') {
		return { ...base, status: value.status };
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
	if (value.status !== 'submitted'
		|| !Array.isArray(value.files)
		|| value.files.length !== request.files.length) {
		return undefined;
	}
	const selections = value.files.map((selection, fileIndex) => parseSelection(selection, fileIndex, request.files[fileIndex]));
	if (selections.includes(undefined)) {
		return undefined;
	}
	return { ...base, status: 'submitted', files: selections as BomFileMappingSelection[] };
}

function assertPanelInput(input: BomMappingPanelInput): void {
	if (!isMode(input.mode) || !Array.isArray(input.files) || !hasExpectedFileCount(input.mode, input.files.length)) {
		throw new TypeError('Stock checks require one BOM file and comparisons require two BOM files.');
	}
}

function cloneFileForBridge(
	file: ParsedBomFile,
	budget: { cells: number; text: number },
): IFrameBomMappingFile {
	if (!isRecord(file)
		|| !isNonEmptyText(file.fileName, MAX_FILE_NAME_LENGTH)
		|| !isFormat(file.format)
		|| !Array.isArray(file.sheets)
		|| file.sheets.length < 1
		|| file.sheets.length > MAX_BOM_MAPPING_SHEETS) {
		throw new TypeError('Invalid parsed BOM file for the mapping panel.');
	}
	return {
		fileName: file.fileName,
		format: file.format,
		encoding: file.encoding,
		sheets: file.sheets.map((sheet) => {
			if (!isRecord(sheet)
				|| !isNonEmptyText(sheet.name, MAX_SHEET_NAME_LENGTH)
				|| !Array.isArray(sheet.rows)
				|| sheet.rows.length < 1
				|| sheet.rows.length > MAX_WORKSHEET_ROWS) {
				throw new TypeError('Invalid BOM worksheet for the mapping panel.');
			}
			const columnCount = sheet.rows.reduce((maximum, row) => {
				if (!Array.isArray(row) || row.length > MAX_BOM_MAPPING_COLUMNS || !row.every(cell => typeof cell === 'string')) {
					throw new TypeError('Invalid BOM worksheet row for the mapping panel.');
				}
				return Math.max(maximum, row.length);
			}, 0);
			if (columnCount < 1) {
				throw new TypeError('A BOM worksheet must contain at least one column.');
			}
			const rows = sheet.rows.slice(0, MAX_BOM_MAPPING_PREVIEW_ROWS).map(row => row.map((cell) => {
				const display = cell.slice(0, MAX_CELL_LENGTH);
				budget.cells += 1;
				budget.text += display.length;
				assertBridgeBudget(budget);
				return display;
			}));
			if (!Array.isArray(sheet.headerCandidates) || sheet.headerCandidates.length > MAX_BOM_MAPPING_HEADER_ROWS) {
				throw new TypeError('Invalid BOM header candidates for the mapping panel.');
			}
			const headerCandidates = sheet.headerCandidates.map(candidate => cloneCandidate(candidate, sheet.rows.length, columnCount));
			return {
				name: sheet.name,
				rowCount: sheet.rows.length,
				columnCount,
				rows,
				headerCandidates,
			};
		}),
	};
}

function cloneCandidate(
	candidate: BomHeaderCandidate,
	rowCount: number,
	columnCount: number,
): IFrameBomMappingHeaderCandidate {
	if (!isRecord(candidate)
		|| !isHeaderRowIndex(candidate.rowIndex, rowCount)
		|| candidate.rowNumber !== candidate.rowIndex + 1
		|| !Number.isSafeInteger(candidate.score)
		|| !isIndexWithin(candidate.recognizedColumnCount, MAX_BOM_MAPPING_COLUMNS + 1)
		|| !isColumnMapping(candidate.suggestedMapping, columnCount, true)
		|| !isFieldArray(candidate.duplicateFields)) {
		throw new TypeError('Invalid BOM header candidate for the mapping panel.');
	}
	return {
		rowIndex: candidate.rowIndex,
		rowNumber: candidate.rowNumber,
		score: candidate.score,
		recognizedColumnCount: candidate.recognizedColumnCount,
		suggestedMapping: { ...candidate.suggestedMapping },
		duplicateFields: [...candidate.duplicateFields],
	};
}

function isBridgeFile(value: unknown, budget: { cells: number; text: number }): value is IFrameBomMappingFile {
	if (!isRecord(value)
		|| !isNonEmptyText(value.fileName, MAX_FILE_NAME_LENGTH)
		|| !isFormat(value.format)
		|| !isEncoding(value.encoding)
		|| !Array.isArray(value.sheets)
		|| value.sheets.length < 1
		|| value.sheets.length > MAX_BOM_MAPPING_SHEETS) {
		return false;
	}
	return value.sheets.every(sheet => isBridgeSheet(sheet, budget));
}

function isBridgeSheet(value: unknown, budget: { cells: number; text: number }): value is IFrameBomMappingSheet {
	if (!isRecord(value)
		|| !isNonEmptyText(value.name, MAX_SHEET_NAME_LENGTH)
		|| !isPositiveSafeInteger(value.rowCount)
		|| value.rowCount > MAX_WORKSHEET_ROWS
		|| !isPositiveSafeInteger(value.columnCount)
		|| value.columnCount > MAX_BOM_MAPPING_COLUMNS
		|| !Array.isArray(value.rows)
		|| value.rows.length !== Math.min(value.rowCount, MAX_BOM_MAPPING_PREVIEW_ROWS)
		|| !Array.isArray(value.headerCandidates)
		|| value.headerCandidates.length > MAX_BOM_MAPPING_HEADER_ROWS) {
		return false;
	}
	const rowCount = value.rowCount;
	const columnCount = value.columnCount;
	for (const row of value.rows) {
		if (!Array.isArray(row)
			|| row.length > columnCount
			|| !row.every(cell => isText(cell, MAX_CELL_LENGTH))) {
			return false;
		}
		budget.cells += row.length;
		budget.text += row.reduce((total, cell) => total + cell.length, 0);
		if (!isBridgeBudgetValid(budget)) {
			return false;
		}
	}
	return value.headerCandidates.every(candidate => isCandidate(candidate, rowCount, columnCount));
}

function isCandidate(value: unknown, rowCount: number, columnCount: number): value is IFrameBomMappingHeaderCandidate {
	return isRecord(value)
		&& isHeaderRowIndex(value.rowIndex, rowCount)
		&& value.rowNumber === value.rowIndex + 1
		&& Number.isSafeInteger(value.score)
		&& isIndexWithin(value.recognizedColumnCount, MAX_BOM_MAPPING_COLUMNS + 1)
		&& isColumnMapping(value.suggestedMapping, columnCount, true)
		&& isFieldArray(value.duplicateFields);
}

function parseSelection(
	value: unknown,
	expectedFileIndex: number,
	file: IFrameBomMappingFile,
): BomFileMappingSelection | undefined {
	if (!isRecord(value)
		|| value.fileIndex !== expectedFileIndex
		|| !isIndexWithin(value.sheetIndex, file.sheets.length)) {
		return undefined;
	}
	const sheet = file.sheets[value.sheetIndex];
	if (!isHeaderRowIndex(value.headerRowIndex, sheet.rowCount)
		|| !isColumnMapping(value.mapping, sheet.columnCount, true)) {
		return undefined;
	}
	return {
		fileIndex: expectedFileIndex,
		sheetIndex: value.sheetIndex,
		headerRowIndex: value.headerRowIndex,
		mapping: { ...value.mapping },
	};
}

function isColumnMapping(value: unknown, columnCount: number, unique: boolean): value is BomColumnMapping {
	if (!isRecord(value)) {
		return false;
	}
	const keys = Object.keys(value);
	if (!keys.every(key => BOM_COLUMN_FIELDS.includes(key as BomColumnField))) {
		return false;
	}
	const columns = keys.map(key => value[key]);
	return columns.every(column => isIndexWithin(column, columnCount))
		&& (!unique || new Set(columns).size === columns.length);
}

function isFieldArray(value: unknown): value is BomColumnField[] {
	return Array.isArray(value)
		&& value.length <= BOM_COLUMN_FIELDS.length
		&& value.every(field => BOM_COLUMN_FIELDS.includes(field as BomColumnField))
		&& new Set(value).size === value.length;
}

function cloneBridgeFile(file: IFrameBomMappingFile): IFrameBomMappingFile {
	return {
		fileName: file.fileName,
		format: file.format,
		encoding: file.encoding,
		sheets: file.sheets.map(sheet => ({
			name: sheet.name,
			rowCount: sheet.rowCount,
			columnCount: sheet.columnCount,
			rows: sheet.rows.map(row => [...row]),
			headerCandidates: sheet.headerCandidates.map(candidate => ({
				...candidate,
				suggestedMapping: { ...candidate.suggestedMapping },
				duplicateFields: [...candidate.duplicateFields],
			})),
		})),
	};
}

function cloneLabels(labels: BomMappingLabels): BomMappingLabels {
	if (!isLabels(labels)) {
		throw new TypeError('Invalid BOM mapping panel labels.');
	}
	return { ...labels };
}

function isLabels(value: unknown): value is BomMappingLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isText(value[key], 500));
}

function hasExpectedFileCount(mode: BomMappingMode, count: number): boolean {
	return mode === 'stock-check' ? count === 1 : count === MAX_BOM_MAPPING_FILES;
}

function isMode(value: unknown): value is BomMappingMode {
	return value === 'stock-check' || value === 'compare';
}

function isFormat(value: unknown): value is ParsedBomFile['format'] {
	return value === 'csv' || value === 'txt' || value === 'xls' || value === 'xlsx';
}

function isEncoding(value: unknown): value is ParsedBomFile['encoding'] {
	return value === undefined
		|| value === 'utf-8'
		|| value === 'utf-16le'
		|| value === 'utf-16be'
		|| value === 'gb18030';
}

function isPanelStage(value: unknown): value is BomMappingPanelStage {
	return value === 'script-started' || value === 'request-read' || value === 'panel-rendered';
}

function isHeaderRowIndex(value: unknown, rowCount: number): value is number {
	return isIndexWithin(value, Math.min(rowCount, MAX_BOM_MAPPING_HEADER_ROWS));
}

function isIndexWithin(value: unknown, upperBound: number): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < upperBound;
}

function isPositiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}

function assertBridgeBudget(budget: { cells: number; text: number }): void {
	if (!isBridgeBudgetValid(budget)) {
		throw new RangeError('The BOM mapping preview exceeds the IFrame bridge size limit.');
	}
}

function isBridgeBudgetValid(budget: { cells: number; text: number }): boolean {
	return budget.cells <= MAX_BOM_MAPPING_BRIDGE_CELLS && budget.text <= MAX_BOM_MAPPING_BRIDGE_TEXT;
}

function assertText(value: unknown, label: string, maximumLength: number): string {
	if (!isNonEmptyText(value, maximumLength)) {
		throw new TypeError(`Invalid ${label}.`);
	}
	return value;
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
