import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeDialog } from '../../src/platform/jlceda-v3/presentation/native-dialog';

const t = ((key: string) => key) as Translate;

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('nativeDialog', () => {
	it('shows information messages with a visible confirmation button', () => {
		const showInformationMessage = vi.fn();
		vi.stubGlobal('eda', { sys_Dialog: { showInformationMessage } });
		const dialog = new NativeDialog(t);

		dialog.info('Inventory record saved.', 'Component added');

		expect(showInformationMessage).toHaveBeenCalledWith(
			'Inventory record saved.',
			'Component added',
			'dialog.confirm',
		);
	});

	it('waits for the current input dialog to close before continuing the flow', async () => {
		vi.useFakeTimers();
		const lifecycle = vi.fn();
		const showInputDialog = vi.fn((...args: unknown[]) => {
			(args[6] as (value: string) => void)('C25804');
		});
		vi.stubGlobal('eda', { sys_Dialog: { showInputDialog } });
		const dialog = new NativeDialog(t);
		const result = dialog.input({ title: 'Inventory', label: 'Part number' }, lifecycle);
		let resolved = false;
		void result.then(() => {
			resolved = true;
		});

		expect(resolved).toBe(false);
		await vi.runAllTimersAsync();

		expect(await result).toBe('C25804');
		expect(resolved).toBe(true);
		expect(lifecycle.mock.calls.map(call => call[0])).toEqual([
			'request',
			'callback',
			'api.return',
			'settle.complete',
		]);
	});

	it('keeps the next input request out of the host modal teardown window', async () => {
		vi.useFakeTimers();
		let hostBusy = false;
		let ignoredRequests = 0;
		const showInputDialog = vi.fn((...args: unknown[]) => {
			if (hostBusy) {
				ignoredRequests += 1;
				return;
			}
			hostBusy = true;
			(args[6] as (value: string) => void)('value');
			setTimeout(() => {
				hostBusy = false;
			}, 300);
		});
		vi.stubGlobal('eda', { sys_Dialog: { showInputDialog } });
		const dialog = new NativeDialog(t);

		const first = dialog.input({ title: 'Inventory', label: 'Name' });
		await vi.advanceTimersByTimeAsync(500);
		expect(await first).toBe('value');

		const second = dialog.input({ title: 'Inventory', label: 'Manufacturer' });
		await vi.advanceTimersByTimeAsync(500);
		expect(await second).toBe('value');
		expect(ignoredRequests).toBe(0);
		expect(showInputDialog).toHaveBeenCalledTimes(2);
	});
});
