import type {
	EdaLibraryCategories,
	EdaLibraryCategoryNode,
	EdaLibraryCategoryReadResult,
	EdaLibraryCategorySource,
} from '../../../features/inventory/ports/eda-library-categories';

const DEVICE_LIBRARY_TYPE = '3' as ELIB_LibraryType;
const DEVICE_PAGE_SIZE = 100;
const MAX_DEVICE_PAGES = 100;

interface ClassificationTreeNode {
	name: string;
	children?: Array<{ name: string }>;
}

interface DeviceClassificationItem {
	uuid: string;
	classification?: ILIB_ClassificationIndex | string[];
}

export interface LibraryCategoriesHost {
	getClassificationTree: (libraryUuid: string) => Promise<ClassificationTreeNode[]>;
	getFavoriteLibraryUuid: () => Promise<string | undefined>;
	getPersonalLibraryUuid: () => Promise<string | undefined>;
	searchDevices: (libraryUuid: string, pageSize: number, page: number) => Promise<DeviceClassificationItem[]>;
}

export class EdaLibraryCategoriesReader implements EdaLibraryCategories {
	public constructor(private readonly host: LibraryCategoriesHost = new EdaLibraryCategoriesHost()) {}

	public async availableSources(): Promise<EdaLibraryCategorySource[]> {
		const [personal, favorite] = await Promise.all([
			this.resolveLibraryUuid('personal').catch(() => undefined),
			this.resolveLibraryUuid('favorite').catch(() => undefined),
		]);
		return [personal ? 'personal' : undefined, favorite ? 'favorite' : undefined]
			.filter((source): source is EdaLibraryCategorySource => source !== undefined);
	}

	public async read(source: EdaLibraryCategorySource): Promise<EdaLibraryCategoryReadResult> {
		let libraryUuid: string | undefined;
		try {
			libraryUuid = await this.resolveLibraryUuid(source);
		}
		catch {
			return { status: 'unsupported' };
		}
		if (!libraryUuid) {
			return { status: 'unavailable' };
		}

		try {
			const tree = await this.host.getClassificationTree(libraryUuid);
			return {
				status: 'available',
				snapshot: {
					categories: normalizeTree(tree),
					complete: true,
					discovery: 'classification-tree',
					source,
				},
			};
		}
		catch {
			return this.readFromDevices(source, libraryUuid);
		}
	}

	private async readFromDevices(
		source: EdaLibraryCategorySource,
		libraryUuid: string,
	): Promise<EdaLibraryCategoryReadResult> {
		const categoryPaths: string[][] = [];
		const seenDevices = new Set<string>();
		try {
			for (let page = 1; page <= MAX_DEVICE_PAGES; page += 1) {
				const devices = await this.host.searchDevices(libraryUuid, DEVICE_PAGE_SIZE, page);
				let newDevices = 0;
				for (const device of devices) {
					if (!seenDevices.has(device.uuid)) {
						seenDevices.add(device.uuid);
						newDevices += 1;
					}
					if (Array.isArray(device.classification)) {
						categoryPaths.push(device.classification);
					}
				}
				if (devices.length < DEVICE_PAGE_SIZE) {
					break;
				}
				if (newDevices === 0) {
					break;
				}
			}
		}
		catch {
			return { status: 'unsupported' };
		}
		return {
			status: 'available',
			snapshot: {
				categories: categoriesFromPaths(categoryPaths),
				// Device search cannot reveal empty EDA categories, even when every page was read.
				complete: false,
				discovery: 'device-scan',
				source,
			},
		};
	}

	private resolveLibraryUuid(source: EdaLibraryCategorySource): Promise<string | undefined> {
		return source === 'personal'
			? this.host.getPersonalLibraryUuid()
			: this.host.getFavoriteLibraryUuid();
	}
}

class EdaLibraryCategoriesHost implements LibraryCategoriesHost {
	public getClassificationTree(libraryUuid: string): Promise<ClassificationTreeNode[]> {
		return eda.lib_Classification.getAllClassificationTree(libraryUuid, DEVICE_LIBRARY_TYPE);
	}

	public getFavoriteLibraryUuid(): Promise<string | undefined> {
		return eda.lib_LibrariesList.getFavoriteLibraryUuid();
	}

	public getPersonalLibraryUuid(): Promise<string | undefined> {
		return eda.lib_LibrariesList.getPersonalLibraryUuid();
	}

	public searchDevices(libraryUuid: string, pageSize: number, page: number): Promise<DeviceClassificationItem[]> {
		return eda.lib_Device.search('', libraryUuid, undefined, undefined, pageSize, page);
	}
}

function normalizeTree(tree: ClassificationTreeNode[]): EdaLibraryCategoryNode[] {
	return categoriesFromPaths(tree.flatMap((category) => {
		const rootName = cleanName(category.name);
		if (isAllCategory(rootName)) {
			return (category.children ?? []).map(child => [child.name]);
		}
		return [
			[category.name],
			...(category.children ?? []).map(child => [category.name, child.name]),
		];
	}));
}

function categoriesFromPaths(paths: string[][]): EdaLibraryCategoryNode[] {
	const roots = new Map<string, { name: string; children: Map<string, string> }>();
	for (const path of paths) {
		const normalizedPath = path.map(cleanName).filter(Boolean);
		if (isAllCategory(normalizedPath[0])) {
			normalizedPath.shift();
		}
		const rootName = normalizedPath[0];
		if (!rootName) {
			continue;
		}
		const rootKey = rootName.toLowerCase();
		const root = roots.get(rootKey) ?? { name: rootName, children: new Map() };
		roots.set(rootKey, root);
		const childName = normalizedPath[1];
		if (childName && !root.children.has(childName.toLowerCase())) {
			root.children.set(childName.toLowerCase(), childName);
		}
	}
	return [...roots.values()].map(root => ({
		name: root.name,
		children: [...root.children.values()],
	}));
}

function cleanName(value: string | undefined): string {
	return typeof value === 'string' ? value.trim() : '';
}

function isAllCategory(value: string | undefined): boolean {
	return value?.toLowerCase() === 'all';
}
