import { normalizeInventoryText } from './inventory-item';

export interface InventoryCategory {
	id: string;
	name: string;
	parentId?: string;
	sortOrder: number;
	createdAt: string;
	updatedAt: string;
	revision: number;
}

export interface NewInventoryCategory {
	name: string;
	parentId?: string;
}

export function normalizeInventoryCategory(
	input: NewInventoryCategory,
	now: string,
	id: string,
	sortOrder: number,
): InventoryCategory {
	return {
		id,
		name: normalizeInventoryCategoryName(input.name),
		parentId: input.parentId,
		sortOrder,
		createdAt: now,
		updatedAt: now,
		revision: 1,
	};
}

export function normalizeInventoryCategoryName(name: string): string {
	const normalized = normalizeInventoryText(name);
	if (!normalized) {
		throw new Error('Category name is required.');
	}
	return normalized;
}

export function sanitizeInventoryCategoryText(category: InventoryCategory): InventoryCategory {
	return {
		...category,
		name: normalizeInventoryCategoryName(category.name),
	};
}
