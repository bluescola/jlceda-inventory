import type {
	AggregatedBomDemand,
	AggregatedBomIdentity,
	BomDesignDemand,
	BomDiffChangeType,
	BomDiffEntry,
	BomDiffResult,
	BomIdentityChange,
	BomIdentityField,
} from './bom-analysis';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../inventory/domain/inventory-item';

const IDENTITY_FIELDS: readonly BomIdentityField[] = [
	'name',
	'manufacturerPartNumber',
	'manufacturer',
	'package',
];

const CHANGE_RANK: Readonly<Record<BomDiffChangeType, number>> = {
	'added': 0,
	'removed': 1,
	'quantity-increased': 2,
	'quantity-decreased': 3,
	'identity-changed': 4,
};

interface MutableAggregate {
	lcscPartNumber: string;
	quantity: number;
	designators: Map<string, string>;
	identity: Record<BomIdentityField, Map<string, string>>;
	sourceRows: Array<{ sheetName: string; rowNumber: number }>;
}

export function diffNormalizedBoms(
	before: readonly BomDesignDemand[],
	after: readonly BomDesignDemand[],
): BomDiffResult {
	const beforeAggregation = aggregateBomDemands(before);
	const afterAggregation = aggregateBomDemands(after);
	const partNumbers = new Set([
		...beforeAggregation.byPartNumber.keys(),
		...afterAggregation.byPartNumber.keys(),
	]);
	const entries: BomDiffEntry[] = [];
	for (const lcscPartNumber of partNumbers) {
		const previous = beforeAggregation.byPartNumber.get(lcscPartNumber);
		const next = afterAggregation.byPartNumber.get(lcscPartNumber);
		if (!previous && next) {
			entries.push({ type: 'added', lcscPartNumber, after: next, quantityDelta: next.quantity });
			continue;
		}
		if (previous && !next) {
			entries.push({ type: 'removed', lcscPartNumber, before: previous, quantityDelta: -previous.quantity });
			continue;
		}
		if (!previous || !next) {
			continue;
		}
		const quantityDelta = next.quantity - previous.quantity;
		if (quantityDelta !== 0) {
			entries.push({
				type: quantityDelta > 0 ? 'quantity-increased' : 'quantity-decreased',
				lcscPartNumber,
				before: previous,
				after: next,
				quantityDelta,
			});
		}
		const identityChanges = compareIdentity(previous.identity, next.identity);
		if (identityChanges.length > 0) {
			entries.push({
				type: 'identity-changed',
				lcscPartNumber,
				before: previous,
				after: next,
				identityChanges,
			});
		}
	}
	entries.sort((left, right) => left.lcscPartNumber.localeCompare(right.lcscPartNumber, undefined, { numeric: true })
		|| CHANGE_RANK[left.type] - CHANGE_RANK[right.type]);
	return {
		entries,
		unmatchedBefore: beforeAggregation.unmatched,
		unmatchedAfter: afterAggregation.unmatched,
	};
}

export function aggregateBomDemands(demands: readonly BomDesignDemand[]): {
	byPartNumber: Map<string, AggregatedBomDemand>;
	unmatched: BomDesignDemand[];
} {
	const mutable = new Map<string, MutableAggregate>();
	const unmatched: BomDesignDemand[] = [];
	for (const demand of demands) {
		if (!Number.isSafeInteger(demand.quantity) || demand.quantity <= 0) {
			throw new TypeError('BOM quantity exceeds the safe integer range.');
		}
		const lcscPartNumber = normalizeLcscPartNumber(demand.lcscPartNumber);
		if (!lcscPartNumber || !/^C\d+$/.test(lcscPartNumber)) {
			unmatched.push(cloneDemand(demand));
			continue;
		}
		let aggregate = mutable.get(lcscPartNumber);
		if (!aggregate) {
			aggregate = createMutableAggregate(lcscPartNumber);
			mutable.set(lcscPartNumber, aggregate);
		}
		const quantity = aggregate.quantity + demand.quantity;
		if (!Number.isSafeInteger(quantity)) {
			throw new TypeError(`BOM quantity for ${lcscPartNumber} exceeds the safe integer range.`);
		}
		aggregate.quantity = quantity;
		for (const designator of demand.designators) {
			addNormalizedValue(aggregate.designators, designator);
		}
		for (const field of IDENTITY_FIELDS) {
			addNormalizedValue(aggregate.identity[field], demand.identity[field]);
		}
		aggregate.sourceRows.push({ sheetName: demand.sheetName, rowNumber: demand.rowNumber });
	}
	const byPartNumber = new Map<string, AggregatedBomDemand>();
	for (const [partNumber, aggregate] of mutable) {
		byPartNumber.set(partNumber, {
			lcscPartNumber: aggregate.lcscPartNumber,
			quantity: aggregate.quantity,
			designators: [...aggregate.designators.values()],
			identity: {
				name: [...aggregate.identity.name.values()],
				manufacturerPartNumber: [...aggregate.identity.manufacturerPartNumber.values()],
				manufacturer: [...aggregate.identity.manufacturer.values()],
				package: [...aggregate.identity.package.values()],
			},
			sourceRows: aggregate.sourceRows.map(row => ({ ...row })),
		});
	}
	return { byPartNumber, unmatched };
}

function createMutableAggregate(lcscPartNumber: string): MutableAggregate {
	return {
		lcscPartNumber,
		quantity: 0,
		designators: new Map(),
		identity: {
			name: new Map(),
			manufacturerPartNumber: new Map(),
			manufacturer: new Map(),
			package: new Map(),
		},
		sourceRows: [],
	};
}

function compareIdentity(before: AggregatedBomIdentity, after: AggregatedBomIdentity): BomIdentityChange[] {
	const changes: BomIdentityChange[] = [];
	for (const field of IDENTITY_FIELDS) {
		if (!sameNormalizedValues(before[field], after[field])) {
			changes.push({ field, before: [...before[field]], after: [...after[field]] });
		}
	}
	return changes;
}

function sameNormalizedValues(left: readonly string[], right: readonly string[]): boolean {
	const leftKeys = left.map(comparisonKey).toSorted();
	const rightKeys = right.map(comparisonKey).toSorted();
	return leftKeys.length === rightKeys.length && leftKeys.every((value, index) => value === rightKeys[index]);
}

function addNormalizedValue(target: Map<string, string>, value: string | undefined): void {
	const normalized = value === undefined ? '' : normalizeInventoryText(value);
	if (normalized) {
		target.set(comparisonKey(normalized), normalized);
	}
}

function comparisonKey(value: string): string {
	return normalizeInventoryText(value).toLocaleLowerCase();
}

function cloneDemand(demand: BomDesignDemand): BomDesignDemand {
	return {
		...demand,
		designators: [...demand.designators],
		identity: { ...demand.identity },
	};
}
