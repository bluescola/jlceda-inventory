import type { InventoryItem } from '../../inventory/domain/inventory-item';
import type { DesignComponentSnapshot, DesignStockCheckRow } from '../domain/design-stock-check';
import { normalizeLcscPartNumber } from '../../inventory/domain/inventory-item';
import { aggregateDesignComponents, assertBoardQuantity, evaluateDesignStockDemand } from '../domain/design-stock-check';

export interface CheckDesignStockInput {
	components: readonly DesignComponentSnapshot[];
	inventory: readonly InventoryItem[];
	boardQuantity?: number;
}

export interface DesignStockCheckReport {
	boardQuantity: number;
	rows: DesignStockCheckRow[];
}

export function checkDesignStock(input: CheckDesignStockInput): DesignStockCheckReport {
	const boardQuantity = assertBoardQuantity(input.boardQuantity ?? 1);
	const inventoryByPartNumber = indexInventory(input.inventory);
	const rows = aggregateDesignComponents(input.components).map(demand => evaluateDesignStockDemand(
		demand,
		demand.identity.lcscPartNumber
			? inventoryByPartNumber.get(demand.identity.lcscPartNumber) ?? []
			: [],
		boardQuantity,
	));
	return { boardQuantity, rows };
}

function indexInventory(inventory: readonly InventoryItem[]): Map<string, InventoryItem[]> {
	const indexed = new Map<string, InventoryItem[]>();
	for (const item of inventory) {
		const partNumber = normalizeLcscPartNumber(item.identity.lcscPartNumber ?? item.identity.supplierId);
		if (!partNumber || !/^C\d+$/.test(partNumber)) {
			continue;
		}
		const matches = indexed.get(partNumber);
		if (matches) {
			matches.push(item);
		}
		else {
			indexed.set(partNumber, [item]);
		}
	}
	return indexed;
}
