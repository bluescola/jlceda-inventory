import type { Translate } from '../eda/i18n-client';

export type DiagnosticDetails = Record<string, boolean | number | string | undefined>;

export interface DiagnosticTrace {
	info: (event: string, details?: DiagnosticDetails) => void;
	warn: (event: string, details?: DiagnosticDetails) => void;
	error: (event: string, details?: DiagnosticDetails) => void;
	waitFor: <T>(step: string, operation: () => Promise<T>) => Promise<T>;
}

export interface Diagnostics {
	start: (operation: string, reveal?: boolean) => DiagnosticTrace;
	show: () => Promise<void>;
	flush: () => Promise<void>;
	exportDocument: () => Promise<DiagnosticLogDocument>;
}

const LOG_PREFIX = '[Component Inventory]';
const WAIT_WARNING_MS = 15_000;
const DIAGNOSTIC_STORAGE_KEY = 'diagnostics.v1.document';
const VERBOSE_ENTRY_LIMIT = 500;
const SIMPLIFIED_ENTRY_LIMIT = 150;
const VERBOSE_BYTE_LIMIT = 512 * 1024;
const SIMPLIFIED_BYTE_LIMIT = 128 * 1024;
const DETAIL_VALUE_LIMIT = 512;

declare const __DIAGNOSTICS_VERBOSE__: boolean;

export interface DiagnosticLogEntry {
	timestamp: string;
	traceId: string;
	operation: string;
	level: 'error' | 'info' | 'warn';
	event: string;
	elapsedMs: number;
	details?: DiagnosticDetails;
}

export interface DiagnosticLogDocument {
	schemaVersion: 1;
	extensionVersion: string;
	mode: 'simplified' | 'verbose';
	updatedAt: string;
	entries: DiagnosticLogEntry[];
}

export class NativeDiagnostics implements Diagnostics {
	private sequence = 0;
	private readonly mode: DiagnosticLogDocument['mode'];
	private readonly store: DiagnosticLogStore;

	public constructor(
		private readonly t: Translate,
		extensionVersion: string,
		mode: DiagnosticLogDocument['mode'] = diagnosticsMode(),
	) {
		this.mode = mode;
		this.store = new DiagnosticLogStore(extensionVersion, this.mode);
	}

	public start(operation: string, reveal = true): DiagnosticTrace {
		const id = `${Date.now().toString(36)}-${++this.sequence}`;
		const trace = new EdaDiagnosticTrace(id, operation, this.mode, this.store);
		trace.info('workflow.start', { mode: this.mode, version: this.store.extensionVersion });
		if (reveal) {
			this.showStartedMessage();
			void this.openLogPanel().catch(() => undefined);
		}
		return trace;
	}

	public async show(): Promise<void> {
		await this.openLogPanel();
		this.showOpenedMessage();
	}

	public exportDocument(): Promise<DiagnosticLogDocument> {
		return this.store.exportDocument();
	}

	public flush(): Promise<void> {
		return this.store.flush();
	}

	private async openLogPanel(): Promise<void> {
		eda.sys_PanelControl.openBottomPanel('log' as ESYS_BottomPanelTab);
		await eda.sys_Log.find(LOG_PREFIX);
	}

	private showOpenedMessage(): void {
		try {
			eda.sys_Message.showToastMessage(
				this.t('diagnostics.opened'),
				'info' as ESYS_ToastMessageType,
				3,
				'log' as ESYS_BottomPanelTab,
			);
		}
		catch {
			// The log panel is still usable when the host cannot show a toast.
		}
	}

	private showStartedMessage(): void {
		try {
			eda.sys_Message.showToastMessage(
				this.t('diagnostics.started'),
				'info' as ESYS_ToastMessageType,
				5,
				'log' as ESYS_BottomPanelTab,
			);
		}
		catch {
			// Diagnostics must never prevent the inventory workflow from running.
		}
	}
}

class EdaDiagnosticTrace implements DiagnosticTrace {
	private readonly startedAt = Date.now();

	public constructor(
		private readonly id: string,
		private readonly operation: string,
		private readonly mode: DiagnosticLogDocument['mode'],
		private readonly store: DiagnosticLogStore,
	) {}

	public info(event: string, details?: DiagnosticDetails): void {
		this.add(event, 'info', details);
	}

	public warn(event: string, details?: DiagnosticDetails): void {
		this.add(event, 'warn', details);
	}

	public error(event: string, details?: DiagnosticDetails): void {
		this.add(event, 'error', details);
	}

	public async waitFor<T>(step: string, operation: () => Promise<T>): Promise<T> {
		const stepStartedAt = Date.now();
		this.info('wait.start', { step });
		const warningTimer = setTimeout(() => {
			this.warn('wait.pending', { elapsedMs: Date.now() - stepStartedAt, step });
		}, WAIT_WARNING_MS);
		try {
			const result = await operation();
			this.info('wait.complete', { elapsedMs: Date.now() - stepStartedAt, step });
			return result;
		}
		catch (error) {
			this.error('wait.error', { error: errorMessage(error), step });
			throw error;
		}
		finally {
			clearTimeout(warningTimer);
		}
	}

	private add(event: string, type: DiagnosticLogEntry['level'], details?: DiagnosticDetails): void {
		const elapsedMs = Date.now() - this.startedAt;
		const persistedDetails = this.mode === 'verbose' ? details : simplifyDetails(details, type);
		const message = `${LOG_PREFIX}[${this.id}][${this.operation}] +${elapsedMs}ms ${event}${formatDetails(persistedDetails)}`;
		try {
			eda.sys_Log.add(message, type as ESYS_LogType);
		}
		catch {
			console.warn(message);
		}
		this.store.append({
			timestamp: new Date().toISOString(),
			traceId: this.id,
			operation: this.operation,
			level: type,
			event,
			elapsedMs,
			details: persistedDetails,
		});
	}
}

class DiagnosticLogStore {
	private writeQueue = Promise.resolve();

	public constructor(
		public readonly extensionVersion: string,
		private readonly mode: DiagnosticLogDocument['mode'],
	) {}

	public append(entry: DiagnosticLogEntry): void {
		this.writeQueue = this.writeQueue
			.then(async () => {
				const document = this.load();
				document.mode = this.mode;
				document.extensionVersion = this.extensionVersion;
				document.updatedAt = entry.timestamp;
				document.entries.push(sanitizeEntry(entry));
				trimDocument(document);
				const saved = await eda.sys_Storage.setExtensionUserConfig(DIAGNOSTIC_STORAGE_KEY, document);
				if (!saved) {
					throw new Error('The host rejected the diagnostic log write.');
				}
			})
			.catch(error => console.error(`${LOG_PREFIX} Failed to persist diagnostics: ${errorMessage(error)}`));
	}

	public async exportDocument(): Promise<DiagnosticLogDocument> {
		await this.flush();
		return this.load();
	}

	public flush(): Promise<void> {
		return this.writeQueue;
	}

	private load(): DiagnosticLogDocument {
		try {
			const stored = eda.sys_Storage.getExtensionUserConfig(DIAGNOSTIC_STORAGE_KEY) as Partial<DiagnosticLogDocument> | undefined;
			if (stored?.schemaVersion === 1 && Array.isArray(stored.entries)) {
				return {
					schemaVersion: 1,
					extensionVersion: typeof stored.extensionVersion === 'string' ? stored.extensionVersion : this.extensionVersion,
					mode: stored.mode === 'verbose' ? 'verbose' : 'simplified',
					updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : new Date(0).toISOString(),
					entries: stored.entries.filter(isDiagnosticLogEntry).map(sanitizeEntry),
				};
			}
		}
		catch (error) {
			console.error(`${LOG_PREFIX} Failed to read persisted diagnostics: ${errorMessage(error)}`);
		}
		return {
			schemaVersion: 1,
			extensionVersion: this.extensionVersion,
			mode: this.mode,
			updatedAt: new Date(0).toISOString(),
			entries: [],
		};
	}
}

function formatDetails(details?: DiagnosticDetails): string {
	if (!details) {
		return '';
	}
	const fields = Object.entries(details)
		.filter((entry): entry is [string, boolean | number | string] => entry[1] !== undefined)
		.map(([key, value]) => `${key}=${sanitizeDetailValue(value)}`);
	return fields.length > 0 ? ` ${fields.join(' ')}` : '';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function diagnosticsMode(): DiagnosticLogDocument['mode'] {
	return typeof __DIAGNOSTICS_VERBOSE__ === 'boolean' && __DIAGNOSTICS_VERBOSE__ ? 'verbose' : 'simplified';
}

function simplifyDetails(details: DiagnosticDetails | undefined, type: DiagnosticLogEntry['level']): DiagnosticDetails | undefined {
	if (!details) {
		return undefined;
	}
	// Keep field identity and lengths only — never field contents — so release
	// builds can still prove whether multi-field input/submit fired.
	const keys = type === 'error'
		? ['attempts', 'changedFields', 'elapsedMs', 'error', 'errorName', 'failure', 'field', 'length', 'mode', 'opened', 'reason', 'returnedType', 'revision', 'stage', 'status', 'step', 'version']
		: [
				'attempts',
				'changedFields',
				'descriptionLength',
				'elapsedMs',
				'errorName',
				'failure',
				'field',
				'height',
				'iframeId',
				'length',
				'manufacturerLength',
				'manufacturerPartNumberLength',
				'mode',
				'nameLength',
				'opened',
				'packageLength',
				'path',
				'pathKind',
				'pathLength',
				'reason',
				'returnedType',
				'revision',
				'stage',
				'status',
				'step',
				'version',
				'width',
			];
	const simplified = Object.fromEntries(keys.map(key => [key, sanitizeDetail(details[key])]));
	return Object.values(simplified).some(value => value !== undefined) ? simplified : undefined;
}

function isDiagnosticLogEntry(value: unknown): value is DiagnosticLogEntry {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const entry = value as Partial<DiagnosticLogEntry>;
	return typeof entry.timestamp === 'string'
		&& typeof entry.traceId === 'string'
		&& typeof entry.operation === 'string'
		&& (entry.level === 'error' || entry.level === 'info' || entry.level === 'warn')
		&& typeof entry.event === 'string'
		&& typeof entry.elapsedMs === 'number';
}

function sanitizeEntry(entry: DiagnosticLogEntry): DiagnosticLogEntry {
	return {
		...entry,
		details: entry.details
			? Object.fromEntries(Object.entries(entry.details).map(([key, value]) => [key, sanitizeDetail(value)]))
			: undefined,
	};
}

function sanitizeDetail(value: DiagnosticDetails[string]): DiagnosticDetails[string] {
	return typeof value === 'string' ? sanitizeDetailValue(value) : value;
}

function sanitizeDetailValue(value: boolean | number | string): string {
	return String(value).replaceAll(/[\r\n]+/g, ' ').slice(0, DETAIL_VALUE_LIMIT);
}

function trimDocument(document: DiagnosticLogDocument): void {
	const entryLimit = document.mode === 'verbose' ? VERBOSE_ENTRY_LIMIT : SIMPLIFIED_ENTRY_LIMIT;
	const byteLimit = document.mode === 'verbose' ? VERBOSE_BYTE_LIMIT : SIMPLIFIED_BYTE_LIMIT;
	document.entries = document.entries.slice(-entryLimit);
	while (document.entries.length > 0 && byteLength(document) > byteLimit) {
		document.entries.shift();
	}
}

function byteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
