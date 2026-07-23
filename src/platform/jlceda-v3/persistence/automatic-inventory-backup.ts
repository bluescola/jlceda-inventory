import type { InventoryDocument } from '../../../features/inventory/domain/inventory-document';
import type { InventoryRepository } from '../../../features/inventory/ports/inventory-repository';
import { cloneInventoryDocument } from '../../../features/inventory/domain/inventory-document';

export const AUTOMATIC_BACKUP_SETTINGS_KEY = 'inventory.v1.auto-backup.settings';
export const AUTOMATIC_BACKUP_FILE_NAME = 'jlceda-inventory-latest.json';
export const MAXIMUM_BACKUP_PATH_LENGTH = 4096;

export interface AutomaticBackupSettings {
	enabled: boolean;
	path?: string;
	lastAttemptAt?: string;
	lastSucceededAt?: string;
	lastFailure?: AutomaticBackupFailure;
}

export type AutomaticBackupFailure
	= | 'api-unavailable'
		| 'host-rejected'
		| 'settings-storage-failed'
		| 'write-failed';

export type AutomaticBackupResult
	= | { status: 'disabled' }
		| { status: 'succeeded'; attempts?: number; completedAt: string }
		| { status: 'failed'; attemptedAt: string; attempts?: number; failure: AutomaticBackupFailure };

export interface AutomaticInventoryBackup {
	getSettings: () => AutomaticBackupSettings;
	selectFolder: () => Promise<string | undefined>;
	prepareBackupPath: (folderPath: string) => Promise<string>;
	configure: (path: string) => Promise<AutomaticBackupSettings>;
	disable: () => Promise<AutomaticBackupSettings>;
	test: (document: InventoryDocument, path?: string) => Promise<AutomaticBackupResult>;
	backupAfterSave: (document: InventoryDocument) => Promise<AutomaticBackupResult>;
}

export interface AutomaticBackupHost {
	readSettings: () => unknown;
	writeSettings: (settings: AutomaticBackupSettings) => Promise<boolean>;
	writeFile?: (path: string, contents: Blob) => Promise<boolean>;
	selectFolder?: () => Promise<string | undefined>;
}

export interface AutomaticBackupClientResponse {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
}

export type AutomaticBackupClientRequest = (
	url: string,
	method: 'POST',
	data: string,
) => Promise<AutomaticBackupClientResponse>;

export type AutomaticBackupFolderPickerStage
	= | 'host-result'
		| 'http-response'
		| 'request'
		| 'response-body';

export class AutomaticBackupFolderPickerError extends Error {
	public constructor(
		message: string,
		public readonly stage: AutomaticBackupFolderPickerStage = 'host-result',
	) {
		super(message);
		this.name = 'AutomaticBackupFolderPickerError';
	}
}
export class InvalidAutomaticBackupFolderError extends TypeError {}

export class EdaAutomaticInventoryBackup implements AutomaticInventoryBackup {
	private pendingDocument?: InventoryDocument;
	private pendingBackup?: Promise<AutomaticBackupResult>;
	private pendingFolderSelection?: Promise<string | undefined>;

	public constructor(
		private readonly host: AutomaticBackupHost = createAutomaticBackupHost(),
		private readonly now: () => string = () => new Date().toISOString(),
		private readonly waitBeforeRetry: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 150)),
	) {}

	public getSettings(): AutomaticBackupSettings {
		return sanitizeAutomaticBackupSettings(this.host.readSettings());
	}

	public selectFolder(): Promise<string | undefined> {
		if (!this.host.selectFolder) {
			return Promise.reject(new Error('The host does not provide a native backup folder picker.'));
		}
		this.pendingFolderSelection ??= this.selectFolderOnce();
		return this.pendingFolderSelection;
	}

	public async prepareBackupPath(folderPath: string): Promise<string> {
		const normalizedFolder = normalizeBackupFolderPath(folderPath);
		return appendFileSystemPath(normalizedFolder, AUTOMATIC_BACKUP_FILE_NAME);
	}

	public async configure(path: string): Promise<AutomaticBackupSettings> {
		const normalizedPath = normalizeBackupPath(path);
		const settings = { ...this.getSettings(), enabled: true, path: normalizedPath };
		if (!await this.host.writeSettings(settings)) {
			throw new Error('The host rejected the automatic backup settings.');
		}
		return settings;
	}

	public async disable(): Promise<AutomaticBackupSettings> {
		const settings = { ...this.getSettings(), enabled: false };
		if (!await this.host.writeSettings(settings)) {
			throw new Error('The host rejected the automatic backup settings.');
		}
		return settings;
	}

	public test(document: InventoryDocument, path = this.getSettings().path): Promise<AutomaticBackupResult> {
		return this.writeBackup(document, path);
	}

	public backupAfterSave(document: InventoryDocument): Promise<AutomaticBackupResult> {
		this.pendingDocument = cloneInventoryDocument(document);
		// Defer the drain until pendingBackup has been assigned. The disabled branch
		// has no await, so starting it inline would clear pendingBackup and then
		// immediately overwrite that clear with an already-resolved Promise.
		this.pendingBackup ??= Promise.resolve().then(() => this.drainPendingBackups());
		return this.pendingBackup;
	}

	private async selectFolderOnce(): Promise<string | undefined> {
		try {
			const selectedFolder = await this.host.selectFolder!();
			return selectedFolder === undefined ? undefined : normalizeBackupFolderPath(selectedFolder);
		}
		finally {
			this.pendingFolderSelection = undefined;
		}
	}

	private async drainPendingBackups(): Promise<AutomaticBackupResult> {
		let result: AutomaticBackupResult = { status: 'disabled' };
		try {
			while (this.pendingDocument) {
				const document = this.pendingDocument;
				this.pendingDocument = undefined;
				const settings = this.getSettings();
				result = settings.enabled
					? await this.writeBackup(document, settings.path)
					: { status: 'disabled' };
			}
			return result;
		}
		finally {
			this.pendingBackup = undefined;
		}
	}

	private async writeBackup(document: InventoryDocument, path: string | undefined): Promise<AutomaticBackupResult> {
		const attemptedAt = this.now();
		let attempts = 0;
		let failure: AutomaticBackupFailure | undefined;
		if (!this.host.writeFile) {
			failure = 'api-unavailable';
		}
		else {
			try {
				const normalizedPath = normalizeBackupPath(path ?? '');
				const contents = new Blob([JSON.stringify(document, undefined, 2)], { type: 'application/json;charset=utf-8' });
				attempts = 1;
				failure = await this.tryWriteBackup(normalizedPath, contents);
				if (failure) {
					await this.waitBeforeRetry();
					attempts = 2;
					failure = await this.tryWriteBackup(normalizedPath, contents);
				}
			}
			catch {
				failure = 'write-failed';
			}
		}

		const settings = this.getSettings();
		const next: AutomaticBackupSettings = {
			...settings,
			lastAttemptAt: attemptedAt,
		};
		if (failure) {
			next.lastFailure = failure;
		}
		else {
			next.lastSucceededAt = attemptedAt;
			delete next.lastFailure;
		}
		if (!await this.host.writeSettings(next)) {
			return { status: 'failed', attemptedAt, attempts, failure: 'settings-storage-failed' };
		}
		return failure
			? { status: 'failed', attemptedAt, attempts, failure }
			: { status: 'succeeded', attempts, completedAt: attemptedAt };
	}

	private async tryWriteBackup(path: string, contents: Blob): Promise<AutomaticBackupFailure | undefined> {
		try {
			return await this.host.writeFile!(path, contents) ? undefined : 'host-rejected';
		}
		catch {
			return 'write-failed';
		}
	}
}

export class AutomaticBackupInventoryRepository implements InventoryRepository {
	public constructor(
		private readonly primary: InventoryRepository,
		private readonly backup: AutomaticInventoryBackup,
		private readonly onBackupResult?: (result: AutomaticBackupResult, revision: number) => void,
	) {}

	public load(): Promise<InventoryDocument> {
		return this.primary.load();
	}

	public loadRecoverySnapshot(): Promise<InventoryDocument | undefined> {
		return this.primary.loadRecoverySnapshot
			? this.primary.loadRecoverySnapshot()
			: Promise.resolve(undefined);
	}

	public saveRecoverySnapshot(document: InventoryDocument): Promise<void> {
		if (!this.primary.saveRecoverySnapshot) {
			return Promise.reject(new Error('The inventory repository does not support recovery snapshots.'));
		}
		return this.primary.saveRecoverySnapshot(document);
	}

	public clearRecoverySnapshot(): Promise<void> {
		if (!this.primary.clearRecoverySnapshot) {
			return Promise.reject(new Error('The inventory repository does not support clearing recovery snapshots.'));
		}
		return this.primary.clearRecoverySnapshot();
	}

	public async save(document: InventoryDocument, expectedRevision?: number): Promise<void> {
		await this.primary.save(document, expectedRevision);
		let result: AutomaticBackupResult;
		try {
			result = await this.backup.backupAfterSave(document);
		}
		catch {
			result = {
				status: 'failed',
				attemptedAt: new Date().toISOString(),
				attempts: 0,
				failure: 'write-failed',
			};
		}
		try {
			this.onBackupResult?.(result, document.revision);
		}
		catch {
			// A notification failure must not turn an already committed primary save into a failed operation.
		}
	}
}

export function sanitizeAutomaticBackupSettings(value: unknown): AutomaticBackupSettings {
	if (!isRecord(value)) {
		return { enabled: false };
	}
	const path = typeof value.path === 'string' && value.path.length <= MAXIMUM_BACKUP_PATH_LENGTH
		? value.path.trim() || undefined
		: undefined;
	const lastFailure = isAutomaticBackupFailure(value.lastFailure) ? value.lastFailure : undefined;
	return {
		enabled: value.enabled === true && Boolean(path),
		path,
		lastAttemptAt: optionalTimestamp(value.lastAttemptAt),
		lastSucceededAt: optionalTimestamp(value.lastSucceededAt),
		lastFailure,
	};
}

function createAutomaticBackupHost(): AutomaticBackupHost {
	const fileSystem = typeof eda === 'undefined' ? undefined : eda.sys_FileSystem;
	const clientUrl = typeof eda === 'undefined' ? undefined : eda.sys_ClientUrl;
	const selectFolder = typeof fileSystem?.getDocumentsPath === 'function' && typeof clientUrl?.request === 'function'
		? async () => {
			const documentsPath = await fileSystem.getDocumentsPath();
			return selectDirectoryThroughClientApi(
				typeof documentsPath === 'string' ? documentsPath : '',
				(url, method, data) => clientUrl.request(url, method, data),
			);
		}
		: undefined;
	return {
		readSettings: () => eda.sys_Storage.getExtensionUserConfig(AUTOMATIC_BACKUP_SETTINGS_KEY),
		writeSettings: settings => eda.sys_Storage.setExtensionUserConfig(AUTOMATIC_BACKUP_SETTINGS_KEY, settings),
		writeFile: typeof fileSystem?.saveFileToFileSystem === 'function'
			? (path, contents) => fileSystem.saveFileToFileSystem(path, contents, undefined, true)
			: undefined,
		selectFolder,
	};
}

function normalizeBackupFolderPath(folderPath: string): string {
	const suppliedPath = typeof folderPath === 'string' ? folderPath.trim() : '';
	const normalized = suppliedPath.toLowerCase().startsWith('file:')
		? fileUrlToNativePath(suppliedPath)
		: suppliedPath;
	const isAbsolute = /^[A-Z]:[\\/]/i.test(normalized)
		|| normalized.startsWith('\\\\')
		|| normalized.startsWith('//')
		|| normalized.startsWith('/');
	if (
		!normalized
		|| !isAbsolute
		|| hasControlCharacter(normalized)
		|| normalized.length + AUTOMATIC_BACKUP_FILE_NAME.length + 1 > MAXIMUM_BACKUP_PATH_LENGTH
	) {
		throw new InvalidAutomaticBackupFolderError('EDA returned an unusable automatic backup folder path.');
	}
	return normalized;
}

function hasControlCharacter(value: string): boolean {
	return [...value].some(character => character.charCodeAt(0) < 32);
}

function appendFileSystemPath(folderPath: string, name: string): string {
	if (folderPath.endsWith('\\') || folderPath.endsWith('/')) {
		return `${folderPath}${name}`;
	}
	const lastForwardSlash = folderPath.lastIndexOf('/');
	const lastBackslash = folderPath.lastIndexOf('\\');
	const separator = lastBackslash > lastForwardSlash
		? '\\'
		: lastForwardSlash >= 0
			? '/'
			: /^[A-Z]:/i.test(folderPath) ? '\\' : '/';
	return `${folderPath}${separator}${name}`;
}

function fileUrlToNativePath(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	}
	catch {
		throw new InvalidAutomaticBackupFolderError('EDA returned a malformed file URL for the backup folder.');
	}
	if (
		url.protocol !== 'file:'
		|| url.username
		|| url.password
		|| url.port
		|| url.search
		|| url.hash
		|| /%(?:2f|5c)/i.test(url.pathname)
	) {
		throw new InvalidAutomaticBackupFolderError('EDA returned an unusable file URL for the backup folder.');
	}
	let pathname: string;
	try {
		pathname = decodeURIComponent(url.pathname);
	}
	catch {
		throw new InvalidAutomaticBackupFolderError('EDA returned a malformed file URL for the backup folder.');
	}
	if (url.hostname && url.hostname.toLowerCase() !== 'localhost') {
		return `\\\\${url.hostname}${pathname.replaceAll('/', '\\')}`;
	}
	if (/^\/[A-Z]:\//i.test(pathname)) {
		return pathname.slice(1).replaceAll('/', '\\');
	}
	return pathname;
}

export async function selectDirectoryThroughClientApi(
	defaultPath: string,
	request: AutomaticBackupClientRequest,
): Promise<string | undefined> {
	let response: AutomaticBackupClientResponse;
	try {
		response = await request(
			'app://api/client/openDir',
			'POST',
			JSON.stringify({ path: defaultPath }),
		);
	}
	catch (error) {
		throw new AutomaticBackupFolderPickerError(
			`The native backup folder picker request failed: ${pickerErrorSummary(error)}`,
			'request',
		);
	}
	if (!response.ok) {
		throw new AutomaticBackupFolderPickerError(
			`The native backup folder picker returned HTTP ${response.status}.`,
			'http-response',
		);
	}
	let value: unknown;
	try {
		value = await response.json();
	}
	catch (error) {
		throw new AutomaticBackupFolderPickerError(
			`The native backup folder picker returned an unreadable response: ${pickerErrorSummary(error)}`,
			'response-body',
		);
	}
	return extractSelectedDirectory(value);
}

export function extractSelectedDirectory(value: unknown): string | undefined {
	if (!isRecord(value)) {
		throw new AutomaticBackupFolderPickerError('The native backup folder picker returned invalid data.');
	}
	if (value.success === false) {
		throw new AutomaticBackupFolderPickerError('The native backup folder picker rejected the request.');
	}
	const result = isRecord(value.result) ? value.result : value;
	if (result.code === 0 && result.message === 'cancel') {
		return undefined;
	}
	if (result.code === 1 && typeof result.path === 'string' && result.path.trim()) {
		return result.path;
	}
	throw new AutomaticBackupFolderPickerError('The native backup folder picker returned invalid data.');
}

function normalizeBackupPath(path: string): string {
	const normalized = path.trim();
	if (!normalized || normalized.length > MAXIMUM_BACKUP_PATH_LENGTH || !normalized.toLowerCase().endsWith('.json')) {
		throw new TypeError('Automatic backup path must be a non-empty JSON file path.');
	}
	return normalized;
}

function optionalTimestamp(value: unknown): string | undefined {
	return typeof value === 'string' && value.length <= 100 && !Number.isNaN(Date.parse(value)) ? value : undefined;
}

function isAutomaticBackupFailure(value: unknown): value is AutomaticBackupFailure {
	return value === 'api-unavailable'
		|| value === 'host-rejected'
		|| value === 'settings-storage-failed'
		|| value === 'write-failed';
}

function isRecord(value: unknown): value is Record<string, any> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickerErrorSummary(error: unknown): string {
	const summary = error instanceof Error
		? `${error.name}: ${error.message}`
		: typeof error === 'string' ? error : 'unknown error';
	return summary.replaceAll('\r', ' ').replaceAll('\n', ' ').slice(0, 300);
}
