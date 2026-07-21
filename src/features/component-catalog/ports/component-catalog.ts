import type { EdaModelReference, PartIdentity } from '../../inventory/domain/inventory-item';

export interface EdaModel {
	identity: PartIdentity;
	reference: EdaModelReference;
	symbolName?: string;
	footprintName?: string;
	attributes: Record<string, boolean | number | string>;
}

export interface EdaModelCatalog {
	findByLcscPartNumber: (partNumber: string) => Promise<EdaModel | undefined>;
	search: (query: string, limit?: number) => Promise<EdaModel[]>;
}
