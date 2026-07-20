import type { Translate } from '../eda/i18n-client';

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
		eda.sys_Dialog.showInformationMessage(content, title);
	}

	public input(options: InputOptions): Promise<string | undefined> {
		return new Promise((resolve) => {
			eda.sys_Dialog.showInputDialog(
				options.label,
				undefined,
				options.title,
				options.type ?? 'text',
				options.value,
				{ min: options.min, step: options.step },
				(value: unknown) => resolve(value === undefined || value === null ? undefined : String(value)),
			);
		});
	}

	public select(options: SelectOption[], title: string, label?: string, defaultValue?: string): Promise<string | undefined> {
		return new Promise((resolve) => {
			eda.sys_Dialog.showSelectDialog(
				options.map(option => ({ value: option.value, displayContent: option.label })),
				label,
				undefined,
				title,
				defaultValue,
				false,
				(value: string) => resolve(value || undefined),
			);
		});
	}

	public confirm(content: string, title: string): Promise<boolean> {
		return new Promise((resolve) => {
			eda.sys_Dialog.showConfirmationMessage(
				content,
				title,
				this.t('dialog.confirm'),
				this.t('dialog.cancel'),
				resolve,
			);
		});
	}
}
