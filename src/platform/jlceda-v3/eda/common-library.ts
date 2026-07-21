import type {
	CommonLibrary,
	CommonLibraryCopyAttempt,
	CommonLibraryCopyOptions,
	CommonLibraryCopyResult,
} from '../../../features/common-library/ports/common-library';
import type { EdaModelReference } from '../../../features/inventory/domain/inventory-item';
import { normalizeLcscPartNumber } from '../../../features/inventory/domain/inventory-item';

export interface CommonLibraryHost {
	copyDevice: (
		deviceUuid: string,
		sourceLibraryUuid: string,
		targetLibraryUuid: string,
		newName?: string,
	) => Promise<string | undefined>;
	findDevicesByLcscPartNumber: (
		lcscPartNumber: string,
		libraryUuid: string,
	) => Promise<readonly CommonLibraryDeviceReference[]>;
	getDeviceIdentity: (deviceUuid: string, libraryUuid: string) => Promise<CommonLibraryDeviceIdentity | undefined>;
	getPersonalLibraryUuid: () => Promise<string | undefined>;
}

export interface CommonLibraryDeviceReference {
	uuid: string;
	libraryUuid: string;
}

export interface CommonLibraryDeviceIdentity extends CommonLibraryDeviceReference {
	manufacturer?: string;
	manufacturerPartNumber?: string;
	name: string;
	supplier?: string;
	supplierId?: string;
}

export class EdaCommonLibrary implements CommonLibrary {
	public constructor(private readonly host: CommonLibraryHost = new EdaCommonLibraryHost()) {}

	public async copy(
		reference: EdaModelReference,
		options: CommonLibraryCopyOptions = {},
	): Promise<CommonLibraryCopyResult> {
		const attempts: CommonLibraryCopyAttempt[] = [];
		let personalLibraryUuid: string | undefined;
		try {
			personalLibraryUuid = await this.host.getPersonalLibraryUuid();
		}
		catch {
			attempts.push({ target: 'personal', status: 'api-error' });
			return { status: 'failed', reason: 'api-error', attempts };
		}
		if (!personalLibraryUuid) {
			attempts.push({ target: 'personal', status: 'unavailable' });
			return { status: 'failed', reason: 'no-target-library', attempts };
		}
		if (personalLibraryUuid === reference.libraryUuid) {
			attempts.push({ target: 'personal', status: 'already-present' });
			return { status: 'already-present', target: 'personal', attempts };
		}

		const normalizedPartNumber = normalizeLcscPartNumber(options.lcscPartNumber);
		const partNumber = normalizedPartNumber && /^C\d+$/.test(normalizedPartNumber)
			? normalizedPartNumber
			: undefined;
		let sourceIdentity: CommonLibraryDeviceIdentity | undefined;
		if (partNumber) {
			try {
				const existing = await this.host.findDevicesByLcscPartNumber(partNumber, personalLibraryUuid);
				for (const candidate of existing.filter(device => device.libraryUuid === personalLibraryUuid)) {
					const identity = await this.host.getDeviceIdentity(candidate.uuid, personalLibraryUuid);
					if (isOwnedDevice(identity, candidate.uuid, personalLibraryUuid)) {
						attempts.push({ target: 'personal', status: 'already-present' });
						return { status: 'already-present', target: 'personal', attempts };
					}
				}
			}
			catch {
				attempts.push({ target: 'personal', status: 'lookup-error' });
			}
		}
		else {
			try {
				sourceIdentity = await this.host.getDeviceIdentity(reference.deviceUuid, reference.libraryUuid);
			}
			catch {
				// Verification is mandatory when no stable C number is available.
			}
			if (!isOwnedDevice(sourceIdentity, reference.deviceUuid, reference.libraryUuid)) {
				attempts.push({ target: 'personal', status: 'verification-failed' });
				return { status: 'failed', reason: 'verification-failed', attempts };
			}
		}

		let copiedUuid: string | undefined;
		try {
			copiedUuid = await this.host.copyDevice(
				reference.deviceUuid,
				reference.libraryUuid,
				personalLibraryUuid,
				options.newName,
			);
			if (!copiedUuid) {
				attempts.push({ target: 'personal', status: 'copy-rejected' });
				return { status: 'failed', reason: 'copy-rejected', attempts };
			}
		}
		catch {
			attempts.push({ target: 'personal', status: 'api-error' });
			return { status: 'failed', reason: 'api-error', attempts };
		}

		try {
			const copiedIdentity = await this.host.getDeviceIdentity(copiedUuid, personalLibraryUuid);
			const belongsToPersonalLibrary = isOwnedDevice(copiedIdentity, copiedUuid, personalLibraryUuid);
			let matchesIdentity = false;
			if (belongsToPersonalLibrary && partNumber) {
				const matches = await this.host.findDevicesByLcscPartNumber(partNumber, personalLibraryUuid);
				matchesIdentity = matches.some(device => (
					device.uuid === copiedUuid && device.libraryUuid === personalLibraryUuid
				));
			}
			else if (belongsToPersonalLibrary && sourceIdentity) {
				matchesIdentity = hasMatchingIdentity(sourceIdentity, copiedIdentity, options.newName);
			}
			if (!belongsToPersonalLibrary || !matchesIdentity) {
				attempts.push({ target: 'personal', status: 'verification-failed' });
				return { status: 'failed', reason: 'verification-failed', attempts };
			}
		}
		catch {
			attempts.push({ target: 'personal', status: 'verification-failed' });
			return { status: 'failed', reason: 'verification-failed', attempts };
		}

		attempts.push({ target: 'personal', status: 'copied' });
		return { status: 'copied', target: 'personal', attempts };
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

	public async findDevicesByLcscPartNumber(
		lcscPartNumber: string,
		libraryUuid: string,
	): Promise<readonly CommonLibraryDeviceReference[]> {
		const result = await eda.lib_Device.getByLcscIds([lcscPartNumber], libraryUuid, true);
		return result.map(device => ({ libraryUuid: device.libraryUuid, uuid: device.uuid }));
	}

	public async getDeviceIdentity(
		deviceUuid: string,
		libraryUuid: string,
	): Promise<CommonLibraryDeviceIdentity | undefined> {
		const device = await eda.lib_Device.get(deviceUuid, libraryUuid);
		if (!device) {
			return undefined;
		}
		return {
			libraryUuid: device.libraryUuid,
			manufacturer: device.property.manufacturer,
			manufacturerPartNumber: device.property.manufacturerId,
			name: device.name,
			supplier: device.property.supplier,
			supplierId: device.property.supplierId,
			uuid: device.uuid,
		};
	}

	public getPersonalLibraryUuid(): Promise<string | undefined> {
		return eda.lib_LibrariesList.getPersonalLibraryUuid();
	}
}

const identityFields = ['manufacturer', 'manufacturerPartNumber', 'supplier', 'supplierId'] as const;

function hasMatchingIdentity(
	source: CommonLibraryDeviceIdentity,
	target: CommonLibraryDeviceIdentity,
	newName?: string,
): boolean {
	const expectedName = normalizeIdentityValue(newName) ?? normalizeIdentityValue(source.name);
	if (!expectedName || normalizeIdentityValue(target.name) !== expectedName) {
		return false;
	}
	return identityFields.every((field) => {
		const expected = normalizeIdentityValue(source[field]);
		return expected === undefined || normalizeIdentityValue(target[field]) === expected;
	});
}

function isOwnedDevice(
	device: CommonLibraryDeviceIdentity | undefined,
	expectedUuid: string,
	expectedLibraryUuid: string,
): device is CommonLibraryDeviceIdentity {
	return device?.uuid === expectedUuid && device.libraryUuid === expectedLibraryUuid;
}

function normalizeIdentityValue(value: string | undefined): string | undefined {
	const normalized = value?.trim();
	return normalized || undefined;
}
