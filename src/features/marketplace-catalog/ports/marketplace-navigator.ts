import type { MarketplaceEvidence, MarketplaceReference } from '../../inventory/domain/inventory-item';

export interface MarketplaceNavigator {
	createReference: (lcscPartNumber: string, evidence: MarketplaceEvidence) => MarketplaceReference;
	openSearch: (lcscPartNumber: string) => void;
}
