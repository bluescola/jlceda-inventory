import type { NewInventoryItem, QuantityPrecision, StockState } from '../../inventory/domain/inventory-item';
import type { ImportDefaultState, ParsedOrderRow } from '../domain/order-import';
import Papa from 'papaparse';

type SourceRow = Record<string, unknown>;

const HEADERS = {
	lcsc: ['c编号', '立创编号', '立创商城编号', 'lcsc', 'lcscpart', 'lcscpartnumber', 'supplierpartnumber', '供应商编号', '商品编号'],
	name: ['name', 'component', 'componentname', 'product', 'productname', '元器件名称', '器件名称', '商品名称', '名称'],
	quantity: ['quantity', 'qty', 'count', '数量', '购买数量', '商品数量'],
	manufacturer: ['manufacturer', 'mfr', '制造商', '品牌'],
	manufacturerPart: ['manufacturerpartnumber', 'manufacturerpart', 'mpn', 'partnumber', '厂家型号', '制造商编号', '型号'],
	package: ['package', 'footprint', '封装', '封装规格'],
	location: ['location', 'storage', 'bin', '仓位', '存放位置', '位置'],
	note: ['note', 'remark', 'remarks', '备注'],
	precision: ['precision', 'quantitytype', 'estimated', 'approximate', '数量类型', '大概数量', '估算'],
	state: ['state', 'status', 'depleted', 'usedup', 'used', '状态', '是否用完', '已用完'],
} as const;

export function parseOrderFile(fileName: string, text: string, defaultState: ImportDefaultState = 'in-stock'): ParsedOrderRow[] {
	const extension = fileName.split('.').pop()?.toLowerCase();
	const rows = extension === 'json' ? parseJson(text) : parseCsv(text);
	return rows.flatMap((row, index) => {
		const parsed = mapRow(row, index + 2, defaultState);
		return parsed ? [parsed] : [];
	});
}

function parseCsv(text: string): SourceRow[] {
	const result = Papa.parse<Record<string, string>>(text, {
		header: true,
		skipEmptyLines: 'greedy',
		transformHeader: header => header.trim(),
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

function mapRow(source: SourceRow, rowNumber: number, defaultState: ImportDefaultState): ParsedOrderRow | undefined {
	const row = normalizeRow(source);
	const lcscPartNumber = readString(row, HEADERS.lcsc);
	const manufacturerPartNumber = readString(row, HEADERS.manufacturerPart);
	const rawName = readString(row, HEADERS.name);
	if (!lcscPartNumber && !manufacturerPartNumber && !rawName) {
		return undefined;
	}

	const rawQuantity = readString(row, HEADERS.quantity);
	const precision = parsePrecision(readString(row, HEADERS.precision), rawQuantity);
	const quantity = parseQuantity(rawQuantity, precision, rowNumber);
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
	return value.trim().toLowerCase().replaceAll(/[\s_#()（）./\\-]+/g, '');
}

function readString(row: Record<string, unknown>, aliases: readonly string[]): string | undefined {
	for (const alias of aliases) {
		const value = row[normalizeHeader(alias)];
		if (value !== undefined && value !== null) {
			const cleaned = String(value).trim();
			if (cleaned) {
				return cleaned;
			}
		}
	}
	return undefined;
}

function parseQuantity(value: string | undefined, precision: QuantityPrecision, rowNumber: number): number | null {
	if (precision === 'unknown') {
		return null;
	}
	const normalized = value?.replaceAll(',', '').trim();
	if (!normalized) {
		return null;
	}
	const quantity = Number(normalized);
	if (!Number.isInteger(quantity) || quantity < 0) {
		throw new Error(`Invalid quantity at row ${rowNumber}: ${value}`);
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
