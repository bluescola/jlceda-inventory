import type { CatalogReference } from '../../../features/inventory/domain/inventory-item';

export class EdaPlacementClient {
	public async placeWithMouse(reference: CatalogReference): Promise<boolean> {
		return eda.sch_PrimitiveComponent.placeComponentWithMouse({
			libraryUuid: reference.libraryUuid,
			uuid: reference.deviceUuid,
		});
	}
}
