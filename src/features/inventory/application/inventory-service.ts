import type { InventoryDocument } from '../domain/inventory-document';
import type { InventoryItem, NewInventoryItem, PartIdentity, QuantityPrecision } from '../domain/inventory-item';
import type { InventoryRepository } from '../ports/inventory-repository';
import { inventoryIdentityKey, normalizeInventoryItem, normalizeQuantity } from '../domain/inventory-item';

export type DuplicateStrategy = 'add' | 'replace' | 'skip';

export interface ImportInventoryResult {
	added: number;
	merged: number;
	skipped: number;
}

export class InventoryService {
	public constructor(
		private readonly repository: InventoryRepository,
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly createId: () => string = () => crypto.randomUUID(),
	) {}

	public async list(includeDepleted = true): Promise<InventoryItem[]> {
		const document = await this.repository.load();
		return document.items
			.filter(item => includeDepleted || item.state === 'in-stock')
			.toSorted(compareInventoryItems);
	}

	public async get(id: string): Promise<InventoryItem | undefined> {
		const document = await this.repository.load();
		return document.items.find(item => item.id === id);
	}

	public async add(input: NewInventoryItem, strategy: DuplicateStrategy = 'add'): Promise<InventoryItem> {
		const document = await this.repository.load();
		const timestamp = this.now();
		const candidate = normalizeInventoryItem(input, timestamp, this.createId());
		const existingIndex = document.items.findIndex(item => inventoryIdentityKey(item.identity) === inventoryIdentityKey(candidate.identity));

		if (existingIndex < 0) {
			document.items.push(candidate);
			await this.persist(document, timestamp);
			return candidate;
		}

		if (strategy === 'skip') {
			return document.items[existingIndex];
		}

		const merged = mergeInventoryItems(document.items[existingIndex], candidate, strategy, timestamp);
		document.items[existingIndex] = merged;
		await this.persist(document, timestamp);
		return merged;
	}

	public async updateQuantity(id: string, quantity: number | null, precision: QuantityPrecision): Promise<InventoryItem> {
		return this.update(id, (item, timestamp) => {
			const normalizedQuantity = normalizeQuantity(quantity, precision);
			return {
				...item,
				quantity: normalizedQuantity,
				precision,
				state: normalizedQuantity === 0 ? 'depleted' : 'in-stock',
				updatedAt: timestamp,
				revision: item.revision + 1,
			};
		});
	}

	public async markDepleted(id: string): Promise<InventoryItem> {
		return this.updateQuantity(id, 0, 'exact');
	}

	public async remove(id: string): Promise<boolean> {
		const document = await this.repository.load();
		const nextItems = document.items.filter(item => item.id !== id);
		if (nextItems.length === document.items.length) {
			return false;
		}
		document.items = nextItems;
		await this.persist(document, this.now());
		return true;
	}

	public async import(items: NewInventoryItem[], strategy: DuplicateStrategy): Promise<ImportInventoryResult> {
		const document = await this.repository.load();
		const timestamp = this.now();
		const result: ImportInventoryResult = { added: 0, merged: 0, skipped: 0 };

		for (const input of items) {
			const candidate = normalizeInventoryItem(input, timestamp, this.createId());
			const existingIndex = document.items.findIndex(item => inventoryIdentityKey(item.identity) === inventoryIdentityKey(candidate.identity));
			if (existingIndex < 0) {
				document.items.push(candidate);
				result.added += 1;
			}
			else if (strategy === 'skip') {
				result.skipped += 1;
			}
			else {
				document.items[existingIndex] = mergeInventoryItems(document.items[existingIndex], candidate, strategy, timestamp);
				result.merged += 1;
			}
		}

		if (result.added > 0 || result.merged > 0) {
			await this.persist(document, timestamp);
		}
		return result;
	}

	public async exportDocument(): Promise<InventoryDocument> {
		return this.repository.load();
	}

	private async update(id: string, transform: (item: InventoryItem, timestamp: string) => InventoryItem): Promise<InventoryItem> {
		const document = await this.repository.load();
		const index = document.items.findIndex(item => item.id === id);
		if (index < 0) {
			throw new Error(`Inventory item not found: ${id}`);
		}
		const timestamp = this.now();
		const updated = transform(document.items[index], timestamp);
		document.items[index] = updated;
		await this.persist(document, timestamp);
		return updated;
	}

	private async persist(document: InventoryDocument, timestamp: string): Promise<void> {
		document.revision += 1;
		document.updatedAt = timestamp;
		await this.repository.save(document);
	}
}

function mergeInventoryItems(existing: InventoryItem, candidate: InventoryItem, strategy: Exclude<DuplicateStrategy, 'skip'>, timestamp: string): InventoryItem {
	const quantity = strategy === 'replace'
		? candidate.quantity
		: addQuantities(existing.quantity, candidate.quantity);
	const precision = strategy === 'replace'
		? candidate.precision
		: mergePrecision(existing.precision, candidate.precision, quantity);

	return {
		...existing,
		identity: mergeIdentity(existing.identity, candidate.identity),
		catalogReference: existing.catalogReference ?? candidate.catalogReference,
		quantity,
		precision,
		state: quantity === 0 || (quantity === null && strategy === 'replace' && candidate.state === 'depleted') ? 'depleted' : 'in-stock',
		location: candidate.location ?? existing.location,
		note: candidate.note ?? existing.note,
		updatedAt: timestamp,
		revision: existing.revision + 1,
	};
}

function addQuantities(current: number | null, incoming: number | null): number | null {
	if (current === null) {
		return incoming;
	}
	if (incoming === null) {
		return current;
	}
	return current + incoming;
}

function mergePrecision(current: QuantityPrecision, incoming: QuantityPrecision, quantity: number | null): QuantityPrecision {
	if (quantity === null) {
		return 'unknown';
	}
	return current === 'estimated' || incoming === 'estimated' || current === 'unknown' || incoming === 'unknown'
		? 'estimated'
		: 'exact';
}

function mergeIdentity(current: PartIdentity, incoming: PartIdentity): PartIdentity {
	return {
		name: incoming.name || current.name,
		lcscPartNumber: incoming.lcscPartNumber ?? current.lcscPartNumber,
		supplierId: incoming.supplierId ?? current.supplierId,
		manufacturerPartNumber: incoming.manufacturerPartNumber ?? current.manufacturerPartNumber,
		manufacturer: incoming.manufacturer ?? current.manufacturer,
		package: incoming.package ?? current.package,
		description: incoming.description ?? current.description,
	};
}

function compareInventoryItems(left: InventoryItem, right: InventoryItem): number {
	if (left.state !== right.state) {
		return left.state === 'in-stock' ? -1 : 1;
	}
	return left.identity.name.localeCompare(right.identity.name);
}
