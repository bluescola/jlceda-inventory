import type { MarketplaceEvidence, MarketplaceReference } from '../../../features/inventory/domain/inventory-item';
import type { MarketplaceNavigator } from '../../../features/marketplace-catalog/ports/marketplace-navigator';
import { normalizeLcscPartNumber } from '../../../features/inventory/domain/inventory-item';

const LCSC_PRODUCT_BASE_URL = 'https://item.szlcsc.com';
const LCSC_SEARCH_BASE_URL = 'https://so.szlcsc.com/global.html';

export class LcscMarketplaceNavigator implements MarketplaceNavigator {
	public constructor(private readonly now: () => string = () => new Date().toISOString()) {}

	public createReference(lcscPartNumber: string, evidence: MarketplaceEvidence): MarketplaceReference {
		const normalized = requireLcscPartNumber(lcscPartNumber);
		return {
			provider: 'lcsc',
			productUrl: createLcscProductUrl(normalized),
			evidence,
			confirmedAt: this.now(),
		};
	}

	public openSearch(lcscPartNumber: string): void {
		eda.sys_Window.open(createLcscSearchUrl(requireLcscPartNumber(lcscPartNumber)), ESYS_WindowOpenTarget.BLANK);
	}
}

export function createLcscProductUrl(lcscPartNumber: string): string {
	const normalized = requireLcscPartNumber(lcscPartNumber);
	return `${LCSC_PRODUCT_BASE_URL}/${normalized.slice(1)}.html`;
}

export function createLcscSearchUrl(lcscPartNumber: string): string {
	const normalized = requireLcscPartNumber(lcscPartNumber);
	return `${LCSC_SEARCH_BASE_URL}?k=${encodeURIComponent(normalized)}`;
}

function requireLcscPartNumber(value: string): string {
	const normalized = normalizeLcscPartNumber(value);
	if (!normalized || !/^C\d+$/.test(normalized)) {
		throw new Error('A valid LCSC part number is required.');
	}
	return normalized;
}
