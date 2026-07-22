import type { DesignStockIdentity } from '../../design-stock-check/domain/design-stock-check';
import type { DesignDocumentKind } from '../../design-stock-check/ports/design-component-reader';
import { normalizeInventoryText, normalizeLcscPartNumber } from '../../inventory/domain/inventory-item';

export const MAX_PROJECT_SNAPSHOT_DEMANDS = 10_000;
export const MAX_PROJECT_DEMAND_DESIGNATORS = 10_000;
export const MAX_PURCHASE_SNAPSHOT_REFERENCES = 10_000;

export interface ProjectDemandLine {
	key: string;
	identity: DesignStockIdentity;
	designators: string[];
	unitQuantity: number;
}

export interface ProjectDemandSnapshot {
	id: string;
	projectUuid?: string;
	documentUuid: string;
	documentKind: DesignDocumentKind | 'file';
	label: string;
	boardQuantity: number;
	demands: ProjectDemandLine[];
	sourceFingerprint: string;
	capturedAt: string;
	revision: number;
}

export interface PurchaseRecord {
	id: string;
	lcscPartNumber?: string;
	name: string;
	quantity: number;
	unitPriceMinor: number;
	currency: string;
	platform?: string;
	productUrl?: string;
	orderNumber?: string;
	purchasedAt: string;
	projectSnapshotIds: string[];
	note?: string;
	createdAt: string;
	revision: number;
}

export interface NewPurchaseRecord extends Omit<PurchaseRecord, 'createdAt' | 'id' | 'revision'> {}

export interface PurchaseCostSummary {
	currency: string;
	recordCount: number;
	totalQuantity: number;
	totalMinor: number;
}

export function sanitizeProjectDemandSnapshot(snapshot: ProjectDemandSnapshot): ProjectDemandSnapshot {
	if (!snapshot || typeof snapshot !== 'object') {
		throw new TypeError('Project demand snapshot must be an object.');
	}
	if (!Array.isArray(snapshot.demands) || snapshot.demands.length > MAX_PROJECT_SNAPSHOT_DEMANDS) {
		throw new TypeError(`Project demand snapshot must contain at most ${MAX_PROJECT_SNAPSHOT_DEMANDS} demand lines.`);
	}
	const documentKind = assertEnum(snapshot.documentKind, ['schematic', 'pcb', 'file'] as const, 'Project document kind');
	const sourceFingerprint = normalizeInventoryText(snapshot.sourceFingerprint).toLowerCase();
	if (!/^[a-f\d]{64}$/.test(sourceFingerprint)) {
		throw new TypeError('Project source fingerprint must be a SHA-256 hexadecimal value.');
	}
	const demands = snapshot.demands.map((demand, index) => sanitizeProjectDemandLine(demand, index));
	if (new Set(demands.map(demand => demand.key)).size !== demands.length) {
		throw new TypeError('Project demand snapshot contains duplicate demand keys.');
	}
	for (const demand of demands) {
		assertSafeProduct(demand.unitQuantity, snapshot.boardQuantity, 'Project demand quantity');
	}
	return {
		id: requiredText(snapshot.id, 'Project snapshot ID', 256),
		projectUuid: optionalText(snapshot.projectUuid, 'Project UUID', 256),
		documentUuid: requiredText(snapshot.documentUuid, 'Project document UUID', 256),
		documentKind,
		label: requiredText(snapshot.label, 'Project snapshot label', 128),
		boardQuantity: positiveSafeInteger(snapshot.boardQuantity, 'Project board quantity'),
		demands,
		sourceFingerprint,
		capturedAt: canonicalTimestamp(snapshot.capturedAt, 'Project snapshot capture time'),
		revision: positiveSafeInteger(snapshot.revision, 'Project snapshot revision'),
	};
}

export function sanitizePurchaseRecord(record: PurchaseRecord): PurchaseRecord {
	if (!record || typeof record !== 'object') {
		throw new TypeError('Purchase record must be an object.');
	}
	const lcscPartNumber = normalizeLcscPartNumber(optionalText(record.lcscPartNumber, 'Purchase C number', 64));
	if (lcscPartNumber && !/^C\d+$/.test(lcscPartNumber)) {
		throw new TypeError('Purchase C number is invalid.');
	}
	const currency = requiredText(record.currency, 'Purchase currency', 3).toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) {
		throw new TypeError('Purchase currency must be a three-letter ISO code.');
	}
	const quantity = positiveSafeInteger(record.quantity, 'Purchase quantity');
	const unitPriceMinor = nonNegativeSafeInteger(record.unitPriceMinor, 'Purchase unit price');
	assertSafeProduct(quantity, unitPriceMinor, 'Purchase amount');
	const productUrl = optionalText(record.productUrl, 'Purchase product URL', 2_048);
	if (productUrl && !isHttpUrl(productUrl)) {
		throw new TypeError('Purchase product URL must use HTTP or HTTPS without embedded credentials.');
	}
	if (!Array.isArray(record.projectSnapshotIds)
		|| record.projectSnapshotIds.length > MAX_PURCHASE_SNAPSHOT_REFERENCES) {
		throw new TypeError('Purchase snapshot references must be an array.');
	}
	return {
		id: requiredText(record.id, 'Purchase record ID', 256),
		lcscPartNumber,
		name: requiredText(record.name, 'Purchase item name', 256),
		quantity,
		unitPriceMinor,
		currency,
		platform: optionalText(record.platform, 'Purchase platform', 128),
		productUrl,
		orderNumber: optionalText(record.orderNumber, 'Purchase order number', 256),
		purchasedAt: canonicalPurchaseDate(record.purchasedAt, 'Purchase date'),
		projectSnapshotIds: [...new Set(record.projectSnapshotIds.map(value => requiredText(value, 'Snapshot ID', 256)))],
		note: optionalText(record.note, 'Purchase note', 4_096),
		createdAt: canonicalTimestamp(record.createdAt, 'Purchase record creation time'),
		revision: positiveSafeInteger(record.revision, 'Purchase record revision'),
	};
}

function sanitizeProjectDemandLine(demand: ProjectDemandLine, index: number): ProjectDemandLine {
	if (!demand || typeof demand !== 'object') {
		throw new TypeError(`Project demand line ${index} must be an object.`);
	}
	if (!Array.isArray(demand.designators) || demand.designators.length > MAX_PROJECT_DEMAND_DESIGNATORS) {
		throw new TypeError(`Project demand line ${index} has too many designators.`);
	}
	if (!demand.identity || typeof demand.identity !== 'object') {
		throw new TypeError(`Project demand line ${index} identity must be an object.`);
	}
	const lcscPartNumber = normalizeLcscPartNumber(optionalText(demand.identity.lcscPartNumber, 'Project demand C number', 64));
	if (lcscPartNumber && !/^C\d+$/.test(lcscPartNumber)) {
		throw new TypeError(`Project demand line ${index} C number is invalid.`);
	}
	return {
		key: requiredText(demand.key, 'Project demand key', 4_096),
		identity: {
			name: optionalText(demand.identity.name, 'Project demand name', 16_384),
			lcscPartNumber,
			manufacturerPartNumber: optionalText(demand.identity.manufacturerPartNumber, 'Project demand manufacturer part number', 16_384),
			manufacturer: optionalText(demand.identity.manufacturer, 'Project demand manufacturer', 16_384),
			package: optionalText(demand.identity.package, 'Project demand package', 16_384),
		},
		designators: [...new Set(demand.designators.map(value => requiredText(value, 'Project demand designator', 256)))],
		unitQuantity: positiveSafeInteger(demand.unitQuantity, 'Project demand unit quantity'),
	};
}

function requiredText(value: string, label: string, maximumLength: number): string {
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be text.`);
	}
	const normalized = normalizeInventoryText(value);
	if (!normalized || normalized.length > maximumLength) {
		throw new TypeError(`${label} must contain between 1 and ${maximumLength} characters.`);
	}
	return normalized;
}

function optionalText(value: string | undefined, label: string, maximumLength: number): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be text.`);
	}
	const normalized = normalizeInventoryText(value);
	if (normalized.length > maximumLength) {
		throw new TypeError(`${label} exceeds the ${maximumLength}-character limit.`);
	}
	return normalized || undefined;
}

function canonicalTimestamp(value: string, label: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be a canonical UTC timestamp.`);
	}
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
		throw new TypeError(`${label} must be a canonical UTC timestamp.`);
	}
	return value;
}

function canonicalPurchaseDate(value: string, label: string): string {
	if (typeof value !== 'string') {
		throw new TypeError(`${label} must be a calendar date.`);
	}
	const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
		? value
		: Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().slice(0, 10) : '';
	if (!date || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
		throw new TypeError(`${label} must be a valid YYYY-MM-DD calendar date.`);
	}
	return date;
}

function positiveSafeInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive safe integer.`);
	}
	return value;
}

function nonNegativeSafeInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new TypeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function assertSafeProduct(left: number, right: number, label: string): void {
	if (!Number.isSafeInteger(left * right)) {
		throw new RangeError(`${label} exceeds the safe integer range.`);
	}
}

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
	}
	catch {
		return false;
	}
}

function assertEnum<const Value extends string>(value: unknown, accepted: readonly Value[], label: string): Value {
	if (typeof value !== 'string' || !accepted.includes(value as Value)) {
		throw new TypeError(`${label} is unsupported.`);
	}
	return value as Value;
}
