import type {
	CurrentDesignReader,
	CurrentDesignReadResult,
	DesignComponentReadCapability,
	DesignComponentSnapshot,
	DesignComponentsSnapshot,
	DesignDocumentKind,
	DesignDocumentReference,
	SelectedDesignComponentsReader,
	SelectedDesignComponentsReadResult,
} from '../../../features/design-stock-check/ports/design-component-reader';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../../features/inventory/domain/inventory-item';

const SCHEMATIC_DOCUMENT_TYPE = 1;
const PCB_DOCUMENT_TYPE = 3;
const COMPONENT_PRIMITIVE_TYPE = 'Component';
const SCHEMATIC_PART_TYPE = 'part';

const LCSC_PROPERTY_ALIASES = [
	'LCSC Part #',
	'LCSC Part',
	'LCSC',
	'Supplier Part',
	'Supplier Part Number',
	'供应商编号',
	'立创编号',
	'商品编号',
] as const;

const DESIGNATOR_PROPERTY_ALIASES = ['Designator', 'Reference', 'RefDes', '位号'] as const;
const MANUFACTURER_PART_PROPERTY_ALIASES = [
	'Manufacturer Part',
	'Manufacturer Part Number',
	'MPN',
	'Part Number',
	'厂家型号',
	'制造商编号',
] as const;
const MANUFACTURER_PROPERTY_ALIASES = ['Manufacturer', 'Mfr', '制造商', '品牌'] as const;
const NAME_PROPERTY_ALIASES = ['Name', 'Comment', 'Value', 'LCSC Part Name', '元件名称', '器件名称', '名称'] as const;
const PACKAGE_PROPERTY_ALIASES = [
	'Package',
	'Supplier Package',
	'Supplier Footprint',
	'Footprint',
	'供应商封装',
	'商品封装',
	'封装',
] as const;

interface HostDocumentInfo {
	documentType: number;
	uuid: string;
	parentProjectUuid?: string;
}

interface HostSchematicInfo {
	uuid: string;
	parentProjectUuid?: string;
}

interface HostPrimitive {
	getState_PrimitiveId?: () => unknown;
	getState_PrimitiveType?: () => unknown;
	getState_ComponentType?: () => unknown;
	getState_AddIntoBom?: () => unknown;
	getState_Component?: () => unknown;
	getState_Designator?: () => unknown;
	getState_Footprint?: () => unknown;
	getState_Manufacturer?: () => unknown;
	getState_ManufacturerId?: () => unknown;
	getState_Name?: () => unknown;
	getState_OtherProperty?: () => unknown;
	getState_SupplierId?: () => unknown;
}

export interface EdaDesignComponentsHost {
	getCurrentDocumentInfo?: () => Promise<HostDocumentInfo | undefined>;
	getCurrentSchematicInfo?: () => Promise<HostSchematicInfo | undefined>;
	getAllPcbComponents?: () => Promise<readonly HostPrimitive[]>;
	getAllSchematicComponents?: () => Promise<readonly HostPrimitive[]>;
	getSelectedPcbPrimitives?: () => Promise<readonly HostPrimitive[]>;
	getSelectedSchematicPrimitives?: () => Promise<readonly HostPrimitive[]>;
}

type DocumentContextResult
	= | { status: 'available'; document: DesignDocumentReference }
		| { status: 'no-active-document' | 'unsupported-document' }
		| { status: 'capability-unavailable'; capability: 'current-document' }
		| { status: 'failed'; step: 'current-document' };

export class EdaCurrentDesignReader implements CurrentDesignReader {
	public constructor(private readonly host: EdaDesignComponentsHost = createEdaDesignComponentsHost()) {}

	public async readCurrentDesign(): Promise<CurrentDesignReadResult> {
		const context = await readDocumentContext(this.host);
		if (context.status !== 'available') {
			return context;
		}

		try {
			if (context.document.kind === 'schematic') {
				if (!this.host.getCurrentSchematicInfo || !this.host.getAllSchematicComponents) {
					return { status: 'capability-unavailable', capability: 'schematic-components' };
				}
				const schematicInfo = await this.host.getCurrentSchematicInfo();
				const schematicUuid = cleanText(schematicInfo?.uuid);
				if (!schematicInfo || !schematicUuid) {
					return { status: 'failed', step: 'schematic-components' };
				}
				const primitives = await this.host.getAllSchematicComponents();
				const document: DesignDocumentReference = {
					kind: 'schematic',
					uuid: schematicUuid,
					projectUuid: cleanText(schematicInfo.parentProjectUuid) ?? context.document.projectUuid,
				};
				return availableSnapshot(document, normalizeComponents(primitives, true));
			}
			if (!this.host.getAllPcbComponents) {
				return { status: 'capability-unavailable', capability: 'pcb-components' };
			}
			return availableSnapshot(context.document, normalizeComponents(await this.host.getAllPcbComponents(), true));
		}
		catch {
			return { status: 'failed', step: componentCapability(context.document.kind) };
		}
	}
}

export class EdaSelectedDesignComponentsReader implements SelectedDesignComponentsReader {
	public constructor(private readonly host: EdaDesignComponentsHost = createEdaDesignComponentsHost()) {}

	public async readSelectedComponents(): Promise<SelectedDesignComponentsReadResult> {
		const context = await readDocumentContext(this.host);
		if (context.status !== 'available') {
			return context;
		}

		const capability = selectionCapability(context.document.kind);
		const read = context.document.kind === 'schematic'
			? this.host.getSelectedSchematicPrimitives
			: this.host.getSelectedPcbPrimitives;
		if (!read) {
			return { status: 'capability-unavailable', capability };
		}

		try {
			const primitives = await read();
			const components = primitives.filter(primitive => context.document.kind === 'schematic'
				? isSchematicComponent(primitive)
				: isPcbComponent(primitive));
			return availableSnapshot(context.document, normalizeComponents(components, false));
		}
		catch {
			return { status: 'failed', step: capability };
		}
	}
}

export function createEdaDesignComponentsHost(): EdaDesignComponentsHost {
	if (typeof eda === 'undefined') {
		return {};
	}

	const documentControl = eda.dmt_SelectControl;
	const schematicControl = eda.dmt_Schematic;
	const schematicComponents = eda.sch_PrimitiveComponent;
	const pcbComponents = eda.pcb_PrimitiveComponent;
	const schematicSelection = eda.sch_SelectControl;
	const pcbSelection = eda.pcb_SelectControl;
	return {
		getCurrentDocumentInfo: typeof documentControl?.getCurrentDocumentInfo === 'function'
			? () => documentControl.getCurrentDocumentInfo()
			: undefined,
		getCurrentSchematicInfo: typeof schematicControl?.getCurrentSchematicInfo === 'function'
			? () => schematicControl.getCurrentSchematicInfo()
			: undefined,
		getAllSchematicComponents: typeof schematicComponents?.getAll === 'function'
			? () => schematicComponents.getAll('part' as ESCH_PrimitiveComponentType, true)
			: undefined,
		getAllPcbComponents: typeof pcbComponents?.getAll === 'function'
			? () => pcbComponents.getAll()
			: undefined,
		getSelectedSchematicPrimitives: typeof schematicSelection?.getAllSelectedPrimitives === 'function'
			? () => schematicSelection.getAllSelectedPrimitives()
			: undefined,
		getSelectedPcbPrimitives: typeof pcbSelection?.getAllSelectedPrimitives === 'function'
			? () => pcbSelection.getAllSelectedPrimitives()
			: undefined,
	};
}

async function readDocumentContext(host: EdaDesignComponentsHost): Promise<DocumentContextResult> {
	if (!host.getCurrentDocumentInfo) {
		return { status: 'capability-unavailable', capability: 'current-document' };
	}

	let info: HostDocumentInfo | undefined;
	try {
		info = await host.getCurrentDocumentInfo();
	}
	catch {
		return { status: 'failed', step: 'current-document' };
	}
	if (!info) {
		return { status: 'no-active-document' };
	}

	const kind = documentKind(info.documentType);
	if (!kind) {
		return { status: 'unsupported-document' };
	}
	const uuid = cleanText(info.uuid);
	if (!uuid) {
		return { status: 'failed', step: 'current-document' };
	}
	return {
		status: 'available',
		document: {
			kind,
			uuid,
			projectUuid: cleanText(info.parentProjectUuid),
		},
	};
}

function normalizeComponents(
	primitives: readonly HostPrimitive[],
	excludeNotInBom: boolean,
): DesignComponentSnapshot[] {
	return primitives.flatMap((primitive) => {
		if (excludeNotInBom && safeRead(() => primitive.getState_AddIntoBom?.()) === false) {
			return [];
		}
		const snapshot = normalizeComponent(primitive);
		return snapshot ? [snapshot] : [];
	});
}

function normalizeComponent(primitive: HostPrimitive): DesignComponentSnapshot | undefined {
	const primitiveId = cleanText(safeRead(() => primitive.getState_PrimitiveId?.()));
	if (!primitiveId) {
		return undefined;
	}
	const otherProperties = toPropertyRecord(safeRead(() => primitive.getState_OtherProperty?.()));
	const component = toNamedReference(safeRead(() => primitive.getState_Component?.()));
	const footprint = toNamedReference(safeRead(() => primitive.getState_Footprint?.()));
	const supplierId = cleanText(safeRead(() => primitive.getState_SupplierId?.()))
		?? pickProperty(otherProperties, LCSC_PROPERTY_ALIASES);

	return {
		primitiveId,
		designator: cleanText(safeRead(() => primitive.getState_Designator?.()))
			?? pickProperty(otherProperties, DESIGNATOR_PROPERTY_ALIASES),
		lcscPartNumber: normalizeLcscPartNumber(supplierId),
		manufacturerPartNumber: cleanText(safeRead(() => primitive.getState_ManufacturerId?.()))
			?? pickProperty(otherProperties, MANUFACTURER_PART_PROPERTY_ALIASES),
		manufacturer: cleanText(safeRead(() => primitive.getState_Manufacturer?.()))
			?? pickProperty(otherProperties, MANUFACTURER_PROPERTY_ALIASES),
		name: cleanText(safeRead(() => primitive.getState_Name?.()))
			?? component?.name
			?? pickProperty(otherProperties, NAME_PROPERTY_ALIASES),
		package: footprint?.name ?? pickProperty(otherProperties, PACKAGE_PROPERTY_ALIASES),
	};
}

function isSchematicComponent(primitive: HostPrimitive): boolean {
	return safeRead(() => primitive.getState_PrimitiveType?.()) === COMPONENT_PRIMITIVE_TYPE
		&& safeRead(() => primitive.getState_ComponentType?.()) === SCHEMATIC_PART_TYPE;
}

function isPcbComponent(primitive: HostPrimitive): boolean {
	return safeRead(() => primitive.getState_PrimitiveType?.()) === COMPONENT_PRIMITIVE_TYPE;
}

function availableSnapshot(
	document: DesignDocumentReference,
	components: DesignComponentSnapshot[],
): { status: 'available'; snapshot: DesignComponentsSnapshot } {
	return { status: 'available', snapshot: { document, components } };
}

function documentKind(documentType: number): DesignDocumentKind | undefined {
	if (documentType === SCHEMATIC_DOCUMENT_TYPE) {
		return 'schematic';
	}
	if (documentType === PCB_DOCUMENT_TYPE) {
		return 'pcb';
	}
	return undefined;
}

function componentCapability(kind: DesignDocumentKind): Extract<DesignComponentReadCapability, 'pcb-components' | 'schematic-components'> {
	return kind === 'schematic' ? 'schematic-components' : 'pcb-components';
}

function selectionCapability(kind: DesignDocumentKind): Extract<DesignComponentReadCapability, 'pcb-selection' | 'schematic-selection'> {
	return kind === 'schematic' ? 'schematic-selection' : 'pcb-selection';
}

function safeRead<T>(read: () => T): T | undefined {
	try {
		return read();
	}
	catch {
		return undefined;
	}
}

function cleanText(value: unknown): string | undefined {
	if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
		return undefined;
	}
	const cleaned = normalizeInventoryText(String(value));
	return cleaned || undefined;
}

function toNamedReference(value: unknown): { name?: string } | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	return { name: cleanText((value as Record<string, unknown>).name) };
}

function toPropertyRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: {};
}

function pickProperty(source: Record<string, unknown>, aliases: readonly string[]): string | undefined {
	const normalized = new Map(Object.entries(source).map(([key, value]) => [normalizePropertyKey(key), value]));
	for (const alias of aliases) {
		const value = cleanText(normalized.get(normalizePropertyKey(alias)));
		if (value) {
			return value;
		}
	}
	return undefined;
}

function normalizePropertyKey(value: string): string {
	return value.toLowerCase().replaceAll(/[\s_#()（）./\\-]+/g, '');
}
