import * as extensionConfig from '../extension.json';
import { createInventoryController } from './platform/jlceda-v3/bootstrap/composition-root';
import { initializeRuntimeI18n, refreshRuntimeLanguage } from './platform/jlceda-v3/eda/i18n-client';

const i18nReady = initializeRuntimeI18n();
const controller = createInventoryController(extensionConfig.version);

export function activate(_status?: 'onStartupFinished', _arg?: string): Promise<void> {
	return i18nReady;
}

export function openInventory(): Promise<void> {
	return withCurrentLanguage(() => controller.openInventory());
}

export function addByLcscPartNumber(): Promise<void> {
	return withCurrentLanguage(() => controller.addByLcscPartNumber());
}

export function addCustomComponent(): Promise<void> {
	return withCurrentLanguage(() => controller.addCustomComponent());
}

export function importOrderFile(): Promise<void> {
	return withCurrentLanguage(() => controller.importOrderFile());
}

export function importPackageCode(): Promise<void> {
	return withCurrentLanguage(() => controller.importPackageCode());
}

export function importEdaCategories(): Promise<void> {
	return withCurrentLanguage(() => controller.importEdaCategories());
}

export function exportInventoryBackup(): Promise<void> {
	return withCurrentLanguage(() => controller.exportInventoryBackup());
}

export function configureAutomaticBackup(): Promise<void> {
	return withCurrentLanguage(() => controller.configureAutomaticBackup());
}

export function restoreInventoryBackup(): Promise<void> {
	return withCurrentLanguage(() => controller.restoreInventoryBackup());
}

export function showDiagnosticLogs(): Promise<void> {
	return withCurrentLanguage(() => controller.showDiagnosticLogs());
}

export function exportDiagnosticLogs(): Promise<void> {
	return withCurrentLanguage(() => controller.exportDiagnosticLogs());
}

export function placeFromInventory(): Promise<void> {
	return withCurrentLanguage(() => controller.placeFromInventory());
}

export function locateSelectedInventory(): Promise<void> {
	return withCurrentLanguage(() => controller.locateSelectedInventory());
}

export function checkCurrentDesignStock(): Promise<void> {
	return withCurrentLanguage(() => controller.checkCurrentDesignStock());
}

export function checkExternalBomStock(): Promise<void> {
	return withCurrentLanguage(() => controller.checkExternalBomStock());
}

export function compareBomVersions(): Promise<void> {
	return withCurrentLanguage(() => controller.compareBomVersions());
}

export function stockOutBomFile(): Promise<void> {
	return withCurrentLanguage(() => controller.stockOutBomFile());
}

export function openInventoryTransactions(): Promise<void> {
	return withCurrentLanguage(() => controller.openInventoryTransactions());
}

export function openProjectPlanning(): Promise<void> {
	return withCurrentLanguage(() => controller.openProjectPlanning());
}

export function manageSubstituteLinks(): Promise<void> {
	return withCurrentLanguage(() => controller.manageSubstituteLinks());
}

export function about(): Promise<void> {
	return withCurrentLanguage(() => controller.about());
}

async function withCurrentLanguage(operation: () => Promise<void> | void): Promise<void> {
	await i18nReady;
	await refreshRuntimeLanguage();
	await operation();
}
