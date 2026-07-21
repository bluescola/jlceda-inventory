import type { Translate } from '../eda/i18n-client';

export const DIALOG_SETTLE_DELAY_MS = 500;

export type DialogLifecycleEvent = 'api.error' | 'api.return' | 'callback' | 'request' | 'settle.complete';
export type DialogLifecycle = (event: DialogLifecycleEvent, details?: Record<string, number | string | undefined>) => void;

export interface InputOptions {
	title: string;
	label: string;
	type?: 'number' | 'text';
	value?: number | string;
	min?: number;
	step?: number;
}

export interface SelectOption {
	value: string;
	label: string;
}

export class NativeDialog {
	public constructor(private readonly t: Translate) {}

	public info(content: string, title = this.t('inventory.title')): void {
		eda.sys_Dialog.showInformationMessage(content, title, this.t('dialog.confirm'));
	}

	public input(options: InputOptions, lifecycle?: DialogLifecycle): Promise<string | undefined> {
		return new Promise((resolve, reject) => {
			lifecycle?.('request', { kind: 'input' });
			try {
				eda.sys_Dialog.showInputDialog(
					options.label,
					undefined,
					options.title,
					options.type ?? 'text',
					options.value,
					{ min: options.min, step: options.step },
					(value: unknown) => {
						const result = value === undefined || value === null ? undefined : String(value);
						lifecycle?.('callback', { kind: 'input', length: result?.length, status: inputOutcome(result) });
						setTimeout(() => {
							lifecycle?.('settle.complete', { cooldownMs: DIALOG_SETTLE_DELAY_MS, kind: 'input' });
							resolve(result);
						}, DIALOG_SETTLE_DELAY_MS);
					},
				);
				lifecycle?.('api.return', { kind: 'input' });
			}
			catch (error) {
				lifecycle?.('api.error', { error: errorMessage(error), kind: 'input' });
				reject(error);
			}
		});
	}

	public select(options: SelectOption[], title: string, label?: string, defaultValue?: string, lifecycle?: DialogLifecycle): Promise<string | undefined> {
		return new Promise((resolve, reject) => {
			lifecycle?.('request', { kind: 'select' });
			try {
				eda.sys_Dialog.showSelectDialog(
					options.map(option => ({ value: option.value, displayContent: option.label })),
					label,
					undefined,
					title,
					defaultValue,
					false,
					(value: string) => {
						const result = value || undefined;
						lifecycle?.('callback', { kind: 'select', status: result ?? 'cancelled' });
						setTimeout(() => {
							lifecycle?.('settle.complete', { cooldownMs: DIALOG_SETTLE_DELAY_MS, kind: 'select' });
							resolve(result);
						}, DIALOG_SETTLE_DELAY_MS);
					},
				);
				lifecycle?.('api.return', { kind: 'select' });
			}
			catch (error) {
				lifecycle?.('api.error', { error: errorMessage(error), kind: 'select' });
				reject(error);
			}
		});
	}

	public confirm(content: string, title: string): Promise<boolean> {
		return new Promise((resolve) => {
			eda.sys_Dialog.showConfirmationMessage(
				content,
				title,
				this.t('dialog.confirm'),
				this.t('dialog.cancel'),
				(value: boolean) => setTimeout(() => resolve(value), DIALOG_SETTLE_DELAY_MS),
			);
		});
	}
}

function inputOutcome(value?: string): string {
	if (value === undefined) {
		return 'cancelled';
	}
	return value ? 'submitted' : 'empty';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
