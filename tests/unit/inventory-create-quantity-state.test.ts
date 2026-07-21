import { describe, expect, it } from 'vitest';
import {
	createInventoryCreateQuantityState,
	inventoryCreateQuantityFormValue,
	setInventoryCreateQuantityMode,
	updateInventoryCreateQuantity,
} from '../../src/platform/jlceda-v3/iframe/inventory-create/inventory-create-quantity-state';

describe('inventory create quantity state', () => {
	it('restores the displayed quantity and precision after depleted is cancelled', () => {
		let state = createInventoryCreateQuantityState('estimated', '37');
		state = setInventoryCreateQuantityMode(state, 'depleted');
		expect(inventoryCreateQuantityFormValue(state)).toEqual({ mode: 'depleted', quantity: '0' });

		state = setInventoryCreateQuantityMode(state, 'estimated');
		expect(inventoryCreateQuantityFormValue(state)).toEqual({ mode: 'estimated', quantity: '37' });
	});

	it('keeps the previous known quantity while switching through unknown', () => {
		let state = createInventoryCreateQuantityState('exact', '12');
		state = setInventoryCreateQuantityMode(state, 'unknown');
		expect(inventoryCreateQuantityFormValue(state)).toEqual({ mode: 'unknown', quantity: '' });

		state = setInventoryCreateQuantityMode(state, 'estimated');
		expect(inventoryCreateQuantityFormValue(state)).toEqual({ mode: 'estimated', quantity: '12' });
	});

	it('automatically changes zero to depleted and restores the value before zero', () => {
		let state = createInventoryCreateQuantityState('exact', '8');
		state = updateInventoryCreateQuantity(state, '0');
		expect(inventoryCreateQuantityFormValue(state)).toEqual({ mode: 'depleted', quantity: '0' });

		state = setInventoryCreateQuantityMode(state, 'exact');
		expect(inventoryCreateQuantityFormValue(state)).toEqual({ mode: 'exact', quantity: '8' });
	});
});
