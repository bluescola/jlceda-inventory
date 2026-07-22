import type { EdaDesignComponentsHost } from '../../src/platform/jlceda-v3/eda/design-component-readers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	EdaCurrentDesignReader,
	EdaSelectedDesignComponentsReader,
} from '../../src/platform/jlceda-v3/eda/design-component-readers';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('edaCurrentDesignReader', () => {
	it('reads every schematic page, skips only explicit BOM exclusions, and normalizes controlled fallbacks', async () => {
		const getAll = vi.fn().mockResolvedValue([
			component({
				primitiveId: 'sch-1',
				designator: 'R1',
				supplierId: ' c307423 ',
				manufacturerId: 'RC0603FR-0710KL',
				manufacturer: 'Yageo',
				name: '10k resistor',
				footprintName: 'R0603',
				addIntoBom: true,
			}),
			component({ primitiveId: 'sch-2', addIntoBom: false, supplierId: 'C2' }),
			component({
				primitiveId: 'sch-3',
				addIntoBom: undefined,
				otherProperty: {
					'立创编号': 123,
					'MPN': 'SN74HC595DR',
					'品牌': 'TI',
					'Comment': 'Shift register',
					'Supplier Package': 'SOIC-16',
					'RefDes': 'U1',
				},
			}),
		]);
		vi.stubGlobal('eda', edaApi({
			document: { documentType: 1, uuid: 'sch-doc', parentProjectUuid: 'project-1' },
			getAllSchematic: getAll,
		}));

		const result = await new EdaCurrentDesignReader().readCurrentDesign();

		expect(getAll).toHaveBeenCalledWith('part', true);
		expect(result).toEqual({
			status: 'available',
			snapshot: {
				document: { kind: 'schematic', uuid: 'schematic-1', projectUuid: 'project-1' },
				components: [
					{
						primitiveId: 'sch-1',
						designator: 'R1',
						lcscPartNumber: 'C307423',
						manufacturerPartNumber: 'RC0603FR-0710KL',
						manufacturer: 'Yageo',
						name: '10k resistor',
						package: 'R0603',
					},
					{
						primitiveId: 'sch-3',
						designator: 'U1',
						lcscPartNumber: 'C123',
						manufacturerPartNumber: 'SN74HC595DR',
						manufacturer: 'TI',
						name: 'Shift register',
						package: 'SOIC-16',
					},
				],
			},
		});
	});

	it('does not silently turn an all-page schematic read into a current-page snapshot', async () => {
		const getAll = vi.fn().mockResolvedValue([component({ primitiveId: 'sch-1', supplierId: 'C1' })]);
		const reader = new EdaCurrentDesignReader(host({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 1, uuid: 'page-1' }),
			getCurrentSchematicInfo: undefined,
			getAllSchematicComponents: getAll,
		}));

		const result = await reader.readCurrentDesign();

		expect(getAll).not.toHaveBeenCalled();
		expect(result).toEqual({ status: 'capability-unavailable', capability: 'schematic-components' });
	});

	it('selects the PCB API from the active document and calls getAll without filters', async () => {
		const getAllPcb = vi.fn().mockResolvedValue([component({ primitiveId: 'pcb-1', supplierId: 'C42' })]);
		const getAllSchematic = vi.fn();
		vi.stubGlobal('eda', edaApi({
			document: { documentType: 3, uuid: 'pcb-doc' },
			getAllPcb,
			getAllSchematic,
		}));

		const result = await new EdaCurrentDesignReader().readCurrentDesign();

		expect(getAllPcb).toHaveBeenCalledWith();
		expect(getAllSchematic).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			status: 'available',
			snapshot: {
				document: { kind: 'pcb', uuid: 'pcb-doc' },
				components: [{ primitiveId: 'pcb-1', lcscPartNumber: 'C42' }],
			},
		});
	});

	it('reports document, capability, and API failures as structured results', async () => {
		expect(await new EdaCurrentDesignReader({}).readCurrentDesign()).toEqual({
			status: 'capability-unavailable',
			capability: 'current-document',
		});
		expect(await new EdaCurrentDesignReader(host({ getCurrentDocumentInfo: vi.fn().mockResolvedValue(undefined) })).readCurrentDesign())
			.toEqual({ status: 'no-active-document' });
		expect(await new EdaCurrentDesignReader(host({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 12, uuid: 'preview' }),
		})).readCurrentDesign()).toEqual({ status: 'unsupported-document' });
		expect(await new EdaCurrentDesignReader(host({ getCurrentDocumentInfo: vi.fn().mockRejectedValue(new Error('context')) })).readCurrentDesign())
			.toEqual({ status: 'failed', step: 'current-document' });
		expect(await new EdaCurrentDesignReader(host({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 1, uuid: 'sch-doc' }),
			getAllSchematicComponents: undefined,
		})).readCurrentDesign()).toEqual({ status: 'capability-unavailable', capability: 'schematic-components' });
		expect(await new EdaCurrentDesignReader(host({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 3, uuid: 'pcb-doc' }),
			getAllPcbComponents: vi.fn().mockRejectedValue(new Error('read')),
		})).readCurrentDesign()).toEqual({ status: 'failed', step: 'pcb-components' });
	});
});

describe('edaSelectedDesignComponentsReader', () => {
	it('strictly keeps selected schematic parts, preserves multiple selections, and includes BOM exclusions for locating', async () => {
		const selected = vi.fn().mockResolvedValue([
			primitive('Wire'),
			component({ primitiveId: 'flag-1', primitiveType: 'Component', componentType: 'netflag', supplierId: 'C1' }),
			component({ primitiveId: 'part-1', primitiveType: 'Component', componentType: 'part', supplierId: 'C2' }),
			component({ primitiveId: 'part-2', primitiveType: 'Component', componentType: 'part', supplierId: 'C3' }),
			component({ primitiveId: 'part-3', primitiveType: 'Component', componentType: 'part', supplierId: 'C4', addIntoBom: false }),
		]);
		const reader = new EdaSelectedDesignComponentsReader(host({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 1, uuid: 'sch-doc' }),
			getSelectedSchematicPrimitives: selected,
		}));

		const result = await reader.readSelectedComponents();

		expect(result).toMatchObject({
			status: 'available',
			snapshot: {
				components: [
					{ primitiveId: 'part-1', lcscPartNumber: 'C2' },
					{ primitiveId: 'part-2', lcscPartNumber: 'C3' },
					{ primitiveId: 'part-3', lcscPartNumber: 'C4' },
				],
			},
		});
	});

	it('strictly filters PCB primitives and reports an empty valid selection', async () => {
		const pcbReader = new EdaSelectedDesignComponentsReader(host({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 3, uuid: 'pcb-doc' }),
			getSelectedPcbPrimitives: vi.fn().mockResolvedValue([
				primitive('Pad'),
				component({ primitiveId: 'pcb-part', primitiveType: 'Component', supplierId: 'C8' }),
			]),
		}));
		expect(await pcbReader.readSelectedComponents()).toMatchObject({
			status: 'available',
			snapshot: { components: [{ primitiveId: 'pcb-part', lcscPartNumber: 'C8' }] },
		});

		const emptyReader = new EdaSelectedDesignComponentsReader(host({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 3, uuid: 'pcb-doc' }),
			getSelectedPcbPrimitives: vi.fn().mockResolvedValue([primitive('Via')]),
		}));
		expect(await emptyReader.readSelectedComponents()).toMatchObject({
			status: 'available',
			snapshot: { components: [] },
		});
	});

	it('reports unavailable and failed selection capabilities without throwing', async () => {
		expect(await new EdaSelectedDesignComponentsReader(host({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 1, uuid: 'sch-doc' }),
			getSelectedSchematicPrimitives: undefined,
		})).readSelectedComponents()).toEqual({
			status: 'capability-unavailable',
			capability: 'schematic-selection',
		});
		expect(await new EdaSelectedDesignComponentsReader(host({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 3, uuid: 'pcb-doc' }),
			getSelectedPcbPrimitives: vi.fn().mockRejectedValue(new Error('selection')),
		})).readSelectedComponents()).toEqual({ status: 'failed', step: 'pcb-selection' });
	});
});

function host(overrides: Partial<EdaDesignComponentsHost> = {}): EdaDesignComponentsHost {
	return {
		getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 1, uuid: 'sch-doc' }),
		getCurrentSchematicInfo: vi.fn().mockResolvedValue({ uuid: 'schematic-1' }),
		getAllPcbComponents: vi.fn().mockResolvedValue([]),
		getAllSchematicComponents: vi.fn().mockResolvedValue([]),
		getSelectedPcbPrimitives: vi.fn().mockResolvedValue([]),
		getSelectedSchematicPrimitives: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}

function edaApi(options: {
	document: { documentType: number; uuid: string; parentProjectUuid?: string };
	getAllPcb?: ReturnType<typeof vi.fn>;
	getAllSchematic?: ReturnType<typeof vi.fn>;
}): object {
	return {
		dmt_SelectControl: { getCurrentDocumentInfo: vi.fn().mockResolvedValue(options.document) },
		dmt_Schematic: {
			getCurrentSchematicInfo: vi.fn().mockResolvedValue({
				uuid: 'schematic-1',
				parentProjectUuid: options.document.parentProjectUuid,
			}),
		},
		sch_PrimitiveComponent: { getAll: options.getAllSchematic ?? vi.fn().mockResolvedValue([]) },
		pcb_PrimitiveComponent: { getAll: options.getAllPcb ?? vi.fn().mockResolvedValue([]) },
		sch_SelectControl: {},
		pcb_SelectControl: {},
	};
}

function primitive(primitiveType: string): Record<string, () => unknown> {
	return {
		getState_PrimitiveType: () => primitiveType,
		getState_PrimitiveId: () => `${primitiveType.toLowerCase()}-1`,
	};
}

function component(options: {
	primitiveId: string;
	primitiveType?: string;
	componentType?: string;
	addIntoBom?: boolean;
	designator?: string;
	supplierId?: string;
	manufacturerId?: string;
	manufacturer?: string;
	name?: string;
	componentName?: string;
	footprintName?: string;
	otherProperty?: Record<string, unknown>;
}): Record<string, () => unknown> {
	return {
		getState_PrimitiveType: () => options.primitiveType ?? 'Component',
		getState_ComponentType: () => options.componentType ?? 'part',
		getState_PrimitiveId: () => options.primitiveId,
		getState_AddIntoBom: () => options.addIntoBom,
		getState_Designator: () => options.designator,
		getState_SupplierId: () => options.supplierId,
		getState_ManufacturerId: () => options.manufacturerId,
		getState_Manufacturer: () => options.manufacturer,
		getState_Name: () => options.name,
		getState_Component: () => options.componentName ? { name: options.componentName } : undefined,
		getState_Footprint: () => options.footprintName ? { name: options.footprintName } : undefined,
		getState_OtherProperty: () => options.otherProperty,
	};
}
