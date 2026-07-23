import type { EdaModelReference } from '../../../features/inventory/domain/inventory-item';

const SCHEMATIC_DOCUMENT_TYPE = 1;

export type EdaPlacementResult = 'not-found' | 'not-schematic' | 'ready' | 'unsupported';

export interface EdaPlacementHost {
	getCurrentDocumentInfo?: () => Promise<{ documentType: number } | undefined>;
	placeComponentWithMouse?: (component: { libraryUuid: string; uuid: string }) => Promise<boolean>;
}

export class EdaPlacementClient {
	public constructor(private readonly host: EdaPlacementHost = createEdaPlacementHost()) {}

	public async placeWithMouse(reference: EdaModelReference): Promise<EdaPlacementResult> {
		if (!this.host.getCurrentDocumentInfo || !this.host.placeComponentWithMouse) {
			return 'unsupported';
		}
		const document = await this.host.getCurrentDocumentInfo();
		if (document?.documentType !== SCHEMATIC_DOCUMENT_TYPE) {
			return 'not-schematic';
		}
		const placed = await this.host.placeComponentWithMouse({
			libraryUuid: reference.libraryUuid,
			uuid: reference.deviceUuid,
		});
		return placed ? 'ready' : 'not-found';
	}
}

export function createEdaPlacementHost(): EdaPlacementHost {
	if (typeof eda === 'undefined') {
		return {};
	}
	const documentControl = eda.dmt_SelectControl;
	const schematicComponents = eda.sch_PrimitiveComponent;
	return {
		getCurrentDocumentInfo: typeof documentControl?.getCurrentDocumentInfo === 'function'
			? () => documentControl.getCurrentDocumentInfo()
			: undefined,
		placeComponentWithMouse: typeof schematicComponents?.placeComponentWithMouse === 'function'
			? component => schematicComponents.placeComponentWithMouse(component)
			: undefined,
	};
}
