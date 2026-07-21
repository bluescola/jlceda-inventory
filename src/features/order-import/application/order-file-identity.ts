import type { OrderFileIdentity } from '../domain/order-import';

const ORDER_NUMBER_PATTERN = /(?:^|[^A-Z0-9])SO[\s_-]*(\d+)(?=$|[^A-Z0-9])/i;

export function extractOrderNumber(fileName: string, content?: string | ArrayBuffer): string | undefined {
	return findOrderNumber(fileName)
		?? (typeof content === 'string' ? findOrderNumber(content) : findOrderNumberInBytes(content));
}

export async function fingerprintOrderFile(content: ArrayBuffer): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error('Web Crypto SHA-256 is not available in this environment.');
	}

	const digest = await subtle.digest('SHA-256', content);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function identifyOrderFile(fileName: string, content: ArrayBuffer): Promise<OrderFileIdentity> {
	return {
		orderNumber: extractOrderNumber(fileName, content),
		fingerprint: await fingerprintOrderFile(content),
	};
}

function findOrderNumber(value: string): string | undefined {
	const match = value.match(ORDER_NUMBER_PATTERN);
	return match ? `SO${match[1]}` : undefined;
}

function findOrderNumberInBytes(content: ArrayBuffer | undefined): string | undefined {
	if (!content) {
		return undefined;
	}

	const bytes = new Uint8Array(content);
	for (const encoding of ['utf-8', 'utf-16le'] as const) {
		const orderNumber = findOrderNumber(new TextDecoder(encoding).decode(bytes));
		if (orderNumber) {
			return orderNumber;
		}
	}
	return undefined;
}
