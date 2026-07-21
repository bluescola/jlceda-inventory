import { afterEach, describe, expect, it, vi } from 'vitest';
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

	it('hands JSON to the host save dialog without inferring an unsupported save result', async () => {
		const saveFile = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('eda', { sys_FileSystem: { saveFile } });

		await expect(new EdaFileClient().saveJson({ ok: true }, 'backup.json')).resolves.toBeUndefined();
		expect(saveFile).toHaveBeenCalledWith(expect.any(Blob), 'backup.json');
	});

	it('propagates a host save failure', async () => {
		const saveFile = vi.fn().mockRejectedValue(new Error('disk full'));
		vi.stubGlobal('eda', { sys_FileSystem: { saveFile } });

		await expect(new EdaFileClient().saveJson({}, 'backup.json')).rejects.toThrow('disk full');
	});
});
