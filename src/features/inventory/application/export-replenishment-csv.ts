import type { InventoryItem, QuantityPrecision } from '../domain/inventory-item';
import type { ReplenishmentStatus } from '../domain/replenishment';
import { classifyReplenishment } from '../domain/replenishment';

export interface ReplenishmentCsvLabels {
	partNumber: string;
	name: string;
	manufacturerPartNumber: string;
	package: string;
	quantity: string;
	precision: string;
	minimumQuantity: string;
	status: string;
	location: string;
	note: string;
	emptyValue: string;
	precisions: Readonly<Record<QuantityPrecision, string>>;
	statuses: Readonly<Record<ReplenishmentStatus, string>>;
}

const EXPORTED_STATUSES = new Set<ReplenishmentStatus>([
	'depleted',
	'low',
	'possibly-low',
	'needs-count',
]);

export function createReplenishmentCsv(
	items: readonly InventoryItem[],
	labels: ReplenishmentCsvLabels,
): string {
	const headers = [
		labels.partNumber,
		labels.name,
		labels.manufacturerPartNumber,
		labels.package,
		labels.quantity,
		labels.precision,
		labels.minimumQuantity,
		labels.status,
		labels.location,
		labels.note,
	];
	const rows = items.flatMap((item) => {
		const status = classifyReplenishment(item);
		if (!EXPORTED_STATUSES.has(status)) {
			return [];
		}
		return [[
			item.identity.lcscPartNumber ?? item.identity.supplierId ?? labels.emptyValue,
			item.identity.name,
			item.identity.manufacturerPartNumber ?? labels.emptyValue,
			item.identity.package ?? labels.emptyValue,
			item.quantity ?? labels.emptyValue,
			labels.precisions[item.precision],
			item.minimumQuantity ?? labels.emptyValue,
			labels.statuses[status],
			item.location ?? labels.emptyValue,
			item.note ?? labels.emptyValue,
		]];
	});
	return [headers, ...rows]
		.map(row => row.map(encodeCsvCell).join(','))
		.join('\r\n');
}

function encodeCsvCell(value: number | string): string {
	let text = String(value);
	const firstCharacter = text[0];
	if (firstCharacter === '='
		|| firstCharacter === '+'
		|| firstCharacter === '@'
		|| (firstCharacter === '-' && text.length > 1)
		|| firstCharacter === '\t'
		|| firstCharacter === '\r'
		|| firstCharacter === '\n') {
		text = `'${text}`;
	}
	return `"${text.replaceAll('"', '""')}"`;
}
