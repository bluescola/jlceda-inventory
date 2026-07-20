import type { CommonLibrary, CommonLibraryTarget } from '../../../features/common-library/ports/common-library';
import type { CatalogReference } from '../../../features/inventory/domain/inventory-item';

export class EdaCommonLibrary implements CommonLibrary {
	public async copy(reference: CatalogReference, newName?: string): Promise<CommonLibraryTarget | undefined> {
		const targets: Array<{ type: CommonLibraryTarget; uuid: string | undefined }> = [
			{ type: 'favorite', uuid: await eda.lib_LibrariesList.getFavoriteLibraryUuid() },
			{ type: 'personal', uuid: await eda.lib_LibrariesList.getPersonalLibraryUuid() },
		];
		for (const target of targets) {
			if (!target.uuid || target.uuid === reference.libraryUuid) {
				continue;
			}
			try {
				const copiedUuid = await eda.lib_Device.copy(
					reference.deviceUuid,
					reference.libraryUuid,
					target.uuid,
					undefined,
					newName,
				);
				if (copiedUuid) {
					return target.type;
				}
			}
			catch {
				// Favorite libraries are not documented as valid copy targets; continue to the personal library.
			}
		}
		return undefined;
	}
}
