export interface PickedTextFile {
	name: string;
	text: string;
}

export class EdaFileClient {
	public async pickOrderFile(): Promise<PickedTextFile | undefined> {
		const file = await eda.sys_FileSystem.openReadFileDialog(['csv', 'json'], false);
		if (!file) {
			return undefined;
		}
		return { name: file.name, text: await file.text() };
	}

	public async saveJson(value: unknown, fileName: string): Promise<void> {
		const blob = new Blob([JSON.stringify(value, undefined, 2)], { type: 'application/json;charset=utf-8' });
		await eda.sys_FileSystem.saveFile(blob, fileName);
	}
}
