import type { EdaModelStatus, InventoryItem } from '../../../features/inventory/domain/inventory-item';
import type { InventoryItemEditDraft } from './inventory-item-panel';
import type { DiagnosticTrace } from './native-diagnostics';

export interface InventoryOverviewCategory {
	id: string;
	name: string;
	parentId?: string;
	sortOrder: number;
	revision: number;
}

export interface InventoryOverviewItem extends InventoryItem {
	categoryId?: string;
}

export interface InventoryOverviewInput {
	items: readonly InventoryOverviewItem[];
	categories: readonly InventoryOverviewCategory[];
	initialState?: InventoryOverviewViewState;
}

export interface InventoryOverviewRevisionRef {
	id: string;
	expectedRevision: number;
}

export type InventoryOverviewStockFilter = 'all' | 'depleted' | 'in-stock';
export type InventoryOverviewModelFilter = 'all' | EdaModelStatus;
export type InventoryOverviewReplenishmentFilter = 'all' | 'needs-replenishment' | 'stocktake-required';
export type InventoryOverviewFavoriteFilter = 'all' | 'favorites';
export type InventoryOverviewSort = 'category' | 'name' | 'relevance' | 'stock' | 'updated';
export type InventoryOverviewSearchScope = 'all' | 'current';

export interface InventoryOverviewViewState {
	query: string;
	focusItemId?: string;
	searchScope: InventoryOverviewSearchScope;
	categoryId: 'all' | 'unclassified' | string;
	stockFilter: InventoryOverviewStockFilter;
	modelFilter: InventoryOverviewModelFilter;
	replenishmentFilter?: InventoryOverviewReplenishmentFilter;
	favoriteFilter?: InventoryOverviewFavoriteFilter;
	sort: InventoryOverviewSort;
	page: number;
	pageSize: 25 | 50 | 100;
}

export type InventoryOverviewAction
	= | { type: 'view-item'; item: InventoryOverviewRevisionRef }
		| { type: 'place-item'; item: InventoryOverviewRevisionRef }
		| { type: 'edit-item'; item: InventoryOverviewRevisionRef }
		| { type: 'update-item'; item: InventoryOverviewRevisionRef; draft: InventoryItemEditDraft; categoryId?: string }
		| { type: 'merge-items'; source: InventoryOverviewRevisionRef; target: InventoryOverviewRevisionRef; matchToken: string; categoryId?: string }
		| { type: 'open-marketplace'; item: InventoryOverviewRevisionRef }
		| { type: 'open-datasheet'; item: InventoryOverviewRevisionRef }
		| { type: 'retry-model'; item: InventoryOverviewRevisionRef }
		| { type: 'attach-model'; item: InventoryOverviewRevisionRef; matchToken: string }
		| { type: 'copy-common'; item: InventoryOverviewRevisionRef }
		| { type: 'delete-item'; item: InventoryOverviewRevisionRef; confirmed: true }
		| { type: 'delete-items'; items: InventoryOverviewRevisionRef[]; confirmed: true }
		| { type: 'move-items'; items: InventoryOverviewRevisionRef[]; categoryId?: string }
		| { type: 'create-category'; name: string; parentId?: string }
		| { type: 'rename-category'; category: InventoryOverviewRevisionRef; name: string }
		| { type: 'delete-category'; category: InventoryOverviewRevisionRef; confirmed: true }
		| { type: 'reorder-categories'; parentId?: string; categories: InventoryOverviewRevisionRef[] }
		| { type: 'import-eda-categories' }
		| { type: 'export-replenishment' }
		| { type: 'refresh' };

export type InventoryOverviewIntent = InventoryOverviewAction & { viewState: InventoryOverviewViewState };

export interface InventoryOverviewOperation {
	operationId: string;
	intent: InventoryOverviewIntent;
}

export interface InventoryOverviewSnapshot {
	items: readonly InventoryOverviewItem[];
	categories: readonly InventoryOverviewCategory[];
}

export type InventoryOverviewOperationResult
	= | { status: 'succeeded' | 'cancelled'; message?: string; snapshot?: InventoryOverviewSnapshot }
		| { status: 'failed' | 'model-missing'; message: string; snapshot?: InventoryOverviewSnapshot }
		| { status: 'model-match'; message: string; matchToken: string; item: InventoryOverviewRevisionRef }
		| {
			status: 'duplicate-match';
			matchToken: string;
			source: InventoryOverviewRevisionRef;
			target: InventoryOverviewRevisionRef;
			candidate: InventoryOverviewItem;
			existing: InventoryOverviewItem;
		};

export type InventoryOverviewOperationHandler = (
	operation: InventoryOverviewOperation,
) => Promise<InventoryOverviewOperationResult>;

export interface InventoryOverviewPanel {
	open: (
		input: InventoryOverviewInput,
		onOperation: InventoryOverviewOperationHandler,
		trace?: DiagnosticTrace,
	) => Promise<void>;
}

export const INVENTORY_OVERVIEW_MODEL_STATUSES: readonly EdaModelStatus[] = [
	'available',
	'missing',
	'failed',
	'unchecked',
];
