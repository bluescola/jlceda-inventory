import type { InventoryDocument } from '../../../features/inventory/domain/inventory-document';
import type { InventoryRepository } from '../../../features/inventory/ports/inventory-repository';
import { cloneInventoryDocument } from '../../../features/inventory/domain/inventory-document';

export const AUTOMATIC_BACKUP_SETTINGS_KEY = 'inventory.v1.auto-backup.settings';
export const AUTOMATIC_BACKUP_DIRECTORY_NAME = 'JLCEDA-Inventory';
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
		| { status: 'succeeded'; completedAt: string }
		| { status: 'failed'; attemptedAt: string; failure: AutomaticBackupFailure };

export interface AutomaticInventoryBackup {
	getSettings: () => AutomaticBackupSettings;
	getDefaultFolder: () => Promise<string | undefined>;
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
	getDocumentsPath?: () => Promise<string>;
	getClientDocumentsPath?: () => Promise<string | undefined>;
	createDirectory?: (folderPath: string) => Promise<boolean>;
}

export class InvalidAutomaticBackupFolderError extends TypeError {}

export class EdaAutomaticInventoryBackup implements AutomaticInventoryBackup {
	private pendingDocument?: InventoryDocument;
	private pendingBackup?: Promise<AutomaticBackupResult>;

	public constructor(
		private readonly host: AutomaticBackupHost = createAutomaticBackupHost(),
		private readonly now: () => string = () => new Date().toISOString(),
	) {}

	public getSettings(): AutomaticBackupSettings {
		return sanitizeAutomaticBackupSettings(this.host.readSettings());
	}

	public async getDefaultFolder(): Promise<string | undefined> {
		if (!this.host.getDocumentsPath) {
			return undefined;
		}
		const hostPath = await this.host.getDocumentsPath();
		let documentsPath: string;
		try {
			documentsPath = normalizeBackupFolderPath(hostPath);
		}
		catch (error) {
			if (!(error instanceof InvalidAutomaticBackupFolderError) || !this.host.getClientDocumentsPath) {
				throw error;
			}
			documentsPath = normalizeBackupFolderPath(await this.host.getClientDocumentsPath() ?? '');
		}
		return appendFileSystemPath(documentsPath, AUTOMATIC_BACKUP_DIRECTORY_NAME);
	}

	public async prepareBackupPath(folderPath: string): Promise<string> {
		const normalizedFolder = normalizeBackupFolderPath(folderPath);
		if (!this.host.createDirectory) {
			throw new Error('The automatic backup directory API is unavailable.');
		}
		if (!await this.host.createDirectory(normalizedFolder)) {
			throw new Error('The host rejected the automatic backup directory creation.');
		}
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
		this.pendingBackup ??= this.drainPendingBackups();
		return this.pendingBackup;
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
		let failure: AutomaticBackupFailure | undefined;
		if (!this.host.writeFile) {
			failure = 'api-unavailable';
		}
		else {
			try {
				const normalizedPath = normalizeBackupPath(path ?? '');
				const contents = new Blob([JSON.stringify(document, undefined, 2)], { type: 'application/json;charset=utf-8' });
				if (!await this.host.writeFile(normalizedPath, contents)) {
					failure = 'host-rejected';
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
			return { status: 'failed', attemptedAt, failure: 'settings-storage-failed' };
		}
		return failure
			? { status: 'failed', attemptedAt, failure }
			: { status: 'succeeded', completedAt: attemptedAt };
	}
}

export class AutomaticBackupInventoryRepository implements InventoryRepository {
	public constructor(
		private readonly primary: InventoryRepository,
		private readonly backup: AutomaticInventoryBackup,
		private readonly onBackupResult?: (result: AutomaticBackupResult) => void,
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
				failure: 'write-failed',
			};
		}
		try {
			this.onBackupResult?.(result);
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
	let externalInteractionConfirmed = false;
	const getDocumentsPath = typeof fileSystem?.getDocumentsPath === 'function'
		? async () => {
			const path = await fileSystem.getDocumentsPath();
			externalInteractionConfirmed = true;
			return path;
		}
		: undefined;
	const getClientDocumentsPath = typeof fetch === 'function'
		? () => externalInteractionConfirmed ? readDocumentsPathFromClientConfig() : Promise.resolve(undefined)
		: undefined;
	const createDirectory = typeof fileSystem?.createDirectoryInFileSystem === 'function'
		? async (folderPath: string) => {
			const created = await fileSystem.createDirectoryInFileSystem(folderPath);
			return created || (externalInteractionConfirmed && await createDirectoryThroughClientApi(folderPath));
		}
		: undefined;
	return {
		readSettings: () => eda.sys_Storage.getExtensionUserConfig(AUTOMATIC_BACKUP_SETTINGS_KEY),
		writeSettings: settings => eda.sys_Storage.setExtensionUserConfig(AUTOMATIC_BACKUP_SETTINGS_KEY, settings),
		writeFile: typeof fileSystem?.saveFileToFileSystem === 'function'
			? (path, contents) => fileSystem.saveFileToFileSystem(path, contents, undefined, true)
			: undefined,
		getDocumentsPath,
		getClientDocumentsPath,
		createDirectory,
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

async function readDocumentsPathFromClientConfig(): Promise<string | undefined> {
	try {
		const response = await fetch('app://api/client/config', {
			cache: 'no-cache',
			priority: 'high',
			redirect: 'follow',
		});
		if (!response.ok) {
			return undefined;
		}
		return extractDocumentsPathFromClientConfig(await response.json());
	}
	catch {
		return undefined;
	}
}

async function createDirectoryThroughClientApi(folderPath: string): Promise<boolean> {
	try {
		const response = await fetch('app://api/client/mkdirSync', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path: folderPath }),
		});
		if (!response.ok) {
			return false;
		}
		const result: unknown = await response.json();
		return isRecord(result) && result.status === true;
	}
	catch {
		return false;
	}
}

export function extractDocumentsPathFromClientConfig(value: unknown): string | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	if (typeof value.documents === 'string') {
		return value.documents;
	}
	return isRecord(value.result) && typeof value.result.documents === 'string'
		? value.result.documents
		: undefined;
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
