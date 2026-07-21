import type { EdaModel, EdaModelCatalog } from '../../../features/component-catalog/ports/component-catalog';
import { normalizeLcscPartNumber } from '../../../features/inventory/domain/inventory-item';

type SearchItem = Awaited<ReturnType<typeof eda.lib_Device.search>>[number];

export class EdaDeviceCatalog implements EdaModelCatalog {
	public async findByLcscPartNumber(partNumber: string): Promise<EdaModel | undefined> {
		const normalized = normalizeLcscPartNumber(partNumber);
		if (!normalized) {
			return undefined;
		}
		const rawResult: unknown = await eda.lib_Device.getByLcscIds([normalized], undefined, true);
		const matches = Array.isArray(rawResult) ? rawResult : rawResult ? [rawResult] : [];
		const first = matches[0] as SearchItem | undefined;
		return first ? this.hydrate(first, normalized) : undefined;
	}

	public async search(query: string, limit = 20): Promise<EdaModel[]> {
		const matches = await eda.lib_Device.search(query, undefined, undefined, undefined, limit, 1);
		const hydrated: EdaModel[] = [];
		for (const match of matches.slice(0, limit)) {
			hydrated.push(await this.hydrate(match));
		}
		return hydrated;
	}

	private async hydrate(item: SearchItem, fallbackLcscPartNumber?: string): Promise<EdaModel> {
		const details = await eda.lib_Device.get(item.uuid, item.libraryUuid);
		const properties = details?.property;
		const attributes = cleanAttributes({
			...(item.otherProperty ?? {}),
			...(properties?.otherProperty ?? {}),
		});
		const supplierId = properties?.supplierId ?? pickString(attributes, [
			'LCSC Part #',
			'LCSC Part',
			'LCSC',
			'Supplier Part',
			'Supplier Part Number',
			'供应商编号',
			'立创编号',
			'商品编号',
		]);
		const lcscPartNumber = normalizeLcscPartNumber(supplierId ?? fallbackLcscPartNumber);
		const symbolName = item.symbol?.name ?? item.symbolName;
		const footprintName = item.footprint?.name ?? item.footprintName;
		const packageName = pickString(attributes, ['Package', 'Supplier Package', '供应商封装', '商品封装', '封装']) ?? footprintName;
		return {
			identity: {
				name: details?.name ?? item.name,
				lcscPartNumber,
				supplierId: supplierId ?? lcscPartNumber,
				manufacturer: properties?.manufacturer ?? pickString(attributes, ['Manufacturer', '制造商', '品牌']),
				manufacturerPartNumber: properties?.manufacturerId ?? pickString(attributes, ['Manufacturer Part', 'Manufacturer Part Number', 'MPN', '厂家型号', '制造商编号']),
				package: packageName,
				description: details?.description ?? item.description,
			},
			reference: {
				deviceUuid: item.uuid,
				libraryUuid: item.libraryUuid,
				symbolName,
				footprintName,
			},
			symbolName,
			footprintName,
			attributes,
		};
	}
}

function cleanAttributes(source: Record<string, boolean | number | string | undefined>): Record<string, boolean | number | string> {
	return Object.fromEntries(Object.entries(source).filter((entry): entry is [string, boolean | number | string] => entry[1] !== undefined));
}

function pickString(source: Record<string, boolean | number | string>, keys: string[]): string | undefined {
	const normalized = new Map(Object.entries(source).map(([key, value]) => [normalizePropertyKey(key), value]));
	for (const key of keys) {
		const value = normalized.get(normalizePropertyKey(key));
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

function normalizePropertyKey(value: string): string {
	return value.toLowerCase().replaceAll(/[\s_#()（）./\\-]+/g, '');
}
