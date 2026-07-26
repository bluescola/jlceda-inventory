import type { URIComponents } from 'uri-js';
import { parse as parseUri } from 'uri-js';
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
	let uri: URIComponents;
	try {
		uri = parseUri(normalized);
	}
	catch {
		throw new TypeError('Datasheet URL is invalid.');
	}
	if ((uri.scheme !== 'http' && uri.scheme !== 'https') || uri.userinfo !== undefined) {
		throw new TypeError('Datasheet URL must use HTTP or HTTPS without embedded credentials.');
	}
	if (!isSafeHttpUri(normalized, uri)) {
		throw new TypeError('Datasheet URL is invalid.');
	}
	return normalized;
}

export function isSafeHttpUrl(value: unknown): value is string {
	if (typeof value !== 'string' || !value || value.length > MAX_DATASHEET_URL_LENGTH) {
		return false;
	}
	try {
		return isSafeHttpUri(value, parseUri(value));
	}
	catch {
		return false;
	}
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

function isSafeHttpUri(value: string, uri: URIComponents): boolean {
	if (hasUnsafeUriCharacter(value)) {
		return false;
	}
	if (
		uri.error
		|| (uri.scheme !== 'http' && uri.scheme !== 'https')
		|| uri.userinfo !== undefined
		|| !uri.host
		|| uri.host.includes('%')
		|| !hasValidHttpAuthority(value)
	) {
		return false;
	}
	if (uri.port === undefined || uri.port === '') {
		return true;
	}
	const port = typeof uri.port === 'number' ? uri.port : Number(uri.port);
	return Number.isInteger(port) && port >= 0 && port <= 65_535;
}

function hasValidHttpAuthority(value: string): boolean {
	const authorityStart = value.indexOf('://') + 3;
	if (authorityStart < 3) {
		return false;
	}
	const pathStart = [...['/', '?', '#']]
		.map(delimiter => value.indexOf(delimiter, authorityStart))
		.filter(index => index >= 0)
		.reduce((earliest, index) => Math.min(earliest, index), value.length);
	const authority = value.slice(authorityStart, pathStart);
	if (!authority || authority.includes('@')) {
		return false;
	}
	if (authority.startsWith('[')) {
		const closingBracket = authority.indexOf(']');
		return closingBracket > 1
			&& isValidPortSuffix(authority.slice(closingBracket + 1));
	}
	if (authority.includes('[') || authority.includes(']')) {
		return false;
	}
	const portSeparator = authority.lastIndexOf(':');
	return portSeparator < 0
		|| (authority.indexOf(':') === portSeparator && isValidPortSuffix(authority.slice(portSeparator)));
}

function isValidPortSuffix(value: string): boolean {
	return value === '' || (value.startsWith(':') && /^\d*$/u.test(value.slice(1)));
}

function hasUnsafeUriCharacter(value: string): boolean {
	return [...value].some((character) => {
		const code = character.charCodeAt(0);
		return character === '\\'
			|| character.trim() === ''
			|| code < 32
			|| (code >= 127 && code <= 159);
	});
}
