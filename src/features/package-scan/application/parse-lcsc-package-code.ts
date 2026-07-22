import { normalizeInventoryText, normalizeLcscPartNumber } from '../../inventory/domain/inventory-item';

export const MAX_PACKAGE_CODE_LENGTH = 4_096;

export interface LcscPackageCode {
	lcscPartNumber: string;
	manufacturerPartNumber?: string;
	quantity: number;
}

export type ParseLcscPackageCodeResult
	= | { status: 'parsed'; value: LcscPackageCode }
		| {
			status: 'invalid';
			reason: 'conflicting-field' | 'empty' | 'invalid-part-number' | 'invalid-quantity' | 'missing-part-number' | 'too-long';
		};

type SupportedField = 'pc' | 'pm' | 'qty';

const FIELD_PATTERN = /(?:^|[,{;\r\n])\s*(pc|pm|qty)\s*:\s*([^,};\r\n]*)/giu;

export function parseLcscPackageCode(input: string): ParseLcscPackageCodeResult {
	if (!input.trim()) {
		return { status: 'invalid', reason: 'empty' };
	}
	if (input.length > MAX_PACKAGE_CODE_LENGTH) {
		return { status: 'invalid', reason: 'too-long' };
	}

	const fields = new Map<SupportedField, string>();
	for (const match of input.matchAll(FIELD_PATTERN)) {
		const key = match[1]?.toLowerCase() as SupportedField;
		const value = normalizeInventoryText(match[2] ?? '');
		const existing = fields.get(key);
		if (existing !== undefined && existing !== value) {
			return { status: 'invalid', reason: 'conflicting-field' };
		}
		fields.set(key, value);
	}

	const rawPartNumber = fields.get('pc');
	if (!rawPartNumber) {
		return { status: 'invalid', reason: 'missing-part-number' };
	}
	const lcscPartNumber = normalizeLcscPartNumber(rawPartNumber);
	if (!lcscPartNumber || !/^C\d+$/.test(lcscPartNumber)) {
		return { status: 'invalid', reason: 'invalid-part-number' };
	}

	const rawQuantity = fields.get('qty');
	const quantity = rawQuantity === undefined || rawQuantity === '' ? 1 : Number(rawQuantity);
	if (!/^\d+$/.test(rawQuantity ?? '1') || !Number.isSafeInteger(quantity) || quantity <= 0) {
		return { status: 'invalid', reason: 'invalid-quantity' };
	}

	const manufacturerPartNumber = fields.get('pm') || undefined;
	return {
		status: 'parsed',
		value: {
			lcscPartNumber,
			manufacturerPartNumber,
			quantity,
		},
	};
}
