import type { InventoryDocument } from '../../../features/inventory/domain/inventory-document';
import type { InventoryRepository } from '../../../features/inventory/ports/inventory-repository';
import { cloneInventoryDocument, createEmptyInventoryDocument, migrateInventoryDocument } from '../../../features/inventory/domain/inventory-document';
import { InventoryDocumentRevisionConflictError } from '../../../features/inventory/ports/inventory-repository';

export const INVENTORY_STORAGE_KEY = 'inventory.v1.document';
export const INVENTORY_RECOVERY_STORAGE_KEY = 'inventory.v1.pre-restore';

export class EdaInventoryRepository implements InventoryRepository {
	private saveQueue: Promise<void> = Promise.resolve();

	public async load(): Promise<InventoryDocument> {
		const stored = this.readStored();
		if (stored === undefined) {
			return createEmptyInventoryDocument();
		}
		const document = migrateInventoryDocument(stored);
		if (!document) {
			throw new TypeError('Unsupported or invalid inventory document.');
		}
		return document;
	}

	public save(document: InventoryDocument, expectedRevision?: number): Promise<void> {
		const snapshot = cloneInventoryDocument(document);
		const pending = this.saveQueue.then(() => this.saveExclusive(snapshot, expectedRevision));
		this.saveQueue = pending.then(() => undefined, () => undefined);
		return pending;
	}

	public async loadRecoverySnapshot(): Promise<InventoryDocument | undefined> {
		let stored: unknown;
		try {
			stored = eda.sys_Storage.getExtensionUserConfig(INVENTORY_RECOVERY_STORAGE_KEY);
		}
		catch (error) {
			throw new Error('Unable to read inventory recovery snapshot.', { cause: error });
		}
		if (stored === undefined) {
			return undefined;
		}
		const document = migrateInventoryDocument(stored);
		if (!document) {
			throw new TypeError('Unsupported or invalid inventory recovery snapshot.');
		}
		return document;
	}

	public async saveRecoverySnapshot(document: InventoryDocument): Promise<void> {
		try {
			const saved = await eda.sys_Storage.setExtensionUserConfig(
				INVENTORY_RECOVERY_STORAGE_KEY,
				cloneInventoryDocument(document),
			);
			if (!saved) {
				throw new Error('The host rejected the inventory recovery snapshot.');
			}
		}
		catch (error) {
			throw new Error('Unable to save inventory recovery snapshot.', { cause: error });
		}
	}

	public async clearRecoverySnapshot(): Promise<void> {
		try {
			const removed = await eda.sys_Storage.deleteExtensionUserConfig(INVENTORY_RECOVERY_STORAGE_KEY);
			if (!removed) {
				throw new Error('The host rejected clearing the inventory recovery snapshot.');
			}
		}
		catch (error) {
			throw new Error('Unable to clear inventory recovery snapshot.', { cause: error });
		}
	}

	private async saveExclusive(document: InventoryDocument, expectedRevision?: number): Promise<void> {
		try {
			if (expectedRevision !== undefined) {
				const stored = this.readStored();
				const current = stored === undefined ? createEmptyInventoryDocument() : migrateInventoryDocument(stored);
				if (!current || current.revision !== expectedRevision) {
					throw new InventoryDocumentRevisionConflictError(expectedRevision, current?.revision);
				}
			}
			const saved = await eda.sys_Storage.setExtensionUserConfig(INVENTORY_STORAGE_KEY, document);
			if (!saved) {
				throw new Error('The host rejected the inventory configuration write.');
			}
		}
		catch (error) {
			if (error instanceof InventoryDocumentRevisionConflictError) {
				throw error;
			}
			throw new Error('Unable to save extension inventory configuration.', { cause: error });
		}
	}

	private readStored(): unknown {
		try {
			return eda.sys_Storage.getExtensionUserConfig(INVENTORY_STORAGE_KEY);
		}
		catch (error) {
			throw new Error('Unable to read extension inventory configuration.', { cause: error });
		}
	}
}
