import { describe, expect, it } from 'vitest';
import {
	formatStructuredLocation,
	normalizeDatasheetUrl,
	normalizeStructuredLocation,
} from '../../src/features/inventory/domain/inventory-metadata';

describe('inventory metadata', () => {
	it('accepts only safe HTTP(S) datasheet URLs', () => {
		expect(normalizeDatasheetUrl(' https://example.com/datasheet.pdf ')).toBe('https://example.com/datasheet.pdf');
		expect(normalizeDatasheetUrl('')).toBeUndefined();
		expect(() => normalizeDatasheetUrl('file:///C:/secret.pdf')).toThrow('HTTP or HTTPS');
		expect(() => normalizeDatasheetUrl('https://user:password@example.com/a.pdf')).toThrow('credentials');
	});

	it('normalizes structured location fields without replacing the legacy free-text location', () => {
		const location = normalizeStructuredLocation({
			cabinet: ' Cabinet A ',
			box: 'Box 12',
			row: ' 3 ',
			column: '',
		});

		expect(location).toEqual({ cabinet: 'Cabinet A', box: 'Box 12', row: '3', column: undefined });
		expect(formatStructuredLocation(location)).toBe('Cabinet A / Box 12 / 3');
		expect(normalizeStructuredLocation({})).toBeUndefined();
	});

	it('rejects oversized or non-text structured location fields', () => {
		expect(() => normalizeStructuredLocation({ cabinet: 'x'.repeat(65) })).toThrow('64-character');
		expect(() => normalizeStructuredLocation({ row: 3 })).toThrow('must be text');
	});
});
