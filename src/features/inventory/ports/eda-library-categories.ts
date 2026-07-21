export type EdaLibraryCategorySource = 'favorite' | 'personal';

export interface EdaLibraryCategoryNode {
	name: string;
	children: string[];
}

export interface EdaLibraryCategorySnapshot {
	categories: EdaLibraryCategoryNode[];
	complete: boolean;
	discovery: 'classification-tree' | 'device-scan';
	source: EdaLibraryCategorySource;
}

export type EdaLibraryCategoryReadResult
	= | { status: 'available'; snapshot: EdaLibraryCategorySnapshot }
		| { status: 'unavailable' }
		| { status: 'unsupported' };

export interface EdaLibraryCategories {
	availableSources: () => Promise<EdaLibraryCategorySource[]>;
	read: (source: EdaLibraryCategorySource) => Promise<EdaLibraryCategoryReadResult>;
}
