import type { ProcurementSuggestion } from '../../../features/project-planning/application/analyze-project-demand';
import type { NewPurchaseRecord, ProjectDemandSnapshot, PurchaseRecord } from '../../../features/project-planning/domain/project-planning';
import type { DiagnosticTrace } from './native-diagnostics';

export type ProjectPlanningTab = 'procurement' | 'purchases' | 'snapshots';
export type ProjectPlanningPageSize = 25 | 50 | 100;

export interface ProjectPlanningViewState {
	tab: ProjectPlanningTab;
	snapshotPage: number;
	procurementPage: number;
	purchasePage: number;
	pageSize: ProjectPlanningPageSize;
}

export interface ProjectPlanningPanelInput {
	snapshots: readonly ProjectDemandSnapshot[];
	procurement: readonly ProcurementSuggestion[];
	purchases: readonly PurchaseRecord[];
	initialState?: ProjectPlanningViewState;
}

export interface ProjectPlanningSnapshotRef {
	id: string;
	expectedRevision: number;
	projectUuid?: string;
	documentUuid: string;
}

export interface ProjectPlanningPurchaseRef {
	id: string;
	expectedRevision: number;
	projectSnapshotIds: string[];
}

export type ProjectPlanningAction
	= | { type: 'capture-current' }
		| { type: 'set-board-quantity'; snapshot: ProjectPlanningSnapshotRef; boardQuantity: number; confirmed: true }
		| { type: 'remove-snapshot'; snapshot: ProjectPlanningSnapshotRef; confirmed: true }
		| { type: 'export-procurement' }
		| { type: 'add-purchase'; draft: NewPurchaseRecord }
		| { type: 'remove-purchase'; purchase: ProjectPlanningPurchaseRef; confirmed: true }
		| { type: 'refresh' }
		| { type: 'close' };

export type ProjectPlanningIntent = ProjectPlanningAction & { viewState: ProjectPlanningViewState };

export interface ProjectPlanningOperation {
	operationId: string;
	intent: ProjectPlanningIntent;
}

export interface ProjectPlanningPanelSnapshot {
	snapshots: readonly ProjectDemandSnapshot[];
	procurement: readonly ProcurementSuggestion[];
	purchases: readonly PurchaseRecord[];
}

export type ProjectPlanningOperationResult
	= | { status: 'cancelled' | 'succeeded'; message?: string; snapshot?: ProjectPlanningPanelSnapshot }
		| { status: 'failed'; message: string; snapshot?: ProjectPlanningPanelSnapshot };

export type ProjectPlanningOperationHandler = (
	operation: ProjectPlanningOperation,
) => Promise<ProjectPlanningOperationResult>;

export interface ProjectPlanningPanel {
	open: (
		input: ProjectPlanningPanelInput,
		handleOperation: ProjectPlanningOperationHandler,
		trace?: DiagnosticTrace,
	) => Promise<void>;
}
