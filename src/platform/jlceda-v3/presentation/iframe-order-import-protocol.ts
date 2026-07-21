import type {
	OrderImportPanelActionOutcome,
	OrderImportPanelFilePreview,
	OrderImportPanelInput,
	OrderImportPanelProgress,
	OrderImportPanelSettings,
} from './order-import-panel';

export const ORDER_IMPORT_IFRAME_ID = 'jlceda-order-import-panel';
export const ORDER_IMPORT_IFRAME_PATH = '/iframe/order-import.html';
export const ORDER_IMPORT_REQUEST_KEY = 'order-import-panel.v1.request';
export const ORDER_IMPORT_EVENT_KEY = 'order-import-panel.v1.event';
export const ORDER_IMPORT_RESPONSE_KEY = 'order-import-panel.v1.response';
export const ORDER_IMPORT_PROTOCOL_VERSION = 1;

const LABEL_KEYS = [
	'title',
	'settingsTitle',
	'defaultState',
	'inStock',
	'depleted',
	'strategy',
	'add',
	'replace',
	'skip',
	'generatePreview',
	'previewTitle',
	'fileName',
	'orderNumber',
	'rows',
	'quantity',
	'status',
	'changes',
	'ready',
	'duplicate',
	'added',
	'merged',
	'skipped',
	'orderNumberMissing',
	'duplicateHistoricalFingerprint',
	'duplicateHistoricalOrder',
	'duplicateBatchFingerprint',
	'duplicateBatchOrder',
	'allFilesDuplicate',
	'confirmImport',
	'backToSettings',
	'progressTitle',
	'phaseParsing',
	'phaseModelMatching',
	'phaseWriting',
	'progressStatus',
	'completedTitle',
	'completedSummary',
	'cancel',
	'done',
	'operationError',
	'loading',
	'connectionError',
] as const;

export type OrderImportLabels = Record<typeof LABEL_KEYS[number], string>;
export type OrderImportPanelStage = 'panel-rendered' | 'request-read' | 'script-started';

export interface IFrameOrderImportRequest {
	protocolVersion: 1;
	requestId: string;
	labels: OrderImportLabels;
	files: Array<{ name: string }>;
}

export type IFrameOrderImportEvent
	= | { protocolVersion: 1; requestId: string; status: 'ready' }
		| { protocolVersion: 1; requestId: string; status: 'progress'; stage: OrderImportPanelStage }
		| { protocolVersion: 1; requestId: string; status: 'failed'; stage: OrderImportPanelStage; errorName: string; error: string }
		| { protocolVersion: 1; requestId: string; status: 'cancelled' | 'done'; operationId: string }
		| {
			protocolVersion: 1;
			requestId: string;
			status: 'action';
			operationId: string;
			action: 'import' | 'preview';
			settings: OrderImportPanelSettings;
			previewToken?: string;
		};

export type IFrameOrderImportResponse
	= | {
		protocolVersion: 1;
		requestId: string;
		operationId: string;
		sequence: number;
		stage: 'progress';
		progress: OrderImportPanelProgress;
	}
	| {
		protocolVersion: 1;
		requestId: string;
		operationId: string;
		sequence: number;
		stage: 'preview';
		previewToken: string;
		preview: { files: OrderImportPanelFilePreview[]; added: number; merged: number; skipped: number };
	}
	| {
		protocolVersion: 1;
		requestId: string;
		operationId: string;
		sequence: number;
		stage: 'completed';
		summary: { importedFiles: number; duplicateFiles: number; added: number; merged: number; skipped: number };
	}
	| {
		protocolVersion: 1;
		requestId: string;
		operationId: string;
		sequence: number;
		stage: 'failed';
		message: string;
	};

export function createOrderImportRequest(
	requestId: string,
	labels: OrderImportLabels,
	input: OrderImportPanelInput,
): IFrameOrderImportRequest {
	return {
		protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
		requestId,
		labels: { ...labels },
		files: input.files.slice(0, 100).map(file => ({ name: file.name.trim().slice(0, 255) })),
	};
}

export function parseIFrameOrderImportRequest(value: unknown): IFrameOrderImportRequest | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== ORDER_IMPORT_PROTOCOL_VERSION
		|| !isNonEmptyText(value.requestId, 200)
		|| !isLabels(value.labels)
		|| !Array.isArray(value.files)
		|| value.files.length === 0
		|| value.files.length > 100
		|| !value.files.every(file => isRecord(file) && isNonEmptyText(file.name, 255))) {
		return undefined;
	}
	return {
		protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION,
		requestId: value.requestId,
		labels: { ...value.labels },
		files: value.files.map(file => ({ name: String(file.name) })),
	};
}

export function parseIFrameOrderImportEvent(value: unknown, requestId: string): IFrameOrderImportEvent | undefined {
	if (!isRecord(value) || value.protocolVersion !== ORDER_IMPORT_PROTOCOL_VERSION || value.requestId !== requestId) {
		return undefined;
	}
	const base = { protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION, requestId } as const;
	if (value.status === 'ready') {
		return { ...base, status: 'ready' };
	}
	if (value.status === 'progress' && isPanelStage(value.stage)) {
		return { ...base, status: 'progress', stage: value.stage };
	}
	if (value.status === 'failed' && isPanelStage(value.stage) && isText(value.errorName, 100) && isText(value.error, 500)) {
		return { ...base, status: 'failed', stage: value.stage, errorName: value.errorName, error: value.error };
	}
	if ((value.status === 'cancelled' || value.status === 'done') && isNonEmptyText(value.operationId, 200)) {
		return { ...base, status: value.status, operationId: value.operationId };
	}
	if (value.status === 'action'
		&& isNonEmptyText(value.operationId, 200)
		&& (value.action === 'preview' || value.action === 'import')
		&& isSettings(value.settings)
		&& (value.previewToken === undefined || isNonEmptyText(value.previewToken, 500))
		&& (value.action === 'preview' ? value.previewToken === undefined : isNonEmptyText(value.previewToken, 500))) {
		return {
			...base,
			status: 'action',
			operationId: value.operationId,
			action: value.action,
			settings: { ...value.settings },
			previewToken: value.previewToken,
		};
	}
	return undefined;
}

export function parseIFrameOrderImportResponse(
	value: unknown,
	requestId: string,
	operationId: string,
): IFrameOrderImportResponse | undefined {
	if (!isRecord(value)
		|| value.protocolVersion !== ORDER_IMPORT_PROTOCOL_VERSION
		|| value.requestId !== requestId
		|| value.operationId !== operationId
		|| !isSafeNonNegativeInteger(value.sequence)) {
		return undefined;
	}
	const base = { protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION, requestId, operationId, sequence: value.sequence } as const;
	if (value.stage === 'progress' && isProgress(value.progress)) {
		return { ...base, stage: 'progress', progress: { ...value.progress } };
	}
	if (value.stage === 'preview'
		&& isNonEmptyText(value.previewToken, 500)
		&& isPreview(value.preview)) {
		return {
			...base,
			stage: 'preview',
			previewToken: value.previewToken,
			preview: { ...value.preview, files: value.preview.files.map(file => ({ ...file })) },
		};
	}
	if (value.stage === 'completed' && isCompletedSummary(value.summary)) {
		return { ...base, stage: 'completed', summary: { ...value.summary } };
	}
	if (value.stage === 'failed' && isNonEmptyText(value.message, 1000)) {
		return { ...base, stage: 'failed', message: value.message };
	}
	return undefined;
}

export function orderImportOutcomeResponse(
	requestId: string,
	operationId: string,
	sequence: number,
	outcome: OrderImportPanelActionOutcome,
): IFrameOrderImportResponse {
	return { protocolVersion: ORDER_IMPORT_PROTOCOL_VERSION, requestId, operationId, sequence, ...outcome };
}

function isLabels(value: unknown): value is OrderImportLabels {
	return isRecord(value) && LABEL_KEYS.every(key => isText(value[key], 1000));
}

function isSettings(value: unknown): value is OrderImportPanelSettings {
	return isRecord(value)
		&& (value.defaultState === 'in-stock' || value.defaultState === 'depleted')
		&& (value.strategy === 'add' || value.strategy === 'replace' || value.strategy === 'skip');
}

function isProgress(value: unknown): value is OrderImportPanelProgress {
	return isRecord(value)
		&& (value.phase === 'parsing' || value.phase === 'model-matching' || value.phase === 'writing')
		&& isSafeNonNegativeInteger(value.completed)
		&& isSafeNonNegativeInteger(value.total)
		&& value.completed <= value.total
		&& (value.message === undefined || isText(value.message, 1000));
}

function isPreview(value: unknown): value is { files: OrderImportPanelFilePreview[]; added: number; merged: number; skipped: number } {
	return isRecord(value)
		&& Array.isArray(value.files)
		&& value.files.length <= 100
		&& value.files.every(isFilePreview)
		&& isSafeNonNegativeInteger(value.added)
		&& isSafeNonNegativeInteger(value.merged)
		&& isSafeNonNegativeInteger(value.skipped);
}

function isFilePreview(value: unknown): value is OrderImportPanelFilePreview {
	return isRecord(value)
		&& isNonEmptyText(value.fileName, 255)
		&& (value.orderNumber === undefined || isText(value.orderNumber, 64))
		&& isSafeNonNegativeInteger(value.rowCount)
		&& isSafeNonNegativeInteger(value.totalQuantity)
		&& (value.status === 'ready' || value.status === 'duplicate')
		&& (value.duplicateReason === undefined || isDuplicateReason(value.duplicateReason))
		&& (value.duplicateImportedAt === undefined || isText(value.duplicateImportedAt, 100))
		&& isSafeNonNegativeInteger(value.added)
		&& isSafeNonNegativeInteger(value.merged)
		&& isSafeNonNegativeInteger(value.skipped);
}

function isCompletedSummary(value: unknown): value is { importedFiles: number; duplicateFiles: number; added: number; merged: number; skipped: number } {
	return isRecord(value)
		&& ['importedFiles', 'duplicateFiles', 'added', 'merged', 'skipped'].every(key => isSafeNonNegativeInteger(value[key]));
}

function isDuplicateReason(value: unknown): boolean {
	return value === 'historical-fingerprint' || value === 'historical-order-number' || value === 'batch-fingerprint' || value === 'batch-order-number';
}

function isPanelStage(value: unknown): value is OrderImportPanelStage {
	return value === 'script-started' || value === 'request-read' || value === 'panel-rendered';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isText(value: unknown, maximumLength: number): value is string {
	return typeof value === 'string' && value.length <= maximumLength;
}

function isNonEmptyText(value: unknown, maximumLength: number): value is string {
	return isText(value, maximumLength) && value.length > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
