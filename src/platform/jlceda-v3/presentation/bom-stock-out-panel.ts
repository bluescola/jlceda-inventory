import type { BomStockOutPreview } from '../../../features/inventory/application/bom-stock-out';
import type { DiagnosticTrace } from './native-diagnostics';

export interface BomStockOutItemSummary {
	lineIndex: number;
	itemId: string;
	requestedQuantity: number;
	designators: readonly string[];
	identity: {
		name: string;
		lcscPartNumber?: string;
		manufacturerPartNumber?: string;
		manufacturer?: string;
		package?: string;
	};
}

export interface BomStockOutPanelInput {
	sourceName: string;
	boardQuantity: number;
	itemSummaries: readonly BomStockOutItemSummary[];
	preview: BomStockOutPreview;
}

export type BomStockOutPanelAction
	= | { type: 'close' }
		| { type: 'commit' };

export type BomStockOutPanelActionOutcome
	= | { status: 'succeeded'; message?: string }
		| { status: 'failed'; message: string };

export type BomStockOutPanelActionHandler = (
	action: BomStockOutPanelAction,
) => Promise<BomStockOutPanelActionOutcome>;

export interface BomStockOutPanel {
	open: (
		input: BomStockOutPanelInput,
		handleAction: BomStockOutPanelActionHandler,
		trace?: DiagnosticTrace,
	) => Promise<void>;
}
