import * as extensionConfig from '../extension.json';
import { createInventoryController } from './platform/jlceda-v3/bootstrap/composition-root';

const controller = createInventoryController(extensionConfig.version);

export function activate(_status?: 'onStartupFinished', _arg?: string): void {}

export function openInventory(): Promise<void> {
	return controller.openInventory();
}

export function addByLcscPartNumber(): Promise<void> {
	return controller.addByLcscPartNumber();
}

export function addCustomComponent(): Promise<void> {
	return controller.addCustomComponent();
}

export function importOrderFile(): Promise<void> {
	return controller.importOrderFile();
}

export function exportInventoryBackup(): Promise<void> {
	return controller.exportInventoryBackup();
}

export function showRecommendations(): Promise<void> {
	return controller.showRecommendations();
}

export function placeFromInventory(): Promise<void> {
	return controller.placeFromInventory();
}

export function about(): void {
	controller.about();
}
