export const BOM_COLUMN_FIELDS = [
	'lcscPartNumber',
	'designators',
	'quantity',
	'name',
	'manufacturerPartNumber',
	'manufacturer',
	'package',
	'excludeFromBom',
] as const;

export type BomColumnField = typeof BOM_COLUMN_FIELDS[number];
export type BomColumnMapping = Partial<Record<BomColumnField, number>>;

export interface BomHeaderCandidate {
	rowIndex: number;
	rowNumber: number;
	score: number;
	recognizedColumnCount: number;
	suggestedMapping: BomColumnMapping;
	duplicateFields: BomColumnField[];
}

export interface BomSheet {
	name: string;
	rows: string[][];
	headerCandidates: BomHeaderCandidate[];
}

export interface ParsedBomFile {
	fileName: string;
	format: 'csv' | 'txt' | 'xls' | 'xlsx';
	encoding?: 'gb18030' | 'utf-16be' | 'utf-16le' | 'utf-8';
	sheets: BomSheet[];
}

export interface BomPartIdentity {
	name?: string;
	manufacturerPartNumber?: string;
	manufacturer?: string;
	package?: string;
}

export interface BomDesignDemand {
	sheetName: string;
	rowNumber: number;
	lcscPartNumber?: string;
	designators: string[];
	quantity: number;
	identity: BomPartIdentity;
}

export type BomRowIssueCode
	= | 'invalid-exclusion'
		| 'invalid-lcsc-part-number'
		| 'invalid-quantity'
		| 'missing-identity'
		| 'missing-lcsc-part-number'
		| 'missing-quantity'
		| 'quantity-designator-mismatch';

export interface BomRowIssue {
	code: BomRowIssueCode;
	sheetName: string;
	rowNumber: number;
	field?: BomColumnField;
	value?: string;
}

export interface BomMappingResult {
	demands: BomDesignDemand[];
	issues: BomRowIssue[];
}

export type BomIdentityField = keyof BomPartIdentity;

export interface AggregatedBomIdentity {
	name: string[];
	manufacturerPartNumber: string[];
	manufacturer: string[];
	package: string[];
}

export interface AggregatedBomDemand {
	lcscPartNumber: string;
	quantity: number;
	designators: string[];
	identity: AggregatedBomIdentity;
	sourceRows: Array<{ sheetName: string; rowNumber: number }>;
}

export type BomDiffChangeType
	= | 'added'
		| 'removed'
		| 'quantity-increased'
		| 'quantity-decreased'
		| 'identity-changed';

export interface BomIdentityChange {
	field: BomIdentityField;
	before: string[];
	after: string[];
}

export interface BomDiffEntry {
	type: BomDiffChangeType;
	lcscPartNumber: string;
	before?: AggregatedBomDemand;
	after?: AggregatedBomDemand;
	quantityDelta?: number;
	identityChanges?: BomIdentityChange[];
}

export interface BomDiffResult {
	entries: BomDiffEntry[];
	unmatchedBefore: BomDesignDemand[];
	unmatchedAfter: BomDesignDemand[];
}
