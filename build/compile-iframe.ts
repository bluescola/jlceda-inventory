import path from 'node:path';
import { build } from 'esbuild';
import fs from 'fs-extra';

const sourceRoot = path.resolve(__dirname, '../src/platform/jlceda-v3/iframe');
const outputDirectory = path.resolve(__dirname, '../iframe');

const assets = [
	{ name: 'product-details', marker: 'PRODUCT_DETAILS' },
	{ name: 'inventory-item', marker: 'INVENTORY_ITEM' },
	{ name: 'inventory-overview', marker: 'INVENTORY_OVERVIEW' },
	{ name: 'inventory-create', marker: 'INVENTORY_CREATE' },
	{ name: 'order-import', marker: 'ORDER_IMPORT' },
	{ name: 'design-stock-check', marker: 'DESIGN_STOCK_CHECK' },
	{ name: 'bom-mapping', marker: 'BOM_MAPPING' },
	{ name: 'bom-diff', marker: 'BOM_DIFF' },
	{ name: 'bom-stock-out', marker: 'BOM_STOCK_OUT' },
	{ name: 'inventory-transactions', marker: 'INVENTORY_TRANSACTIONS' },
	{ name: 'project-planning', marker: 'PROJECT_PLANNING' },
] as const;

async function main(): Promise<void> {
	await fs.ensureDir(outputDirectory);
	await Promise.all(assets.map(compileAsset));
}

async function compileAsset(asset: typeof assets[number]): Promise<void> {
	const sourceDirectory = path.join(sourceRoot, asset.name);
	const styleMarker = `/* __${asset.marker}_INLINE_CSS__ */`;
	const scriptMarker = `/* __${asset.marker}_INLINE_JS__ */`;
	await Promise.all([
		fs.remove(path.join(outputDirectory, `${asset.name}.css`)),
		fs.remove(path.join(outputDirectory, `${asset.name}.js`)),
	]);
	const [template, style, scriptBuild] = await Promise.all([
		fs.readFile(path.join(sourceDirectory, `${asset.name}.html`), 'utf8'),
		fs.readFile(path.join(sourceDirectory, `${asset.name}.css`), 'utf8'),
		build({
			entryPoints: [path.join(sourceDirectory, `${asset.name}.ts`)],
			bundle: true,
			format: 'iife',
			platform: 'browser',
			target: 'es2022',
			minify: true,
			sourcemap: false,
			write: false,
		}),
	]);
	const script = scriptBuild.outputFiles[0]?.text;
	if (!script) {
		throw new Error(`The ${asset.name} IFrame script build returned no output.`);
	}
	const html = replaceMarker(
		replaceMarker(template, styleMarker, style),
		scriptMarker,
		script.replaceAll(/<\/script/gi, '<\\/script'),
	);
	assertSelfContained(html, styleMarker, scriptMarker, asset.name);
	await fs.writeFile(path.join(outputDirectory, `${asset.name}.html`), html, 'utf8');
}

void main();

function replaceMarker(template: string, marker: string, value: string): string {
	const markerCount = template.split(marker).length - 1;
	if (markerCount !== 1) {
		throw new Error(`Expected exactly one IFrame build marker ${marker}, found ${markerCount}.`);
	}
	return template.replace(marker, value);
}

function assertSelfContained(html: string, styleMarker: string, scriptMarker: string, assetName: string): void {
	if (html.includes(styleMarker) || html.includes(scriptMarker)) {
		throw new Error(`The ${assetName} IFrame contains an unreplaced build marker.`);
	}
	if (/<link[^>]+href\s*=|<script[^>]+src\s*=/i.test(html)) {
		throw new Error(`The ${assetName} IFrame must not reference external styles or scripts.`);
	}
}
