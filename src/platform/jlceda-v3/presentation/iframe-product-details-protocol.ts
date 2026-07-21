import type { ProductDetailsFormState } from './product-details-form-session';

export const PRODUCT_DETAILS_IFRAME_ID = 'jlceda-inventory-product-details';
export const PRODUCT_DETAILS_IFRAME_PATH = '/iframe/product-details.html';
export const PRODUCT_DETAILS_REQUEST_KEY = 'product-details-form.v2.request';
export const PRODUCT_DETAILS_RESULT_KEY = 'product-details-form.v2.result';
export const PRODUCT_DETAILS_PROTOCOL_VERSION = 2;

export type IFrameProductDetailsStage = 'form-rendered' | 'request-read' | 'script-started';

export interface ProductDetailsFormLabels {
	title: string;
	lcsc: string;
	name: string;
	manufacturer: string;
	manufacturerPartNumber: string;
	package: string;
	description: string;
	cancel: string;
	confirm: string;
	loading: string;
	nameRequired: string;
	connectionError: string;
	saveError: string;
}

export interface IFrameProductDetailsRequest {
	protocolVersion: 2;
	requestId: string;
	partNumber: string;
	initial: ProductDetailsFormState;
	labels: ProductDetailsFormLabels;
}

export type IFrameProductDetailsResult
	= | {
		protocolVersion: 2;
		requestId: string;
		status: 'ready' | 'cancelled';
	}
	| {
		protocolVersion: 2;
		requestId: string;
		status: 'progress';
		stage: IFrameProductDetailsStage;
	}
	| {
		protocolVersion: 2;
		requestId: string;
		status: 'failed';
		stage: IFrameProductDetailsStage;
		errorName: string;
		error: string;
	}
	| {
		protocolVersion: 2;
		requestId: string;
		status: 'submitted';
		value: ProductDetailsFormState;
	};

export function createIFrameProductDetailsRequest(
	requestId: string,
	partNumber: string,
	initial: ProductDetailsFormState,
	labels: ProductDetailsFormLabels,
): IFrameProductDetailsRequest {
	return {
		protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
		requestId,
		partNumber,
		initial: { ...initial },
		labels: { ...labels },
	};
}

export function parseIFrameProductDetailsRequest(value: unknown): IFrameProductDetailsRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== PRODUCT_DETAILS_PROTOCOL_VERSION
		|| !isNonEmptyString(value.requestId)
		|| !isString(value.partNumber)
		|| !isProductDetailsState(value.initial)
		|| !isProductDetailsLabels(value.labels)) {
		return undefined;
	}
	return {
		protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
		requestId: value.requestId,
		partNumber: value.partNumber,
		initial: { ...value.initial },
		labels: { ...value.labels },
	};
}

export function parseIFrameProductDetailsResult(
	value: unknown,
	expectedRequestId: string,
): IFrameProductDetailsResult | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== PRODUCT_DETAILS_PROTOCOL_VERSION
		|| value.requestId !== expectedRequestId) {
		return undefined;
	}
	if (value.status === 'ready' || value.status === 'cancelled') {
		return {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: expectedRequestId,
			status: value.status,
		};
	}
	if (value.status === 'progress' && isProductDetailsStage(value.stage)) {
		return {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: expectedRequestId,
			status: 'progress',
			stage: value.stage,
		};
	}
	if (value.status === 'failed'
		&& isProductDetailsStage(value.stage)
		&& isString(value.errorName)
		&& isString(value.error)) {
		return {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: expectedRequestId,
			status: 'failed',
			stage: value.stage,
			errorName: value.errorName,
			error: value.error,
		};
	}
	if (value.status === 'submitted' && isProductDetailsState(value.value)) {
		return {
			protocolVersion: PRODUCT_DETAILS_PROTOCOL_VERSION,
			requestId: expectedRequestId,
			status: 'submitted',
			value: { ...value.value },
		};
	}
	return undefined;
}

function isProductDetailsState(value: unknown): value is ProductDetailsFormState {
	return isRecord(value)
		&& isString(value.name)
		&& isString(value.manufacturer)
		&& isString(value.manufacturerPartNumber)
		&& isString(value.package)
		&& isString(value.description);
}

function isProductDetailsLabels(value: unknown): value is ProductDetailsFormLabels {
	return isRecord(value)
		&& isString(value.title)
		&& isString(value.lcsc)
		&& isString(value.name)
		&& isString(value.manufacturer)
		&& isString(value.manufacturerPartNumber)
		&& isString(value.package)
		&& isString(value.description)
		&& isString(value.cancel)
		&& isString(value.confirm)
		&& isString(value.loading)
		&& isString(value.nameRequired)
		&& isString(value.connectionError)
		&& isString(value.saveError);
}

function isProductDetailsStage(value: unknown): value is IFrameProductDetailsStage {
	return value === 'script-started' || value === 'request-read' || value === 'form-rendered';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object';
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
	return isString(value) && value.length > 0;
}
