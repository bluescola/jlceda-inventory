import type { CommonLibraryHost } from '../../src/platform/jlceda-v3/eda/common-library';
import { describe, expect, it, vi } from 'vitest';
import { EdaCommonLibrary } from '../../src/platform/jlceda-v3/eda/common-library';

const reference = {
	deviceUuid: 'device-system',
	libraryUuid: 'library-system',
};

function createHost(overrides: Partial<CommonLibraryHost> = {}): CommonLibraryHost {
	return {
		copyDevice: vi.fn().mockResolvedValue('device-copied'),
		findDeviceByLcscPartNumber: vi.fn().mockResolvedValue(false),
		getFavoriteLibraryUuid: vi.fn().mockResolvedValue('library-favorite'),
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

	it('continues with the personal library when resolving Favorites throws', async () => {
		const host = createHost({
			getFavoriteLibraryUuid: vi.fn().mockRejectedValue(new Error('Favorites unavailable')),
		});
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'copied', target: 'personal' });
		expect(host.copyDevice).toHaveBeenCalledWith(
			'device-system',
			'library-system',
			'library-personal',
			undefined,
		);
	});

	it('does not duplicate an LCSC device already present in Favorites', async () => {
		const host = createHost({
			findDeviceByLcscPartNumber: vi.fn(async (_partNumber, libraryUuid) => libraryUuid === 'library-favorite'),
		});
		const result = await new EdaCommonLibrary(host).copy(reference, { lcscPartNumber: 'C25804' });

		expect(result).toMatchObject({ status: 'already-present', target: 'favorite' });
		expect(host.copyDevice).not.toHaveBeenCalled();
	});

	it('falls back to Favorites after the personal library rejects copying', async () => {
		const host = createHost({
			copyDevice: vi.fn()
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce('device-favorite'),
		});
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'copied', target: 'favorite' });
		expect(host.copyDevice).toHaveBeenCalledTimes(2);
	});

	it('reports when neither target library exists', async () => {
		const host = createHost({
			getFavoriteLibraryUuid: vi.fn().mockResolvedValue(undefined),
			getPersonalLibraryUuid: vi.fn().mockResolvedValue(undefined),
		});
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'failed', reason: 'no-target-library' });
		expect(host.copyDevice).not.toHaveBeenCalled();
	});

	it('distinguishes library API errors from an unavailable workspace library', async () => {
		const host = createHost({
			getFavoriteLibraryUuid: vi.fn().mockRejectedValue(new Error('Favorites failed')),
			getPersonalLibraryUuid: vi.fn().mockRejectedValue(new Error('Personal failed')),
		});
		const result = await new EdaCommonLibrary(host).copy(reference);

		expect(result).toMatchObject({ status: 'failed', reason: 'api-error' });
		expect(host.copyDevice).not.toHaveBeenCalled();
	});
});
