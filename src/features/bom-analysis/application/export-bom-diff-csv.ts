import type {
	AggregatedBomDemand,
	BomDesignDemand,
	BomDiffChangeType,
	BomDiffResult,
	BomIdentityField,
} from '../domain/bom-analysis';

export type BomDiffCsvRowType = BomDiffChangeType | 'unmatched-before' | 'unmatched-after';

export interface BomDiffCsvLabels {
	type: string;
	lcscPartNumber: string;
	beforeQuantity: string;
	afterQuantity: string;
	quantityDelta: string;
	beforeDesignators: string;
	afterDesignators: string;
	beforeName: string;
	afterName: string;
	beforeManufacturerPartNumber: string;
	afterManufacturerPartNumber: string;
	beforeManufacturer: string;
	afterManufacturer: string;
	beforePackage: string;
	afterPackage: string;
	identityChanges: string;
	sourceSheet: string;
	sourceRow: string;
	emptyValue: string;
	types: Readonly<Record<BomDiffCsvRowType, string>>;
	identityFields: Readonly<Record<BomIdentityField, string>>;
}

export function createBomDiffCsv(result: BomDiffResult, labels: BomDiffCsvLabels): string {
	const rows: Array<Array<number | string>> = [
		[
			labels.type,
			labels.lcscPartNumber,
			labels.beforeQuantity,
			labels.afterQuantity,
			labels.quantityDelta,
			labels.beforeDesignators,
			labels.afterDesignators,
			labels.beforeName,
			labels.afterName,
			labels.beforeManufacturerPartNumber,
			labels.afterManufacturerPartNumber,
			labels.beforeManufacturer,
			labels.afterManufacturer,
			labels.beforePackage,
			labels.afterPackage,
			labels.identityChanges,
			labels.sourceSheet,
			labels.sourceRow,
		],
	];

	for (const entry of result.entries) {
		rows.push([
			labels.types[entry.type],
			entry.lcscPartNumber,
			quantity(entry.before, labels.emptyValue),
			quantity(entry.after, labels.emptyValue),
			entry.quantityDelta ?? labels.emptyValue,
			joined(entry.before?.designators, labels.emptyValue),
			joined(entry.after?.designators, labels.emptyValue),
			identity(entry.before, 'name', labels.emptyValue),
			identity(entry.after, 'name', labels.emptyValue),
			identity(entry.before, 'manufacturerPartNumber', labels.emptyValue),
			identity(entry.after, 'manufacturerPartNumber', labels.emptyValue),
			identity(entry.before, 'manufacturer', labels.emptyValue),
			identity(entry.after, 'manufacturer', labels.emptyValue),
			identity(entry.before, 'package', labels.emptyValue),
			identity(entry.after, 'package', labels.emptyValue),
			entry.identityChanges?.map(change => labels.identityFields[change.field]).join(', ') || labels.emptyValue,
			labels.emptyValue,
			labels.emptyValue,
		]);
	}
	appendUnmatched(rows, result.unmatchedBefore, 'unmatched-before', labels);
	appendUnmatched(rows, result.unmatchedAfter, 'unmatched-after', labels);

	return rows.map(row => row.map(value => encodeCsvCell(value, labels.emptyValue)).join(',')).join('\r\n');
}

function appendUnmatched(
	rows: Array<Array<number | string>>,
	demands: readonly BomDesignDemand[],
	type: Extract<BomDiffCsvRowType, 'unmatched-before' | 'unmatched-after'>,
	labels: BomDiffCsvLabels,
): void {
	for (const demand of demands) {
		const before = type === 'unmatched-before';
		rows.push([
			labels.types[type],
			labels.emptyValue,
			before ? demand.quantity : labels.emptyValue,
			before ? labels.emptyValue : demand.quantity,
			labels.emptyValue,
			before ? joined(demand.designators, labels.emptyValue) : labels.emptyValue,
			before ? labels.emptyValue : joined(demand.designators, labels.emptyValue),
			before ? demand.identity.name ?? labels.emptyValue : labels.emptyValue,
			before ? labels.emptyValue : demand.identity.name ?? labels.emptyValue,
			before ? demand.identity.manufacturerPartNumber ?? labels.emptyValue : labels.emptyValue,
			before ? labels.emptyValue : demand.identity.manufacturerPartNumber ?? labels.emptyValue,
			before ? demand.identity.manufacturer ?? labels.emptyValue : labels.emptyValue,
			before ? labels.emptyValue : demand.identity.manufacturer ?? labels.emptyValue,
			before ? demand.identity.package ?? labels.emptyValue : labels.emptyValue,
			before ? labels.emptyValue : demand.identity.package ?? labels.emptyValue,
			labels.emptyValue,
			demand.sheetName,
			demand.rowNumber,
		]);
	}
}

function quantity(demand: AggregatedBomDemand | undefined, emptyValue: string): number | string {
	return demand?.quantity ?? emptyValue;
}

function identity(
	demand: AggregatedBomDemand | undefined,
	field: BomIdentityField,
	emptyValue: string,
): string {
	return joined(demand?.identity[field], emptyValue);
}

function joined(values: readonly string[] | undefined, emptyValue: string): string {
	return values && values.length > 0 ? values.join(', ') : emptyValue;
}

function encodeCsvCell(value: number | string, emptyValue: string): string {
	let text = String(value);
	if (typeof value === 'string' && text !== emptyValue && /^[=+\-@\t\r]/.test(text)) {
		text = `'${text}`;
	}
	return `"${text.replaceAll('"', '""')}"`;
}
