import type { DiagnosticTrace } from './native-diagnostics';
import type { ProductDetailsDraft } from './product-details-form';
import { normalizeProductDetailsDraft } from './product-details-form';

export type ProductDetailsField
	= 'description'
		| 'manufacturer'
		| 'manufacturerPartNumber'
		| 'name'
		| 'package';

export interface ProductDetailsFormState {
	name: string;
	manufacturer: string;
	manufacturerPartNumber: string;
	package: string;
	description: string;
}

export interface FieldChangeDiagnostic {
	field: ProductDetailsField;
	length: number;
}

export interface SubmitSummaryDiagnostic {
	status: 'iframe' | 'sequential';
	nameLength: number;
	manufacturerLength: number;
	manufacturerPartNumberLength: number;
	packageLength: number;
	descriptionLength: number;
	changedFields: number;
}

export type SubmitResult
	= | { ok: true; value: ProductDetailsDraft; summary: SubmitSummaryDiagnostic }
		| { ok: false; reason: 'name-required'; summary: SubmitSummaryDiagnostic };

/**
 * Pure form session shared by product-detail UI adapters and unit tests.
 * Values stay in memory only; diagnostics never include field contents.
 */
export class ProductDetailsFormSession {
	private readonly state: ProductDetailsFormState;
	private readonly changed = new Set<ProductDetailsField>();

	public constructor(initial?: Partial<ProductDetailsFormState>) {
		this.state = {
			name: initial?.name ?? '',
			manufacturer: initial?.manufacturer ?? '',
			manufacturerPartNumber: initial?.manufacturerPartNumber ?? '',
			package: initial?.package ?? '',
			description: initial?.description ?? '',
		};
	}

	public getState(): ProductDetailsFormState {
		return { ...this.state };
	}

	public applyChange(field: ProductDetailsField, rawValue: unknown): FieldChangeDiagnostic {
		const text = readOnChangeText(rawValue);
		this.state[field] = text;
		this.changed.add(field);
		return { field, length: text.length };
	}

	public submit(status: SubmitSummaryDiagnostic['status']): SubmitResult {
		const summary = this.summary(status);
		const normalized = normalizeProductDetailsDraft(this.state);
		if (!normalized.ok) {
			return { ok: false, reason: normalized.reason, summary };
		}
		return { ok: true, value: normalized.value, summary };
	}

	public summary(status: SubmitSummaryDiagnostic['status']): SubmitSummaryDiagnostic {
		return {
			status,
			nameLength: this.state.name.length,
			manufacturerLength: this.state.manufacturer.length,
			manufacturerPartNumberLength: this.state.manufacturerPartNumber.length,
			packageLength: this.state.package.length,
			descriptionLength: this.state.description.length,
			changedFields: this.changed.size,
		};
	}

	public recordFieldChange(trace: DiagnosticTrace | undefined, diagnostic: FieldChangeDiagnostic): void {
		trace?.info('product-form.field.change', { ...diagnostic });
	}

	public recordSubmit(trace: DiagnosticTrace | undefined, result: SubmitResult): void {
		if (result.ok) {
			trace?.info('product-form.submitted', { ...result.summary });
			return;
		}
		// Keep validation reason in `status`; form adapter remains in summary fields.
		trace?.warn('product-form.validation.failed', {
			...result.summary,
			status: result.reason,
		});
	}
}

/**
 * Host dialog callbacks are documented as strings, but compatibility layers may
 * deliver event-like objects. Coerce them before storing form state.
 */
export function readOnChangeText(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (value && typeof value === 'object') {
		const record = value as { target?: { value?: unknown }; value?: unknown; data?: unknown };
		if (typeof record.target?.value === 'string' || typeof record.target?.value === 'number') {
			return String(record.target.value);
		}
		if (typeof record.value === 'string' || typeof record.value === 'number') {
			return String(record.value);
		}
		if (typeof record.data === 'string' || typeof record.data === 'number') {
			return String(record.data);
		}
	}
	return '';
}
