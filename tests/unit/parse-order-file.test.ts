import { describe, expect, it } from 'vitest';
import { parseOrderFile } from '../../src/features/order-import/application/parse-order-file';

describe('parseOrderFile', () => {
	it('parses quoted CSV rows with Chinese headers and per-row depleted state', () => {
		const csv = [
			'C编号,商品名称,数量,大概数量,是否用完,仓位',
			'C25804,"电阻, 10k",100,是,否,A-01',
			'C12345,电容,20,否,是,B-02',
		].join('\n');

		const rows = parseOrderFile('order.csv', csv);
		expect(rows).toHaveLength(2);
		expect(rows[0].item.identity.name).toBe('电阻, 10k');
		expect(rows[0].item.quantity).toBe(100);
		expect(rows[0].item.precision).toBe('estimated');
		expect(rows[0].item.location).toBe('A-01');
		expect(rows[1].item.quantity).toBe(0);
		expect(rows[1].item.state).toBe('depleted');
		expect(rows[1].hasExplicitState).toBe(true);
	});

	it('parses JSON arrays and applies a default state only when no status is supplied', () => {
		const rows = parseOrderFile('order.json', JSON.stringify([
			{ 'LCSC Part #': 'C111', 'Name': 'LED', 'Qty': 5 },
			{ 'LCSC Part #': 'C222', 'Name': 'Switch', 'Qty': 2, 'Status': 'in-stock' },
		]), 'depleted');

		expect(rows[0].item.state).toBe('depleted');
		expect(rows[0].item.quantity).toBe(0);
		expect(rows[0].hasExplicitState).toBe(false);
		expect(rows[1].item.state).toBe('in-stock');
		expect(rows[1].item.quantity).toBe(2);
	});

	it('rejects invalid quantities with a row number', () => {
		expect(() => parseOrderFile('order.csv', 'C编号,数量\nC123,1.5')).toThrow('row 2');
	});
});
