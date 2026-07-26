import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	formatStructuredLocation,
	normalizeDatasheetUrl,
	normalizeStructuredLocation,
} from '../../src/features/inventory/domain/inventory-metadata';

afterEach(() => vi.unstubAllGlobals());

describe('inventory metadata', () => {
	it('accepts only safe HTTP(S) datasheet URLs', () => {
		expect(normalizeDatasheetUrl(' https://example.com/datasheet.pdf ')).toBe('https://example.com/datasheet.pdf');
		expect(normalizeDatasheetUrl('')).toBeUndefined();
		expect(() => normalizeDatasheetUrl('file:///C:/secret.pdf')).toThrow('HTTP or HTTPS');
		expect(() => normalizeDatasheetUrl('https://user:password@example.com/a.pdf')).toThrow('credentials');
	});

	it('validates safe datasheet URLs when the host does not provide URL', () => {
		vi.stubGlobal('URL', undefined);

		expect(normalizeDatasheetUrl('https://example.com/test.pdf')).toBe('https://example.com/test.pdf');
		expect(normalizeDatasheetUrl('http://127.0.0.1:8080/data.pdf?revision=1#page=2'))
			.toBe('http://127.0.0.1:8080/data.pdf?revision=1#page=2');
		expect(() => normalizeDatasheetUrl('javascript:alert(1)')).toThrow('HTTP or HTTPS');
		expect(() => normalizeDatasheetUrl('ftp://example.com/a.pdf')).toThrow('HTTP or HTTPS');
		expect(() => normalizeDatasheetUrl('https://user:pass@example.com/a.pdf')).toThrow('credentials');
		expect(() => normalizeDatasheetUrl('https://')).toThrow('invalid');
		expect(() => normalizeDatasheetUrl('https://example.com:abc/a.pdf')).toThrow('invalid');
		expect(() => normalizeDatasheetUrl('https://example.com:65536/a.pdf')).toThrow('invalid');
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
