import type { DesignStockCheckStatus } from '../domain/design-stock-check';
import type { DesignStockCheckReport } from './check-design-stock';

export interface DesignStockCsvLabels {
	partNumber: string;
	name: string;
	manufacturerPartNumber: string;
	package: string;
	designators: string;
	unitQuantity: string;
	boardQuantity: string;
	requiredQuantity: string;
	availableQuantity: string;
	shortageQuantity: string;
	status: string;
	emptyValue: string;
	statuses: Readonly<Record<DesignStockCheckStatus, string>>;
}

export function createDesignStockShortageCsv(
	report: DesignStockCheckReport,
	labels: DesignStockCsvLabels,
): string {
	const headers = [
		labels.partNumber,
		labels.name,
		labels.manufacturerPartNumber,
		labels.package,
		labels.designators,
		labels.unitQuantity,
		labels.boardQuantity,
		labels.requiredQuantity,
		labels.availableQuantity,
		labels.shortageQuantity,
		labels.status,
	];
	const rows = report.rows
		.filter(row => row.status !== 'sufficient')
		.map(row => [
			row.identity.lcscPartNumber ?? labels.emptyValue,
			row.identity.name ?? labels.emptyValue,
			row.identity.manufacturerPartNumber ?? labels.emptyValue,
			row.identity.package ?? labels.emptyValue,
			row.designators.join(', '),
			row.unitQuantity,
			row.boardQuantity,
			row.requiredQuantity,
			row.availableQuantity ?? labels.emptyValue,
			row.shortageQuantity ?? labels.emptyValue,
			labels.statuses[row.status],
		]);
	return [headers, ...rows]
		.map(row => row.map(encodeCsvCell).join(','))
		.join('\r\n');
}

function encodeCsvCell(value: number | string): string {
	let text = String(value);
	if (/^[=+\-@\t\r]/.test(text)) {
		text = `'${text}`;
	}
	return `"${text.replaceAll('"', '""')}"`;
}
