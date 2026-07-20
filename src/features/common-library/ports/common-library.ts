import type { CatalogReference } from '../../inventory/domain/inventory-item';

export type CommonLibraryTarget = 'favorite' | 'personal';

export interface CommonLibrary {
	copy: (reference: CatalogReference, newName?: string) => Promise<CommonLibraryTarget | undefined>;
}
