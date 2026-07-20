import type { CommonLibrary } from '../../../features/common-library/ports/common-library';
import type { ComponentCatalog } from '../../../features/component-catalog/ports/component-catalog';
import type { DuplicateStrategy, InventoryService } from '../../../features/inventory/application/inventory-service';
import type { InventoryItem, NewInventoryItem, QuantityPrecision } from '../../../features/inventory/domain/inventory-item';
import type { ImportDefaultState } from '../../../features/order-import/domain/order-import';
import type { EdaFileClient } from '../eda/file-client';
import type { Translate } from '../eda/i18n-client';
import type { EdaPlacementClient } from '../eda/placement-client';
import type { NativeDialog, SelectOption } from './native-dialog';
import { parseOrderFile } from '../../../features/order-import/application/parse-order-file';
import { rankInventory } from '../../../features/stock-recommendation/application/rank-inventory';

interface StockInput {
	quantity: number | null;
	precision: QuantityPrecision;
	location?: string;
}

export class NativeInventoryController {
	public constructor(
		private readonly inventory: InventoryService,
		private readonly catalog: ComponentCatalog,
		private readonly commonLibrary: CommonLibrary,
		private readonly files: EdaFileClient,
		private readonly placement: EdaPlacementClient,
		private readonly dialog: NativeDialog,
		private readonly t: Translate,
		private readonly version: string,
	) {}

	public openInventory(): Promise<void> {
		return this.execute(async () => {
			const items = await this.inventory.list();
			if (items.length === 0) {
				this.dialog.info(this.t('inventory.empty'));
				return;
			}
			const itemId = await this.dialog.select(
				items.map(item => ({ value: item.id, label: this.formatItemLine(item) })),
				this.t('inventory.title'),
				this.t('inventory.select'),
			);
			const item = itemId ? items.find(candidate => candidate.id === itemId) : undefined;
			if (!item) {
				return;
			}
			const actions: SelectOption[] = [
				{ value: 'details', label: this.t('inventory.details') },
				{ value: 'quantity', label: item.state === 'depleted' ? this.t('inventory.restore') : this.t('inventory.editQuantity') },
				...(item.state === 'in-stock' ? [{ value: 'depleted', label: this.t('inventory.markDepleted') }] : []),
				...(item.catalogReference ? [{ value: 'copy', label: this.t('inventory.copyCommon') }] : []),
				{ value: 'remove', label: this.t('inventory.remove') },
			];
			const action = await this.dialog.select(actions, item.identity.name, this.t('dialog.selectAction'));
			await this.handleInventoryAction(item, action);
		});
	}

	public addByLcscPartNumber(): Promise<void> {
		return this.execute(async () => {
			const input = await this.dialog.input({
				title: this.t('inventory.title'),
				label: this.t('part.lcscPrompt'),
				value: 'C',
			});
			if (!input?.trim()) {
				return;
			}
			const part = await this.catalog.findByLcscPartNumber(input);
			if (!part) {
				this.dialog.info(this.t('part.notFound', input));
				return;
			}
			const stock = await this.collectStockInput(1);
			if (!stock) {
				return;
			}
			await this.inventory.add({
				identity: part.identity,
				catalogReference: part.reference,
				quantity: stock.quantity,
				precision: stock.precision,
				location: stock.location,
				source: 'catalog',
			});
			this.dialog.info(this.t('inventory.saved'));
		});
	}

	public addCustomComponent(): Promise<void> {
		return this.execute(async () => {
			const name = await this.dialog.input({ title: this.t('inventory.title'), label: this.t('part.namePrompt') });
			if (!name?.trim()) {
				return;
			}
			const manufacturer = await this.dialog.input({ title: name, label: this.t('part.manufacturerPrompt') });
			const manufacturerPartNumber = await this.dialog.input({ title: name, label: this.t('part.manufacturerPartPrompt') });
			const supplierId = await this.dialog.input({ title: name, label: this.t('part.supplierPartPrompt') });
			const stock = await this.collectStockInput(1);
			if (!stock) {
				return;
			}
			await this.inventory.add({
				identity: { name, manufacturer, manufacturerPartNumber, supplierId, lcscPartNumber: supplierId },
				quantity: stock.quantity,
				precision: stock.precision,
				location: stock.location,
				source: 'manual',
			});
			this.dialog.info(this.t('inventory.saved'));
		});
	}

	public importOrderFile(): Promise<void> {
		return this.execute(async () => {
			const file = await this.files.pickOrderFile();
			if (!file) {
				return;
			}
			const defaultState = await this.dialog.select([
				{ value: 'in-stock', label: this.t('inventory.inStock') },
				{ value: 'depleted', label: this.t('inventory.depleted') },
			], this.t('import.title'), this.t('import.defaultStatus'), 'in-stock') as ImportDefaultState | undefined;
			if (!defaultState) {
				return;
			}
			let rows;
			try {
				rows = parseOrderFile(file.name, file.text, defaultState);
			}
			catch (error) {
				this.dialog.info(this.t('import.error', errorMessage(error)), this.t('import.title'));
				return;
			}
			if (rows.length === 0) {
				this.dialog.info(this.t('import.noRows'), this.t('import.title'));
				return;
			}
			const strategy = await this.dialog.select([
				{ value: 'add', label: this.t('import.add') },
				{ value: 'replace', label: this.t('import.replace') },
				{ value: 'skip', label: this.t('import.skip') },
			], this.t('import.title'), this.t('import.strategy'), 'add') as DuplicateStrategy | undefined;
			if (!strategy || !await this.dialog.confirm(this.t('import.summary', rows.length), this.t('import.title'))) {
				return;
			}
			const items = await this.hydrateImportedItems(rows.map(row => row.item));
			const result = await this.inventory.import(items, strategy);
			this.dialog.info(this.t('import.completed', result.added, result.merged, result.skipped), this.t('import.title'));
		});
	}

	public exportInventoryBackup(): Promise<void> {
		return this.execute(async () => {
			const document = await this.inventory.exportDocument();
			const date = new Date().toISOString().slice(0, 10);
			await this.files.saveJson(document, `jlceda-inventory-${date}.json`);
			this.dialog.info(this.t('backup.exported'));
		});
	}

	public showRecommendations(): Promise<void> {
		return this.execute(async () => {
			const query = await this.dialog.input({ title: this.t('recommend.title'), label: this.t('recommend.prompt') });
			if (query === undefined) {
				return;
			}
			const items = rankInventory(await this.inventory.list(), query).slice(0, 20);
			if (items.length === 0) {
				this.dialog.info(this.t('recommend.empty'), this.t('recommend.title'));
				return;
			}
			this.dialog.info(items.map(item => this.formatItemLine(item)).join('\n'), this.t('recommend.title'));
		});
	}

	public placeFromInventory(): Promise<void> {
		return this.execute(async () => {
			const items = (await this.inventory.list(false)).filter(item => item.catalogReference);
			if (items.length === 0) {
				this.dialog.info(this.t('place.empty'), this.t('place.title'));
				return;
			}
			const selectedId = await this.dialog.select(
				items.map(item => ({ value: item.id, label: this.formatItemLine(item) })),
				this.t('place.title'),
			);
			const selected = selectedId ? items.find(item => item.id === selectedId) : undefined;
			if (!selected?.catalogReference) {
				return;
			}
			const placed = await this.placement.placeWithMouse(selected.catalogReference);
			this.dialog.info(this.t(placed ? 'place.ready' : 'place.failed'), this.t('place.title'));
		});
	}

	public about(): void {
		this.dialog.info(this.t('about.content', this.version), this.t('about.title'));
	}

	private async handleInventoryAction(item: InventoryItem, action?: string): Promise<void> {
		switch (action) {
			case 'details':
				this.dialog.info(this.formatDetails(item), item.identity.name);
				break;
			case 'quantity':
				await this.editQuantity(item);
				break;
			case 'depleted':
				await this.inventory.markDepleted(item.id);
				this.dialog.info(this.t('inventory.updated'));
				break;
			case 'copy':
				await this.copyToCommonLibrary(item);
				break;
			case 'remove':
				if (await this.dialog.confirm(this.t('inventory.confirmRemove', item.identity.name), this.t('inventory.title'))) {
					await this.inventory.remove(item.id);
					this.dialog.info(this.t('inventory.removed'));
				}
				break;
			default:
				break;
		}
	}

	private async editQuantity(item: InventoryItem): Promise<void> {
		const stock = await this.collectStockInput(item.quantity ?? undefined, item.location);
		if (!stock) {
			return;
		}
		await this.inventory.updateQuantity(item.id, stock.quantity, stock.precision);
		this.dialog.info(this.t('inventory.updated'));
	}

	private async copyToCommonLibrary(item: InventoryItem): Promise<void> {
		if (!item.catalogReference) {
			return;
		}
		const target = await this.commonLibrary.copy(item.catalogReference);
		if (!target) {
			this.dialog.info(this.t('common.failed'));
			return;
		}
		this.dialog.info(this.t('common.copied', this.t(`common.${target}`)));
	}

	private async hydrateImportedItems(items: NewInventoryItem[]): Promise<NewInventoryItem[]> {
		const hydrated: NewInventoryItem[] = [];
		for (const item of items) {
			const partNumber = item.identity.lcscPartNumber ?? item.identity.supplierId;
			if (!partNumber) {
				hydrated.push(item);
				continue;
			}
			try {
				const catalogPart = await this.catalog.findByLcscPartNumber(partNumber);
				if (!catalogPart) {
					hydrated.push(item);
					continue;
				}
				const importedNameIsFallback = item.identity.name === partNumber;
				hydrated.push({
					...item,
					identity: {
						...catalogPart.identity,
						...item.identity,
						name: importedNameIsFallback ? catalogPart.identity.name : item.identity.name,
					},
					catalogReference: catalogPart.reference,
				});
			}
			catch {
				// A catalog lookup failure must not discard a valid order row.
				hydrated.push(item);
			}
		}
		return hydrated;
	}

	private async collectStockInput(defaultQuantity?: number, defaultLocation?: string): Promise<StockInput | undefined> {
		const quantityInput = await this.dialog.input({
			title: this.t('inventory.title'),
			label: this.t('inventory.quantityLabel'),
			type: 'number',
			value: defaultQuantity,
			min: 0,
			step: 1,
		});
		if (quantityInput === undefined) {
			return undefined;
		}
		const normalized = quantityInput.trim();
		let quantity: number | null = null;
		let precision: QuantityPrecision = 'unknown';
		if (normalized) {
			quantity = Number(normalized);
			if (!Number.isInteger(quantity) || quantity < 0) {
				this.dialog.info(this.t('inventory.quantityInvalid'));
				return undefined;
			}
			const selectedPrecision = await this.dialog.select([
				{ value: 'exact', label: this.t('inventory.exact') },
				{ value: 'estimated', label: this.t('inventory.estimated') },
			], this.t('inventory.title'), undefined, 'exact') as QuantityPrecision | undefined;
			if (!selectedPrecision) {
				return undefined;
			}
			precision = selectedPrecision;
		}
		const location = await this.dialog.input({
			title: this.t('inventory.title'),
			label: this.t('inventory.locationPrompt'),
			value: defaultLocation,
		});
		return { quantity, precision, location };
	}

	private formatItemLine(item: InventoryItem): string {
		const partNumber = item.identity.lcscPartNumber ?? item.identity.manufacturerPartNumber ?? '-';
		return this.t('status.itemLine', item.identity.name, partNumber, this.formatQuantity(item));
	}

	private formatQuantity(item: InventoryItem): string {
		if (item.state === 'depleted') {
			return this.t('inventory.depleted');
		}
		if (item.quantity === null) {
			return this.t('status.quantityUnknown');
		}
		return this.t(item.precision === 'estimated' ? 'status.quantityEstimated' : 'status.quantityExact', item.quantity);
	}

	private formatDetails(item: InventoryItem): string {
		const rows = [
			[this.t('part.nameLabel'), item.identity.name],
			[this.t('part.lcscLabel'), item.identity.lcscPartNumber],
			[this.t('part.manufacturerLabel'), item.identity.manufacturer],
			[this.t('part.manufacturerPartLabel'), item.identity.manufacturerPartNumber],
			[this.t('part.packageLabel'), item.identity.package],
			[this.t('inventory.quantityLabel'), this.formatQuantity(item)],
			[this.t('inventory.locationLabel'), item.location],
			[this.t('inventory.noteLabel'), item.note],
		];
		return rows.filter((row): row is [string, string] => Boolean(row[1])).map(([label, value]) => `${label}: ${value}`).join('\n');
	}

	private async execute(operation: () => Promise<void>): Promise<void> {
		try {
			await operation();
		}
		catch (error) {
			this.dialog.info(this.t('error.generic', errorMessage(error)), this.t('dialog.error'));
		}
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
