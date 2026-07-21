import type { CommonLibraryHost } from '../../src/platform/jlceda-v3/eda/common-library';
import { describe, expect, it, vi } from 'vitest';
import { EdaCommonLibrary } from '../../src/platform/jlceda-v3/eda/common-library';

const reference = {
	deviceUuid: 'device-system',
	libraryUuid: 'library-system',
};

const sourceIdentity = {
	libraryUuid: reference.libraryUuid,
	manufacturer: 'UNI-ROYAL',
	manufacturerPartNumber: '0603WAF1002T5E',
	name: '10k resistor',
	supplier: 'LCSC',
	supplierId: 'C25804',
	uuid: reference.deviceUuid,
};

const copiedIdentity = {
	...sourceIdentity,
	libraryUuid: 'library-personal',
	uuid: 'device-copied',
};

function createHost(overrides: Partial<CommonLibraryHost> = {}): CommonLibraryHost {
	return {
		copyDevice: vi.fn().mockResolvedValue('device-copied'),
		findDevicesByLcscPartNumber: vi.fn().mockResolvedValue([]),
		getDeviceIdentity: vi.fn(async (deviceUuid, libraryUuid) => (
			deviceUuid === reference.deviceUuid && libraryUuid === reference.libraryUuid
				? sourceIdentity
				: deviceUuid === copiedIdentity.uuid && libraryUuid === copiedIdentity.libraryUuid
					? copiedIdentity
					: undefined
		)),
		getPersonalLibraryUuid: vi.fn().mockResolvedValue('library-personal'),
		...overrides,
	};
}

describe('edaCommonLibrary', () => {
	it('treats a device already in the personal library as success', async () => {
		const host = createHost();
		const result = await new EdaCommonLibrary(host).copy({
			...reference,
			libraryUuid: 'library-personal',
		});

		expect(result).toMatchObject({ status: 'already-present', target: 'personal' });
		expect(host.copyDevice).not.toHaveBeenCalled();
	});

	it('copies to the personal library and verifies the returned device UUID', async () => {
		const host = createHost();
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'copied', target: 'personal' });
		expect(host.copyDevice).toHaveBeenCalledWith(
			'device-system',
			'library-system',
			'library-personal',
			undefined,
		);
		expect(host.getDeviceIdentity).toHaveBeenCalledWith('device-system', 'library-system');
		expect(host.getDeviceIdentity).toHaveBeenCalledWith('device-copied', 'library-personal');
	});

	it('does not duplicate an LCSC device already present in the personal library', async () => {
		const host = createHost({
			findDevicesByLcscPartNumber: vi.fn().mockResolvedValue([
				{ libraryUuid: 'library-personal', uuid: 'existing-personal-device' },
			]),
			getDeviceIdentity: vi.fn().mockResolvedValue({
				...copiedIdentity,
				uuid: 'existing-personal-device',
			}),
		});
		const result = await new EdaCommonLibrary(host).copy(reference, { lcscPartNumber: 'C25804' });

		expect(result).toMatchObject({ status: 'already-present', target: 'personal' });
		expect(host.findDevicesByLcscPartNumber).toHaveBeenCalledWith('C25804', 'library-personal');
		expect(host.copyDevice).not.toHaveBeenCalled();
	});

	it('does not treat an unreadable personal-library lookup result as already present', async () => {
		const host = createHost({
			findDevicesByLcscPartNumber: vi.fn()
				.mockResolvedValueOnce([{ libraryUuid: 'library-personal', uuid: 'ghost-device' }])
				.mockResolvedValueOnce([{ libraryUuid: 'library-personal', uuid: 'device-copied' }]),
		});
		const result = await new EdaCommonLibrary(host).copy(reference, { lcscPartNumber: 'C25804' });

		expect(result).toMatchObject({ status: 'copied', target: 'personal' });
		expect(host.copyDevice).toHaveBeenCalledTimes(1);
	});

	it('does not treat a lookup result from another library as already present', async () => {
		const host = createHost({
			findDevicesByLcscPartNumber: vi.fn()
				.mockResolvedValueOnce([{ libraryUuid: 'library-system', uuid: 'device-system' }])
				.mockResolvedValueOnce([{ libraryUuid: 'library-personal', uuid: 'device-copied' }]),
		});
		const result = await new EdaCommonLibrary(host).copy(reference, { lcscPartNumber: 'C25804' });

		expect(result).toMatchObject({ status: 'copied', target: 'personal' });
		expect(host.copyDevice).toHaveBeenCalledTimes(1);
	});

	it('does not report success when get returns the copied UUID from the source library', async () => {
		const host = createHost({
			getDeviceIdentity: vi.fn(async (deviceUuid, libraryUuid) => (
				deviceUuid === reference.deviceUuid && libraryUuid === reference.libraryUuid
					? sourceIdentity
					: { ...copiedIdentity, libraryUuid: 'library-system' }
			)),
		});
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'failed', reason: 'verification-failed' });
		expect(result.attempts).toContainEqual({ target: 'personal', status: 'verification-failed' });
	});

	it('requires the copied UUID itself to match the requested C number in the personal library', async () => {
		const host = createHost({
			findDevicesByLcscPartNumber: vi.fn()
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ libraryUuid: 'library-personal', uuid: 'another-device' }]),
		});
		const result = await new EdaCommonLibrary(host).copy(reference, { lcscPartNumber: 'C25804' });

		expect(result).toMatchObject({ status: 'failed', reason: 'verification-failed' });
	});

	it('rejects a copied device whose non-C identity differs from the source', async () => {
		const host = createHost({
			getDeviceIdentity: vi.fn(async (deviceUuid, libraryUuid) => (
				deviceUuid === reference.deviceUuid && libraryUuid === reference.libraryUuid
					? sourceIdentity
					: { ...copiedIdentity, manufacturerPartNumber: 'WRONG-PART' }
			)),
		});
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'failed', reason: 'verification-failed' });
	});

	it('reports a rejected personal-library copy without trying another target', async () => {
		const host = createHost({
			copyDevice: vi.fn().mockResolvedValue(undefined),
		});
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'failed', reason: 'copy-rejected' });
		expect(host.copyDevice).toHaveBeenCalledTimes(1);
		expect(host.getDeviceIdentity).toHaveBeenCalledTimes(1);
	});

	it('reports when no personal library exists', async () => {
		const host = createHost({
			getPersonalLibraryUuid: vi.fn().mockResolvedValue(undefined),
		});
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'failed', reason: 'no-target-library' });
		expect(host.copyDevice).not.toHaveBeenCalled();
	});

	it('distinguishes a personal-library API error from an unavailable workspace library', async () => {
		const host = createHost({
			getPersonalLibraryUuid: vi.fn().mockRejectedValue(new Error('Personal failed')),
		});
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'failed', reason: 'api-error' });
		expect(host.copyDevice).not.toHaveBeenCalled();
	});
});
