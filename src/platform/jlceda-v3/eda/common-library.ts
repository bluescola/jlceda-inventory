import type {
	CommonLibrary,
	CommonLibraryCopyAttempt,
	CommonLibraryCopyOptions,
	CommonLibraryCopyResult,
	CommonLibraryTarget,
} from '../../../features/common-library/ports/common-library';
import type { EdaModelReference } from '../../../features/inventory/domain/inventory-item';
import { normalizeLcscPartNumber } from '../../../features/inventory/domain/inventory-item';

interface CommonLibraryTargetDefinition {
	type: CommonLibraryTarget;
	resolveUuid: () => Promise<string | undefined>;
}

interface ResolvedCommonLibraryTarget {
	type: CommonLibraryTarget;
	uuid: string;
}

export interface CommonLibraryHost {
	copyDevice: (
		deviceUuid: string,
		sourceLibraryUuid: string,
		targetLibraryUuid: string,
		newName?: string,
	) => Promise<string | undefined>;
	findDeviceByLcscPartNumber: (lcscPartNumber: string, libraryUuid: string) => Promise<boolean>;
	getFavoriteLibraryUuid: () => Promise<string | undefined>;
	getPersonalLibraryUuid: () => Promise<string | undefined>;
}

export class EdaCommonLibrary implements CommonLibrary {
	public constructor(private readonly host: CommonLibraryHost = new EdaCommonLibraryHost()) {}

	public async copy(
		reference: EdaModelReference,
		options: CommonLibraryCopyOptions = {},
	): Promise<CommonLibraryCopyResult> {
		const attempts: CommonLibraryCopyAttempt[] = [];
		const targets = await this.resolveTargets(attempts);
		for (const target of targets) {
			if (target.uuid === reference.libraryUuid) {
				attempts.push({ target: target.type, status: 'already-present' });
				return { status: 'already-present', target: target.type, attempts };
			}
		}

		const partNumber = normalizeLcscPartNumber(options.lcscPartNumber);
		if (partNumber && /^C\d+$/.test(partNumber)) {
			for (const target of orderTargets(targets, ['favorite', 'personal'])) {
				try {
					if (await this.host.findDeviceByLcscPartNumber(partNumber, target.uuid)) {
						attempts.push({ target: target.type, status: 'already-present' });
						return { status: 'already-present', target: target.type, attempts };
					}
				}
				catch {
					attempts.push({ target: target.type, status: 'lookup-error' });
				}
			}
		}

		// Personal libraries are documented as user-owned copy destinations. Favorites
		// remain a best-effort fallback because V3 exposes their UUID but no add API.
		for (const target of orderTargets(targets, ['personal', 'favorite'])) {
			try {
				const copiedUuid = await this.host.copyDevice(
					reference.deviceUuid,
					reference.libraryUuid,
					target.uuid,
					options.newName,
				);
				if (copiedUuid) {
					attempts.push({ target: target.type, status: 'copied' });
					return { status: 'copied', target: target.type, attempts };
				}
				attempts.push({ target: target.type, status: 'copy-rejected' });
			}
			catch {
				attempts.push({ target: target.type, status: 'api-error' });
			}
		}

		const hasResolvedTarget = targets.length > 0;
		const hasApiError = attempts.some(attempt => attempt.status === 'api-error' || attempt.status === 'lookup-error');
		return {
			status: 'failed',
			reason: hasApiError ? 'api-error' : !hasResolvedTarget ? 'no-target-library' : 'copy-rejected',
			attempts,
		};
	}

	private async resolveTargets(attempts: CommonLibraryCopyAttempt[]): Promise<ResolvedCommonLibraryTarget[]> {
		const definitions: CommonLibraryTargetDefinition[] = [
			{ type: 'personal', resolveUuid: () => this.host.getPersonalLibraryUuid() },
			{ type: 'favorite', resolveUuid: () => this.host.getFavoriteLibraryUuid() },
		];
		const targets: ResolvedCommonLibraryTarget[] = [];
		for (const definition of definitions) {
			try {
				const uuid = await definition.resolveUuid();
				if (uuid) {
					targets.push({ type: definition.type, uuid });
				}
				else {
					attempts.push({ target: definition.type, status: 'unavailable' });
				}
			}
			catch {
				attempts.push({ target: definition.type, status: 'api-error' });
			}
		}
		return targets;
	}
}

class EdaCommonLibraryHost implements CommonLibraryHost {
	public copyDevice(
		deviceUuid: string,
		sourceLibraryUuid: string,
		targetLibraryUuid: string,
		newName?: string,
	): Promise<string | undefined> {
		return eda.lib_Device.copy(deviceUuid, sourceLibraryUuid, targetLibraryUuid, undefined, newName);
	}

	public async findDeviceByLcscPartNumber(lcscPartNumber: string, libraryUuid: string): Promise<boolean> {
		const result: unknown = await eda.lib_Device.getByLcscIds([lcscPartNumber], libraryUuid, true);
		return Array.isArray(result) ? result.length > 0 : Boolean(result);
	}

	public getFavoriteLibraryUuid(): Promise<string | undefined> {
		return eda.lib_LibrariesList.getFavoriteLibraryUuid();
	}

	public getPersonalLibraryUuid(): Promise<string | undefined> {
		return eda.lib_LibrariesList.getPersonalLibraryUuid();
	}
}

function orderTargets(
	targets: readonly ResolvedCommonLibraryTarget[],
	order: readonly CommonLibraryTarget[],
): ResolvedCommonLibraryTarget[] {
	const rank = new Map(order.map((target, index) => [target, index]));
	return targets.toSorted((left, right) => (rank.get(left.type) ?? order.length) - (rank.get(right.type) ?? order.length));
}
