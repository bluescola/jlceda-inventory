import type { EdaModelReference } from '../../../features/inventory/domain/inventory-item';

export class EdaPlacementClient {
	public async placeWithMouse(reference: EdaModelReference): Promise<boolean> {
		return eda.sch_PrimitiveComponent.placeComponentWithMouse({
			libraryUuid: reference.libraryUuid,
			uuid: reference.deviceUuid,
		});
	}
}
