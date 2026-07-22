import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_BOM_FILE_BYTES } from '../../src/features/bom-analysis/application/read-bom-file';
import { MAX_ORDER_FILE_BYTES, MAX_ORDER_IMPORT_FILES } from '../../src/features/order-import/application/parse-order-file';
import { EdaFileClient } from '../../src/platform/jlceda-v3/eda/file-client';

describe('edaFileClient', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('picks supported order files and returns their binary content in selection order', async () => {
		const firstContent = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0]).buffer;
		const secondContent = new TextEncoder().encode('catalogNumber,quantity\nC2,20').buffer;
		const firstArrayBuffer = vi.fn().mockResolvedValue(firstContent);
		const secondArrayBuffer = vi.fn().mockResolvedValue(secondContent);
		const openReadFileDialog = vi.fn().mockResolvedValue([
			{ name: 'first-order.xls', arrayBuffer: firstArrayBuffer },
			{ name: 'second-order.csv', arrayBuffer: secondArrayBuffer },
		]);
		vi.stubGlobal('eda', { sys_FileSystem: { openReadFileDialog } });

		await expect(new EdaFileClient().pickOrderFiles()).resolves.toEqual([
			{ name: 'first-order.xls', content: firstContent },
			{ name: 'second-order.csv', content: secondContent },
		]);
		expect(openReadFileDialog).toHaveBeenCalledWith(['xls', 'xlsx', 'csv', 'json'], true);
		expect(firstArrayBuffer).toHaveBeenCalledOnce();
		expect(secondArrayBuffer).toHaveBeenCalledOnce();
	});

	it('returns undefined when file selection is cancelled', async () => {
		const openReadFileDialog = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('eda', { sys_FileSystem: { openReadFileDialog } });

		await expect(new EdaFileClient().pickOrderFiles()).resolves.toBeUndefined();
	});

	it('returns an empty list when the host returns an empty selection', async () => {
		const openReadFileDialog = vi.fn().mockResolvedValue([]);
		vi.stubGlobal('eda', { sys_FileSystem: { openReadFileDialog } });

		await expect(new EdaFileClient().pickOrderFiles()).resolves.toEqual([]);
	});

	it('rejects oversized or excessive order selections before reading any file', async () => {
		const oversizedRead = vi.fn();
		vi.stubGlobal('eda', {
			sys_FileSystem: {
				openReadFileDialog: vi.fn().mockResolvedValue([{
					name: 'oversized.xlsx',
					size: MAX_ORDER_FILE_BYTES + 1,
					arrayBuffer: oversizedRead,
				}]),
			},
		});
		await expect(new EdaFileClient().pickOrderFiles()).rejects.toThrow('larger');
		expect(oversizedRead).not.toHaveBeenCalled();

		const reads = Array.from({ length: MAX_ORDER_IMPORT_FILES + 1 }, () => vi.fn());
		vi.stubGlobal('eda', {
			sys_FileSystem: {
				openReadFileDialog: vi.fn().mockResolvedValue(reads.map((arrayBuffer, index) => ({
					name: `order-${index}.csv`,
					size: 1,
					arrayBuffer,
				}))),
			},
		});
		await expect(new EdaFileClient().pickOrderFiles()).rejects.toThrow('file limit');
		expect(reads.every(read => read.mock.calls.length === 0)).toBe(true);
	});

	it('picks generic BOM files independently from order imports', async () => {
		const content = new TextEncoder().encode('C number,Qty\nC1,2').buffer;
		const openReadFileDialog = vi.fn().mockResolvedValue([{ name: 'bom.txt', arrayBuffer: vi.fn(async () => content) }]);
		vi.stubGlobal('eda', { sys_FileSystem: { openReadFileDialog } });

		await expect(new EdaFileClient().pickBomFiles()).resolves.toEqual([{ name: 'bom.txt', content }]);
		expect(openReadFileDialog).toHaveBeenCalledWith(['xls', 'xlsx', 'csv', 'txt'], true);
	});

	it('rejects an oversized BOM before allocating its binary content', async () => {
		const arrayBuffer = vi.fn();
		vi.stubGlobal('eda', {
			sys_FileSystem: {
				openReadFileDialog: vi.fn().mockResolvedValue([{
					name: 'oversized-bom.xlsx',
					size: MAX_BOM_FILE_BYTES + 1,
					arrayBuffer,
				}]),
			},
		});

		await expect(new EdaFileClient().pickBomFiles()).rejects.toThrow('larger');
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it('reads one size-limited UTF-8 JSON backup', async () => {
		const content = new TextEncoder().encode('{"schemaVersion":6}').buffer;
		const openReadFileDialog = vi.fn().mockResolvedValue({
			name: 'inventory.json',
			size: content.byteLength,
			arrayBuffer: vi.fn(async () => content),
		});
		vi.stubGlobal('eda', { sys_FileSystem: { openReadFileDialog } });

		await expect(new EdaFileClient().pickInventoryBackup(1024)).resolves.toEqual({
			name: 'inventory.json',
			content: '{"schemaVersion":6}',
		});
		expect(openReadFileDialog).toHaveBeenCalledWith(['json'], false);
	});

	it('rejects an oversized backup before reading its content', async () => {
		const arrayBuffer = vi.fn();
		vi.stubGlobal('eda', {
			sys_FileSystem: {
				openReadFileDialog: vi.fn().mockResolvedValue({ name: 'large.json', size: 2048, arrayBuffer }),
			},
		});

		await expect(new EdaFileClient().pickInventoryBackup(1024)).rejects.toThrow('byte limit');
		expect(arrayBuffer).not.toHaveBeenCalled();
	});

	it('hands JSON to the host save dialog without inferring an unsupported save result', async () => {
		const saveFile = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('eda', { sys_FileSystem: { saveFile } });

		await expect(new EdaFileClient().saveJson({ ok: true }, 'backup.json')).resolves.toBeUndefined();
		expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'backup.json');
	});

	it('saves CSV as UTF-8 text with a BOM for spreadsheet compatibility', async () => {
		const saveFile = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('eda', { sys_FileSystem: { saveFile } });

		await expect(new EdaFileClient().saveCsv('编号,数量\r\nC1,2', 'shortage.csv')).resolves.toBeUndefined();

		expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'shortage.csv');
		const blob = saveFile.mock.calls[0][0] as Blob;
		expect(blob.type).toBe('text/csv;charset=utf-8');
		const bytes = new Uint8Array(await blob.arrayBuffer());
		expect([...bytes.slice(0, 3)]).toEqual([0xEF, 0xBB, 0xBF]);
		expect(new TextDecoder().decode(bytes.slice(3))).toBe('编号,数量\r\nC1,2');
	});

	it('propagates a host save failure', async () => {
		const saveFile = vi.fn().mockRejectedValue(new Error('disk full'));
		vi.stubGlobal('eda', { sys_FileSystem: { saveFile } });

		await expect(new EdaFileClient().saveJson({}, 'backup.json')).rejects.toThrow('disk full');
	});
});
