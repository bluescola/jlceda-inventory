import type { BomColumnMapping, ParsedBomFile } from '../../../features/bom-analysis/domain/bom-analysis';
import type { DiagnosticTrace } from './native-diagnostics';

export type BomMappingMode = 'compare' | 'stock-check';

export interface BomMappingPanelInput {
	mode: BomMappingMode;
	files: ParsedBomFile[];
}

export interface BomFileMappingSelection {
	fileIndex: number;
	sheetIndex: number;
	headerRowIndex: number;
	mapping: BomColumnMapping;
}

export type BomMappingPanelResult
	= | { status: 'cancelled' }
		| { status: 'submitted'; files: BomFileMappingSelection[] };

export interface BomMappingPanel {
	open: (input: BomMappingPanelInput, trace?: DiagnosticTrace) => Promise<BomMappingPanelResult>;
}
