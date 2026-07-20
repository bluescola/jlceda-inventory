import type { InventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import type { InventoryRepository } from '../../src/features/inventory/ports/inventory-repository';
import { describe, expect, it } from 'vitest';
import { InventoryService } from '../../src/features/inventory/application/inventory-service';
import { createEmptyInventoryDocument } from '../../src/features/inventory/domain/inventory-document';

class MemoryInventoryRepository implements InventoryRepository {
	private document = createEmptyInventoryDocument('2026-01-01T00:00:00.000Z');

	public load = async (): Promise<InventoryDocument> => structuredClone(this.document);

	public save = async (document: InventoryDocument): Promise<void> => {
		this.document = structuredClone(document);
	};
}

function createService(): InventoryService {
	let id = 0;
	let second = 0;
	return new InventoryService(
		new MemoryInventoryRepository(),
		() => `2026-01-01T00:00:${String(second++).padStart(2, '0')}.000Z`,
		() => `item-${++id}`,
	);
}

describe('inventoryService', () => {
	it('stores exact and estimated quantities and can mark a part depleted', async () => {
		const service = createService();
		const exact = await service.add({
			identity: { name: '10k resistor', lcscPartNumber: '25804' },
			quantity: 100,
			precision: 'exact',
			source: 'manual',
		});

		expect(exact.identity.lcscPartNumber).toBe('C25804');
		expect(exact.quantity).toBe(100);
		expect(exact.state).toBe('in-stock');

		const depleted = await service.markDepleted(exact.id);
		expect(depleted.quantity).toBe(0);
		expect(depleted.precision).toBe('exact');
		expect(depleted.state).toBe('depleted');

		const restored = await service.updateQuantity(exact.id, 40, 'estimated');
		expect(restored.quantity).toBe(40);
		expect(restored.precision).toBe('estimated');
		expect(restored.state).toBe('in-stock');
	});

	it('merges duplicate LCSC parts using the selected strategy', async () => {
		const service = createService();
		await service.add({
			identity: { name: 'Resistor', lcscPartNumber: 'C25804' },
			quantity: 50,
			precision: 'exact',
			source: 'catalog',
		});

		const added = await service.add({
			identity: { name: 'Resistor 0603', lcscPartNumber: '25804', package: '0603' },
			quantity: 20,
			precision: 'estimated',
			source: 'order',
		}, 'add');

		expect(added.quantity).toBe(70);
		expect(added.precision).toBe('estimated');
		expect(added.identity.package).toBe('0603');
		expect(await service.list()).toHaveLength(1);

		const replaced = await service.add({
			identity: { name: 'Resistor', lcscPartNumber: 'C25804' },
			quantity: 8,
			precision: 'exact',
			source: 'order',
		}, 'replace');
		expect(replaced.quantity).toBe(8);
		expect(replaced.precision).toBe('exact');
	});

	it('rejects negative and fractional quantities', async () => {
		const service = createService();
		await expect(service.add({
			identity: { name: 'Invalid part' },
			quantity: -1,
			precision: 'exact',
			source: 'manual',
		})).rejects.toThrow('non-negative integer');
	});
});
