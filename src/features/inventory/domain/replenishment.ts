import type { InventoryItem } from './inventory-item';

export type ReplenishmentStatus
	= | 'depleted'
		| 'low'
		| 'needs-count'
		| 'not-configured'
		| 'possibly-low'
		| 'sufficient';

export type ReplenishmentInventoryState = Pick<
	InventoryItem,
	'minimumQuantity' | 'precision' | 'quantity' | 'state'
>;

export function classifyReplenishment(item: ReplenishmentInventoryState): ReplenishmentStatus {
	if (item.state === 'depleted') {
		return 'depleted';
	}
	if (item.minimumQuantity === undefined) {
		return 'not-configured';
	}
	if (item.precision === 'unknown' || item.quantity === null) {
		return 'needs-count';
	}
	if (item.quantity >= item.minimumQuantity) {
		return 'sufficient';
	}
	return item.precision === 'estimated' ? 'possibly-low' : 'low';
}
