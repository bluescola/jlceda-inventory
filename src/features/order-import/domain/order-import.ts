import type { NewInventoryItem, StockState } from '../../inventory/domain/inventory-item';

export interface ParsedOrderRow {
	rowNumber: number;
	item: NewInventoryItem;
	hasExplicitState: boolean;
}

export interface OrderFileIdentity {
	orderNumber: string | undefined;
	fingerprint: string;
}

export interface ParsedOrderFile {
	fileName: string;
	identity: OrderFileIdentity;
	rows: ParsedOrderRow[];
}

export type ImportDefaultState = StockState;
