export interface InventoryStockDraftValue {
	quantity: string;
	precision: 'exact' | 'estimated';
	depleted: boolean;
}

export interface InventoryStockDraftSession {
	value: InventoryStockDraftValue;
	restoreValue?: InventoryStockDraftValue;
	lastInStockValue?: InventoryStockDraftValue;
}

export function createInventoryStockDraftSession(initial: InventoryStockDraftValue): InventoryStockDraftSession {
	const depleted = initial.depleted || initial.quantity.trim() === '0';
	const value = depleted
		? depletedValue()
		: cloneValue(initial, false);
	return {
		value,
		lastInStockValue: depleted ? undefined : cloneValue(value, false),
	};
}

export function setInventoryStockDraftDepleted(
	session: InventoryStockDraftSession,
	depleted: boolean,
): InventoryStockDraftSession {
	if (depleted) {
		if (session.value.depleted) {
			return session;
		}
		const restoreValue = cloneValue(session.value, false);
		return {
			value: depletedValue(),
			restoreValue,
			lastInStockValue: restoreValue,
		};
	}
	if (!session.value.depleted) {
		return session;
	}
	const value = session.restoreValue
		? cloneValue(session.restoreValue, false)
		: { quantity: '', precision: 'exact' as const, depleted: false };
	return {
		value,
		lastInStockValue: cloneValue(value, false),
	};
}

export function updateInventoryStockDraftQuantity(
	session: InventoryStockDraftSession,
	quantity: string,
): InventoryStockDraftSession {
	const normalized = quantity.trim();
	if (normalized === '0') {
		const restoreValue = session.restoreValue
			?? (!session.value.depleted ? cloneValue(session.value, false) : session.lastInStockValue);
		return {
			value: depletedValue(),
			restoreValue,
			lastInStockValue: restoreValue ?? session.lastInStockValue,
		};
	}
	const value = { ...session.value, quantity };
	if (/^\d+$/.test(normalized) && Number(normalized) > 0) {
		const inStockValue = cloneValue(value, false);
		return {
			value: inStockValue,
			lastInStockValue: inStockValue,
		};
	}
	return { ...session, value };
}

export function updateInventoryStockDraftPrecision(
	session: InventoryStockDraftSession,
	precision: 'exact' | 'estimated',
): InventoryStockDraftSession {
	if (session.value.depleted) {
		return session;
	}
	const value = { ...session.value, precision };
	return {
		...session,
		value,
		lastInStockValue: cloneValue(value, false),
	};
}

function depletedValue(): InventoryStockDraftValue {
	return { quantity: '0', precision: 'exact', depleted: true };
}

function cloneValue(value: InventoryStockDraftValue, depleted: boolean): InventoryStockDraftValue {
	return { quantity: value.quantity, precision: value.precision, depleted };
}
