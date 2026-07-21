import type { LibraryCategoriesHost } from '../../src/platform/jlceda-v3/eda/library-categories';
import { describe, expect, it, vi } from 'vitest';
import { EdaLibraryCategoriesReader } from '../../src/platform/jlceda-v3/eda/library-categories';

function createHost(overrides: Partial<LibraryCategoriesHost> = {}): LibraryCategoriesHost {
	return {
		getClassificationTree: vi.fn().mockResolvedValue([]),
		getFavoriteLibraryUuid: vi.fn().mockResolvedValue(undefined),
		getPersonalLibraryUuid: vi.fn().mockResolvedValue('personal-library'),
		searchDevices: vi.fn().mockResolvedValue([]),
		...overrides,
	};
}

describe('edaLibraryCategoriesReader', () => {
	it('reads and normalizes the complete EDA classification tree', async () => {
		const host = createHost({
			getClassificationTree: vi.fn().mockResolvedValue([
				{ name: ' Passive ', children: [{ name: 'Resistors' }, { name: ' resistors ' }] },
				{ name: 'Connectors' },
			]),
		});

		const result = await new EdaLibraryCategoriesReader(host).read('personal');

		expect(result).toEqual({
			status: 'available',
			snapshot: {
				source: 'personal',
				discovery: 'classification-tree',
				complete: true,
				categories: [
					{ name: 'Passive', children: ['Resistors'] },
					{ name: 'Connectors', children: [] },
				],
			},
		});
		expect(host.searchDevices).not.toHaveBeenCalled();
	});

	it('removes the EDA virtual ALL root and promotes its children', async () => {
		const host = createHost({
			getClassificationTree: vi.fn().mockResolvedValue([
				{ name: 'ALL', children: [{ name: 'Passive' }, { name: 'Connectors' }] },
				{ name: 'Passive', children: [{ name: 'Resistors' }] },
			]),
		});

		const result = await new EdaLibraryCategoriesReader(host).read('personal');

		expect(result).toMatchObject({
			status: 'available',
			snapshot: {
				categories: [
					{ name: 'Passive', children: ['Resistors'] },
					{ name: 'Connectors', children: [] },
				],
			},
		});
	});

	it('falls back to category paths used by devices when the tree API is unavailable', async () => {
		const firstPage = Array.from({ length: 100 }, (_, index) => ({
			uuid: `device-${index}`,
			classification: index % 2 === 0 ? ['Passive', 'Resistors'] : ['Connectors'],
		}));
		const host = createHost({
			getClassificationTree: vi.fn().mockRejectedValue(new Error('Removed in EDA v3.3')),
			searchDevices: vi.fn()
				.mockResolvedValueOnce(firstPage)
				.mockResolvedValueOnce([{ uuid: 'device-100', classification: ['Passive', 'Capacitors'] }]),
		});

		const result = await new EdaLibraryCategoriesReader(host).read('personal');

		expect(result).toEqual({
			status: 'available',
			snapshot: {
				source: 'personal',
				discovery: 'device-scan',
				complete: false,
				categories: [
					{ name: 'Passive', children: ['Resistors', 'Capacitors'] },
					{ name: 'Connectors', children: [] },
				],
			},
		});
		expect(host.searchDevices).toHaveBeenCalledTimes(2);
	});

	it('removes a leading ALL segment from device category paths', async () => {
		const host = createHost({
			getClassificationTree: vi.fn().mockRejectedValue(new Error('Removed')),
			searchDevices: vi.fn().mockResolvedValue([
				{ uuid: 'device-1', classification: ['ALL', 'Passive', 'Resistors'] },
			]),
		});

		const result = await new EdaLibraryCategoriesReader(host).read('personal');

		expect(result).toMatchObject({
			status: 'available',
			snapshot: { categories: [{ name: 'Passive', children: ['Resistors'] }] },
		});
	});

	it('reports unavailable libraries and unsupported category APIs', async () => {
		const unavailable = createHost({ getPersonalLibraryUuid: vi.fn().mockResolvedValue(undefined) });
		expect(await new EdaLibraryCategoriesReader(unavailable).read('personal')).toEqual({ status: 'unavailable' });

		const unsupported = createHost({
			getClassificationTree: vi.fn().mockRejectedValue(new Error('Removed')),
			searchDevices: vi.fn().mockRejectedValue(new Error('Search rejected')),
		});
		expect(await new EdaLibraryCategoriesReader(unsupported).read('personal')).toEqual({ status: 'unsupported' });
	});
});
