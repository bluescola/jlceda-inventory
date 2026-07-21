import { describe, expect, it } from 'vitest';
import {
	createInventoryStockDraftSession,
	setInventoryStockDraftDepleted,
	updateInventoryStockDraftQuantity,
} from '../../src/platform/jlceda-v3/iframe/inventory-item/inventory-stock-draft';

describe('inventory item stock draft', () => {
	it('restores the displayed quantity and precision after depleted is selected and then cancelled', () => {
		const initial = createInventoryStockDraftSession({
			quantity: '34',
			precision: 'estimated',
			depleted: false,
		});

		const depleted = setInventoryStockDraftDepleted(initial, true);
		expect(depleted.value).toEqual({ quantity: '0', precision: 'exact', depleted: true });

		const restored = setInventoryStockDraftDepleted(depleted, false);
		expect(restored.value).toEqual({ quantity: '34', precision: 'estimated', depleted: false });
	});

	it('also restores the last in-stock value after zero automatically marks the draft depleted', () => {
		const initial = createInventoryStockDraftSession({
			quantity: '12',
			precision: 'exact',
			depleted: false,
		});

		const depleted = updateInventoryStockDraftQuantity(initial, '0');
		const restored = setInventoryStockDraftDepleted(depleted, false);

		expect(restored.value).toEqual({ quantity: '12', precision: 'exact', depleted: false });
	});

	it('requires a new quantity when an originally depleted record is unchecked', () => {
		const initial = createInventoryStockDraftSession({
			quantity: '0',
			precision: 'exact',
			depleted: true,
		});

		const restored = setInventoryStockDraftDepleted(initial, false);

		expect(restored.value).toEqual({ quantity: '', precision: 'exact', depleted: false });
	});
});
