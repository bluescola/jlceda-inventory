export type DesignDocumentKind = 'pcb' | 'schematic';

export interface DesignDocumentReference {
	kind: DesignDocumentKind;
	uuid: string;
	projectUuid?: string;
}

export interface DesignComponentSnapshot {
	primitiveId: string;
	designator?: string;
	lcscPartNumber?: string;
	manufacturerPartNumber?: string;
	manufacturer?: string;
	name?: string;
	package?: string;
}

export interface DesignComponentsSnapshot {
	document: DesignDocumentReference;
	components: DesignComponentSnapshot[];
}

export type DesignComponentReadCapability
	= | 'current-document'
		| 'pcb-components'
		| 'pcb-selection'
		| 'schematic-components'
		| 'schematic-selection';

export type CurrentDesignReadResult
	= | { status: 'available'; snapshot: DesignComponentsSnapshot }
		| { status: 'no-active-document' | 'unsupported-document' }
		| { status: 'capability-unavailable'; capability: DesignComponentReadCapability }
		| { status: 'failed'; step: 'current-document' | 'pcb-components' | 'schematic-components' };

export type SelectedDesignComponentsReadResult
	= | { status: 'available'; snapshot: DesignComponentsSnapshot }
		| { status: 'no-active-document' | 'unsupported-document' }
		| { status: 'capability-unavailable'; capability: DesignComponentReadCapability }
		| { status: 'failed'; step: 'current-document' | 'pcb-selection' | 'schematic-selection' };

export interface CurrentDesignReader {
	readCurrentDesign: () => Promise<CurrentDesignReadResult>;
}

export interface SelectedDesignComponentsReader {
	readSelectedComponents: () => Promise<SelectedDesignComponentsReadResult>;
}
