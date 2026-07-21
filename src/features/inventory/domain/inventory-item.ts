export type QuantityPrecision = 'exact' | 'estimated' | 'unknown';
export type StockState = 'in-stock' | 'depleted';
export type InventorySource = 'manual' | 'marketplace' | 'catalog' | 'order';
export type MarketplaceEvidence = 'user-confirmed' | 'order-import';
export type EdaModelStatus = 'available' | 'missing' | 'failed' | 'unchecked';

export interface MarketplaceReference {
	provider: 'lcsc';
	productUrl: string;
	evidence: MarketplaceEvidence;
	confirmedAt: string;
}

export interface EdaModelReference {
	deviceUuid: string;
	libraryUuid: string;
	symbolName?: string;
	footprintName?: string;
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
	categoryId?: string;
	identity: PartIdentity;
	marketplaceReference?: MarketplaceReference;
	edaModelReference?: EdaModelReference;
	edaModelStatus: EdaModelStatus;
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
	categoryId?: string;
	identity: PartIdentity;
	marketplaceReference?: MarketplaceReference;
	edaModelReference?: EdaModelReference;
	edaModelStatus?: EdaModelStatus;
	quantity: number | null;
	precision: QuantityPrecision;
	state?: StockState;
	location?: string;
	note?: string;
	source: InventorySource;
}

const FORMAT_CHARACTERS = /\p{Cf}/gu;

export function normalizeInventoryText(value: string): string {
	const withoutUnsafeFormatCharacters = value
		// ZWNJ and ZWJ are format characters with valid multilingual shaping semantics.
		.replaceAll(FORMAT_CHARACTERS, character => character === '\u200C' || character === '\u200D' ? character : '');
	return Array.from(withoutUnsafeFormatCharacters, character => isUnsafeControlCharacter(character) ? '' : character).join('').trim();
}

function isUnsafeControlCharacter(character: string): boolean {
	const codePoint = character.codePointAt(0) ?? 0;
	return codePoint <= 0x08
		|| codePoint === 0x0B
		|| codePoint === 0x0C
		|| (codePoint >= 0x0E && codePoint <= 0x1F)
		|| (codePoint >= 0x7F && codePoint <= 0x9F);
}

export function normalizeInventoryItem(input: NewInventoryItem, now: string, id: string): InventoryItem {
	const quantity = normalizeQuantity(input.quantity, input.precision);
	return {
		id,
		categoryId: input.categoryId,
		identity: normalizeIdentity(input.identity),
		marketplaceReference: input.marketplaceReference ? { ...input.marketplaceReference } : undefined,
		edaModelReference: input.edaModelReference ? sanitizeEdaModelReferenceText(input.edaModelReference) : undefined,
		edaModelStatus: input.edaModelReference ? 'available' : input.edaModelStatus ?? 'unchecked',
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
	return `name:${normalizeInventoryText(identity.name).toLowerCase()}`;
}

export function normalizeLcscPartNumber(value?: string): string | undefined {
	const cleaned = cleanOptional(value)?.replaceAll(/\s+/g, '').toUpperCase();
	if (!cleaned) {
		return undefined;
	}
	return /^\d+$/.test(cleaned) ? `C${cleaned}` : cleaned;
}

function normalizeIdentity(identity: PartIdentity): PartIdentity {
	const normalized = sanitizeIdentityText(identity);
	return {
		...normalized,
		supplierId: normalized.supplierId ?? normalized.lcscPartNumber,
	};
}

export function sanitizeInventoryItemText(item: InventoryItem): InventoryItem {
	return {
		...item,
		identity: sanitizeIdentityText(item.identity),
		edaModelReference: item.edaModelReference ? sanitizeEdaModelReferenceText(item.edaModelReference) : undefined,
		location: cleanOptional(item.location),
		note: cleanOptional(item.note),
	};
}

export function sanitizeEdaModelReferenceText(reference: EdaModelReference): EdaModelReference {
	return {
		...reference,
		symbolName: cleanOptional(reference.symbolName),
		footprintName: cleanOptional(reference.footprintName),
	};
}

function sanitizeIdentityText(identity: PartIdentity): PartIdentity {
	const name = normalizeInventoryText(identity.name);
	if (!name) {
		throw new Error('Component name is required.');
	}
	const lcscPartNumber = normalizeLcscPartNumber(identity.lcscPartNumber ?? identity.supplierId);
	return {
		name,
		lcscPartNumber,
		supplierId: cleanOptional(identity.supplierId),
		manufacturerPartNumber: cleanOptional(identity.manufacturerPartNumber),
		manufacturer: cleanOptional(identity.manufacturer),
		package: cleanOptional(identity.package),
		description: cleanOptional(identity.description),
	};
}

function cleanOptional(value?: string): string | undefined {
	const cleaned = value === undefined ? undefined : normalizeInventoryText(value);
	return cleaned || undefined;
}
