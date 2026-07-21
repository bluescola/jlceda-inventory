import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
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

	it('removes pasted invisible formatting before parsing headers, values, and quantities', () => {
		const rows = parseOrderFile(
			'order.csv',
			'\uFEFFC编号,商品名\u200B称,数\u200B量,大概数量,仓位\nC2\u200B5804,电\u200B阻,1\u206000,估\u200B算,A-\uFEFF01',
		);

		expect(rows).toHaveLength(1);
		expect(rows[0].item).toMatchObject({
			identity: {
				lcscPartNumber: 'C25804',
				name: '电阻',
			},
			quantity: 100,
			precision: 'estimated',
			location: 'A-01',
		});
	});

	it('parses a BIFF XLS export whose LCSC header starts on row 18', () => {
		const header = ['商品编号', '品牌', '厂家型号', '封装', '商品名称', '订购数量', '订购数量（修改后）', '是否不发此货'];
		const sheet = utils.aoa_to_sheet([
			['立创商城订单详情'],
			...Array.from({ length: 16 }, () => []),
			header,
			['C25804', 'UNI-ROYAL', '0603WAF1002T5E', '0603', '贴片电阻', '100个', '', '否'],
			['C12345', 'Brand', 'CAP-10U', '0805', '贴片电容', '60个', '80 PCS', '0'],
			['C99999', 'Brand', 'SKIP-ME', 'SOT-23', '不发货物料', '10个', '', '是'],
		]);
		const workbook = utils.book_new();
		utils.book_append_sheet(workbook, sheet, '订单详情');

		const rows = parseOrderFile('立创商城订单详情.xls', writeWorkbook(workbook, 'biff8'));

		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			rowNumber: 19,
			item: {
				identity: {
					lcscPartNumber: 'C25804',
					manufacturer: 'UNI-ROYAL',
					manufacturerPartNumber: '0603WAF1002T5E',
					package: '0603',
					name: '贴片电阻',
				},
				quantity: 100,
			},
		});
		expect(rows[1].item.quantity).toBe(80);
	});

	it('selects the worksheet with the most importable items and does not merge duplicate sheets', () => {
		const header = ['商品编号', '商品名称', '订购数量（修改后）'];
		const smaller = utils.aoa_to_sheet([
			header,
			['C1', '较小工作表物料', '1个'],
		]);
		const detailData = [
			['订单说明'],
			header,
			['C2', '电阻', '2 PCS'],
			['C3', '电容', '3件'],
			['C4', '二极管', '4 EA'],
		];
		const workbook = utils.book_new();
		utils.book_append_sheet(workbook, utils.aoa_to_sheet([['订单导出说明']]), '说明');
		utils.book_append_sheet(workbook, smaller, '辅助明细');
		utils.book_append_sheet(workbook, utils.aoa_to_sheet(detailData), '订单详情');
		utils.book_append_sheet(workbook, utils.aoa_to_sheet(detailData), '订单详情副本');

		const rows = parseOrderFile('order.xlsx', writeWorkbook(workbook, 'xlsx'));

		expect(rows.map(row => row.item.identity.lcscPartNumber)).toEqual(['C2', 'C3', 'C4']);
	});

	it('accepts UTF-8 ArrayBuffer content for CSV imports', () => {
		const content = new TextEncoder().encode('商品编号,商品名称,订购数量\nC88,连接器,12PCS').buffer;
		const rows = parseOrderFile('order.csv', content);

		expect(rows[0].item).toMatchObject({
			identity: { lcscPartNumber: 'C88' },
			quantity: 12,
		});
	});

	it('rejects Excel sheets without both an identity and quantity header', () => {
		const workbook = utils.book_new();
		utils.book_append_sheet(workbook, utils.aoa_to_sheet([
			['品牌', '封装'],
			['Brand', '0603'],
		]), '非订单数据');

		expect(() => parseOrderFile('order.xls', writeWorkbook(workbook, 'biff8'))).toThrow('No recognizable order header');
	});

	it('rejects unsupported quantity units without partially parsing the number', () => {
		expect(() => parseOrderFile('order.csv', '商品编号,订购数量\nC123,12 boxes')).toThrow('row 2');
	});

	it('does not let a header-only worksheet hide an invalid quantity error', () => {
		const header = ['商品编号', '商品名称', '订购数量'];
		const workbook = utils.book_new();
		utils.book_append_sheet(workbook, utils.aoa_to_sheet([header]), '空明细');
		utils.book_append_sheet(workbook, utils.aoa_to_sheet([
			header,
			['C123', '错误数量物料', '12 boxes'],
		]), '订单详情');

		expect(() => parseOrderFile('order.xls', writeWorkbook(workbook, 'biff8'))).toThrow('worksheet "订单详情" row 2');
	});

	it('enforces the order file size limit before parsing', () => {
		expect(() => parseOrderFile('order.xls', new ArrayBuffer(10 * 1024 * 1024 + 1))).toThrow('10 MB limit');
	});

	it('requires binary Excel content and reports unsupported file types', () => {
		expect(() => parseOrderFile('order.xls', 'not binary')).toThrow('ArrayBuffer');
		expect(() => parseOrderFile('order.txt', '商品编号,数量\nC1,1')).toThrow('Unsupported order file type');
	});
});

function writeWorkbook(workbook: ReturnType<typeof utils.book_new>, bookType: 'biff8' | 'xlsx'): ArrayBuffer {
	return write(workbook, { bookType, type: 'array' }) as ArrayBuffer;
}
