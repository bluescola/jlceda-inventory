import type { BomStockOutInput } from '../../inventory/application/bom-stock-out';
import type { InventoryItem } from '../../inventory/domain/inventory-item';
import type { AggregatedBomDemand, BomDesignDemand } from '../domain/bom-analysis';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../inventory/domain/inventory-item';
import { aggregateBomDemands } from '../domain/diff-boms';

export type PreparedBomStockOutIssueCode
	= | 'identity-unmatched'
		| 'inventory-missing'
		| 'inventory-ambiguous'
		| 'quantity-not-exact'
		| 'insufficient-stock';

export interface PreparedBomStockOutIssue {
	code: PreparedBomStockOutIssueCode;
	lcscPartNumber?: string;
	itemIds: string[];
	requiredQuantity: number;
	availableQuantity: number | null;
	designators: string[];
	sheetName?: string;
	rowNumber?: number;
}

export interface PreparedBomStockOutLine {
	lcscPartNumber: string;
	itemId: string;
	itemRevision: number;
	name: string;
	unitQuantity: number;
	boardQuantity: number;
	requiredQuantity: number;
	beforeQuantity: number;
	afterQuantity: number;
	designators: string[];
}

export interface PreparedBomStockOut {
	status: 'ready' | 'blocked';
	input: BomStockOutInput;
	lines: PreparedBomStockOutLine[];
	issues: PreparedBomStockOutIssue[];
}

export interface PrepareBomStockOutInput {
	demands: readonly BomDesignDemand[];
	inventory: readonly InventoryItem[];
	boardQuantity: number;
	sourceFingerprint: string;
	sourceName?: string;
	note?: string;
}

export function prepareBomStockOut(input: PrepareBomStockOutInput): PreparedBomStockOut {
	assertBoardQuantity(input.boardQuantity);
	const aggregation = aggregateBomDemands(input.demands);
	const inventoryByPartNumber = indexInventory(input.inventory);
	const lines: PreparedBomStockOutLine[] = [];
	const issues: PreparedBomStockOutIssue[] = aggregation.unmatched.map(demand => ({
		code: 'identity-unmatched',
		itemIds: [],
		requiredQuantity: multiplySafeIntegers(demand.quantity, input.boardQuantity),
		availableQuantity: null,
		designators: [...demand.designators],
		sheetName: demand.sheetName,
		rowNumber: demand.rowNumber,
	}));

	for (const demand of aggregation.byPartNumber.values()) {
		const requiredQuantity = multiplySafeIntegers(demand.quantity, input.boardQuantity);
		const matches = inventoryByPartNumber.get(demand.lcscPartNumber) ?? [];
		const issueBase = {
			lcscPartNumber: demand.lcscPartNumber,
			itemIds: matches.map(item => item.id),
			requiredQuantity,
			designators: [...demand.designators],
		};
		if (matches.length === 0) {
			issues.push({ ...issueBase, code: 'inventory-missing', availableQuantity: 0 });
			continue;
		}
		if (matches.length > 1) {
			issues.push({ ...issueBase, code: 'inventory-ambiguous', availableQuantity: sumExactQuantity(matches) });
			continue;
		}
		const item = matches[0];
		if (item.precision !== 'exact' || item.quantity === null) {
			issues.push({ ...issueBase, code: 'quantity-not-exact', availableQuantity: item.quantity });
			continue;
		}
		if (item.quantity < requiredQuantity) {
			issues.push({ ...issueBase, code: 'insufficient-stock', availableQuantity: item.quantity });
			continue;
		}
		lines.push(toPreparedLine(demand, item, input.boardQuantity, requiredQuantity, item.quantity));
	}

	return {
		status: issues.length === 0 && lines.length > 0 ? 'ready' : 'blocked',
		input: {
			sourceFingerprint: input.sourceFingerprint,
			sourceName: cleanOptional(input.sourceName),
			note: cleanOptional(input.note),
			lines: lines.map(line => ({
				itemId: line.itemId,
				quantity: line.requiredQuantity,
				sourceReference: formatSourceReference(line.designators),
			})),
		},
		lines,
		issues,
	};
}

export async function fingerprintBomSource(content: ArrayBuffer): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error('Web Crypto SHA-256 is not available in this environment.');
	}
	const digest = await subtle.digest('SHA-256', content);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function toPreparedLine(
	demand: AggregatedBomDemand,
	item: InventoryItem,
	boardQuantity: number,
	requiredQuantity: number,
	beforeQuantity: number,
): PreparedBomStockOutLine {
	return {
		lcscPartNumber: demand.lcscPartNumber,
		itemId: item.id,
		itemRevision: item.revision,
		name: item.identity.name,
		unitQuantity: demand.quantity,
		boardQuantity,
		requiredQuantity,
		beforeQuantity,
		afterQuantity: beforeQuantity - requiredQuantity,
		designators: [...demand.designators],
	};
}

function indexInventory(inventory: readonly InventoryItem[]): Map<string, InventoryItem[]> {
	const indexed = new Map<string, InventoryItem[]>();
	for (const item of inventory) {
		const partNumber = normalizeLcscPartNumber(item.identity.lcscPartNumber ?? item.identity.supplierId);
		if (!partNumber || !/^C\d+$/.test(partNumber)) {
			continue;
		}
		const matches = indexed.get(partNumber) ?? [];
		matches.push(item);
		indexed.set(partNumber, matches);
	}
	return indexed;
}

function sumExactQuantity(items: readonly InventoryItem[]): number | null {
	let total = 0;
	for (const item of items) {
		if (item.precision !== 'exact' || item.quantity === null) {
			return null;
		}
		total = addSafeIntegers(total, item.quantity);
	}
	return total;
}

function formatSourceReference(designators: readonly string[]): string | undefined {
	const joined = designators.join(', ');
	if (!joined) {
		return undefined;
	}
	return joined.length <= 16_384 ? joined : `${joined.slice(0, 16_381)}...`;
}

function cleanOptional(value: string | undefined): string | undefined {
	const normalized = value === undefined ? '' : normalizeInventoryText(value);
	return normalized || undefined;
}

function assertBoardQuantity(value: number): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError('BOM stock-out board quantity must be a positive safe integer.');
	}
}

function multiplySafeIntegers(left: number, right: number): number {
	const value = left * right;
	if (!Number.isSafeInteger(value)) {
		throw new RangeError('BOM stock-out quantity exceeds the safe integer range.');
	}
	return value;
}

function addSafeIntegers(left: number, right: number): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) {
		throw new RangeError('Inventory quantity exceeds the safe integer range.');
	}
	return value;
}
