import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeRuntimeI18n, refreshRuntimeLanguage, translate } from '../../src/platform/jlceda-v3/eda/i18n-client';

afterEach(() => vi.unstubAllGlobals());

function readMessages(language: string): Record<string, string> {
	return JSON.parse(readFileSync(resolve(`locales/${language}.json`), 'utf8')) as Record<string, string>;
}

describe('runtime locale files', () => {
	it('keep English and Simplified Chinese keys in sync', () => {
		const chineseKeys = Object.keys(readMessages('zh-Hans')).sort();
		const englishKeys = Object.keys(readMessages('en')).sort();
		expect(englishKeys).toEqual(chineseKeys);
	});

	it('contains every inventory item field label', () => {
		expect(readMessages('zh-Hans')['inventoryItem.supplierId']).toBe('供应商编号');
		expect(readMessages('en')['inventoryItem.supplierId']).toBe('Supplier ID');
	});

	it('defines every literal translation key used by inventory presentation adapters', () => {
		const sources = [
			'src/platform/jlceda-v3/presentation/iframe-inventory-item-panel.ts',
			'src/platform/jlceda-v3/presentation/native-inventory-controller.ts',
		].map(path => readFileSync(resolve(path), 'utf8'));
		const usedKeys = sources.flatMap(source => [...source.matchAll(/this\.t\('([^']+)'\)/g)].map(match => match[1]));
		for (const language of ['zh-Hans', 'en']) {
			const available = readMessages(language);
			expect(usedKeys.filter(key => !(key in available)), `${language} missing translation keys`).toEqual([]);
		}
	});

	it('registers bundled messages and does not expose stale host keys', async () => {
		const importMultilingual = vi.fn(() => true);
		const getCurrentLanguage = vi.fn(async () => 'zh-Hans');
		vi.stubGlobal('eda', {
			sys_I18n: {
				getCurrentLanguage,
				importMultilingual,
				text: vi.fn(() => 'Edit all fields'),
			},
		});

		await initializeRuntimeI18n();

		expect(importMultilingual).toHaveBeenCalledWith('zh-Hans', expect.objectContaining({
			'inventory.edit': '完整编辑',
			'inventoryItem.supplierId': '供应商编号',
		}));
		expect(translate('inventory.edit')).toBe('完整编辑');
		expect(translate('inventory.confirmRemove', '测试元件')).toBe('确定删除 测试元件 的库存记录吗？');

		getCurrentLanguage.mockResolvedValue('en');
		await refreshRuntimeLanguage();
		expect(translate('inventory.edit')).toBe('Edit all fields');
	});

	it('uses Chinese manifest text by default and provides complete English menu translations', () => {
		const manifest = JSON.parse(readFileSync(resolve('extension.json'), 'utf8')) as {
			displayName: string;
			description: string;
			headerMenus: Record<string, Array<{ title: string; menuItems: Array<{ title: string }> }>>;
		};
		const english = JSON.parse(readFileSync(resolve('locales/extensionJson/en.json'), 'utf8')) as Record<string, string>;
		const chinese = JSON.parse(readFileSync(resolve('locales/extensionJson/zh-Hans.json'), 'utf8')) as Record<string, string>;
		const sourceTexts = new Set([manifest.displayName, manifest.description]);
		for (const menus of Object.values(manifest.headerMenus)) {
			for (const menu of menus) {
				sourceTexts.add(menu.title);
				for (const item of menu.menuItems) {
					sourceTexts.add(item.title);
				}
			}
		}

		expect(manifest.displayName).toBe('元器件库存');
		expect(sourceTexts).toContain('关于库存扩展');
		expect([...sourceTexts].filter(text => !(text in chinese))).toEqual([]);
		expect([...sourceTexts].filter(text => !(text in english))).toEqual([]);
		expect(english['关于库存扩展']).toBe('About inventory extension');
	});

	it('keeps one grouped inventory menu in the established editor contexts', () => {
		const manifest = JSON.parse(readFileSync(resolve('extension.json'), 'utf8')) as {
			headerMenus: Record<string, Array<{ id: string; menuItems?: Array<{ id: string; registerFn?: string }>; registerFn?: string }>>;
		};
		const expectedMenuItems: Record<string, string[]> = {
			home: [
				'inventoryOverview',
				'addByLcsc',
				'addManual',
				'checkExternalBomStock',
				'compareBomVersions',
				'stockOutBomFile',
				'inventoryTransactions',
				'projectPlanning',
				'substituteLinks',
				'importOrder',
				'importPackageCode',
				'exportBackup',
				'automaticBackupSettings',
				'restoreBackup',
				'viewDiagnosticLogs',
				'exportDiagnosticLogs',
				'about',
			],
			sch: [
				'inventoryOverview',
				'placeFromInventory',
				'locateSelectedInventory',
				'checkCurrentDesignStock',
				'projectPlanning',
				'addByLcsc',
				'viewDiagnosticLogs',
				'exportDiagnosticLogs',
			],
			pcb: [
				'inventoryOverview',
				'locateSelectedInventory',
				'checkCurrentDesignStock',
				'projectPlanning',
				'addByLcsc',
				'viewDiagnosticLogs',
				'exportDiagnosticLogs',
			],
		};
		expect(Object.keys(manifest.headerMenus).sort()).toEqual(['home', 'pcb', 'sch']);
		for (const [context, menus] of Object.entries(manifest.headerMenus)) {
			expect(menus).toHaveLength(1);
			expect(menus[0]).toMatchObject({ id: 'componentInventory' });
			expect(menus[0]).not.toHaveProperty('registerFn');
			expect(menus[0].menuItems?.map(item => item.id)).toEqual(expectedMenuItems[context]);
		}
	});
});
