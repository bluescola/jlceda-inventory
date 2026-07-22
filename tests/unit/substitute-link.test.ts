import type { InventoryItem, NewInventoryItem } from '../../src/features/inventory/domain/inventory-item';
import { describe, expect, it } from 'vitest';
import { normalizeInventoryItem } from '../../src/features/inventory/domain/inventory-item';
import {
	listConfirmedSubstituteCandidates,
	normalizeSubstituteItemPair,
	normalizeSubstituteLink,
} from '../../src/features/inventory/domain/substitute-link';

const NOW = '2026-07-22T08:00:00.000Z';

describe('substitute links', () => {
	it('normalizes the unordered pair and rejects self-links', () => {
		expect(normalizeSubstituteItemPair(' item-b ', 'item-a')).toEqual(['item-a', 'item-b']);
		expect(() => normalizeSubstituteItemPair('item-a', ' item-a ')).toThrow('two different');
	});

	it('ranks only user-confirmed linked candidates by stock confidence and sufficiency', () => {
		const base = item('base', { identity: { name: 'Base resistor' }, quantity: 1, precision: 'exact' });
		const sufficient = item('sufficient', { identity: { name: 'Sufficient' }, quantity: 20, precision: 'exact' });
		const insufficient = item('insufficient', { identity: { name: 'Insufficient' }, quantity: 3, precision: 'exact' });
		const review = item('review', { identity: { name: 'Review' }, quantity: 30, precision: 'estimated' });
		const depleted = item('depleted', { identity: { name: 'Depleted' }, quantity: 0, precision: 'exact' });
		const similarButUnconfirmed = item('unconfirmed', {
			identity: { name: 'Base resistor', package: '0603' },
			quantity: 100,
			precision: 'exact',
		});
		const links = [sufficient, insufficient, review, depleted].map((candidate, index) => normalizeSubstituteLink({
			itemIdA: base.id,
			itemIdB: candidate.id,
		}, NOW, `link-${index + 1}`));

		const candidates = listConfirmedSubstituteCandidates(
			base.id,
			5,
			[base, sufficient, insufficient, review, depleted, similarButUnconfirmed],
			links,
		);

		expect(candidates.map(candidate => [candidate.item.id, candidate.status])).toEqual([
			['sufficient', 'exact-and-sufficient'],
			['insufficient', 'exact-in-stock'],
			['review', 'needs-review'],
			['depleted', 'depleted'],
		]);
	});
});

function item(id: string, input: Pick<NewInventoryItem, 'identity' | 'precision' | 'quantity'>): InventoryItem {
	return normalizeInventoryItem({ ...input, source: 'manual' }, NOW, id);
}
