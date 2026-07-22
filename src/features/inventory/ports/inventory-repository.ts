import type { InventoryDocument } from '../domain/inventory-document';

export interface InventoryRepository {
	load: () => Promise<InventoryDocument>;
	save: (document: InventoryDocument, expectedRevision?: number) => Promise<void>;
	loadRecoverySnapshot?: () => Promise<InventoryDocument | undefined>;
	saveRecoverySnapshot?: (document: InventoryDocument) => Promise<void>;
	clearRecoverySnapshot?: () => Promise<void>;
}

export class InventoryDocumentRevisionConflictError extends Error {
	public constructor(
		public readonly expectedRevision: number,
		public readonly actualRevision?: number,
	) {
		super(`Inventory document revision conflict: expected ${expectedRevision}, actual ${actualRevision ?? 'missing'}.`);
		this.name = 'InventoryDocumentRevisionConflictError';
	}
}
