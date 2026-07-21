import type { InventoryCreateQuantityMode } from '../../presentation/inventory-create-panel';
import type { InventoryStockDraftSession, InventoryStockDraftValue } from '../inventory-item/inventory-stock-draft';
import {
	createInventoryStockDraftSession,
	setInventoryStockDraftDepleted,
	updateInventoryStockDraftPrecision,
	updateInventoryStockDraftQuantity,
} from '../inventory-item/inventory-stock-draft';

export interface InventoryCreateQuantityState {
	mode: InventoryCreateQuantityMode;
	stock: InventoryStockDraftSession;
}

export function createInventoryCreateQuantityState(
	mode: InventoryCreateQuantityMode,
	quantity: string,
): InventoryCreateQuantityState {
	if (mode === 'unknown') {
		return { mode, stock: createInventoryStockDraftSession(inStockValue(quantity, 'exact')) };
	}
	if (mode === 'depleted') {
		return { mode, stock: createInventoryStockDraftSession({ quantity: '0', precision: 'exact', depleted: true }) };
	}
	return { mode, stock: createInventoryStockDraftSession(inStockValue(quantity, mode)) };
}

export function setInventoryCreateQuantityMode(
	state: InventoryCreateQuantityState,
	mode: InventoryCreateQuantityMode,
): InventoryCreateQuantityState {
	if (mode === 'unknown') {
		return { ...state, mode };
	}
	if (mode === 'depleted') {
		return { mode, stock: setInventoryStockDraftDepleted(state.stock, true) };
	}
	let stock = state.stock.value.depleted
		? setInventoryStockDraftDepleted(state.stock, false)
		: state.stock;
	stock = updateInventoryStockDraftPrecision(stock, mode);
	return { mode, stock };
}

export function updateInventoryCreateQuantity(
	state: InventoryCreateQuantityState,
	quantity: string,
): InventoryCreateQuantityState {
	if (state.mode === 'unknown' || state.mode === 'depleted') {
		return state;
	}
	const stock = updateInventoryStockDraftQuantity(state.stock, quantity);
	return { mode: stock.value.depleted ? 'depleted' : state.mode, stock };
}

export function inventoryCreateQuantityFormValue(state: InventoryCreateQuantityState): {
	mode: InventoryCreateQuantityMode;
	quantity: string;
} {
	return {
		mode: state.mode,
		quantity: state.mode === 'unknown' ? '' : state.stock.value.quantity,
	};
}

function inStockValue(
	quantity: string,
	precision: 'estimated' | 'exact',
): InventoryStockDraftValue {
	return { quantity, precision, depleted: false };
}
