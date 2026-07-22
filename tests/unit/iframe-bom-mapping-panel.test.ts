import type { ParsedBomFile } from '../../src/features/bom-analysis/domain/bom-analysis';
import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { BomMappingIFrameHost } from '../../src/platform/jlceda-v3/presentation/iframe-bom-mapping-panel';
import type { BomMappingLabels } from '../../src/platform/jlceda-v3/presentation/iframe-bom-mapping-protocol';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IFrameBomMappingPanel } from '../../src/platform/jlceda-v3/presentation/iframe-bom-mapping-panel';
import {
	BOM_MAPPING_PROTOCOL_VERSION,
	BOM_MAPPING_REQUEST_KEY,
	BOM_MAPPING_RESULT_KEY,
	createIFrameBomMappingRequest,
	parseIFrameBomMappingRequest,
	parseIFrameBomMappingResult,
} from '../../src/platform/jlceda-v3/presentation/iframe-bom-mapping-protocol';

const t = ((key: string) => key) as Translate;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

class FakeHost implements BomMappingIFrameHost {
	public readonly values = new Map<string, unknown>();
	public readonly write = vi.fn(async (key: string, value: unknown) => {
		this.values.set(key, value);
		return this.writeResult;
	});

	public readonly remove = vi.fn(async (key: string) => this.values.delete(key));
	public readonly close = vi.fn(async () => true);
	public readonly stopPolling = vi.fn(() => true);
	public readonly startPolling = vi.fn((_id: string, _interval: number, callback: () => void) => {
		this.poll = callback;
		return true;
	});

	public readonly open = vi.fn(async (options: { title: string; onClose: () => void }) => {
		this.onClose = options.onClose;
		return true;
	});

	public writeResult = true;
	public poll: () => void = () => undefined;
	public onClose: () => void = () => undefined;

	public read(key: string): unknown {
		return this.values.get(key);
	}
}

function parsedBom(fileName = 'board.csv'): ParsedBomFile {
	return {
		fileName,
		format: 'csv',
		sheets: [{
			name: 'Main',
			rows: [
				['Exported BOM'],
				['LCSC', 'Qty', 'Quantity', 'Designator', 'Name', 'MPN', 'Manufacturer', 'Package'],
				['C1', '2', '2', 'R1,R2', '10k', 'RC0603', 'Vendor', '0603'],
			],
			headerCandidates: [{
				rowIndex: 1,
				rowNumber: 2,
				score: 30,
				recognizedColumnCount: 8,
				suggestedMapping: {
					lcscPartNumber: 0,
					quantity: 1,
					designators: 3,
					name: 4,
					manufacturerPartNumber: 5,
					manufacturer: 6,
					package: 7,
				},
				duplicateFields: ['quantity'],
			}],
		}],
	};
}

const labels: BomMappingLabels = {
	titleStockCheck: 'Stock check',
	titleCompare: 'Compare',
	file: 'File',
	format: 'Format',
	worksheet: 'Worksheet',
	headerCandidate: 'Header candidate',
	headerRow: 'Header row',
	detectedCandidate: 'Detected',
	manualHeader: 'Manual',
	noCandidate: 'No candidate',
	mapping: 'Mapping',
	mappingHint: 'Optional mapping',
	notMapped: 'Not mapped',
	rawPreview: 'Preview',
	duplicateWarning: 'Duplicate',
	duplicateAssignmentWarning: 'Duplicate assignment',
	fieldLcscPartNumber: 'LCSC',
	fieldDesignators: 'Designators',
	fieldQuantity: 'Quantity',
	fieldName: 'Name',
	fieldManufacturerPartNumber: 'MPN',
	fieldManufacturer: 'Manufacturer',
	fieldPackage: 'Package',
	fieldExcludeFromBom: 'DNP',
	columnFallback: 'Column',
	cancel: 'Cancel',
	confirm: 'Confirm',
	loading: 'Loading',
	connectionError: 'Connection error',
	saveError: 'Save error',
};

function request(mode: 'compare' | 'stock-check' = 'stock-check') {
	return createIFrameBomMappingRequest(
		'request-1',
		labels,
		{ mode, files: mode === 'compare' ? [parsedBom('before.csv'), parsedBom('after.csv')] : [parsedBom()] },
	);
}

async function requestFrom(host: FakeHost) {
	await vi.waitFor(() => expect(host.values.has(BOM_MAPPING_REQUEST_KEY)).toBe(true));
	const result = parseIFrameBomMappingRequest(host.values.get(BOM_MAPPING_REQUEST_KEY));
	if (!result) {
		throw new Error('Expected a valid BOM mapping request.');
	}
	return result;
}

async function settle<T>(promise: Promise<T>): Promise<T> {
	await vi.advanceTimersByTimeAsync(500);
	return promise;
}

describe('iframe BOM mapping protocol', () => {
	it('creates a bounded display snapshot with candidate mappings and duplicate semantic fields', () => {
		const source = parsedBom();
		source.sheets[0].rows[2][4] = 'x'.repeat(600);
		const created = createIFrameBomMappingRequest('request-1', labels, { mode: 'stock-check', files: [source] });
		const parsed = parseIFrameBomMappingRequest(created);

		expect(parsed).toMatchObject({
			mode: 'stock-check',
			files: [{
				fileName: 'board.csv',
				sheets: [{
					rowCount: 3,
					columnCount: 8,
					headerCandidates: [{
						rowIndex: 1,
						duplicateFields: ['quantity'],
						suggestedMapping: { lcscPartNumber: 0, quantity: 1 },
					}],
				}],
			}],
		});
		expect(parsed?.files[0].sheets[0].rows[2][4]).toHaveLength(500);
		expect(() => createIFrameBomMappingRequest(
			'request-1',
			labels,
			{ mode: 'compare', files: [parsedBom()] },
		)).toThrow('require two BOM files');
	});

	it('rejects previews beyond the bridge budget', () => {
		const rows = Array.from({ length: 106 }, () => Array.from({ length: 128 }, () => 'x'));
		const file = parsedBom();
		file.sheets = Array.from({ length: 4 }, (_, index) => ({
			name: `Sheet ${index + 1}`,
			rows,
			headerCandidates: [],
		}));
		expect(() => createIFrameBomMappingRequest(
			'request-1',
			labels,
			{ mode: 'stock-check', files: [file] },
		)).toThrow('bridge size limit');
	});

	it('accepts explicit cancellation and rejects stale, unknown, duplicate, or out-of-range mappings', () => {
		const source = request('compare');
		const valid = {
			protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
			requestId: source.requestId,
			status: 'submitted',
			files: [0, 1].map(fileIndex => ({
				fileIndex,
				sheetIndex: 0,
				headerRowIndex: 1,
				mapping: { lcscPartNumber: 0, quantity: 1 },
			})),
		};
		expect(parseIFrameBomMappingResult(valid, source)).toMatchObject({ status: 'submitted' });
		expect(parseIFrameBomMappingResult({
			protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
			requestId: source.requestId,
			status: 'cancelled',
		}, source)).toMatchObject({ status: 'cancelled' });
		expect(parseIFrameBomMappingResult({ ...valid, requestId: 'stale' }, source)).toBeUndefined();
		expect(parseIFrameBomMappingResult({
			...valid,
			files: [{ ...valid.files[0], mapping: { unknown: 0 } }, valid.files[1]],
		}, source)).toBeUndefined();
		expect(parseIFrameBomMappingResult({
			...valid,
			files: [{ ...valid.files[0], mapping: { lcscPartNumber: 0, quantity: 0 } }, valid.files[1]],
		}, source)).toBeUndefined();
		expect(parseIFrameBomMappingResult({
			...valid,
			files: [{ ...valid.files[0], headerRowIndex: 100 }, valid.files[1]],
		}, source)).toBeUndefined();
		expect(parseIFrameBomMappingResult({
			...valid,
			files: [{ ...valid.files[0], sheetIndex: 4 }, valid.files[1]],
		}, source)).toBeUndefined();
		expect(parseIFrameBomMappingResult({
			...valid,
			files: [{ ...valid.files[0], mapping: { quantity: 8 } }, valid.files[1]],
		}, source)).toBeUndefined();
	});
});

describe('iframe BOM mapping panel', () => {
	it('returns an independently validated mapping for both files and cleans bridge state', async () => {
		const host = new FakeHost();
		const pending = new IFrameBomMappingPanel(t, host).open({
			mode: 'compare',
			files: [parsedBom('before.csv'), parsedBom('after.csv')],
		});
		const source = await requestFrom(host);
		host.values.set(BOM_MAPPING_RESULT_KEY, {
			protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
			requestId: source.requestId,
			status: 'ready',
		});
		host.poll();
		host.values.set(BOM_MAPPING_RESULT_KEY, {
			protocolVersion: BOM_MAPPING_PROTOCOL_VERSION,
			requestId: source.requestId,
			status: 'submitted',
			files: [0, 1].map(fileIndex => ({
				fileIndex,
				sheetIndex: 0,
				headerRowIndex: 1,
				mapping: { lcscPartNumber: 0, designators: 3, quantity: 1 },
			})),
		});
		host.poll();

		await expect(settle(pending)).resolves.toEqual({
			status: 'submitted',
			files: [0, 1].map(fileIndex => ({
				fileIndex,
				sheetIndex: 0,
				headerRowIndex: 1,
				mapping: { lcscPartNumber: 0, designators: 3, quantity: 1 },
			})),
		});
		expect(host.stopPolling).toHaveBeenCalledOnce();
		expect(host.close).toHaveBeenCalledOnce();
		expect(host.values.has(BOM_MAPPING_REQUEST_KEY)).toBe(false);
		expect(host.values.has(BOM_MAPPING_RESULT_KEY)).toBe(false);
	});

	it('returns explicit cancellation when the native title-bar close is used', async () => {
		const host = new FakeHost();
		const pending = new IFrameBomMappingPanel(t, host).open({ mode: 'stock-check', files: [parsedBom()] });
		await requestFrom(host);

		host.onClose();

		await expect(settle(pending)).resolves.toEqual({ status: 'cancelled' });
	});

	it('keeps the source template self-contained and exposes mapping, preview, and explicit commands', () => {
		const html = readFileSync(resolve('src/platform/jlceda-v3/iframe/bom-mapping/bom-mapping.html'), 'utf8');
		expect(html).toMatch(/__BOM_MAPPING_INLINE_CSS__/);
		expect(html).toMatch(/__BOM_MAPPING_INLINE_JS__/);
		expect(html).toMatch(/id="mapping-rows"/);
		expect(html).toMatch(/id="preview-table"/);
		expect(html).toMatch(/id="cancel"/);
		expect(html).toMatch(/id="confirm"/);
		expect(html).not.toMatch(/<link[^>]+href|<script[^>]+src/i);
	});
});
