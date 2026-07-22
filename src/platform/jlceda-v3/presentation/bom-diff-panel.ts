import type { BomDiffResult, BomRowIssue } from '../../../features/bom-analysis/domain/bom-analysis';
import type { DiagnosticTrace } from './native-diagnostics';

export interface BomDiffPanelInput {
	result: BomDiffResult;
	beforeFileName: string;
	afterFileName: string;
	beforeIssues: readonly BomRowIssue[];
	afterIssues: readonly BomRowIssue[];
}

export type BomDiffPanelAction
	= | { type: 'close' }
		| { type: 'export-csv' };

export type BomDiffPanelActionOutcome
	= | { status: 'succeeded'; message?: string }
		| { status: 'failed'; message: string };

export type BomDiffPanelActionHandler = (
	action: BomDiffPanelAction,
) => Promise<BomDiffPanelActionOutcome>;

export interface BomDiffPanel {
	open: (
		input: BomDiffPanelInput,
		handleAction: BomDiffPanelActionHandler,
		trace?: DiagnosticTrace,
	) => Promise<void>;
}
