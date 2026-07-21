import type { InventoryItem, PartIdentity } from '../../inventory/domain/inventory-item';
import { normalizeInventoryText } from '../../inventory/domain/inventory-item';

const SEARCHABLE_IDENTITY_FIELDS = [
	'lcscPartNumber',
	'supplierId',
	'manufacturerPartNumber',
	'name',
	'manufacturer',
	'package',
] as const satisfies readonly (keyof PartIdentity)[];

const MATCH_RANK = {
	none: 0,
	contains: 1,
	prefix: 2,
	exact: 3,
} as const;
type MatchRank = typeof MATCH_RANK[keyof typeof MATCH_RANK];

export function searchInventory(items: readonly InventoryItem[], query: string): InventoryItem[] {
	const normalizedQuery = normalizeSearchText(query);
	return items
		.map(item => ({ item, rank: matchItem(item, normalizedQuery) }))
		.filter(result => result.rank !== MATCH_RANK.none)
		.toSorted((left, right) => compareMatches(left, right))
		.map(result => result.item);
}

function matchItem(item: InventoryItem, query: string): MatchRank {
	if (!query) {
		return MATCH_RANK.contains;
	}

	let bestRank: MatchRank = MATCH_RANK.none;
	for (const field of SEARCHABLE_IDENTITY_FIELDS) {
		const value = item.identity[field];
		if (!value) {
			continue;
		}
		const rank = matchText(normalizeSearchText(value), query);
		if (rank > bestRank) {
			bestRank = rank;
		}
		if (bestRank === MATCH_RANK.exact) {
			break;
		}
	}
	return bestRank;
}

function matchText(value: string, query: string): MatchRank {
	if (value === query) {
		return MATCH_RANK.exact;
	}
	if (value.startsWith(query)) {
		return MATCH_RANK.prefix;
	}
	return value.includes(query) ? MATCH_RANK.contains : MATCH_RANK.none;
}

function compareMatches(
	left: { item: InventoryItem; rank: MatchRank },
	right: { item: InventoryItem; rank: MatchRank },
): number {
	const rankDifference = right.rank - left.rank;
	if (rankDifference !== 0) {
		return rankDifference;
	}
	const stockDifference = Number(right.item.state === 'in-stock') - Number(left.item.state === 'in-stock');
	return stockDifference || right.item.updatedAt.localeCompare(left.item.updatedAt);
}

function normalizeSearchText(value: string): string {
	return normalizeInventoryText(value).replaceAll(/\s+/g, ' ').toLowerCase();
}
