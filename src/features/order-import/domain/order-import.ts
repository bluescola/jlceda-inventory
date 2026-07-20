import type { NewInventoryItem, StockState } from '../../inventory/domain/inventory-item';

export interface ParsedOrderRow {
	rowNumber: number;
	item: NewInventoryItem;
	hasExplicitState: boolean;
}

export type ImportDefaultState = StockState;
