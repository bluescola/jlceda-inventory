import type { OrderImportDuplicateReason } from '../../../features/inventory/domain/order-import-batch';
import type { ImportDefaultState } from '../../../features/order-import/domain/order-import';
import type { DiagnosticTrace } from './native-diagnostics';

export type OrderImportPanelStrategy = 'add' | 'replace' | 'skip';
export type OrderImportProgressPhase = 'model-matching' | 'parsing' | 'writing';

export interface OrderImportPanelSettings {
	defaultState: ImportDefaultState;
	strategy: OrderImportPanelStrategy;
}

export interface OrderImportPanelInput {
	files: ReadonlyArray<{ name: string }>;
}

export interface OrderImportPanelProgress {
	phase: OrderImportProgressPhase;
	completed: number;
	total: number;
	message?: string;
}

export interface OrderImportPanelFilePreview {
	fileName: string;
	orderNumber?: string;
	rowCount: number;
	totalQuantity: number;
	status: 'duplicate' | 'ready';
	duplicateReason?: OrderImportDuplicateReason;
	duplicateImportedAt?: string;
	added: number;
	merged: number;
	skipped: number;
}

export interface OrderImportPanelPreview {
	files: OrderImportPanelFilePreview[];
	added: number;
	merged: number;
	skipped: number;
}

export interface OrderImportPanelCompletedSummary {
	importedFiles: number;
	duplicateFiles: number;
	added: number;
	merged: number;
	skipped: number;
}

export type OrderImportPanelAction
	= | { type: 'preview'; operationId: string; settings: OrderImportPanelSettings }
		| { type: 'import'; operationId: string; settings: OrderImportPanelSettings; previewToken: string };

export type OrderImportPanelActionOutcome
	= | { stage: 'preview'; previewToken: string; preview: OrderImportPanelPreview }
		| { stage: 'completed'; summary: OrderImportPanelCompletedSummary }
		| { stage: 'failed'; message: string };

export type OrderImportPanelProgressReporter = (progress: OrderImportPanelProgress) => Promise<void>;
export type OrderImportPanelActionHandler = (
	action: OrderImportPanelAction,
	reportProgress: OrderImportPanelProgressReporter,
) => Promise<OrderImportPanelActionOutcome>;

export interface OrderImportPanel {
	open: (
		input: OrderImportPanelInput,
		handleAction: OrderImportPanelActionHandler,
		trace?: DiagnosticTrace,
	) => Promise<'cancelled' | 'completed'>;
}
