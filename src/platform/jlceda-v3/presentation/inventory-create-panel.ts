import type { EdaModelReference, PartIdentity, QuantityPrecision, StockState } from '../../../features/inventory/domain/inventory-item';
import type { StructuredInventoryLocation } from '../../../features/inventory/domain/inventory-metadata';
import type { DiagnosticTrace } from './native-diagnostics';

export type InventoryCreateMode = 'custom' | 'lcsc';
export type InventoryCreateQuantityMode = 'depleted' | 'estimated' | 'exact' | 'unknown';

export interface InventoryCreateFormState {
	lcscPartNumber: string;
	marketplaceConfirmed: boolean;
	supplierId: string;
	name: string;
	manufacturer: string;
	manufacturerPartNumber: string;
	package: string;
	description: string;
	quantityMode: InventoryCreateQuantityMode;
	quantity: string;
	minimumQuantity?: string;
	favorite?: boolean;
	categoryId: string;
	location: string;
	datasheetUrl: string;
	locationCabinet: string;
	locationBox: string;
	locationRow: string;
	locationColumn: string;
	note: string;
}

export interface InventoryCreateDraft {
	identity: PartIdentity;
	quantity: number | null;
	precision: QuantityPrecision;
	state: StockState;
	minimumQuantity?: number;
	favorite?: boolean;
	categoryId?: string;
	location?: string;
	datasheetUrl?: string;
	structuredLocation?: StructuredInventoryLocation;
	note?: string;
}

export interface InventoryCreateCategory {
	id: string;
	name: string;
	parentId?: string;
	sortOrder: number;
}

export interface InventoryCreatePanelInput {
	mode: InventoryCreateMode;
	initial?: Partial<InventoryCreateFormState>;
	categories?: readonly InventoryCreateCategory[];
	locationOptions?: readonly string[];
}

export interface InventoryCreateIdentitySuggestion extends Partial<Omit<PartIdentity, 'name'>> {
	name?: string;
}

export interface InventoryCreateModelSummary {
	status: 'available' | 'failed' | 'missing' | 'unchecked';
	reference?: EdaModelReference;
}

export interface InventoryCreateDuplicateSnapshot {
	id: string;
	revision: number;
	identity: PartIdentity;
	quantity: number | null;
	precision: QuantityPrecision;
	state: StockState;
	categoryName?: string;
	location?: string;
	datasheetUrl?: string;
	structuredLocation?: StructuredInventoryLocation;
	note?: string;
}

interface InventoryCreatePanelActionBase {
	operationId: string;
	form: InventoryCreateFormState;
}

export type InventoryCreatePanelAction
	= | InventoryCreatePanelActionBase & {
		type: 'query-eda';
		lcscPartNumber: string;
	}
	| InventoryCreatePanelActionBase & {
		type: 'open-marketplace';
		lcscPartNumber?: string;
	}
	| InventoryCreatePanelActionBase & {
		type: 'save';
		draft: InventoryCreateDraft;
		modelToken?: string;
	}
	| InventoryCreatePanelActionBase & {
		type: 'confirm-merge';
		draft: InventoryCreateDraft;
		duplicateToken: string;
		modelToken?: string;
		existing: { id: string; expectedRevision: number };
	};

export type InventoryCreateActionOutcome
	= | {
		stage: 'succeeded';
		message?: string;
		suggestion?: InventoryCreateIdentitySuggestion;
		model?: InventoryCreateModelSummary;
		modelToken?: string;
	}
	| {
		stage: 'not-found';
		message?: string;
		model?: InventoryCreateModelSummary;
	}
	| {
		stage: 'duplicate';
		message?: string;
		duplicateToken: string;
		existing: InventoryCreateDuplicateSnapshot;
	}
	| {
		stage: 'cancelled' | 'failed';
		message?: string;
	};

export type InventoryCreatePanelOutcome
	= | { status: 'cancelled' }
		| { status: 'saved'; draft: InventoryCreateDraft; merged: boolean };

export type InventoryCreateActionHandler = (
	action: InventoryCreatePanelAction,
) => Promise<InventoryCreateActionOutcome>;

export interface InventoryCreatePanel {
	open: (
		input: InventoryCreatePanelInput,
		handleAction: InventoryCreateActionHandler,
		trace?: DiagnosticTrace,
	) => Promise<InventoryCreatePanelOutcome>;
}
