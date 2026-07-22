import type { NewInventoryItem, QuantityPrecision, StockState } from '../../inventory/domain/inventory-item';
import type { ImportDefaultState, ParsedOrderRow } from '../domain/order-import';
import Papa from 'papaparse';
import { read, utils } from 'xlsx';
import { normalizeInventoryText } from '../../inventory/domain/inventory-item';

type SourceRow = Record<string, unknown>;

export const MAX_ORDER_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ORDER_IMPORT_FILES = 100;
const MAX_WORKSHEETS = 32;
const MAX_WORKSHEET_COLUMNS = 128;
const MAX_HEADER_SCAN_ROWS = 100;
const MAX_DATA_ROWS = 10_000;
const MAX_WORKSHEET_ROWS = MAX_HEADER_SCAN_ROWS + MAX_DATA_ROWS;

const HEADERS = {
	lcsc: ['c编号', '立创编号', '立创商城编号', 'lcsc', 'lcscpart', 'lcscpartnumber', 'supplierpartnumber', '供应商编号', '商品编号'],
	name: ['name', 'component', 'componentname', 'product', 'productname', '元器件名称', '器件名称', '商品名称', '名称'],
	quantity: ['订购数量（修改后）', '订购数量修改后', 'quantity', 'qty', 'count', '数量', '购买数量', '商品数量', '订购数量'],
	manufacturer: ['manufacturer', 'mfr', '制造商', '品牌'],
	manufacturerPart: ['manufacturerpartnumber', 'manufacturerpart', 'mpn', 'partnumber', '厂家型号', '制造商编号', '型号'],
	package: ['package', 'footprint', '封装', '封装规格'],
	location: ['location', 'storage', 'bin', '仓位', '存放位置', '位置'],
	note: ['note', 'remark', 'remarks', '备注'],
	precision: ['precision', 'quantitytype', 'estimated', 'approximate', '数量类型', '大概数量', '估算'],
	state: ['state', 'status', 'depleted', 'usedup', 'used', '状态', '是否用完', '已用完'],
	doNotShip: ['donotship', 'skip', '是否不发此货', '不发此货'],
} as const;

type HeaderGroup = keyof typeof HEADERS;

const HEADER_GROUPS = (Object.entries(HEADERS) as Array<[HeaderGroup, readonly string[]]>).map(([group, aliases]) => ({
	group,
	aliases: new Set(aliases.map(normalizeHeader)),
}));

const IDENTITY_HEADER_GROUPS = new Set<HeaderGroup>(['lcsc', 'name', 'manufacturerPart']);

export function parseOrderFile(
	fileName: string,
	content: string | ArrayBuffer,
	defaultState: ImportDefaultState = 'in-stock',
): ParsedOrderRow[] {
	assertFileSize(content);
	const extension = fileName.split('.').pop()?.toLowerCase();

	if (extension === 'json') {
		return mapStructuredRows(parseJson(readTextContent(content, 'JSON')), defaultState);
	}
	if (extension === 'csv') {
		return mapStructuredRows(parseCsv(readTextContent(content, 'CSV')), defaultState);
	}
	if (extension === 'xls' || extension === 'xlsx') {
		if (typeof content === 'string') {
			throw new TypeError('Excel content must be provided as an ArrayBuffer.');
		}
		return parseWorkbook(content, defaultState);
	}

	throw new Error(`Unsupported order file type: ${extension ? `.${extension}` : 'missing extension'}`);
}

function parseCsv(text: string): SourceRow[] {
	const result = Papa.parse<Record<string, string>>(text, {
		header: true,
		skipEmptyLines: 'greedy',
		transformHeader: normalizeInventoryText,
	});
	const fatalError = result.errors.find(error => error.code !== 'UndetectableDelimiter');
	if (fatalError) {
		throw new Error(`${fatalError.message} (row ${fatalError.row ?? '?'})`);
	}
	return result.data;
}

function parseJson(text: string): SourceRow[] {
	const parsed: unknown = JSON.parse(text);
	const rows = Array.isArray(parsed)
		? parsed
		: readJsonRows(parsed);
	if (!Array.isArray(rows)) {
		throw new TypeError('JSON must be an array or contain an items, rows, or data array.');
	}
	return rows.filter((row): row is SourceRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
}

function readJsonRows(value: unknown): unknown[] | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	for (const key of ['items', 'rows', 'data']) {
		if (Array.isArray(record[key])) {
			return record[key];
		}
	}
	return undefined;
}

function parseWorkbook(content: ArrayBuffer, defaultState: ImportDefaultState): ParsedOrderRow[] {
	let workbook;
	try {
		workbook = read(content, {
			type: 'array',
			dense: true,
			cellDates: false,
			nodim: true,
			sheetRows: MAX_WORKSHEET_ROWS + 1,
		});
	}
	catch (error) {
		throw new Error(`Unable to read Excel workbook: ${readErrorMessage(error)}`);
	}

	if (workbook.SheetNames.length > MAX_WORKSHEETS) {
		throw new Error(`Excel workbook exceeds the ${MAX_WORKSHEETS}-worksheet limit.`);
	}

	const seenSheets = new Set<string>();
	let foundHeader = false;
	let selectedRows: ParsedOrderRow[] | undefined;
	let firstCandidateError: unknown;

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
		if (!matrix.some(hasValues)) {
			continue;
		}

		const fingerprint = fingerprintSheet(matrix);
		if (seenSheets.has(fingerprint)) {
			continue;
		}
		seenSheets.add(fingerprint);

		const headerIndex = findHeaderIndex(matrix);
		if (headerIndex === undefined) {
			continue;
		}
		foundHeader = true;

		try {
			const candidateRows = parseWorksheetRows(matrix, headerIndex, range.s.r, sheetName, defaultState);
			if (!selectedRows || candidateRows.length > selectedRows.length) {
				selectedRows = candidateRows;
			}
		}
		catch (error) {
			firstCandidateError ??= error;
		}
	}

	if (!foundHeader) {
		throw new Error('No recognizable order header was found in the Excel workbook.');
	}
	if ((selectedRows?.length ?? 0) === 0 && firstCandidateError) {
		throw firstCandidateError;
	}
	return selectedRows ?? [];
}

function mapStructuredRows(rows: SourceRow[], defaultState: ImportDefaultState): ParsedOrderRow[] {
	if (rows.length > MAX_DATA_ROWS) {
		throw new Error(`Order import exceeds the ${MAX_DATA_ROWS}-row limit.`);
	}
	return rows.flatMap((row, index) => {
		if (Object.keys(row).length > MAX_WORKSHEET_COLUMNS) {
			throw new Error(`Order row ${index + 2} exceeds the ${MAX_WORKSHEET_COLUMNS}-column limit.`);
		}
		const parsed = mapRow(row, index + 2, defaultState);
		return parsed ? [parsed] : [];
	});
}

function mapRow(
	source: SourceRow,
	rowNumber: number,
	defaultState: ImportDefaultState,
	sourceLabel = `row ${rowNumber}`,
): ParsedOrderRow | undefined {
	const row = normalizeRow(source);
	if (parseBoolean(readString(row, HEADERS.doNotShip)) === true) {
		return undefined;
	}
	const lcscPartNumber = readString(row, HEADERS.lcsc);
	const manufacturerPartNumber = readString(row, HEADERS.manufacturerPart);
	const rawName = readString(row, HEADERS.name);
	if (!lcscPartNumber && !manufacturerPartNumber && !rawName) {
		return undefined;
	}

	const rawQuantity = readString(row, HEADERS.quantity);
	const precision = parsePrecision(readString(row, HEADERS.precision), rawQuantity);
	const quantity = parseQuantity(rawQuantity, precision, sourceLabel);
	const rawState = readString(row, HEADERS.state);
	const state = parseState(rawState) ?? defaultState;
	const item: NewInventoryItem = {
		identity: {
			name: rawName ?? manufacturerPartNumber ?? lcscPartNumber ?? `Row ${rowNumber}`,
			lcscPartNumber,
			supplierId: lcscPartNumber,
			manufacturerPartNumber,
			manufacturer: readString(row, HEADERS.manufacturer),
			package: readString(row, HEADERS.package),
		},
		quantity: state === 'depleted' ? 0 : quantity,
		precision: state === 'depleted' ? 'exact' : precision,
		state,
		location: readString(row, HEADERS.location),
		note: readString(row, HEADERS.note),
		source: 'order',
	};
	return { rowNumber, item, hasExplicitState: rawState !== undefined };
}

function normalizeRow(source: SourceRow): Record<string, unknown> {
	return Object.fromEntries(Object.entries(source).map(([key, value]) => [normalizeHeader(key), value]));
}

function normalizeHeader(value: string): string {
	return normalizeInventoryText(value).toLowerCase().replaceAll(/[\s_#()（）./\\-]+/g, '');
}

function readString(row: Record<string, unknown>, aliases: readonly string[]): string | undefined {
	for (const alias of aliases) {
		const value = row[normalizeHeader(alias)];
		if (value !== undefined && value !== null) {
			const cleaned = normalizeInventoryText(String(value));
			if (cleaned) {
				return cleaned;
			}
		}
	}
	return undefined;
}

function parseQuantity(value: string | undefined, precision: QuantityPrecision, sourceLabel: string): number | null {
	if (precision === 'unknown') {
		return null;
	}
	const normalized = value
		? normalizeInventoryText(value).replaceAll(/[,，\s]/g, '')
		: '';
	if (!normalized) {
		return null;
	}
	const match = normalized.match(/^(\d+(?:\.0+)?)(?:[个件只片颗支]|pcs?|ea|pieces?)?$/i);
	const quantity = match ? Number(match[1]) : Number.NaN;
	if (!Number.isSafeInteger(quantity) || quantity < 0) {
		throw new Error(`Invalid quantity at ${sourceLabel}: ${value}`);
	}
	return quantity;
}

function parsePrecision(value: string | undefined, quantity: string | undefined): QuantityPrecision {
	if (!quantity?.trim()) {
		return 'unknown';
	}
	const normalized = value?.trim().toLowerCase();
	if (normalized && ['estimated', 'estimate', 'approx', 'approximate', 'true', 'yes', '是', '大概', '估算'].includes(normalized)) {
		return 'estimated';
	}
	return 'exact';
}

function parseState(value: string | undefined): StockState | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	if (['depleted', 'used', 'usedup', 'empty', '0', 'true', 'yes', '是', '已用完', '用完'].includes(normalized)) {
		return 'depleted';
	}
	if (['in-stock', 'instock', 'available', '1', 'false', 'no', '否', '有库存', '未用完'].includes(normalized)) {
		return 'in-stock';
	}
	return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	if (['true', 'yes', '1', '是', '不发', '不发此货'].includes(normalized)) {
		return true;
	}
	if (['false', 'no', '0', '否', '正常发货'].includes(normalized)) {
		return false;
	}
	return undefined;
}

function assertFileSize(content: string | ArrayBuffer): void {
	const byteLength = typeof content === 'string'
		? new TextEncoder().encode(content).byteLength
		: content.byteLength;
	if (byteLength > MAX_ORDER_FILE_BYTES) {
		throw new Error(`Order file exceeds the ${MAX_ORDER_FILE_BYTES / 1024 / 1024} MB limit.`);
	}
}

function readTextContent(content: string | ArrayBuffer, kind: string): string {
	if (typeof content === 'string') {
		return content;
	}
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(content);
	}
	catch {
		throw new Error(`${kind} content is not valid UTF-8 text.`);
	}
}

function readSheetRange(reference: string, sheetName: string): ReturnType<typeof utils.decode_range> {
	try {
		return utils.decode_range(reference);
	}
	catch {
		throw new Error(`Worksheet "${sheetName}" has an invalid cell range.`);
	}
}

function assertSheetBounds(range: ReturnType<typeof utils.decode_range>, sheetName: string): void {
	const rowCount = range.e.r - range.s.r + 1;
	const columnCount = range.e.c - range.s.c + 1;
	if (rowCount > MAX_WORKSHEET_ROWS) {
		throw new Error(`Worksheet "${sheetName}" exceeds the ${MAX_WORKSHEET_ROWS}-row limit.`);
	}
	if (columnCount > MAX_WORKSHEET_COLUMNS) {
		throw new Error(`Worksheet "${sheetName}" exceeds the ${MAX_WORKSHEET_COLUMNS}-column limit.`);
	}
}

function findHeaderIndex(matrix: unknown[][]): number | undefined {
	let bestIndex: number | undefined;
	let bestScore = 0;
	for (let index = 0; index < Math.min(matrix.length, MAX_HEADER_SCAN_ROWS); index += 1) {
		const match = matchHeaderGroups(matrix[index]);
		if (match.hasIdentity && match.hasQuantity && match.score > bestScore) {
			bestIndex = index;
			bestScore = match.score;
		}
	}
	return bestIndex;
}

function isHeaderLike(values: unknown[]): boolean {
	const match = matchHeaderGroups(values);
	return match.hasIdentity && match.hasQuantity;
}

function matchHeaderGroups(values: unknown[]): { hasIdentity: boolean; hasQuantity: boolean; score: number } {
	const cells = new Set(values.map(value => normalizeHeader(String(value ?? ''))).filter(Boolean));
	const matched = HEADER_GROUPS.filter(({ aliases }) => [...cells].some(cell => aliases.has(cell))).map(({ group }) => group);
	return {
		hasIdentity: matched.some(group => IDENTITY_HEADER_GROUPS.has(group)),
		hasQuantity: matched.includes('quantity'),
		score: matched.length,
	};
}

function parseWorksheetRows(
	matrix: unknown[][],
	headerIndex: number,
	startRow: number,
	sheetName: string,
	defaultState: ImportDefaultState,
): ParsedOrderRow[] {
	const rows: ParsedOrderRow[] = [];
	const headers = matrix[headerIndex];
	for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
		const values = matrix[rowIndex];
		if (!hasValues(values) || isHeaderLike(values)) {
			continue;
		}
		const rowNumber = startRow + rowIndex + 1;
		const parsed = mapRow(createSourceRow(headers, values), rowNumber, defaultState, `worksheet "${sheetName}" row ${rowNumber}`);
		if (parsed) {
			rows.push(parsed);
			if (rows.length > MAX_DATA_ROWS) {
				throw new Error(`Worksheet "${sheetName}" exceeds the ${MAX_DATA_ROWS}-data-row limit.`);
			}
		}
	}
	return rows;
}

function createSourceRow(headers: unknown[], values: unknown[]): SourceRow {
	const row: SourceRow = {};
	for (let index = 0; index < Math.min(headers.length, MAX_WORKSHEET_COLUMNS); index += 1) {
		const header = normalizeInventoryText(String(headers[index] ?? ''));
		if (header && row[header] === undefined) {
			row[header] = values[index];
		}
	}
	return row;
}

function hasValues(values: unknown[]): boolean {
	return values.some(value => normalizeInventoryText(String(value ?? '')) !== '');
}

function fingerprintSheet(matrix: unknown[][]): string {
	let hash = 2166136261;
	let cells = 0;
	for (const row of matrix) {
		for (const value of row) {
			const normalized = normalizeInventoryText(String(value ?? ''));
			for (let index = 0; index < normalized.length; index += 1) {
				hash ^= normalized.charCodeAt(index);
				hash = Math.imul(hash, 16777619);
			}
			hash ^= 31;
			cells += 1;
		}
		hash ^= 127;
	}
	return `${matrix.length}:${cells}:${hash >>> 0}`;
}

function readErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
