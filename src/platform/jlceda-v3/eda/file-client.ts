import { MAX_BOM_FILE_BYTES } from '../../../features/bom-analysis/application/read-bom-file';
import { MAX_ORDER_FILE_BYTES, MAX_ORDER_IMPORT_FILES } from '../../../features/order-import/application/parse-order-file';

const MAX_ORDER_IMPORT_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_BOM_SELECTION_FILES = 2;

export interface PickedOrderFile {
	name: string;
	content: ArrayBuffer;
}

export type PickedBomFile = PickedOrderFile;

export interface PickedInventoryBackup {
	name: string;
	content: string;
}

export class EdaFileClient {
	public async pickOrderFiles(): Promise<PickedOrderFile[] | undefined> {
		const files = await eda.sys_FileSystem.openReadFileDialog(['xls', 'xlsx', 'csv', 'json'], true);
		if (!files) {
			return undefined;
		}
		return readBoundedFiles(
			files,
			MAX_ORDER_IMPORT_FILES,
			MAX_ORDER_FILE_BYTES,
			MAX_ORDER_IMPORT_TOTAL_BYTES,
			'Order file selection',
		);
	}

	public async pickBomFiles(): Promise<PickedBomFile[] | undefined> {
		const files = await eda.sys_FileSystem.openReadFileDialog(['xls', 'xlsx', 'csv', 'txt'], true);
		if (!files) {
			return undefined;
		}
		return readBoundedFiles(
			files,
			MAX_BOM_SELECTION_FILES,
			MAX_BOM_FILE_BYTES,
			MAX_BOM_SELECTION_FILES * MAX_BOM_FILE_BYTES,
			'BOM file selection',
		);
	}

	public async pickInventoryBackup(maximumBytes: number): Promise<PickedInventoryBackup | undefined> {
		const file = await eda.sys_FileSystem.openReadFileDialog(['json'], false);
		if (!file) {
			return undefined;
		}
		if (file.size > maximumBytes) {
			throw new RangeError(`Inventory backup exceeds the ${maximumBytes}-byte limit.`);
		}
		const content = await file.arrayBuffer();
		if (content.byteLength > maximumBytes) {
			throw new RangeError(`Inventory backup exceeds the ${maximumBytes}-byte limit.`);
		}
		try {
			return {
				name: file.name,
				content: new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(content)),
			};
		}
		catch (error) {
			throw new TypeError('Inventory backup must be valid UTF-8 JSON text.', { cause: error });
		}
	}

	public async saveJson(value: unknown, fileName: string): Promise<void> {
		const blob = new Blob([JSON.stringify(value, undefined, 2)], { type: 'application/json;charset=utf-8' });
		await eda.sys_FileSystem.saveFile(blob, fileName);
	}

	public async saveCsv(value: string, fileName: string): Promise<void> {
		const blob = new Blob([`\uFEFF${value}`], { type: 'text/csv;charset=utf-8' });
		await eda.sys_FileSystem.saveFile(blob, fileName);
	}
}

async function readBoundedFiles(
	files: readonly File[],
	maximumFiles: number,
	maximumFileBytes: number,
	maximumTotalBytes: number,
	label: string,
): Promise<PickedOrderFile[]> {
	if (files.length > maximumFiles) {
		throw new RangeError(`${label} exceeds the ${maximumFiles}-file limit.`);
	}
	let declaredTotal = 0;
	for (const file of files) {
		if (Number.isFinite(file.size) && file.size > maximumFileBytes) {
			throw new RangeError(`${label} contains a file larger than ${maximumFileBytes} bytes.`);
		}
		declaredTotal += Number.isFinite(file.size) ? file.size : 0;
		if (!Number.isSafeInteger(declaredTotal) || declaredTotal > maximumTotalBytes) {
			throw new RangeError(`${label} exceeds the ${maximumTotalBytes}-byte total limit.`);
		}
	}

	const picked: PickedOrderFile[] = [];
	let actualTotal = 0;
	for (const file of files) {
		const content = await file.arrayBuffer();
		if (content.byteLength > maximumFileBytes) {
			throw new RangeError(`${label} contains a file larger than ${maximumFileBytes} bytes.`);
		}
		actualTotal += content.byteLength;
		if (!Number.isSafeInteger(actualTotal) || actualTotal > maximumTotalBytes) {
			throw new RangeError(`${label} exceeds the ${maximumTotalBytes}-byte total limit.`);
		}
		picked.push({ name: file.name, content });
	}
	return picked;
}
