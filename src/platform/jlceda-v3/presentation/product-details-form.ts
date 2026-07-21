import type { Translate } from '../eda/i18n-client';
import type { DiagnosticTrace } from './native-diagnostics';
import type { InputOptions, NativeDialog } from './native-dialog';
import type { ProductDetailsField } from './product-details-form-session';
import { normalizeInventoryText } from '../../../features/inventory/domain/inventory-item';
import { ProductDetailsFormSession } from './product-details-form-session';

export interface ProductDetailsDraft {
	name: string;
	manufacturer?: string;
	manufacturerPartNumber?: string;
	package?: string;
	description?: string;
}

export interface ProductDetailsFormRequest {
	partNumber: string;
	marketplaceConfirmed: boolean;
	initial?: Partial<ProductDetailsDraft>;
}

export interface ProductDetailsForm {
	open: (request: ProductDetailsFormRequest, trace?: DiagnosticTrace) => Promise<ProductDetailsDraft | undefined>;
}

export type ProductDetailsFormUnavailableStatus = 'api-missing' | 'init-failed' | 'render-failed';

export class ProductDetailsFormUnavailableError extends Error {
	public constructor(
		public readonly status: ProductDetailsFormUnavailableStatus,
		options?: ErrorOptions,
	) {
		super(`Product details form unavailable: ${status}`, options);
		this.name = 'ProductDetailsFormUnavailableError';
	}
}

export class FallbackProductDetailsForm implements ProductDetailsForm {
	public constructor(
		private readonly primary: ProductDetailsForm,
		private readonly fallback: ProductDetailsForm,
	) {}

	public async open(request: ProductDetailsFormRequest, trace?: DiagnosticTrace): Promise<ProductDetailsDraft | undefined> {
		try {
			return await this.primary.open(request, trace);
		}
		catch (error) {
			if (!(error instanceof ProductDetailsFormUnavailableError)) {
				throw error;
			}
			trace?.warn('product-form.primary.unavailable', { status: error.status });
			trace?.warn('product-form.fallback.start', { status: 'sequential' });
			return this.fallback.open(request, trace);
		}
	}
}

export class SequentialProductDetailsForm implements ProductDetailsForm {
	public constructor(
		private readonly dialog: NativeDialog,
		private readonly t: Translate,
	) {}

	public async open(request: ProductDetailsFormRequest, trace?: DiagnosticTrace): Promise<ProductDetailsDraft | undefined> {
		const title = this.t(request.marketplaceConfirmed ? 'marketplace.productDetails' : 'marketplace.customDetails');
		const session = new ProductDetailsFormSession({
			name: request.initial?.name ?? '',
			manufacturer: request.initial?.manufacturer ?? '',
			manufacturerPartNumber: request.initial?.manufacturerPartNumber ?? '',
			package: request.initial?.package ?? '',
			description: request.initial?.description ?? '',
		});

		const fields: Array<{ field: ProductDetailsField; step: string; label: string; initial?: string }> = [
			{
				field: 'name',
				step: 'dialog.marketplace-name',
				label: this.t(request.marketplaceConfirmed ? 'marketplace.namePrompt' : 'part.namePrompt'),
				initial: request.initial?.name,
			},
			{
				field: 'manufacturer',
				step: 'dialog.marketplace-manufacturer',
				label: this.t(request.marketplaceConfirmed ? 'marketplace.manufacturerPrompt' : 'part.manufacturerPrompt'),
				initial: request.initial?.manufacturer,
			},
			{
				field: 'manufacturerPartNumber',
				step: 'dialog.marketplace-manufacturer-id',
				label: this.t(request.marketplaceConfirmed ? 'marketplace.manufacturerIdPrompt' : 'part.manufacturerPartPrompt'),
				initial: request.initial?.manufacturerPartNumber,
			},
			{
				field: 'package',
				step: 'dialog.marketplace-package',
				label: this.t(request.marketplaceConfirmed ? 'marketplace.packagePrompt' : 'part.packagePrompt'),
				initial: request.initial?.package,
			},
			{
				field: 'description',
				step: 'dialog.marketplace-description',
				label: this.t(request.marketplaceConfirmed ? 'marketplace.descriptionPrompt' : 'part.descriptionPrompt'),
				initial: request.initial?.description,
			},
		];

		for (const item of fields) {
			const value = await this.input(trace, item.step, {
				title,
				label: item.label,
				value: item.initial,
			});
			if (value === undefined) {
				trace?.info('product-form.cancelled', {
					...session.summary('sequential'),
				});
				return undefined;
			}
			const diagnostic = session.applyChange(item.field, value);
			session.recordFieldChange(trace, diagnostic);
		}

		const result = session.submit('sequential');
		session.recordSubmit(trace, result);
		if (!result.ok) {
			this.dialog.info(this.t(request.marketplaceConfirmed ? 'marketplace.nameRequired' : 'part.inputRequired'), title);
			return undefined;
		}
		return result.value;
	}

	private input(trace: DiagnosticTrace | undefined, step: string, options: InputOptions): Promise<string | undefined> {
		const operation = () => this.dialog.input(options, trace
			? (event, details) => trace.info(`dialog.${event}`, { ...details, step })
			: undefined);
		return trace ? trace.waitFor(step, operation) : operation();
	}
}

export type NormalizedProductDetails
	= | { ok: true; value: ProductDetailsDraft }
		| { ok: false; reason: 'name-required' };

export function normalizeProductDetailsDraft(draft: ProductDetailsDraft): NormalizedProductDetails {
	const name = normalizeInventoryText(draft.name);
	if (!name) {
		return { ok: false, reason: 'name-required' };
	}
	return {
		ok: true,
		value: {
			name,
			manufacturer: optionalText(draft.manufacturer),
			manufacturerPartNumber: optionalText(draft.manufacturerPartNumber),
			package: optionalText(draft.package),
			description: optionalText(draft.description),
		},
	};
}

function optionalText(value?: string): string | undefined {
	return value === undefined ? undefined : normalizeInventoryText(value) || undefined;
}
