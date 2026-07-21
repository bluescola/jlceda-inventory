import type { Translate } from '../../src/platform/jlceda-v3/eda/i18n-client';
import type { DiagnosticTrace } from '../../src/platform/jlceda-v3/presentation/native-diagnostics';
import type { NativeDialog } from '../../src/platform/jlceda-v3/presentation/native-dialog';
import type { ProductDetailsDraft, ProductDetailsForm } from '../../src/platform/jlceda-v3/presentation/product-details-form';
import { describe, expect, it, vi } from 'vitest';
import {
	FallbackProductDetailsForm,
	normalizeProductDetailsDraft,
	ProductDetailsFormUnavailableError,
	SequentialProductDetailsForm,
} from '../../src/platform/jlceda-v3/presentation/product-details-form';
import { ProductDetailsFormSession, readOnChangeText } from '../../src/platform/jlceda-v3/presentation/product-details-form-session';

const request = {
	partNumber: 'C233991',
	marketplaceConfirmed: true,
};

function createTrace(): DiagnosticTrace {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		waitFor: vi.fn(async (_step: string, operation: () => Promise<unknown>) => operation()),
	} as unknown as DiagnosticTrace;
}

describe('productDetailsForm', () => {
	it('normalizes all fields and removes blank optional values', () => {
		expect(normalizeProductDetailsDraft({
			name: '  Microphone  ',
			manufacturer: ' INGHAi ',
			manufacturerPartNumber: ' ',
			package: ' SMD\u200B ',
			description: '',
		})).toEqual({
			ok: true,
			value: {
				name: 'Microphone',
				manufacturer: 'INGHAi',
				manufacturerPartNumber: undefined,
				package: 'SMD',
				description: undefined,
			},
		});
		expect(normalizeProductDetailsDraft({ name: '  ' })).toEqual({ ok: false, reason: 'name-required' });
	});

	it('submits a full session without recording field contents', () => {
		const trace = createTrace();
		const session = new ProductDetailsFormSession();
		for (const [field, value] of [
			['name', ' Microphone '],
			['manufacturer', 'INGHAi'],
			['manufacturerPartNumber', 'GMI9745'],
			['package', 'SMD'],
			['description', 'Electret microphone'],
		] as const) {
			session.recordFieldChange(trace, session.applyChange(field, value));
		}

		const result = session.submit('iframe');
		session.recordSubmit(trace, result);

		expect(result).toEqual({
			ok: true,
			value: {
				name: 'Microphone',
				manufacturer: 'INGHAi',
				manufacturerPartNumber: 'GMI9745',
				package: 'SMD',
				description: 'Electret microphone',
			},
			summary: {
				status: 'iframe',
				nameLength: 12,
				manufacturerLength: 6,
				manufacturerPartNumberLength: 7,
				packageLength: 3,
				descriptionLength: 19,
				changedFields: 5,
			},
		});
		const diagnostics = JSON.stringify(vi.mocked(trace.info).mock.calls);
		expect(diagnostics).not.toMatch(/Microphone|INGHAi|GMI9745|Electret/);
	});

	it('rejects an empty name with length-only validation diagnostics', () => {
		const trace = createTrace();
		const session = new ProductDetailsFormSession();
		session.recordFieldChange(trace, session.applyChange('name', '   '));
		session.recordFieldChange(trace, session.applyChange('manufacturer', 'INGHAi'));
		const result = session.submit('iframe');
		session.recordSubmit(trace, result);

		expect(result.ok).toBe(false);
		if (result.ok) {
			return;
		}
		expect(trace.warn).toHaveBeenCalledWith('product-form.validation.failed', {
			...result.summary,
			status: 'name-required',
		});
	});

	it('uses fallback only when the primary form is unavailable', async () => {
		const trace = createTrace();
		const fallback = { open: vi.fn().mockResolvedValue({ name: 'Fallback part' }) } as unknown as ProductDetailsForm;
		const unavailable = new FallbackProductDetailsForm(
			{ open: vi.fn().mockRejectedValue(new ProductDetailsFormUnavailableError('api-missing')) } as unknown as ProductDetailsForm,
			fallback,
		);
		expect(await unavailable.open(request, trace)).toEqual({ name: 'Fallback part' });
		expect(fallback.open).toHaveBeenCalledWith(request, trace);

		fallback.open = vi.fn();
		const value: ProductDetailsDraft = { name: 'Microphone' };
		const successful = new FallbackProductDetailsForm(
			{ open: vi.fn().mockResolvedValue(value) } as unknown as ProductDetailsForm,
			fallback,
		);
		const cancelled = new FallbackProductDetailsForm(
			{ open: vi.fn().mockResolvedValue(undefined) } as unknown as ProductDetailsForm,
			fallback,
		);
		expect(await successful.open(request, trace)).toEqual(value);
		expect(await cancelled.open(request, trace)).toBeUndefined();
		expect(fallback.open).not.toHaveBeenCalled();
	});

	it('collects native fallback fields in sequence and trims them', async () => {
		const values = [' Microphone ', ' INGHAi ', ' GMI9745 ', ' SMD ', ' Electret microphone '];
		const dialog = {
			input: vi.fn().mockImplementation(async () => values.shift()),
			info: vi.fn(),
		} as unknown as NativeDialog;
		const trace = createTrace();
		const form = new SequentialProductDetailsForm(dialog, ((key: string) => key) as Translate);

		expect(await form.open(request, trace)).toEqual({
			name: 'Microphone',
			manufacturer: 'INGHAi',
			manufacturerPartNumber: 'GMI9745',
			package: 'SMD',
			description: 'Electret microphone',
		});
		expect(dialog.input).toHaveBeenCalledTimes(5);
		expect(trace.info).toHaveBeenCalledWith('product-form.submitted', expect.objectContaining({
			status: 'sequential',
			changedFields: 5,
		}));
	});

	it('coerces event-like host values into plain text for native compatibility', () => {
		expect(readOnChangeText('Microphone')).toBe('Microphone');
		expect(readOnChangeText(12)).toBe('12');
		expect(readOnChangeText({ target: { value: ' from-event ' } })).toBe(' from-event ');
		expect(readOnChangeText({ value: 'from-value' })).toBe('from-value');
		expect(readOnChangeText({ data: 'from-data' })).toBe('from-data');
		expect(readOnChangeText(undefined)).toBe('');
	});
});
