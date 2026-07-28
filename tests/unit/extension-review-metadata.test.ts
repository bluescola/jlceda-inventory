import { Buffer } from 'node:buffer';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface ExtensionManifest {
	name: string;
	uuid: string;
	displayName: string;
	description: string;
	version: string;
	license: string;
	repository: { type: string; url: string };
	categories: string[];
	images: { logo: string; banner?: string };
	entry: string;
}

const manifest = JSON.parse(readFileSync(resolve('extension.json'), 'utf8')) as ExtensionManifest;
const reviewSafePreviewImages = [
	'bom-mapping-demo.png',
	'inventory-overview-demo.png',
	'stock-check-demo.png',
];
const excludedSensitivePreviewImages = [
	'bom-diff-demo.png',
	'bom-stock-out-demo.png',
	'inventory-create-demo.png',
	'inventory-transactions-demo.png',
	'order-import-demo.png',
	'project-procurement-demo.png',
	'project-purchases-demo.png',
	'project-snapshots-demo.png',
];

function repositoryPath(relativePath: string): string {
	return resolve(relativePath.replace(/^\.\//, ''));
}

describe('extension review metadata', () => {
	it('provides all required manifest fields and at least one category', () => {
		for (const value of [
			manifest.name,
			manifest.uuid,
			manifest.displayName,
			manifest.description,
			manifest.version,
			manifest.license,
			manifest.repository.type,
			manifest.repository.url,
		]) {
			expect(value.trim()).not.toBe('');
		}

		expect(manifest.uuid).toMatch(/^[a-z0-9]{32}$/);
		expect(manifest.categories.length).toBeGreaterThan(0);
		expect(manifest.categories.every(category => category.trim().length > 0)).toBe(true);
	});

	it('keeps release versions and documented package names aligned', () => {
		const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string };
		const packageLock = JSON.parse(readFileSync(resolve('package-lock.json'), 'utf8')) as {
			version: string;
			packages: Record<string, { version: string }>;
		};
		const readme = readFileSync(resolve('README.md'), 'utf8');

		expect(packageJson.version).toBe(manifest.version);
		expect(packageLock.version).toBe(manifest.version);
		expect(packageLock.packages[''].version).toBe(manifest.version);
		expect(readme).toContain(`jlceda-inventory_v${manifest.version}.eext`);
	});

	it('uses a square opaque PNG logo that satisfies the review size limits', () => {
		const logoPath = repositoryPath(manifest.images.logo);
		const logo = readFileSync(logoPath);

		expect(extname(logoPath).toLowerCase()).toBe('.png');
		expect(logo.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
		expect(logo.subarray(12, 16).toString('ascii')).toBe('IHDR');
		expect(logo.readUInt32BE(16)).toBe(1024);
		expect(logo.readUInt32BE(20)).toBe(1024);
		expect(logo[25]).toBe(2);
		expect(statSync(logoPath).size).toBeLessThanOrEqual(5 * 1024 * 1024);
		expect(readFileSync(resolve('.edaignore'), 'utf8')).toContain('/images/logo-source.svg');
		expect(manifest.images.banner).toBeUndefined();
	});

	it('keeps the entry buildable and includes detailed public documentation', () => {
		const entryName = manifest.entry.replace(/^\.\/dist\//, '');
		const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
			scripts: { build?: string };
		};
		const readme = readFileSync(resolve('README.md'), 'utf8');
		const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8');

		expect(entryName).not.toBe(manifest.entry);
		expect(existsSync(resolve('src', `${entryName}.ts`))).toBe(true);
		expect(packageJson.scripts.build).toBeTruthy();
		expect(readme.length).toBeGreaterThan(1000);
		expect(readme).toContain('## 已实现');
		expect(readme).toContain('## 安装');
		for (const imageName of reviewSafePreviewImages) {
			expect(existsSync(resolve('images', imageName))).toBe(true);
			expect(readme).toContain(`](images/${imageName})`);
		}
		const ignoreFile = readFileSync(resolve('.edaignore'), 'utf8');
		for (const imageName of excludedSensitivePreviewImages) {
			expect(ignoreFile).toContain(`/images/${imageName}`);
			expect(readme).not.toContain(imageName);
		}
		expect(readme).not.toContain('](./images/');
		expect(readme).not.toContain('raw.githubusercontent.com');
		expect(changelog.length).toBeGreaterThan(1000);
		expect(changelog).toContain(`## ${manifest.version}`);
	});

	it('does not expose a mainland China mobile number in public metadata', () => {
		const publicMetadata = [
			'extension.json',
			'README.md',
			'README.en.md',
			'CHANGELOG.md',
			'CHANGELOG.en.md',
			'CONTRIBUTORS.md',
			'locales/zh-Hans.json',
			'locales/en.json',
		].map(path => readFileSync(resolve(path), 'utf8')).join('\n');

		expect(publicMetadata).not.toMatch(/(?<!\d)1[3-9]\d{9}(?!\d)/);
	});
});
