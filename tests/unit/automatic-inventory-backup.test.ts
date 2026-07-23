import type { InventoryRepository } from '../../src/features/inventory/ports/inventory-repository';
import type { AutomaticBackupHost } from '../../src/platform/jlceda-v3/persistence/automatic-inventory-backup';
import { describe, expect, it, vi } from 'vitest';
import { InventoryService } from '../../src/features/inventory/application/inventory-service';
import { cloneInventoryDocument, createEmptyInventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import {
	AutomaticBackupInventoryRepository,
	EdaAutomaticInventoryBackup,
	extractSelectedDirectory,
	sanitizeAutomaticBackupSettings,
	selectDirectoryThroughClientApi,
} from '../../src/platform/jlceda-v3/persistence/automatic-inventory-backup';

function createHost(initial: unknown = { enabled: true, path: 'C:\\backup\\inventory.json' }): AutomaticBackupHost & {
	settings: unknown;
	selectFolder: ReturnType<typeof vi.fn>;
	writeFile: ReturnType<typeof vi.fn>;
	writeSettings: ReturnType<typeof vi.fn>;
} {
	const host = {
		settings: initial,
		readSettings: () => host.settings,
		writeSettings: vi.fn(async (settings) => {
			host.settings = settings;
			return true;
		}),
		writeFile: vi.fn(async () => true),
		selectFolder: vi.fn(async () => 'D:\\Inventory'),
	};
	return host;
}

describe('edaAutomaticInventoryBackup', () => {
	it('returns the native folder selection and appends the fixed JSON file name', async () => {
		const host = createHost({ enabled: false });
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.selectFolder()).resolves.toBe('D:\\Inventory');
		await expect(backup.prepareBackupPath('D:\\Inventory')).resolves.toBe('D:\\Inventory\\jlceda-inventory-latest.json');
	});

	it('returns no folder when the native picker is cancelled', async () => {
		const host = createHost({ enabled: false });
		host.selectFolder.mockResolvedValueOnce(undefined);
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.selectFolder()).resolves.toBeUndefined();
	});

	it('rejects when the host does not provide a native folder picker', async () => {
		const host = createHost({ enabled: false });
		delete (host as Partial<AutomaticBackupHost>).selectFolder;
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.selectFolder()).rejects.toThrow('does not provide');
	});

	it('shares one native picker request between concurrent setup attempts', async () => {
		const host = createHost({ enabled: false });
		let resolveSelection!: (path: string) => void;
		host.selectFolder.mockImplementationOnce(() => new Promise(resolve => resolveSelection = resolve));
		const backup = new EdaAutomaticInventoryBackup(host);

		const first = backup.selectFolder();
		const second = backup.selectFolder();
		resolveSelection('D:\\Inventory');

		await expect(Promise.all([first, second])).resolves.toEqual(['D:\\Inventory', 'D:\\Inventory']);
		expect(host.selectFolder).toHaveBeenCalledOnce();
	});

	it('converts a file URL selected by the host into the native path expected by the file APIs', async () => {
		const host = createHost({ enabled: false });
		host.selectFolder.mockResolvedValueOnce('file:///C:/Users/tester/My%20Documents');
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.selectFolder()).resolves.toBe('C:\\Users\\tester\\My Documents');
	});

	it('rejects an unusable automatic backup folder before touching the file system', async () => {
		const host = createHost({ enabled: false });
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.prepareBackupPath('relative-folder')).rejects.toThrow('unusable');
	});

	it('extracts selected and cancelled states from wrapped or direct native picker responses', () => {
		expect(extractSelectedDirectory({ success: true, result: { code: 1, path: 'C:\\Backups' } })).toBe('C:\\Backups');
		expect(extractSelectedDirectory({ code: 1, path: '/home/tester/backups' })).toBe('/home/tester/backups');
		expect(extractSelectedDirectory({ success: true, result: { code: 0, message: 'cancel' } })).toBeUndefined();
		expect(() => extractSelectedDirectory({ success: true, result: { code: 0, message: 'dialog failed' } })).toThrow('invalid data');
		expect(() => extractSelectedDirectory({ success: true, result: {} })).toThrow('invalid data');
	});

	it('uses SYS_ClientUrl request arguments expected by the client native picker', async () => {
		const request = vi.fn(async () => new Response(JSON.stringify({
			success: true,
			result: { code: 1, path: 'D:\\Inventory' },
		}), { status: 200 }));

		await expect(
			selectDirectoryThroughClientApi('C:\\Users\\tester\\Documents', request),
		)
			.resolves
			.toBe('D:\\Inventory');

		expect(request).toHaveBeenCalledWith(
			'app://api/client/openDir',
			'POST',
			JSON.stringify({ path: 'C:\\Users\\tester\\Documents' }),
		);
	});

	it('routes the production folder picker through SYS_ClientUrl after the desktop probe', async () => {
		const getDocumentsPath = vi.fn(async () => 'C:\\Users\\tester\\Documents');
		const request = vi.fn(async () => new Response(JSON.stringify({
			success: true,
			result: { code: 1, path: 'D:\\Inventory' },
		}), { status: 200 }));
		vi.stubGlobal('eda', {
			sys_ClientUrl: { request },
			sys_FileSystem: { getDocumentsPath },
			sys_Storage: {
				getExtensionUserConfig: vi.fn(),
				setExtensionUserConfig: vi.fn(),
			},
		});
		try {
			const backup = new EdaAutomaticInventoryBackup();

			await expect(backup.selectFolder()).resolves.toBe('D:\\Inventory');
			expect(getDocumentsPath).toHaveBeenCalledOnce();
			expect(request).toHaveBeenCalledWith(
				'app://api/client/openDir',
				'POST',
				JSON.stringify({ path: 'C:\\Users\\tester\\Documents' }),
			);
		}
		finally {
			vi.unstubAllGlobals();
		}
	});

	it('classifies native picker transport and response failures by stage', async () => {
		const failedRequest = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
		await expect(selectDirectoryThroughClientApi('', failedRequest)).rejects.toMatchObject({
			stage: 'request',
			message: expect.stringContaining('TypeError: Failed to fetch'),
		});

		const failedResponse = vi.fn(async () => new Response('', { status: 500 }));
		await expect(selectDirectoryThroughClientApi('', failedResponse)).rejects.toMatchObject({
			stage: 'http-response',
		});

		const invalidResponse = vi.fn(async () => new Response('not-json', { status: 200 }));
		await expect(selectDirectoryThroughClientApi('', invalidResponse)).rejects.toMatchObject({
			stage: 'response-body',
		});
	});

	it('writes the latest document to the configured path and stores success state', async () => {
		const host = createHost();
		const document = createEmptyInventoryDocument('2026-07-22T00:00:00.000Z');
		const backup = new EdaAutomaticInventoryBackup(host, () => '2026-07-22T01:00:00.000Z');

		await expect(backup.backupAfterSave(document)).resolves.toEqual({
			status: 'succeeded',
			attempts: 1,
			completedAt: '2026-07-22T01:00:00.000Z',
		});

		expect(host.writeFile).toHaveBeenCalledWith('C:\\backup\\inventory.json', expect.any(Blob));
		expect(host.settings).toMatchObject({
			enabled: true,
			lastAttemptAt: '2026-07-22T01:00:00.000Z',
			lastSucceededAt: '2026-07-22T01:00:00.000Z',
		});
	});

	it('retries one transient file-system failure before reporting success', async () => {
		const host = createHost();
		host.writeFile.mockRejectedValueOnce(new Error('file is temporarily locked')).mockResolvedValueOnce(true);
		const waitBeforeRetry = vi.fn(async () => undefined);
		const backup = new EdaAutomaticInventoryBackup(
			host,
			() => '2026-07-22T01:00:00.000Z',
			waitBeforeRetry,
		);

		await expect(backup.backupAfterSave(createEmptyInventoryDocument())).resolves.toEqual({
			status: 'succeeded',
			attempts: 2,
			completedAt: '2026-07-22T01:00:00.000Z',
		});

		expect(host.writeFile).toHaveBeenCalledTimes(2);
		expect(waitBeforeRetry).toHaveBeenCalledOnce();
		expect(host.settings).not.toHaveProperty('lastFailure');
	});

	it('reports a backup failure without rejecting a successful primary save', async () => {
		const host = createHost();
		host.writeFile.mockRejectedValue(new Error('permission denied'));
		const backup = new EdaAutomaticInventoryBackup(host, () => '2026-07-22T01:00:00.000Z');
		const primary = {
			load: vi.fn(),
			save: vi.fn(async () => undefined),
		} satisfies InventoryRepository;
		const notify = vi.fn();
		const repository = new AutomaticBackupInventoryRepository(primary, backup, notify);
		const document = createEmptyInventoryDocument();

		await expect(repository.save(document, 0)).resolves.toBeUndefined();

		expect(primary.save).toHaveBeenCalledWith(document, 0);
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'failed', failure: 'write-failed' }),
			document.revision,
		);
	});

	it('isolates unexpected backup and notification errors after the primary save commits', async () => {
		const primary = {
			load: vi.fn(),
			save: vi.fn(async () => undefined),
		} satisfies InventoryRepository;
		const backup = {
			getSettings: vi.fn(() => ({ enabled: true })),
			selectFolder: vi.fn(),
			prepareBackupPath: vi.fn(),
			configure: vi.fn(),
			disable: vi.fn(),
			test: vi.fn(),
			backupAfterSave: vi.fn(async () => Promise.reject(new Error('settings read failed'))),
		};
		const notify = vi.fn(() => {
			throw new Error('notification failed');
		});
		const repository = new AutomaticBackupInventoryRepository(primary, backup, notify);
		const document = createEmptyInventoryDocument();

		await expect(repository.save(document, 0)).resolves.toBeUndefined();

		expect(primary.save).toHaveBeenCalledWith(document, 0);
		expect(notify).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'failed', failure: 'write-failed' }),
			document.revision,
		);
	});

	it('does not touch the file system when automatic backup is disabled', async () => {
		const host = createHost({ enabled: false, path: 'C:\\backup\\inventory.json' });
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.backupAfterSave(createEmptyInventoryDocument())).resolves.toEqual({ status: 'disabled' });

		expect(host.writeFile).not.toHaveBeenCalled();
	});

	it('resumes automatic writes after a disabled save and refreshes restored and subsequent revisions', async () => {
		const host = createHost({ enabled: false, path: 'C:\\backup\\inventory.json' });
		const backup = new EdaAutomaticInventoryBackup(host, () => '2026-07-22T01:00:00.000Z');
		let stored = createEmptyInventoryDocument('2026-07-22T00:00:00.000Z');
		let recovery: typeof stored | undefined;
		const primary = {
			load: vi.fn(async () => cloneInventoryDocument(stored)),
			save: vi.fn(async (document) => {
				stored = cloneInventoryDocument(document);
			}),
			loadRecoverySnapshot: vi.fn(async () => recovery ? cloneInventoryDocument(recovery) : undefined),
			saveRecoverySnapshot: vi.fn(async (document) => {
				recovery = cloneInventoryDocument(document);
			}),
			clearRecoverySnapshot: vi.fn(async () => {
				recovery = undefined;
			}),
		} satisfies InventoryRepository;
		const notify = vi.fn();
		const repository = new AutomaticBackupInventoryRepository(primary, backup, notify);
		const service = new InventoryService(repository, () => '2026-07-22T02:00:00.000Z');

		await repository.save(stored, stored.revision);
		await backup.configure('C:\\backup\\inventory.json');
		const restored = await service.restoreDocument(cloneInventoryDocument(stored), stored.revision);
		const subsequent = cloneInventoryDocument(restored);
		subsequent.revision += 1;
		subsequent.updatedAt = '2026-07-22T03:00:00.000Z';
		await repository.save(subsequent, restored.revision);

		expect(restored.revision).toBe(1);
		expect(host.writeFile).toHaveBeenCalledTimes(2);
		const writtenBlob = host.writeFile.mock.calls[0]?.[1] as Blob;
		expect(JSON.parse(await writtenBlob.text())).toMatchObject({
			revision: 1,
			updatedAt: '2026-07-22T02:00:00.000Z',
		});
		const subsequentBlob = host.writeFile.mock.calls[1]?.[1] as Blob;
		expect(JSON.parse(await subsequentBlob.text())).toMatchObject({
			revision: 2,
			updatedAt: '2026-07-22T03:00:00.000Z',
		});
		expect(notify).toHaveBeenNthCalledWith(1, { status: 'disabled' }, 0);
		expect(notify).toHaveBeenNthCalledWith(2, {
			status: 'succeeded',
			attempts: 1,
			completedAt: '2026-07-22T01:00:00.000Z',
		}, 1);
		expect(notify).toHaveBeenNthCalledWith(3, {
			status: 'succeeded',
			attempts: 1,
			completedAt: '2026-07-22T01:00:00.000Z',
		}, 2);
	});

	it('sanitizes persisted settings and rejects paths that are not JSON files', async () => {
		expect(sanitizeAutomaticBackupSettings({ enabled: true, path: '  C:\\a.json  ', lastFailure: 'write-failed' })).toEqual({
			enabled: true,
			path: 'C:\\a.json',
			lastAttemptAt: undefined,
			lastSucceededAt: undefined,
			lastFailure: 'write-failed',
		});
		const backup = new EdaAutomaticInventoryBackup(createHost({ enabled: false }));
		await expect(backup.configure('C:\\backup\\inventory.txt')).rejects.toThrow('JSON file path');
	});
});
