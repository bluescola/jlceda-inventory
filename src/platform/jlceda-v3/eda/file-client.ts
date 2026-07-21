export interface PickedOrderFile {
	name: string;
	content: ArrayBuffer;
}

export class EdaFileClient {
	public async pickOrderFiles(): Promise<PickedOrderFile[] | undefined> {
		const files = await eda.sys_FileSystem.openReadFileDialog(['xls', 'xlsx', 'csv', 'json'], true);
		if (!files) {
			return undefined;
		}
		return Promise.all(
			files.map(async file => ({
				name: file.name,
				content: await file.arrayBuffer(),
			})),
		);
	}

	public async saveJson(value: unknown, fileName: string): Promise<void> {
		const blob = new Blob([JSON.stringify(value, undefined, 2)], { type: 'application/json;charset=utf-8' });
		await eda.sys_FileSystem.saveFile(blob, fileName);
	}
}
