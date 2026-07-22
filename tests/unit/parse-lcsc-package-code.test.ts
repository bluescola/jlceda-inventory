import { describe, expect, it } from 'vitest';
import { MAX_PACKAGE_CODE_LENGTH, parseLcscPackageCode } from '../../src/features/package-scan/application/parse-lcsc-package-code';

describe('parseLcscPackageCode', () => {
	it('parses the supported LCSC package fields', () => {
		expect(parseLcscPackageCode('{pc:c12345,pm: STM32F103C8T6 ,qty:50}')).toEqual({
			status: 'parsed',
			value: {
				lcscPartNumber: 'C12345',
				manufacturerPartNumber: 'STM32F103C8T6',
				quantity: 50,
			},
		});
	});

	it('normalizes a numeric part number and defaults a missing quantity to one', () => {
		expect(parseLcscPackageCode('pc: 307423\npm: RC0603FR-0710KL')).toEqual({
			status: 'parsed',
			value: {
				lcscPartNumber: 'C307423',
				manufacturerPartNumber: 'RC0603FR-0710KL',
				quantity: 1,
			},
		});
	});

	it.each([
		['', 'empty'],
		['pm:ABC,qty:1', 'missing-part-number'],
		['pc:not-a-c-number,qty:1', 'invalid-part-number'],
		['pc:C123,qty:0', 'invalid-quantity'],
		['pc:C123,qty:-1', 'invalid-quantity'],
		['pc:C123,qty:1.5', 'invalid-quantity'],
		['pc:C123,pc:C456,qty:1', 'conflicting-field'],
	] as const)('rejects %s as %s', (input, reason) => {
		expect(parseLcscPackageCode(input)).toEqual({ status: 'invalid', reason });
	});

	it('rejects input above the scanner payload limit', () => {
		expect(parseLcscPackageCode(`pc:C123,pm:${'x'.repeat(MAX_PACKAGE_CODE_LENGTH)}`)).toEqual({
			status: 'invalid',
			reason: 'too-long',
		});
	});

	it('rejects conflicting duplicate quantities while accepting identical duplicates', () => {
		expect(parseLcscPackageCode('pc:C123,qty:2;qty:3')).toEqual({
			status: 'invalid',
			reason: 'conflicting-field',
		});
		expect(parseLcscPackageCode('pc:C123;pc:C123;qty:2')).toEqual({
			status: 'parsed',
			value: { lcscPartNumber: 'C123', quantity: 2 },
		});
	});
});
