import type { CatalogReference, PartIdentity } from '../../inventory/domain/inventory-item';

export interface CatalogPart {
	identity: PartIdentity;
	reference: CatalogReference;
	symbolName?: string;
	footprintName?: string;
	attributes: Record<string, boolean | number | string>;
}

export interface ComponentCatalog {
	findByLcscPartNumber: (partNumber: string) => Promise<CatalogPart | undefined>;
	search: (query: string, limit?: number) => Promise<CatalogPart[]>;
}
