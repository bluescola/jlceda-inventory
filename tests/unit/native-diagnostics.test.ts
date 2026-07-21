import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { DiagnosticLogDocument } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeDiagnostics } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';

const t = ((key: string) => key) as Translate;

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('nativeDiagnostics', () => {
	it('mirrors traces to the host log and persists a bounded extension document', async () => {
		let stored: DiagnosticLogDocument | undefined;
		const add = vi.fn();
		const find = vi.fn().mockResolvedValue([]);
		const openBottomPanel = vi.fn();
		const showToastMessage = vi.fn();
		vi.stubGlobal('eda', {
			sys_Log: { add, find },
			sys_Message: { showToastMessage },
			sys_PanelControl: { openBottomPanel },
			sys_Storage: {
				getExtensionUserConfig: vi.fn(() => stored),
				setExtensionUserConfig: vi.fn(async (_key: string, value: DiagnosticLogDocument) => {
					stored = value;
					return true;
				}),
			},
		});
		const diagnostics = new NativeDiagnostics(t, '0.2.1', 'verbose');
		const trace = diagnostics.start('add-lcsc');

		trace.info('part-number.accepted', { partNumber: 'C25804' });
		await diagnostics.flush();

		expect(add).toHaveBeenCalledWith(expect.stringContaining('workflow.start'), 'info');
		expect(openBottomPanel).toHaveBeenCalledWith('log');
		expect(find).toHaveBeenCalledWith('[Component Inventory]');
		expect(showToastMessage).toHaveBeenCalledWith('diagnostics.started', 'info', 5, 'log');
		expect(stored).toMatchObject({
			schemaVersion: 1,
			extensionVersion: '0.2.1',
			mode: 'verbose',
		});
		expect(stored?.entries.map(entry => entry.event)).toEqual(['workflow.start', 'part-number.accepted']);
		expect(stored?.entries[1].details).toEqual({ partNumber: 'C25804' });
	});

	it('opens and filters the host log panel with feedback for a manual view request', async () => {
		const find = vi.fn().mockResolvedValue([]);
		const openBottomPanel = vi.fn();
		const showToastMessage = vi.fn();
		vi.stubGlobal('eda', {
			sys_Log: { find },
			sys_Message: { showToastMessage },
			sys_PanelControl: { openBottomPanel },
		});
		const diagnostics = new NativeDiagnostics(t, '0.3.1', 'verbose');

		await diagnostics.show();

		expect(openBottomPanel).toHaveBeenCalledWith('log');
		expect(find).toHaveBeenCalledWith('[Component Inventory]');
		expect(showToastMessage).toHaveBeenCalledWith('diagnostics.opened', 'info', 3, 'log');
	});

	it('records a warning when an SDK or dialog promise remains pending', async () => {
		vi.useFakeTimers();
		let finish!: (value: string) => void;
		const add = vi.fn();
		vi.stubGlobal('eda', {
			sys_Log: { add, find: vi.fn().mockResolvedValue([]) },
			sys_Message: { showToastMessage: vi.fn() },
			sys_PanelControl: { openBottomPanel: vi.fn() },
			sys_Storage: {
				getExtensionUserConfig: vi.fn(),
				setExtensionUserConfig: vi.fn().mockResolvedValue(true),
			},
		});
		const diagnostics = new NativeDiagnostics(t, '0.2.1', 'verbose');
		const trace = diagnostics.start('add-lcsc');
		const pending = trace.waitFor('dialog.marketplace-manufacturer', () => new Promise((resolve) => {
			finish = resolve;
		}));

		await vi.advanceTimersByTimeAsync(15_000);
		expect(add).toHaveBeenCalledWith(expect.stringContaining('wait.pending'), 'warn');

		finish('done');
		expect(await pending).toBe('done');
		await diagnostics.flush();
	});

	it('keeps release logs useful without persisting detailed part data', async () => {
		let stored: DiagnosticLogDocument | undefined;
		vi.stubGlobal('eda', {
			sys_Log: { add: vi.fn(), find: vi.fn().mockResolvedValue([]) },
			sys_Message: { showToastMessage: vi.fn() },
			sys_PanelControl: { openBottomPanel: vi.fn() },
			sys_Storage: {
				getExtensionUserConfig: vi.fn(() => stored),
				setExtensionUserConfig: vi.fn(async (_key: string, value: DiagnosticLogDocument) => {
					stored = value;
					return true;
				}),
			},
		});
		const diagnostics = new NativeDiagnostics(t, '0.2.1', 'simplified');
		const trace = diagnostics.start('add-lcsc');

		trace.info('part-number.accepted', { partNumber: 'C25804' });
		trace.info('wait.complete', { elapsedMs: 42, step: 'eda-model.lookup' });
		trace.error('workflow.error', { error: 'SDK failed', partNumber: 'C25804' });
		await diagnostics.flush();

		const document = await diagnostics.exportDocument();
		expect(document.mode).toBe('simplified');
		expect(document.entries.find(entry => entry.event === 'part-number.accepted')?.details).toBeUndefined();
		expect(document.entries.find(entry => entry.event === 'wait.complete')?.details).toEqual({ elapsedMs: 42, step: 'eda-model.lookup' });
		expect(document.entries.find(entry => entry.event === 'workflow.error')?.details).toEqual({ error: 'SDK failed' });
	});

	it('keeps product-form field identity and lengths in simplified logs without field contents', async () => {
		let stored: DiagnosticLogDocument | undefined;
		vi.stubGlobal('eda', {
			sys_Log: { add: vi.fn(), find: vi.fn().mockResolvedValue([]) },
			sys_Message: { showToastMessage: vi.fn() },
			sys_PanelControl: { openBottomPanel: vi.fn() },
			sys_Storage: {
				getExtensionUserConfig: vi.fn(() => stored),
				setExtensionUserConfig: vi.fn(async (_key: string, value: DiagnosticLogDocument) => {
					stored = value;
					return true;
				}),
			},
		});
		const diagnostics = new NativeDiagnostics(t, '0.2.3', 'simplified');
		const trace = diagnostics.start('add-lcsc');

		trace.info('product-form.field.change', { field: 'name', length: 12, value: 'Microphone' });
		trace.info('product-form.submitted', {
			status: 'iframe',
			nameLength: 12,
			manufacturerLength: 6,
			changedFields: 2,
			name: 'Microphone',
		});
		trace.info('product-form.iframe.open.return', {
			iframeId: 'jlceda-inventory-product-details',
			opened: false,
			returnedType: 'boolean',
			stage: 'openIFrame',
			title: 'Secret product title',
		});
		trace.error('product-form.iframe.open.error', {
			error: 'Asset not found',
			errorName: 'TypeError',
			stage: 'openIFrame',
			title: 'Secret product title',
		});
		await diagnostics.flush();

		const document = await diagnostics.exportDocument();
		expect(document.entries.find(entry => entry.event === 'product-form.field.change')?.details).toEqual({
			field: 'name',
			length: 12,
		});
		expect(document.entries.find(entry => entry.event === 'product-form.submitted')?.details).toEqual({
			status: 'iframe',
			nameLength: 12,
			manufacturerLength: 6,
			changedFields: 2,
		});
		expect(document.entries.find(entry => entry.event === 'product-form.iframe.open.return')?.details).toEqual({
			iframeId: 'jlceda-inventory-product-details',
			opened: false,
			returnedType: 'boolean',
			stage: 'openIFrame',
		});
		expect(document.entries.find(entry => entry.event === 'product-form.iframe.open.error')?.details).toEqual({
			error: 'Asset not found',
			errorName: 'TypeError',
			stage: 'openIFrame',
		});
		expect(JSON.stringify(document)).not.toContain('Microphone');
		expect(JSON.stringify(document)).not.toContain('Secret product title');
	});
});
