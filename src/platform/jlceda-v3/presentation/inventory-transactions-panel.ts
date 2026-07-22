import type { InventoryTransaction, StockOutBatchRecord } from '../../../features/inventory/domain/inventory-transaction';
import type { DiagnosticTrace } from './native-diagnostics';

export interface InventoryTransactionsPanelInput {
	batches: readonly StockOutBatchRecord[];
	transactions: readonly InventoryTransaction[];
}

export type InventoryTransactionsPanelAction
	= | { type: 'close' }
		| { type: 'refresh' }
		| { type: 'undo-batch'; batchId: string };

export type InventoryTransactionsPanelActionOutcome
	= | { status: 'succeeded'; message?: string; snapshot?: InventoryTransactionsPanelInput }
		| { status: 'failed'; message: string };

export type InventoryTransactionsPanelActionHandler = (
	action: InventoryTransactionsPanelAction,
) => Promise<InventoryTransactionsPanelActionOutcome>;

export interface InventoryTransactionsPanel {
	open: (
		input: InventoryTransactionsPanelInput,
		handleAction: InventoryTransactionsPanelActionHandler,
		trace?: DiagnosticTrace,
	) => Promise<void>;
}
