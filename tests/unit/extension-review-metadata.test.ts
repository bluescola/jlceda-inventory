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
	headerMenus: Record<string, Array<{
		menuItems: Array<{ title: string }>;
	}>>;
}

const repositoryUrlBase = 'https://github.com/bluescola/jlceda-inventory';

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

function markdownDocumentTargets(markdown: string): string[] {
	return [...markdown.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)]
		.map(match => match[1] ?? '');
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
		const readmes = [
			readFileSync(resolve('README.md'), 'utf8'),
			readFileSync(resolve('README.en.md'), 'utf8'),
		];

		expect(packageJson.version).toBe(manifest.version);
		expect(packageLock.version).toBe(manifest.version);
		expect(packageLock.packages[''].version).toBe(manifest.version);
		for (const readme of readmes) {
			expect(readme).toContain(`jlceda-inventory_v${manifest.version}.eext`);
		}
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

	it('keeps the entry buildable and documents every public command for ordinary users', () => {
		const entryName = manifest.entry.replace(/^\.\/dist\//, '');
		const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
			scripts: { build?: string };
		};
		const readme = readFileSync(resolve('README.md'), 'utf8');
		const englishReadme = readFileSync(resolve('README.en.md'), 'utf8');
		const changelog = readFileSync(resolve('CHANGELOG.md'), 'utf8');

		expect(entryName).not.toBe(manifest.entry);
		expect(existsSync(resolve('src', `${entryName}.ts`))).toBe(true);
		expect(packageJson.scripts.build).toBeTruthy();
		expect(readme.length).toBeGreaterThan(3000);
		expect(englishReadme.length).toBeGreaterThan(3000);
		for (const heading of [
			'## 添加与管理库存',
			'## 在设计中使用库存',
			'## BOM、备料与生产',
			'## 项目需求与采购',
			'## 备份、迁移与恢复',
			'## 常见问题',
		]) {
			expect(readme).toContain(heading);
		}
		for (const heading of [
			'## Adding Components and Receiving Stock',
			'## Managing Inventory',
			'## Working with a Design',
			'## BOM and Production',
			'## Projects, Procurement, and Substitutes',
			'## Backup, Transfer, and Restore',
			'## Frequently Asked Questions',
		]) {
			expect(englishReadme).toContain(heading);
		}

		const menuTitles = new Set(Object.values(manifest.headerMenus)
			.flatMap(groups => groups)
			.flatMap(group => group.menuItems)
			.map(item => item.title));
		for (const title of menuTitles) {
			expect(readme).toContain(title);
		}
		expect(readme).toContain('HID 键盘模式');
		expect(readme).toContain('扩展不会调用电脑或手机摄像头');
		expect(englishReadme).toContain('HID keyboard');
		expect(englishReadme).toContain('does not access a camera');
		expect(readme).toContain('“BOM”是物料清单');
		expect(readme).toContain('安装在电脑上的嘉立创 EDA 客户端');
		expect(englishReadme).toContain('bill of materials (BOM)');
		for (const unclearTerm of ['桌面端', '结构化仓位', '原子操作', '语义列映射', 'JSON 快照']) {
			expect(readme).not.toContain(unclearTerm);
		}
		for (const unclearTerm of ['Desktop-only', 'file fingerprints', 'commits the whole batch atomically', 'current runtime inventory']) {
			expect(englishReadme).not.toContain(unclearTerm);
		}
		expect(readme).not.toContain('当前设计或外部文件的需求快照');
		expect(englishReadme).not.toContain('current design or an external file');
		for (const imageName of reviewSafePreviewImages) {
			expect(existsSync(resolve('images', imageName))).toBe(true);
			expect(readme).toContain(`](images/${imageName})`);
			expect(englishReadme).toContain(`](images/${imageName})`);
		}
		const ignoreFile = readFileSync(resolve('.edaignore'), 'utf8');
		for (const imageName of excludedSensitivePreviewImages) {
			expect(ignoreFile).toContain(`/images/${imageName}`);
			expect(readme).not.toContain(imageName);
			expect(englishReadme).not.toContain(imageName);
		}
		for (const publicReadme of [readme, englishReadme]) {
			expect(publicReadme).not.toContain('](./images/');
			expect(publicReadme).not.toContain('raw.githubusercontent.com');
			expect(markdownDocumentTargets(publicReadme).length).toBeGreaterThan(0);
			expect(markdownDocumentTargets(publicReadme).every(target => target.startsWith(repositoryUrlBase))).toBe(true);
		}
		expect(changelog.length).toBeGreaterThan(1000);
		expect(changelog).toContain(`## ${manifest.version}`);
	});

	it('keeps development details in dedicated Chinese and English guides', () => {
		const readme = readFileSync(resolve('README.md'), 'utf8');
		const englishReadme = readFileSync(resolve('README.en.md'), 'utf8');
		const guides = [
			readFileSync(resolve('docs/开发指南.md'), 'utf8'),
			readFileSync(resolve('docs/development-guide.md'), 'utf8'),
		];

		for (const publicReadme of [readme, englishReadme]) {
			expect(publicReadme).not.toContain('## 开发\n');
			expect(publicReadme).not.toContain('## 目录');
			expect(publicReadme).not.toContain('## Development\n');
			expect(publicReadme).not.toContain('## Directory Structure');
			expect(publicReadme).not.toContain('SYS_Storage');
			expect(publicReadme).not.toContain('host-level atomic CAS');
		}
		for (const guide of guides) {
			expect(guide).toContain('Node.js');
			expect(guide).toContain('npm run lint');
			expect(guide).toContain('npm run typecheck');
			expect(guide).toContain('npm test');
			expect(guide).toContain('npm run build');
			expect(guide).toContain('build/dist/');
		}
	});

	it('does not expose a mainland China mobile number in public metadata', () => {
		const publicMetadata = [
			'extension.json',
			'README.md',
			'README.en.md',
			'CHANGELOG.md',
			'CHANGELOG.en.md',
			'CONTRIBUTORS.md',
			'docs/开发指南.md',
			'docs/development-guide.md',
			'locales/zh-Hans.json',
			'locales/en.json',
		].map(path => readFileSync(resolve(path), 'utf8')).join('\n');

		expect(publicMetadata).not.toMatch(/(?<!\d)1[3-9]\d{9}(?!\d)/);
	});
});
