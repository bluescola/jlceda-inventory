import { normalizeInventoryText } from './inventory-text';

export const MAX_DATASHEET_URL_LENGTH = 2_048;
export const MAX_STRUCTURED_LOCATION_FIELD_LENGTH = 64;

export interface StructuredInventoryLocation {
	cabinet?: string;
	box?: string;
	row?: string;
	column?: string;
}

export function normalizeDatasheetUrl(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new TypeError('Datasheet URL must be text.');
	}
	const normalized = normalizeInventoryText(value);
	if (!normalized) {
		return undefined;
	}
	if (normalized.length > MAX_DATASHEET_URL_LENGTH) {
		throw new TypeError(`Datasheet URL exceeds the ${MAX_DATASHEET_URL_LENGTH}-character limit.`);
	}
	let url: URL;
	try {
		url = new URL(normalized);
	}
	catch {
		throw new TypeError('Datasheet URL is invalid.');
	}
	if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
		throw new TypeError('Datasheet URL must use HTTP or HTTPS without embedded credentials.');
	}
	return normalized;
}

export function normalizeStructuredLocation(value: unknown): StructuredInventoryLocation | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Structured inventory location must be an object.');
	}
	const source = value as Record<string, unknown>;
	const normalized: StructuredInventoryLocation = {
		cabinet: normalizeLocationField(source.cabinet, 'cabinet'),
		box: normalizeLocationField(source.box, 'box'),
		row: normalizeLocationField(source.row, 'row'),
		column: normalizeLocationField(source.column, 'column'),
	};
	return normalized.cabinet || normalized.box || normalized.row || normalized.column
		? normalized
		: undefined;
}

export function formatStructuredLocation(
	value: StructuredInventoryLocation | undefined,
	separator = ' / ',
): string | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = normalizeStructuredLocation(value);
	return normalized
		? [normalized.cabinet, normalized.box, normalized.row, normalized.column].filter(Boolean).join(separator)
		: undefined;
}

function normalizeLocationField(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null || value === '') {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new TypeError(`Structured inventory location ${field} must be text.`);
	}
	const normalized = normalizeInventoryText(value);
	if (normalized.length > MAX_STRUCTURED_LOCATION_FIELD_LENGTH) {
		throw new TypeError(`Structured inventory location ${field} exceeds the ${MAX_STRUCTURED_LOCATION_FIELD_LENGTH}-character limit.`);
	}
	return normalized || undefined;
}
