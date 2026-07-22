import type { DesignStockCheckStatus } from '../../design-stock-check/domain/design-stock-check';
import type { ProcurementSuggestion } from './analyze-project-demand';

export interface ProcurementCsvLabels {
	lcscPartNumber: string;
	name: string;
	manufacturerPartNumber: string;
	package: string;
	requiredQuantity: string;
	availableQuantity: string;
	suggestedQuantity: string;
	status: string;
	sources: string;
	emptyValue: string;
	boardQuantityPrefix: string;
	statuses: Readonly<Record<DesignStockCheckStatus, string>>;
}

export function createProcurementCsv(
	suggestions: readonly ProcurementSuggestion[],
	labels: ProcurementCsvLabels,
): string {
	const rows: Array<Array<number | string>> = [[
		labels.lcscPartNumber,
		labels.name,
		labels.manufacturerPartNumber,
		labels.package,
		labels.requiredQuantity,
		labels.availableQuantity,
		labels.suggestedQuantity,
		labels.status,
		labels.sources,
	]];
	for (const suggestion of suggestions) {
		rows.push([
			suggestion.identity.lcscPartNumber ?? labels.emptyValue,
			suggestion.identity.name ?? labels.emptyValue,
			suggestion.identity.manufacturerPartNumber ?? labels.emptyValue,
			suggestion.identity.package ?? labels.emptyValue,
			suggestion.requiredQuantity,
			suggestion.availableQuantity ?? labels.emptyValue,
			suggestion.suggestedQuantity ?? labels.emptyValue,
			labels.statuses[suggestion.status],
			suggestion.sources.length > 0
				? suggestion.sources.map(source => `${source.label} (${labels.boardQuantityPrefix}${source.boardQuantity})`).join('; ')
				: labels.emptyValue,
		]);
	}
	return rows.map(row => row.map(value => encodeCsvCell(value, labels.emptyValue)).join(',')).join('\r\n');
}

function encodeCsvCell(value: number | string, emptyValue: string): string {
	let text = String(value);
	if (typeof value === 'string' && text !== emptyValue && /^[=+\-@\t\r]/.test(text)) {
		text = `'${text}`;
	}
	return `"${text.replaceAll('"', '""')}"`;
}
