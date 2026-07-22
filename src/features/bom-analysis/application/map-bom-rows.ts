import type {
	BomColumnField,
	BomColumnMapping,
	BomDesignDemand,
	BomMappingResult,
	BomPartIdentity,
	BomRowIssue,
	BomSheet,
} from '../domain/bom-analysis';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../inventory/domain/inventory-item';
import { BOM_COLUMN_FIELDS } from '../domain/bom-analysis';
import { MAX_BOM_COLUMNS, MAX_BOM_DATA_ROWS } from './read-bom-file';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', '是', 'dnp', 'dnf', 'exclude', '不装', '不贴']);
const FALSE_VALUES = new Set(['', '0', 'false', 'no', 'n', '否']);

export function mapBomRows(
	sheet: BomSheet,
	headerRowIndex: number,
	mapping: BomColumnMapping,
): BomMappingResult {
	assertMapping(sheet, headerRowIndex, mapping);
	const dataRows = sheet.rows.slice(headerRowIndex + 1);
	if (dataRows.length > MAX_BOM_DATA_ROWS) {
		throw new Error(`BOM mapping exceeds the ${MAX_BOM_DATA_ROWS}-data-row limit.`);
	}
	const demands: BomDesignDemand[] = [];
	const issues: BomRowIssue[] = [];
	for (let index = 0; index < dataRows.length; index += 1) {
		const row = dataRows[index];
		if (!row.some(value => normalizeInventoryText(value).length > 0)) {
			continue;
		}
		const rowNumber = headerRowIndex + index + 2;
		const exclusion = parseExclusion(readCell(row, mapping.excludeFromBom));
		if (exclusion === undefined) {
			issues.push(createIssue(sheet.name, rowNumber, 'invalid-exclusion', 'excludeFromBom', readCell(row, mapping.excludeFromBom)));
		}
		else if (exclusion) {
			continue;
		}

		const designators = parseDesignators(readCell(row, mapping.designators));
		const rawQuantity = readCell(row, mapping.quantity);
		const quantity = parseQuantity(rawQuantity, designators);
		if (quantity === undefined) {
			issues.push(createIssue(
				sheet.name,
				rowNumber,
				rawQuantity ? 'invalid-quantity' : 'missing-quantity',
				'quantity',
				rawQuantity,
			));
			continue;
		}
		if (rawQuantity && designators.length > 0 && quantity !== designators.length) {
			issues.push(createIssue(sheet.name, rowNumber, 'quantity-designator-mismatch', 'quantity', rawQuantity));
		}

		const rawPartNumber = readCell(row, mapping.lcscPartNumber);
		const normalizedPartNumber = rawPartNumber ? normalizeLcscPartNumber(rawPartNumber) : undefined;
		const lcscPartNumber = normalizedPartNumber && /^C\d+$/.test(normalizedPartNumber)
			? normalizedPartNumber
			: undefined;
		if (!rawPartNumber) {
			issues.push(createIssue(sheet.name, rowNumber, 'missing-lcsc-part-number', 'lcscPartNumber'));
		}
		else if (!lcscPartNumber) {
			issues.push(createIssue(sheet.name, rowNumber, 'invalid-lcsc-part-number', 'lcscPartNumber', rawPartNumber));
		}

		const identity = readIdentity(row, mapping);
		if (!lcscPartNumber && !identity.name && !identity.manufacturerPartNumber && designators.length === 0) {
			issues.push(createIssue(sheet.name, rowNumber, 'missing-identity'));
		}
		demands.push({
			sheetName: sheet.name,
			rowNumber,
			lcscPartNumber,
			designators,
			quantity,
			identity,
		});
	}
	return { demands, issues };
}

function assertMapping(sheet: BomSheet, headerRowIndex: number, mapping: BomColumnMapping): void {
	if (!Number.isSafeInteger(headerRowIndex) || headerRowIndex < 0 || headerRowIndex >= sheet.rows.length) {
		throw new Error('BOM header row index is out of range.');
	}
	const maximumColumns = sheet.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
	const usedColumns = new Set<number>();
	for (const field of BOM_COLUMN_FIELDS) {
		const columnIndex = mapping[field];
		if (columnIndex === undefined) {
			continue;
		}
		if (!Number.isSafeInteger(columnIndex) || columnIndex < 0 || columnIndex >= maximumColumns || columnIndex >= MAX_BOM_COLUMNS) {
			throw new Error(`BOM column mapping for ${field} is out of range.`);
		}
		if (usedColumns.has(columnIndex)) {
			throw new Error(`BOM column ${columnIndex + 1} is mapped more than once.`);
		}
		usedColumns.add(columnIndex);
	}
	if (mapping.quantity === undefined && mapping.designators === undefined) {
		throw new Error('BOM column mapping requires quantity or designators.');
	}
	if (mapping.lcscPartNumber === undefined
		&& mapping.designators === undefined
		&& mapping.manufacturerPartNumber === undefined
		&& mapping.name === undefined) {
		throw new Error('BOM column mapping requires an identity or designator column.');
	}
}

function readIdentity(row: readonly string[], mapping: BomColumnMapping): BomPartIdentity {
	return {
		name: optionalCell(row, mapping.name),
		manufacturerPartNumber: optionalCell(row, mapping.manufacturerPartNumber),
		manufacturer: optionalCell(row, mapping.manufacturer),
		package: optionalCell(row, mapping.package),
	};
}

function parseDesignators(value: string): string[] {
	const designators = new Map<string, string>();
	for (const part of value.split(/[\s,;，；]+/g)) {
		const normalized = normalizeInventoryText(part);
		if (normalized) {
			designators.set(normalized.toLocaleLowerCase(), normalized);
		}
	}
	return [...designators.values()];
}

function parseQuantity(value: string, designators: readonly string[]): number | undefined {
	if (!value) {
		return designators.length > 0 ? designators.length : undefined;
	}
	if (!/^\d+$/.test(value)) {
		return undefined;
	}
	const quantity = Number(value);
	return Number.isSafeInteger(quantity) && quantity > 0 ? quantity : undefined;
}

function parseExclusion(value: string): boolean | undefined {
	const normalized = normalizeInventoryText(value).toLocaleLowerCase();
	if (TRUE_VALUES.has(normalized)) {
		return true;
	}
	if (FALSE_VALUES.has(normalized)) {
		return false;
	}
	return undefined;
}

function optionalCell(row: readonly string[], columnIndex: number | undefined): string | undefined {
	return readCell(row, columnIndex) || undefined;
}

function readCell(row: readonly string[], columnIndex: number | undefined): string {
	return columnIndex === undefined ? '' : normalizeInventoryText(row[columnIndex] ?? '');
}

function createIssue(
	sheetName: string,
	rowNumber: number,
	code: BomRowIssue['code'],
	field?: BomColumnField,
	value?: string,
): BomRowIssue {
	return { code, sheetName, rowNumber, field, value: value || undefined };
}
