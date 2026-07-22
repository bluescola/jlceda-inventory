import type { BomSheet, ParsedBomFile } from '../domain/bom-analysis';
import Papa from 'papaparse';
import { read, utils } from 'xlsx';
import { normalizeInventoryText } from '../../inventory/domain/inventory-item';
import { findBomHeaderCandidates, MAX_BOM_HEADER_SCAN_ROWS } from './bom-column-mapping';

export const MAX_BOM_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BOM_WORKSHEETS = 32;
export const MAX_BOM_COLUMNS = 128;
export const MAX_BOM_DATA_ROWS = 10_000;
export const MAX_BOM_WORKSHEET_ROWS = MAX_BOM_HEADER_SCAN_ROWS + MAX_BOM_DATA_ROWS;

export function readBomFile(fileName: string, content: string | ArrayBuffer): ParsedBomFile {
	assertFileSize(content);
	const extension = fileName.split('.').pop()?.toLocaleLowerCase();
	if (extension === 'csv' || extension === 'txt') {
		const decoded = readTextContent(content, extension.toUpperCase());
		const rows = parseDelimitedText(decoded.text);
		return {
			fileName,
			format: extension,
			encoding: decoded.encoding,
			sheets: rows.length > 0 ? [createSheet(fileName, rows)] : [],
		};
	}
	if (extension === 'xls' || extension === 'xlsx') {
		if (typeof content === 'string') {
			throw new TypeError('Excel BOM content must be provided as an ArrayBuffer.');
		}
		return { fileName, format: extension, sheets: parseWorkbook(content) };
	}
	throw new Error(`Unsupported BOM file type: ${extension ? `.${extension}` : 'missing extension'}`);
}

function parseDelimitedText(text: string): string[][] {
	const result = Papa.parse<string[]>(text, { skipEmptyLines: false });
	const fatalError = result.errors.find(error => error.code !== 'UndetectableDelimiter');
	if (fatalError) {
		throw new Error(`${fatalError.message} (row ${fatalError.row ?? '?'})`);
	}
	return normalizeMatrix(result.data, 'text BOM');
}

function parseWorkbook(content: ArrayBuffer): BomSheet[] {
	let workbook;
	try {
		workbook = read(content, {
			type: 'array',
			dense: true,
			cellDates: false,
			nodim: true,
			sheetRows: MAX_BOM_WORKSHEET_ROWS + 1,
		});
	}
	catch (error) {
		throw new Error(`Unable to read BOM workbook: ${readErrorMessage(error)}`);
	}
	if (workbook.SheetNames.length > MAX_BOM_WORKSHEETS) {
		throw new Error(`BOM workbook exceeds the ${MAX_BOM_WORKSHEETS}-worksheet limit.`);
	}
	const sheets: BomSheet[] = [];
	for (const sheetName of workbook.SheetNames) {
		const sheet = workbook.Sheets[sheetName];
		const reference = sheet?.['!fullref'] ?? sheet?.['!ref'];
		if (!sheet || !reference) {
			continue;
		}
		const range = readSheetRange(reference, sheetName);
		assertSheetBounds(range, sheetName);
		const matrix = utils.sheet_to_json<unknown[]>(sheet, {
			header: 1,
			raw: false,
			defval: '',
			blankrows: true,
		});
		const rows = normalizeMatrix(matrix, `worksheet "${sheetName}"`);
		if (rows.length > 0 && rows.some(row => row.some(Boolean))) {
			sheets.push(createSheet(sheetName, rows));
		}
	}
	return sheets;
}

function createSheet(name: string, rows: string[][]): BomSheet {
	return { name, rows, headerCandidates: findBomHeaderCandidates(rows) };
}

function normalizeMatrix(rows: readonly (readonly unknown[])[], label: string): string[][] {
	if (rows.length > MAX_BOM_WORKSHEET_ROWS) {
		throw new Error(`${label} exceeds the ${MAX_BOM_DATA_ROWS}-data-row limit.`);
	}
	const normalized = rows.map((source, rowIndex) => {
		if (source.length > MAX_BOM_COLUMNS) {
			throw new Error(`${label} row ${rowIndex + 1} exceeds the ${MAX_BOM_COLUMNS}-column limit.`);
		}
		const row = source.map(value => normalizeInventoryText(value === undefined || value === null ? '' : String(value)));
		while (row.at(-1) === '') {
			row.pop();
		}
		return row;
	});
	while (normalized.at(-1)?.length === 0) {
		normalized.pop();
	}
	return normalized;
}

function assertFileSize(content: string | ArrayBuffer): void {
	const byteLength = typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.byteLength;
	if (byteLength > MAX_BOM_FILE_BYTES) {
		throw new Error(`BOM file exceeds the ${MAX_BOM_FILE_BYTES / 1024 / 1024} MB limit.`);
	}
}

function readTextContent(
	content: string | ArrayBuffer,
	kind: string,
): { text: string; encoding?: ParsedBomFile['encoding'] } {
	if (typeof content === 'string') {
		return { text: content };
	}
	const bytes = new Uint8Array(content);
	const bom = detectTextBom(bytes);
	if (bom) {
		return {
			text: new TextDecoder(bom.encoding, { fatal: true }).decode(bytes.subarray(bom.offset)),
			encoding: bom.encoding,
		};
	}
	for (const encoding of ['utf-8', 'gb18030'] as const) {
		try {
			return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), encoding };
		}
		catch {
			// Try the next supported BOM text encoding.
		}
	}
	throw new Error(`${kind} content is not valid UTF-8, UTF-16, or GB18030 text.`);
}

function detectTextBom(
	bytes: Uint8Array,
): { encoding: 'utf-16be' | 'utf-16le' | 'utf-8'; offset: number } | undefined {
	if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
		return { encoding: 'utf-8', offset: 3 };
	}
	if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
		return { encoding: 'utf-16le', offset: 2 };
	}
	if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
		return { encoding: 'utf-16be', offset: 2 };
	}
	return undefined;
}

function readSheetRange(reference: string, sheetName: string): ReturnType<typeof utils.decode_range> {
	try {
		return utils.decode_range(reference);
	}
	catch (error) {
		throw new Error(`Worksheet "${sheetName}" has an invalid cell range.`, { cause: error });
	}
}

function assertSheetBounds(range: ReturnType<typeof utils.decode_range>, sheetName: string): void {
	const rowCount = range.e.r - range.s.r + 1;
	const columnCount = range.e.c - range.s.c + 1;
	if (rowCount > MAX_BOM_WORKSHEET_ROWS) {
		throw new Error(`Worksheet "${sheetName}" exceeds the ${MAX_BOM_DATA_ROWS}-data-row limit.`);
	}
	if (columnCount > MAX_BOM_COLUMNS) {
		throw new Error(`Worksheet "${sheetName}" exceeds the ${MAX_BOM_COLUMNS}-column limit.`);
	}
}

function readErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
