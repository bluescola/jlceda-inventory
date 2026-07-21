import { InventoryService } from '../../../features/inventory/application/inventory-service';
import { EdaCommonLibrary } from '../eda/common-library';
import { EdaDeviceCatalog } from '../eda/device-catalog';
import { EdaFileClient } from '../eda/file-client';
import { translate } from '../eda/i18n-client';
import { LcscMarketplaceNavigator } from '../eda/lcsc-marketplace-navigator';
import { EdaPlacementClient } from '../eda/placement-client';
import { EdaInventoryRepository } from '../persistence/eda-inventory-repository';
import { IFrameInventoryCreatePanel } from '../presentation/iframe-inventory-create-panel';
import { IFrameInventoryItemPanel } from '../presentation/iframe-inventory-item-panel';
import { IFrameInventoryOverviewPanel } from '../presentation/iframe-inventory-overview-panel';
import { IFrameOrderImportPanel } from '../presentation/iframe-order-import-panel';
import { IFrameProductDetailsForm } from '../presentation/iframe-product-details-form';
import { NativeDiagnostics } from '../presentation/native-diagnostics';
import { NativeDialog } from '../presentation/native-dialog';
import { NativeInventoryController } from '../presentation/native-inventory-controller';
import { FallbackProductDetailsForm, SequentialProductDetailsForm } from '../presentation/product-details-form';

export function createInventoryController(version: string): NativeInventoryController {
	const repository = new EdaInventoryRepository();
	const inventory = new InventoryService(repository);
	const dialog = new NativeDialog(translate);
	const diagnostics = new NativeDiagnostics(translate, version);
	// Keep the legacy marketplace form isolated; the unified create flow does not
	// invoke its sequential fallback when the inventory-create IFrame cannot start.
	const productDetailsForm = new FallbackProductDetailsForm(
		new IFrameProductDetailsForm(translate),
		new SequentialProductDetailsForm(dialog, translate),
	);
	return new NativeInventoryController(
		inventory,
		new EdaDeviceCatalog(),
		new LcscMarketplaceNavigator(),
		new EdaCommonLibrary(),
		new EdaFileClient(),
		new EdaPlacementClient(),
		dialog,
		diagnostics,
		productDetailsForm,
		new IFrameInventoryCreatePanel(translate),
		new IFrameOrderImportPanel(translate),
		new IFrameInventoryOverviewPanel(translate),
		new IFrameInventoryItemPanel(translate),
		translate,
		version,
	);
}
