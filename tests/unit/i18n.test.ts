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

	it('defines every literal translation key used by the inventory item adapter', () => {
		const source = readFileSync(resolve('src/platform/jlceda-v3/presentation/iframe-inventory-item-panel.ts'), 'utf8');
		const usedKeys = [...source.matchAll(/this\.t\('([^']+)'\)/g)].map(match => match[1]);
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
});
