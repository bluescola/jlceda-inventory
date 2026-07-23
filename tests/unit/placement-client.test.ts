import { describe, expect, it, vi } from 'vitest';
import { EdaPlacementClient } from '../../src/platform/jlceda-v3/eda/placement-client';

const reference = {
	deviceUuid: 'device-1',
	libraryUuid: 'library-1',
	symbolName: 'R',
	footprintName: 'R0603',
};

describe('edaPlacementClient', () => {
	it('places only in a schematic and maps the stored model reference to the EDA API', async () => {
		const placeComponentWithMouse = vi.fn().mockResolvedValue(true);
		const client = new EdaPlacementClient({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 1 }),
			placeComponentWithMouse,
		});

		expect(await client.placeWithMouse(reference)).toBe('ready');
		expect(placeComponentWithMouse).toHaveBeenCalledWith({
			libraryUuid: 'library-1',
			uuid: 'device-1',
		});
	});

	it('rejects non-schematic documents before calling the placement API', async () => {
		const placeComponentWithMouse = vi.fn().mockResolvedValue(true);
		const client = new EdaPlacementClient({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 3 }),
			placeComponentWithMouse,
		});

		expect(await client.placeWithMouse(reference)).toBe('not-schematic');
		expect(placeComponentWithMouse).not.toHaveBeenCalled();
	});

	it('reports unavailable and rejected host capabilities without changing the reference', async () => {
		expect(await new EdaPlacementClient({}).placeWithMouse(reference)).toBe('unsupported');
		expect(await new EdaPlacementClient({
			getCurrentDocumentInfo: vi.fn().mockResolvedValue({ documentType: 1 }),
			placeComponentWithMouse: vi.fn().mockResolvedValue(false),
		}).placeWithMouse(reference)).toBe('not-found');
	});
});
