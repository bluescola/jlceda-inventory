import { InventoryService } from '../../../features/inventory/application/inventory-service';
import { EdaCommonLibrary } from '../eda/common-library';
import { EdaDeviceCatalog } from '../eda/device-catalog';
import { EdaFileClient } from '../eda/file-client';
import { translate } from '../eda/i18n-client';
import { EdaPlacementClient } from '../eda/placement-client';
import { EdaInventoryRepository } from '../persistence/eda-inventory-repository';
import { NativeDialog } from '../presentation/native-dialog';
import { NativeInventoryController } from '../presentation/native-inventory-controller';

export function createInventoryController(version: string): NativeInventoryController {
	const repository = new EdaInventoryRepository();
	return new NativeInventoryController(
		new InventoryService(repository),
		new EdaDeviceCatalog(),
		new EdaCommonLibrary(),
		new EdaFileClient(),
		new EdaPlacementClient(),
		new NativeDialog(translate),
		translate,
		version,
	);
}
