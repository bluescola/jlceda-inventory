import type { BomColumnField, BomColumnMapping, BomHeaderCandidate } from '../domain/bom-analysis';
import { normalizeInventoryText } from '../../inventory/domain/inventory-item';
import { BOM_COLUMN_FIELDS } from '../domain/bom-analysis';

export const MAX_BOM_HEADER_SCAN_ROWS = 100;

export const BOM_COLUMN_ALIASES: Readonly<Record<BomColumnField, readonly string[]>> = {
	lcscPartNumber: [
		'c编号',
		'立创编号',
		'立创商城编号',
		'商品编号',
		'供应商编号',
		'lcsc',
		'lcsc part',
		'lcsc part #',
		'lcsc part number',
		'supplier part',
		'supplier part #',
		'supplier part number',
	],
	designators: [
		'designator',
		'designators',
		'reference',
		'references',
		'reference designator',
		'ref',
		'refs',
		'refdes',
		'位号',
		'器件位号',
		'元件位号',
	],
	quantity: [
		'quantity',
		'qty',
		'count',
		'amount',
		'数量',
		'用量',
		'单板用量',
		'器件数量',
	],
	name: [
		'name',
		'component',
		'component name',
		'comment',
		'value',
		'description',
		'器件名称',
		'元件名称',
		'商品名称',
		'名称',
		'参数',
		'值',
	],
	manufacturerPartNumber: [
		'manufacturer part number',
		'manufacturer part',
		'mfr part',
		'mfr part number',
		'mpn',
		'part number',
		'厂家型号',
		'制造商编号',
		'型号',
	],
	manufacturer: [
		'manufacturer',
		'manufacture',
		'mfr',
		'brand',
		'制造商',
		'厂家',
		'品牌',
	],
	package: [
		'package',
		'package name',
		'footprint',
		'封装',
		'封装名称',
		'封装规格',
	],
	excludeFromBom: [
		'exclude from bom',
		'do not populate',
		'do not fit',
		'not fitted',
		'dnp',
		'dnf',
		'不加入bom',
		'不装',
		'不贴',
		'不焊接',
	],
};

const FIELD_WEIGHTS: Readonly<Record<BomColumnField, number>> = {
	lcscPartNumber: 8,
	designators: 6,
	quantity: 6,
	manufacturerPartNumber: 4,
	name: 3,
	package: 2,
	manufacturer: 1,
	excludeFromBom: 1,
};

const ALIAS_FIELDS = createAliasFields();

export function findBomHeaderCandidates(rows: readonly (readonly string[])[]): BomHeaderCandidate[] {
	const candidates: BomHeaderCandidate[] = [];
	for (let rowIndex = 0; rowIndex < Math.min(rows.length, MAX_BOM_HEADER_SCAN_ROWS); rowIndex += 1) {
		const suggestion = suggestBomColumnMapping(rows[rowIndex]);
		const fields = Object.keys(suggestion.mapping) as BomColumnField[];
		const hasDemand = fields.includes('quantity') || fields.includes('designators');
		const hasIdentity = fields.includes('lcscPartNumber')
			|| fields.includes('designators')
			|| fields.includes('manufacturerPartNumber')
			|| fields.includes('name');
		if (fields.length < 2 || !hasDemand || !hasIdentity) {
			continue;
		}
		candidates.push({
			rowIndex,
			rowNumber: rowIndex + 1,
			score: suggestion.score,
			recognizedColumnCount: suggestion.recognizedColumnCount,
			suggestedMapping: suggestion.mapping,
			duplicateFields: suggestion.duplicateFields,
		});
	}
	return candidates.toSorted((left, right) => right.score - left.score || left.rowIndex - right.rowIndex);
}

export function suggestBomColumnMapping(headers: readonly string[]): {
	mapping: BomColumnMapping;
	duplicateFields: BomColumnField[];
	recognizedColumnCount: number;
	score: number;
} {
	const mapping: BomColumnMapping = {};
	const duplicateFields = new Set<BomColumnField>();
	let recognizedColumnCount = 0;
	for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
		const field = ALIAS_FIELDS.get(normalizeBomHeader(headers[columnIndex] ?? ''));
		if (!field) {
			continue;
		}
		recognizedColumnCount += 1;
		if (mapping[field] === undefined) {
			mapping[field] = columnIndex;
		}
		else {
			duplicateFields.add(field);
		}
	}
	const score = (Object.keys(mapping) as BomColumnField[])
		.reduce((total, field) => total + FIELD_WEIGHTS[field], 0)
		+ recognizedColumnCount
		- duplicateFields.size;
	return { mapping, duplicateFields: [...duplicateFields], recognizedColumnCount, score };
}

export function normalizeBomHeader(value: string): string {
	return normalizeInventoryText(value)
		.toLocaleLowerCase()
		.replaceAll(/[\s#_\-./\\()[\]{}:：]+/g, '');
}

function createAliasFields(): Map<string, BomColumnField> {
	const fields = new Map<string, BomColumnField>();
	for (const field of BOM_COLUMN_FIELDS) {
		for (const alias of BOM_COLUMN_ALIASES[field]) {
			const normalized = normalizeBomHeader(alias);
			const existing = fields.get(normalized);
			if (existing && existing !== field) {
				throw new Error(`BOM column alias is ambiguous: ${alias}`);
			}
			fields.set(normalized, field);
		}
	}
	return fields;
}
