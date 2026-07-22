import type { InventoryItem } from './inventory-item';
import { normalizeInventoryText } from './inventory-text';

export interface SubstituteLink {
	id: string;
	itemIdA: string;
	itemIdB: string;
	note?: string;
	createdAt: string;
	updatedAt: string;
	revision: number;
}

export interface NewSubstituteLink {
	itemIdA: string;
	itemIdB: string;
	note?: string;
}

export type SubstituteCandidateStatus
	= | 'exact-and-sufficient'
		| 'exact-in-stock'
		| 'needs-review'
		| 'depleted';

export interface SubstituteCandidate {
	link: SubstituteLink;
	item: InventoryItem;
	status: SubstituteCandidateStatus;
}

export function normalizeSubstituteItemPair(leftItemId: string, rightItemId: string): readonly [string, string] {
	const left = normalizeSubstituteItemId(leftItemId);
	const right = normalizeSubstituteItemId(rightItemId);
	if (left === right) {
		throw new TypeError('A substitute link must reference two different inventory items.');
	}
	return left < right ? [left, right] : [right, left];
}

export function substitutePairKey(leftItemId: string, rightItemId: string): string {
	const [itemIdA, itemIdB] = normalizeSubstituteItemPair(leftItemId, rightItemId);
	return `${itemIdA}\u0000${itemIdB}`;
}

export function normalizeSubstituteLink(
	input: NewSubstituteLink,
	now: string,
	id: string,
): SubstituteLink {
	const [itemIdA, itemIdB] = normalizeSubstituteItemPair(input.itemIdA, input.itemIdB);
	const link: SubstituteLink = {
		id: normalizeSubstituteItemId(id),
		itemIdA,
		itemIdB,
		createdAt: now,
		updatedAt: now,
		revision: 1,
	};
	const note = normalizeOptionalNote(input.note);
	if (note !== undefined) {
		link.note = note;
	}
	return link;
}

export function sanitizeSubstituteLink(link: SubstituteLink): SubstituteLink {
	const [itemIdA, itemIdB] = normalizeSubstituteItemPair(link.itemIdA, link.itemIdB);
	const sanitized: SubstituteLink = {
		...link,
		id: normalizeSubstituteItemId(link.id),
		itemIdA,
		itemIdB,
	};
	const note = normalizeOptionalNote(link.note);
	if (note === undefined) {
		delete sanitized.note;
	}
	else {
		sanitized.note = note;
	}
	return sanitized;
}

export function listConfirmedSubstituteCandidates(
	baseItemId: string,
	requiredQuantity: number,
	items: readonly InventoryItem[],
	links: readonly SubstituteLink[],
): SubstituteCandidate[] {
	const normalizedBaseItemId = normalizeSubstituteItemId(baseItemId);
	if (!Number.isSafeInteger(requiredQuantity) || requiredQuantity <= 0) {
		throw new TypeError('Required substitute quantity must be a positive safe integer.');
	}
	const itemsById = new Map(items.map(item => [item.id, item]));
	return links
		.flatMap((link): SubstituteCandidate[] => {
			const candidateId = link.itemIdA === normalizedBaseItemId
				? link.itemIdB
				: link.itemIdB === normalizedBaseItemId ? link.itemIdA : undefined;
			const item = candidateId === undefined ? undefined : itemsById.get(candidateId);
			return item ? [{ link, item, status: classifySubstituteCandidate(item, requiredQuantity) }] : [];
		})
		.toSorted((left, right) => candidateStatusRank(left.status) - candidateStatusRank(right.status)
			|| candidateQuantity(right.item) - candidateQuantity(left.item)
			|| left.item.id.localeCompare(right.item.id));
}

function classifySubstituteCandidate(item: InventoryItem, requiredQuantity: number): SubstituteCandidateStatus {
	if (item.state === 'depleted' || item.quantity === 0) {
		return 'depleted';
	}
	if (item.precision === 'exact' && item.quantity !== null) {
		return item.quantity >= requiredQuantity ? 'exact-and-sufficient' : 'exact-in-stock';
	}
	return 'needs-review';
}

function candidateStatusRank(status: SubstituteCandidateStatus): number {
	switch (status) {
		case 'exact-and-sufficient': return 0;
		case 'exact-in-stock': return 1;
		case 'needs-review': return 2;
		case 'depleted': return 3;
	}
}

function candidateQuantity(item: InventoryItem): number {
	return typeof item.quantity === 'number' ? item.quantity : -1;
}

function normalizeSubstituteItemId(value: string): string {
	const normalized = typeof value === 'string' ? normalizeInventoryText(value) : '';
	if (!normalized || normalized.length > 4096) {
		throw new TypeError('Substitute link identifiers must be non-empty normalized text.');
	}
	return normalized;
}

function normalizeOptionalNote(value?: string): string | undefined {
	const normalized = value === undefined ? undefined : normalizeInventoryText(value);
	if (normalized !== undefined && normalized.length > 65_536) {
		throw new TypeError('Substitute link note must not exceed 65536 characters.');
	}
	return normalized || undefined;
}
