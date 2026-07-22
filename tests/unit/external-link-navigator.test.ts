import { describe, expect, it, vi } from 'vitest';
import { EdaExternalLinkNavigator } from '../../src/platform/jlceda-v3/eda/external-link-navigator';

describe('eda external link navigator', () => {
	it('opens a validated datasheet URL in the injected host window', () => {
		const openWindow = vi.fn();
		const navigator = new EdaExternalLinkNavigator(openWindow);

		expect(navigator.open(' https://example.com/data.pdf ')).toBe(true);
		expect(openWindow).toHaveBeenCalledWith('https://example.com/data.pdf');
	});

	it('returns false when the host rejects the external window', () => {
		const navigator = new EdaExternalLinkNavigator(() => {
			throw new Error('blocked');
		});

		expect(navigator.open('https://example.com/data.pdf')).toBe(false);
		expect(navigator.open('file:///tmp/data.pdf')).toBe(false);
	});
});
