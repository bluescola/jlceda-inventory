import type { NewPurchaseRecord, PurchaseCostSummary, PurchaseRecord } from '../domain/project-planning';
import { sanitizePurchaseRecord } from '../domain/project-planning';

export function normalizePurchaseRecord(input: NewPurchaseRecord, id: string, createdAt: string): PurchaseRecord {
	return sanitizePurchaseRecord({
		...input,
		id,
		quantity: input.quantity,
		unitPriceMinor: input.unitPriceMinor,
		purchasedAt: input.purchasedAt,
		createdAt: normalizeTimestamp(createdAt, 'Purchase record creation time'),
		revision: 1,
	});
}

export function summarizePurchaseCosts(records: readonly PurchaseRecord[]): PurchaseCostSummary[] {
	const summaries = new Map<string, PurchaseCostSummary>();
	for (const record of records) {
		const amount = assertSafeProduct(record.quantity, record.unitPriceMinor);
		let summary = summaries.get(record.currency);
		if (!summary) {
			summary = { currency: record.currency, recordCount: 0, totalQuantity: 0, totalMinor: 0 };
			summaries.set(record.currency, summary);
		}
		summary.recordCount += 1;
		summary.totalQuantity = addSafe(summary.totalQuantity, record.quantity);
		summary.totalMinor = addSafe(summary.totalMinor, amount);
	}
	return [...summaries.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

function assertSafeProduct(left: number, right: number): number {
	const result = left * right;
	if (!Number.isSafeInteger(result)) {
		throw new RangeError('Purchase amount exceeds the safe integer range.');
	}
	return result;
}

function addSafe(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) {
		throw new RangeError('Purchase cost summary exceeds the safe integer range.');
	}
	return result;
}

function normalizeTimestamp(value: string, label: string): string {
	const parsed = Date.parse(value);
	if (!Number.isFinite(parsed)) {
		throw new TypeError(`${label} must be a valid timestamp.`);
	}
	return new Date(parsed).toISOString();
}
