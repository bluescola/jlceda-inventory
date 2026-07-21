import { describe, expect, it } from 'vitest';
import {
	extractOrderNumber,
	fingerprintOrderFile,
	identifyOrderFile,
} from '../../src/features/order-import/application/order-file-identity';

describe('order file identity', () => {
	it('extracts and normalizes an LCSC order number from the file name', () => {
		expect(extractOrderNumber('立创商城订单详情-so25072711175 (1).xls')).toBe('SO25072711175');
		expect(extractOrderNumber('SO-2505118152.xlsx')).toBe('SO2505118152');
	});

	it('does not treat an embedded SO fragment as an order number', () => {
		expect(extractOrderNumber('NOSO25072711175.xls')).toBeUndefined();
		expect(extractOrderNumber('立创商城物料明细对账单.xls')).toBeUndefined();
	});

	it('can fall back to text content when the file name has no order number', () => {
		expect(extractOrderNumber('订单详情.csv', '订单编号,SO2511173157')).toBe('SO2511173157');
	});

	it('returns the same SHA-256 fingerprint for identical bytes', async () => {
		const first = new TextEncoder().encode('same order export').buffer;
		const second = new TextEncoder().encode('same order export').buffer;

		await expect(fingerprintOrderFile(first)).resolves.toBe(
			'0b5f7785b837c4c3cf27797272e461b7d577c8997ec304942204eacde0930a06',
		);
		await expect(fingerprintOrderFile(second)).resolves.toBe(await fingerprintOrderFile(first));
	});

	it('returns different fingerprints when file bytes differ', async () => {
		const first = new TextEncoder().encode('order A').buffer;
		const second = new TextEncoder().encode('order B').buffer;

		expect(await fingerprintOrderFile(first)).not.toBe(await fingerprintOrderFile(second));
	});

	it('builds an identity suitable for a parsed order file', async () => {
		const content = new TextEncoder().encode('order rows').buffer;
		const identity = await identifyOrderFile('立创商城订单详情-SO2511094293.xls', content);

		expect(identity.orderNumber).toBe('SO2511094293');
		expect(identity.fingerprint).toMatch(/^[0-9a-f]{64}$/);
	});
});
