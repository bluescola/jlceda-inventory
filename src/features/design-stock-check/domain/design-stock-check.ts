import type { InventoryItem, PartIdentity } from '../../inventory/domain/inventory-item';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../inventory/domain/inventory-item';

export interface DesignComponentSnapshot {
	designator?: string;
	identity: Partial<PartIdentity>;
	quantity?: number;
	includeInBom?: boolean;
}

export interface DesignStockIdentity {
	name?: string;
	lcscPartNumber?: string;
	manufacturerPartNumber?: string;
	manufacturer?: string;
	package?: string;
}

export interface DesignStockDemand {
	key: string;
	identity: DesignStockIdentity;
	designators: string[];
	unitQuantity: number;
	firstSourceIndex: number;
}

export type DesignStockInventoryState
	= | 'exact'
		| 'estimated'
		| 'unknown'
		| 'depleted'
		| 'missing'
		| 'identity-unmatched';

export type DesignStockCheckStatus
	= | 'sufficient'
		| 'insufficient'
		| 'review-required'
		| 'stocktake-required'
		| 'inventory-missing'
		| 'identity-unmatched';

export interface DesignStockCheckRow extends DesignStockDemand {
	boardQuantity: number;
	requiredQuantity: number;
	inventoryItemIds: string[];
	inventoryState: DesignStockInventoryState;
	availableQuantity: number | null;
	shortageQuantity: number | null;
	status: DesignStockCheckStatus;
}

interface InventoryAssessment {
	itemIds: string[];
	state: Exclude<DesignStockInventoryState, 'identity-unmatched'>;
	quantity: number | null;
}

export function aggregateDesignComponents(
	components: readonly DesignComponentSnapshot[],
): DesignStockDemand[] {
	const numbered = new Map<string, DesignStockDemand>();
	const unmatched: DesignStockDemand[] = [];

	for (const [sourceIndex, component] of components.entries()) {
		if (component.includeInBom === false) {
			continue;
		}
		const quantity = normalizeDemandQuantity(component.quantity, sourceIndex);
		const identity = normalizeDesignIdentity(component.identity);
		const designator = cleanOptionalText(component.designator);
		const partNumber = identity.lcscPartNumber;
		if (!partNumber) {
			unmatched.push({
				key: `identity-unmatched:${sourceIndex}`,
				identity,
				designators: designator ? [designator] : [],
				unitQuantity: quantity,
				firstSourceIndex: sourceIndex,
			});
			continue;
		}

		const existing = numbered.get(partNumber);
		if (!existing) {
			numbered.set(partNumber, {
				key: `lcsc:${partNumber.toLowerCase()}`,
				identity,
				designators: designator ? [designator] : [],
				unitQuantity: quantity,
				firstSourceIndex: sourceIndex,
			});
			continue;
		}

		existing.unitQuantity = addSafeIntegers(existing.unitQuantity, quantity, 'Aggregated design quantity');
		existing.identity = mergeIdentity(existing.identity, identity);
		if (designator && !existing.designators.includes(designator)) {
			existing.designators.push(designator);
		}
	}

	return [...numbered.values(), ...unmatched].sort(compareDesignStockDemands);
}

export function evaluateDesignStockDemand(
	demand: DesignStockDemand,
	matchingInventory: readonly InventoryItem[],
	boardQuantity: number,
): DesignStockCheckRow {
	const requiredQuantity = multiplySafeIntegers(demand.unitQuantity, boardQuantity, 'Required design quantity');
	if (!demand.identity.lcscPartNumber) {
		return {
			...cloneDemand(demand),
			boardQuantity,
			requiredQuantity,
			inventoryItemIds: [],
			inventoryState: 'identity-unmatched',
			availableQuantity: null,
			shortageQuantity: null,
			status: 'identity-unmatched',
		};
	}

	const assessment = assessInventory(matchingInventory);
	const base = {
		...cloneDemand(demand),
		boardQuantity,
		requiredQuantity,
		inventoryItemIds: assessment.itemIds,
		inventoryState: assessment.state,
		availableQuantity: assessment.quantity,
	};
	if (assessment.state === 'missing') {
		return {
			...base,
			shortageQuantity: requiredQuantity,
			status: 'inventory-missing',
		};
	}
	if (assessment.state === 'unknown') {
		return {
			...base,
			shortageQuantity: null,
			status: 'stocktake-required',
		};
	}
	if (assessment.state === 'estimated') {
		return {
			...base,
			shortageQuantity: null,
			status: 'review-required',
		};
	}

	const shortageQuantity = Math.max(0, requiredQuantity - (assessment.quantity ?? 0));
	return {
		...base,
		shortageQuantity,
		status: shortageQuantity === 0 ? 'sufficient' : 'insufficient',
	};
}

export function assertBoardQuantity(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError('Board quantity must be a positive safe integer.');
	}
	return value;
}

function assessInventory(items: readonly InventoryItem[]): InventoryAssessment {
	if (items.length === 0) {
		return { itemIds: [], state: 'missing', quantity: 0 };
	}

	const itemIds = items.map(item => item.id);
	let quantity = 0;
	let hasEstimated = false;
	let hasUnknown = false;
	for (const item of items) {
		if (item.state === 'depleted') {
			continue;
		}
		if (item.precision === 'unknown' || item.quantity === null) {
			hasUnknown = true;
			continue;
		}
		quantity = addSafeIntegers(quantity, item.quantity, 'Available inventory quantity');
		hasEstimated ||= item.precision === 'estimated';
	}

	if (hasUnknown) {
		return { itemIds, state: 'unknown', quantity: null };
	}
	if (hasEstimated) {
		return { itemIds, state: 'estimated', quantity };
	}
	if (quantity === 0) {
		return { itemIds, state: 'depleted', quantity: 0 };
	}
	return { itemIds, state: 'exact', quantity };
}

function normalizeDesignIdentity(identity: Partial<PartIdentity>): DesignStockIdentity {
	const normalizedPartNumber = normalizeLcscPartNumber(identity.lcscPartNumber ?? identity.supplierId);
	return {
		name: cleanOptionalText(identity.name),
		lcscPartNumber: normalizedPartNumber && /^C\d+$/.test(normalizedPartNumber) ? normalizedPartNumber : undefined,
		manufacturerPartNumber: cleanOptionalText(identity.manufacturerPartNumber),
		manufacturer: cleanOptionalText(identity.manufacturer),
		package: cleanOptionalText(identity.package),
	};
}

function mergeIdentity(current: DesignStockIdentity, candidate: DesignStockIdentity): DesignStockIdentity {
	return {
		name: current.name ?? candidate.name,
		lcscPartNumber: current.lcscPartNumber ?? candidate.lcscPartNumber,
		manufacturerPartNumber: current.manufacturerPartNumber ?? candidate.manufacturerPartNumber,
		manufacturer: current.manufacturer ?? candidate.manufacturer,
		package: current.package ?? candidate.package,
	};
}

function normalizeDemandQuantity(quantity: number | undefined, sourceIndex: number): number {
	const normalized = quantity ?? 1;
	if (!Number.isSafeInteger(normalized) || normalized <= 0) {
		throw new TypeError(`Design component quantity at index ${sourceIndex} must be a positive safe integer.`);
	}
	return normalized;
}

function compareDesignStockDemands(left: DesignStockDemand, right: DesignStockDemand): number {
	const leftPartNumber = left.identity.lcscPartNumber;
	const rightPartNumber = right.identity.lcscPartNumber;
	if (leftPartNumber && rightPartNumber) {
		const partNumberOrder = comparePartNumbers(leftPartNumber, rightPartNumber);
		return partNumberOrder || left.firstSourceIndex - right.firstSourceIndex;
	}
	if (leftPartNumber) {
		return -1;
	}
	if (rightPartNumber) {
		return 1;
	}
	return left.firstSourceIndex - right.firstSourceIndex;
}

function comparePartNumbers(left: string, right: string): number {
	const leftDigits = left.match(/^C(\d+)$/)?.[1];
	const rightDigits = right.match(/^C(\d+)$/)?.[1];
	if (leftDigits !== undefined && rightDigits !== undefined) {
		const normalizedLeft = leftDigits.replace(/^0+(?=\d)/, '');
		const normalizedRight = rightDigits.replace(/^0+(?=\d)/, '');
		if (normalizedLeft.length !== normalizedRight.length) {
			return normalizedLeft.length - normalizedRight.length;
		}
		if (normalizedLeft !== normalizedRight) {
			return normalizedLeft < normalizedRight ? -1 : 1;
		}
	}
	return left === right ? 0 : left < right ? -1 : 1;
}

function cloneDemand(demand: DesignStockDemand): DesignStockDemand {
	return {
		...demand,
		identity: { ...demand.identity },
		designators: [...demand.designators],
	};
}

function cleanOptionalText(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	return normalizeInventoryText(value) || undefined;
}

function addSafeIntegers(left: number, right: number, label: string): number {
	const value = left + right;
	if (!Number.isSafeInteger(value)) {
		throw new RangeError(`${label} exceeds the safe integer range.`);
	}
	return value;
}

function multiplySafeIntegers(left: number, right: number, label: string): number {
	const value = left * right;
	if (!Number.isSafeInteger(value)) {
		throw new RangeError(`${label} exceeds the safe integer range.`);
	}
	return value;
}
