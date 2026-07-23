import { InventoryService } from '../../../features/inventory/application/inventory-service';
import { EdaCommonLibrary } from '../eda/common-library';
import { EdaCurrentDesignReader, EdaSelectedDesignComponentsReader } from '../eda/design-component-readers';
import { EdaDeviceCatalog } from '../eda/device-catalog';
import { EdaExternalLinkNavigator } from '../eda/external-link-navigator';
import { EdaFileClient } from '../eda/file-client';
import { translate } from '../eda/i18n-client';
import { LcscMarketplaceNavigator } from '../eda/lcsc-marketplace-navigator';
import { EdaLibraryCategoriesReader } from '../eda/library-categories';
import { EdaPlacementClient } from '../eda/placement-client';
import { AutomaticBackupInventoryRepository, EdaAutomaticInventoryBackup } from '../persistence/automatic-inventory-backup';
import { EdaInventoryRepository } from '../persistence/eda-inventory-repository';
import { IFrameBomDiffPanel } from '../presentation/iframe-bom-diff-panel';
import { IFrameBomMappingPanel } from '../presentation/iframe-bom-mapping-panel';
import { IFrameBomStockOutPanel } from '../presentation/iframe-bom-stock-out-panel';
import { IFrameDesignStockCheckPanel } from '../presentation/iframe-design-stock-check-panel';
import { IFrameInventoryCreatePanel } from '../presentation/iframe-inventory-create-panel';
import { IFrameInventoryItemPanel } from '../presentation/iframe-inventory-item-panel';
import { IFrameInventoryOverviewPanel } from '../presentation/iframe-inventory-overview-panel';
import { IFrameInventoryTransactionsPanel } from '../presentation/iframe-inventory-transactions-panel';
import { IFrameOrderImportPanel } from '../presentation/iframe-order-import-panel';
import { IFrameProductDetailsForm } from '../presentation/iframe-product-details-form';
import { IFrameProjectPlanningPanel } from '../presentation/iframe-project-planning-panel';
import { NativeDiagnostics } from '../presentation/native-diagnostics';
import { NativeDialog } from '../presentation/native-dialog';
import { NativeInventoryController } from '../presentation/native-inventory-controller';
import { FallbackProductDetailsForm, SequentialProductDetailsForm } from '../presentation/product-details-form';

export function createInventoryController(version: string): NativeInventoryController {
	const dialog = new NativeDialog(translate);
	const diagnostics = new NativeDiagnostics(translate, version);
	const automaticBackupTrace = diagnostics.start('automatic-inventory-backup', false);
	const automaticBackup = new EdaAutomaticInventoryBackup();
	const repository = new AutomaticBackupInventoryRepository(
		new EdaInventoryRepository(),
		automaticBackup,
		(result, revision) => {
			const details = {
				attempts: result.status === 'disabled' ? 0 : result.attempts,
				failure: result.status === 'failed' ? result.failure : undefined,
				revision,
				status: result.status,
			};
			if (result.status === 'failed') {
				automaticBackupTrace.warn('auto-backup.background-result', details);
				dialog.info(translate('autoBackup.backgroundFailed'), translate('autoBackup.title'));
				return;
			}
			automaticBackupTrace.info('auto-backup.background-result', details);
		},
	);
	const inventory = new InventoryService(repository);
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
		new EdaLibraryCategoriesReader(),
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
		new EdaSelectedDesignComponentsReader(),
		new EdaCurrentDesignReader(),
		new IFrameDesignStockCheckPanel(translate),
		automaticBackup,
		new IFrameBomMappingPanel(translate),
		new IFrameBomDiffPanel(translate),
		new IFrameBomStockOutPanel(translate),
		new IFrameInventoryTransactionsPanel(translate),
		new IFrameProjectPlanningPanel(translate),
		new EdaExternalLinkNavigator(),
	);
}
