import { describe, expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import {
	MAX_BOM_WORKSHEET_ROWS,
	readBomFile,
} from '../../src/features/bom-analysis/application/read-bom-file';

describe('readBomFile', () => {
	it('reads a quoted CSV and ranks a header below introductory rows', () => {
		const parsed = readBomFile('board-bom.csv', [
			'BOM export',
			'LCSC Part #,Designator,Qty,Comment,Footprint',
			'C25804,"R1, R2",2,"Resistor, 10k",0603',
		].join('\n'));

		expect(parsed).toMatchObject({ fileName: 'board-bom.csv', format: 'csv' });
		expect(parsed.sheets).toHaveLength(1);
		expect(parsed.sheets[0].rows[2][3]).toBe('Resistor, 10k');
		expect(parsed.sheets[0].headerCandidates[0]).toMatchObject({
			rowIndex: 1,
			rowNumber: 2,
			suggestedMapping: {
				lcscPartNumber: 0,
				designators: 1,
				quantity: 2,
				name: 3,
				package: 4,
			},
		});
	});

	it('detects tab-delimited TXT content supplied as UTF-8 bytes', () => {
		const content = new TextEncoder().encode('位号\t数量\t厂家型号\nU1\t1\tSTM32F103').buffer;
		const parsed = readBomFile('board.txt', content);

		expect(parsed).toMatchObject({ format: 'txt', encoding: 'utf-8' });
		expect(parsed.sheets[0].rows[1]).toEqual(['U1', '1', 'STM32F103']);
		expect(parsed.sheets[0].headerCandidates[0].suggestedMapping).toMatchObject({
			designators: 0,
			quantity: 1,
			manufacturerPartNumber: 2,
		});
	});

	it('decodes common GB18030 CSV exports and exposes the detected encoding', () => {
		const content = new Uint8Array([
			0xCE,
			0xBB,
			0xBA,
			0xC5,
			0x2C,
			0xCA,
			0xFD,
			0xC1,
			0xBF,
			0x0A,
			0x52,
			0x31,
			0x2C,
			0x31,
		]).buffer;
		const parsed = readBomFile('gbk-export.csv', content);

		expect(parsed.encoding).toBe('gb18030');
		expect(parsed.sheets[0].rows).toEqual([
			['位号', '数量'],
			['R1', '1'],
		]);
	});

	it('returns every non-empty Excel worksheet with independent header candidates', () => {
		const workbook = utils.book_new();
		utils.book_append_sheet(workbook, utils.aoa_to_sheet([
			['说明'],
			['立创编号', '位号', '单板用量'],
			['C1', 'R1', 1],
		]), 'Main');
		utils.book_append_sheet(workbook, utils.aoa_to_sheet([
			['MPN', 'References', 'Quantity'],
			['ABC-1', 'U1 U2', 2],
		]), 'Alternate');
		utils.book_append_sheet(workbook, utils.aoa_to_sheet([]), 'Empty');

		const parsed = readBomFile('board.xlsx', writeWorkbook(workbook, 'xlsx'));

		expect(parsed.sheets.map(sheet => sheet.name)).toEqual(['Main', 'Alternate']);
		expect(parsed.sheets.map(sheet => sheet.headerCandidates[0].rowNumber)).toEqual([2, 1]);
	});

	it('reads legacy BIFF XLS workbooks through the same bounded worksheet model', () => {
		const workbook = utils.book_new();
		utils.book_append_sheet(workbook, utils.aoa_to_sheet([
			['商品编号', '器件位号', '数量'],
			['C88', 'U1', 1],
		]), 'BOM');

		const parsed = readBomFile('legacy.xls', writeWorkbook(workbook, 'biff8'));

		expect(parsed.format).toBe('xls');
		expect(parsed.sheets[0].rows[1]).toEqual(['C88', 'U1', '1']);
		expect(parsed.sheets[0].headerCandidates[0].suggestedMapping).toMatchObject({
			lcscPartNumber: 0,
			designators: 1,
			quantity: 2,
		});
	});

	it('reports duplicate semantic columns without choosing the later column', () => {
		const parsed = readBomFile('duplicate.csv', 'LCSC,Qty,Quantity\nC1,1,1');
		const candidate = parsed.sheets[0].headerCandidates[0];

		expect(candidate.suggestedMapping.quantity).toBe(1);
		expect(candidate.duplicateFields).toEqual(['quantity']);
		expect(candidate.recognizedColumnCount).toBe(3);
	});

	it('enforces file, row, column, worksheet, and extension limits', () => {
		expect(() => readBomFile('large.csv', new ArrayBuffer(10 * 1024 * 1024 + 1))).toThrow('10 MB limit');
		expect(() => readBomFile('wide.csv', `${Array.from({ length: 129 }, (_, index) => `C${index}`).join(',')}\n${Array.from({ length: 129 }).fill('1').join(',')}`))
			.toThrow('128-column limit');
		expect(() => readBomFile('long.txt', Array.from({ length: MAX_BOM_WORKSHEET_ROWS + 1 }, () => 'value').join('\n')))
			.toThrow('10000-data-row limit');

		const workbook = utils.book_new();
		for (let index = 0; index < 33; index += 1) {
			utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Qty', 'Ref'], [1, `R${index}`]]), `S${index}`);
		}
		expect(() => readBomFile('many.xlsx', writeWorkbook(workbook, 'xlsx'))).toThrow('32-worksheet limit');
		expect(() => readBomFile('board.json', '[]')).toThrow('Unsupported BOM file type');
		expect(() => readBomFile('board.xlsx', 'not binary')).toThrow('ArrayBuffer');
	});

	it('rejects bytes that are invalid in every supported text encoding', () => {
		expect(() => readBomFile('board.csv', new Uint8Array([0x81, 0x20, 0xFF]).buffer)).toThrow('GB18030');
	});
});

function writeWorkbook(workbook: ReturnType<typeof utils.book_new>, bookType: 'biff8' | 'xlsx'): ArrayBuffer {
	return write(workbook, { bookType, type: 'array' }) as ArrayBuffer;
}
