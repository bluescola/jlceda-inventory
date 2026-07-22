const FORMAT_CHARACTERS = /\p{Cf}/gu;

export function normalizeInventoryText(value: string): string {
	const withoutUnsafeFormatCharacters = value
		// ZWNJ and ZWJ are format characters with valid multilingual shaping semantics.
		.replaceAll(FORMAT_CHARACTERS, character => character === '\u200C' || character === '\u200D' ? character : '');
	return Array.from(withoutUnsafeFormatCharacters, character => isUnsafeControlCharacter(character) ? '' : character).join('').trim();
}

function isUnsafeControlCharacter(character: string): boolean {
	const codePoint = character.codePointAt(0) ?? 0;
	return codePoint <= 0x08
		|| codePoint === 0x0B
		|| codePoint === 0x0C
		|| (codePoint >= 0x0E && codePoint <= 0x1F)
		|| (codePoint >= 0x7F && codePoint <= 0x9F);
}
