import type { InventoryItem } from '../../inventory/domain/inventory-item';

export function rankInventory(items: InventoryItem[], query: string): InventoryItem[] {
	const normalizedQuery = query.trim().toLowerCase();
	return items
		.map(item => ({ item, score: scoreItem(item, normalizedQuery) }))
		.filter(result => result.score >= 0)
		.toSorted((left, right) => right.score - left.score || right.item.updatedAt.localeCompare(left.item.updatedAt))
		.map(result => result.item);
}

function scoreItem(item: InventoryItem, query: string): number {
	const stockScore = item.state === 'in-stock' ? 1000 : 0;
	if (!query) {
		return stockScore + quantityScore(item);
	}
	const fields = [
		item.identity.lcscPartNumber,
		item.identity.supplierId,
		item.identity.manufacturerPartNumber,
		item.identity.name,
		item.identity.manufacturer,
		item.identity.package,
	].filter((value): value is string => Boolean(value)).map(value => value.toLowerCase());

	const exactIndex = fields.findIndex(value => value === query);
	if (exactIndex >= 0) {
		return stockScore + 500 - exactIndex;
	}
	const partialIndex = fields.findIndex(value => value.includes(query));
	if (partialIndex >= 0) {
		return stockScore + 200 - partialIndex;
	}
	return -1;
}

function quantityScore(item: InventoryItem): number {
	if (item.quantity === null) {
		return 1;
	}
	return Math.min(item.quantity, 100);
}
