export type QuantityPrecision = 'exact' | 'estimated' | 'unknown';
export type StockState = 'in-stock' | 'depleted';
export type InventorySource = 'manual' | 'catalog' | 'order';

export interface CatalogReference {
	deviceUuid: string;
	libraryUuid: string;
}

export interface PartIdentity {
	name: string;
	lcscPartNumber?: string;
	supplierId?: string;
	manufacturerPartNumber?: string;
	manufacturer?: string;
	package?: string;
	description?: string;
}

export interface InventoryItem {
	id: string;
	identity: PartIdentity;
	catalogReference?: CatalogReference;
	quantity: number | null;
	precision: QuantityPrecision;
	state: StockState;
	location?: string;
	note?: string;
	source: InventorySource;
	createdAt: string;
	updatedAt: string;
	revision: number;
}

export interface NewInventoryItem {
	identity: PartIdentity;
	catalogReference?: CatalogReference;
	quantity: number | null;
	precision: QuantityPrecision;
	state?: StockState;
	location?: string;
	note?: string;
	source: InventorySource;
}

export function normalizeInventoryItem(input: NewInventoryItem, now: string, id: string): InventoryItem {
	const quantity = normalizeQuantity(input.quantity, input.precision);
	return {
		id,
		identity: normalizeIdentity(input.identity),
		catalogReference: input.catalogReference,
		quantity,
		precision: input.precision,
		state: input.state === 'depleted' || quantity === 0 ? 'depleted' : 'in-stock',
		location: cleanOptional(input.location),
		note: cleanOptional(input.note),
		source: input.source,
		createdAt: now,
		updatedAt: now,
		revision: 1,
	};
}

export function normalizeQuantity(quantity: number | null, precision: QuantityPrecision): number | null {
	if (precision === 'unknown') {
		return null;
	}
	if (!Number.isInteger(quantity) || quantity === null || quantity < 0) {
		throw new Error('Quantity must be a non-negative integer.');
	}
	return quantity;
}

export function inventoryIdentityKey(identity: PartIdentity): string {
	const lcscPartNumber = normalizeLcscPartNumber(identity.lcscPartNumber ?? identity.supplierId);
	if (lcscPartNumber) {
		return `lcsc:${lcscPartNumber.toLowerCase()}`;
	}
	const manufacturer = cleanOptional(identity.manufacturer)?.toLowerCase() ?? '';
	const partNumber = cleanOptional(identity.manufacturerPartNumber)?.toLowerCase();
	if (partNumber) {
		return `mpn:${manufacturer}:${partNumber}`;
	}
	return `name:${identity.name.trim().toLowerCase()}`;
}

export function normalizeLcscPartNumber(value?: string): string | undefined {
	const cleaned = cleanOptional(value)?.replaceAll(/\s+/g, '').toUpperCase();
	if (!cleaned) {
		return undefined;
	}
	return /^\d+$/.test(cleaned) ? `C${cleaned}` : cleaned;
}

function normalizeIdentity(identity: PartIdentity): PartIdentity {
	const name = identity.name.trim();
	if (!name) {
		throw new Error('Component name is required.');
	}
	const lcscPartNumber = normalizeLcscPartNumber(identity.lcscPartNumber ?? identity.supplierId);
	return {
		name,
		lcscPartNumber,
		supplierId: cleanOptional(identity.supplierId) ?? lcscPartNumber,
		manufacturerPartNumber: cleanOptional(identity.manufacturerPartNumber),
		manufacturer: cleanOptional(identity.manufacturer),
		package: cleanOptional(identity.package),
		description: cleanOptional(identity.description),
	};
}

function cleanOptional(value?: string): string | undefined {
	const cleaned = value?.trim();
	return cleaned || undefined;
}
