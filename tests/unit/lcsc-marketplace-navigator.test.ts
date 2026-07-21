import { describe, expect, it } from 'vitest';
import { createLcscProductUrl, createLcscSearchUrl, LcscMarketplaceNavigator } from '../../src/platform/jlceda-v3/eda/lcsc-marketplace-navigator';

describe('lcscMarketplaceNavigator', () => {
	it('creates domestic marketplace links from normalized LCSC part numbers', () => {
		expect(createLcscProductUrl('233991')).toBe('https://item.szlcsc.com/233991.html');
		expect(createLcscSearchUrl('c233991')).toBe('https://so.szlcsc.com/global.html?k=C233991');
	});

	it('creates an evidence-bearing marketplace reference', () => {
		const navigator = new LcscMarketplaceNavigator(() => '2026-07-20T07:00:00.000Z');
		expect(navigator.createReference('C233991', 'user-confirmed')).toEqual({
			provider: 'lcsc',
			productUrl: 'https://item.szlcsc.com/233991.html',
			evidence: 'user-confirmed',
			confirmedAt: '2026-07-20T07:00:00.000Z',
		});
	});

	it('rejects values that are not LCSC C numbers', () => {
		expect(() => createLcscProductUrl('GMI9745')).toThrow('valid LCSC part number');
	});
});
