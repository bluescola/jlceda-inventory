import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readMessages(language: string): Record<string, string> {
	return JSON.parse(readFileSync(resolve(`locales/${language}.json`), 'utf8')) as Record<string, string>;
}

describe('runtime locale files', () => {
	it('keep English and Simplified Chinese keys in sync', () => {
		const chineseKeys = Object.keys(readMessages('zh-Hans')).sort();
		const englishKeys = Object.keys(readMessages('en')).sort();
		expect(englishKeys).toEqual(chineseKeys);
	});
});
