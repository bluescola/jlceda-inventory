import type { DesignStockCheckReport } from '../../../features/design-stock-check/application/check-design-stock';
import type { DiagnosticTrace } from './native-diagnostics';

export type DesignStockCheckSource = 'file' | 'pcb' | 'schematic';

export interface DesignStockCheckPanelInput {
	report: DesignStockCheckReport;
	source: DesignStockCheckSource;
}

export type DesignStockCheckPanelAction
	= | { type: 'close' }
		| { type: 'export-csv' };

export type DesignStockCheckPanelActionOutcome
	= | { status: 'succeeded'; message?: string }
		| { status: 'failed'; message: string };

export type DesignStockCheckPanelActionHandler = (
	action: DesignStockCheckPanelAction,
) => Promise<DesignStockCheckPanelActionOutcome>;

export interface DesignStockCheckPanel {
	open: (
		input: DesignStockCheckPanelInput,
		handleAction: DesignStockCheckPanelActionHandler,
		trace?: DiagnosticTrace,
	) => Promise<void>;
}
