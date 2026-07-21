import englishMessagesJson from '../../../../locales/en.json';
import chineseMessagesJson from '../../../../locales/zh-Hans.json';

export type Translate = (key: string, ...args: Array<boolean | number | string>) => string;

type SupportedLanguage = 'en' | 'zh-Hans';

const messages: Record<SupportedLanguage, Record<string, string>> = {
	'en': englishMessagesJson,
	'zh-Hans': chineseMessagesJson,
};

let currentLanguage = normalizeLanguage(typeof navigator === 'undefined' ? 'en' : navigator.language);
let initialization: Promise<void> | undefined;

export function initializeRuntimeI18n(): Promise<void> {
	if (initialization) {
		return initialization;
	}

	initialization = (async () => {
		if (typeof eda === 'undefined' || !eda.sys_I18n) {
			return;
		}

		for (const [language, source] of Object.entries(messages)) {
			try {
				eda.sys_I18n.importMultilingual(language, source);
			}
			catch {
				// Bundled messages below remain available if the host rejects registration.
			}
		}

		await refreshRuntimeLanguage();
	})();
	return initialization;
}

export async function refreshRuntimeLanguage(): Promise<void> {
	if (typeof eda === 'undefined' || !eda.sys_I18n) {
		return;
	}
	try {
		currentLanguage = normalizeLanguage(await eda.sys_I18n.getCurrentLanguage());
	}
	catch {
		// Keep the last known language when the host language cannot be read.
	}
}

export const translate: Translate = (key, ...args) => {
	const template = messages[currentLanguage][key];
	if (template !== undefined) {
		return interpolate(template, args);
	}
	return eda.sys_I18n.text(key, undefined, undefined, ...args);
};

function normalizeLanguage(language: string): SupportedLanguage {
	return language.toLowerCase().startsWith('zh') ? 'zh-Hans' : 'en';
}

function interpolate(template: string, args: Array<boolean | number | string>): string {
	return args.reduce<string>(
		(result, value, index) => result.replaceAll(`\${${index + 1}}`, String(value)),
		template,
	);
}
