import type { InventoryRepository } from '../../src/features/inventory/ports/inventory-repository';
import type { AutomaticBackupHost } from '../../src/platform/jlceda-v3/persistence/automatic-inventory-backup';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyInventoryDocument } from '../../src/features/inventory/domain/inventory-document';
import {
	AutomaticBackupInventoryRepository,
	EdaAutomaticInventoryBackup,
	extractDocumentsPathFromClientConfig,
	sanitizeAutomaticBackupSettings,
} from '../../src/platform/jlceda-v3/persistence/automatic-inventory-backup';

function createHost(initial: unknown = { enabled: true, path: 'C:\\backup\\inventory.json' }): AutomaticBackupHost & {
	settings: unknown;
	createDirectory: ReturnType<typeof vi.fn>;
	getClientDocumentsPath: ReturnType<typeof vi.fn>;
	getDocumentsPath: ReturnType<typeof vi.fn>;
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
		getDocumentsPath: vi.fn(async () => 'C:\\Users\\tester\\Documents'),
		getClientDocumentsPath: vi.fn(async () => undefined),
		createDirectory: vi.fn(async () => true),
	};
	return host;
}

describe('edaAutomaticInventoryBackup', () => {
	it('prepares a dedicated default folder and appends the fixed JSON file name', async () => {
		const host = createHost({ enabled: false });
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.getDefaultFolder()).resolves.toBe('C:\\Users\\tester\\Documents\\JLCEDA-Inventory');
		await expect(backup.prepareBackupPath('D:\\Inventory')).resolves.toBe('D:\\Inventory\\jlceda-inventory-latest.json');

		expect(host.createDirectory).toHaveBeenCalledWith('D:\\Inventory');
	});

	it('falls back to the current client config when the public Documents API returns an empty string', async () => {
		const host = createHost({ enabled: false });
		host.getDocumentsPath.mockResolvedValueOnce('');
		host.getClientDocumentsPath.mockResolvedValueOnce('C:\\Users\\tester\\Documents');
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.getDefaultFolder()).resolves.toBe('C:\\Users\\tester\\Documents\\JLCEDA-Inventory');

		expect(host.getClientDocumentsPath).toHaveBeenCalledOnce();
	});

	it('converts a file URL returned by the host into the native path expected by the file APIs', async () => {
		const host = createHost({ enabled: false });
		host.getDocumentsPath.mockResolvedValueOnce('file:///C:/Users/tester/My%20Documents');
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.getDefaultFolder()).resolves.toBe('C:\\Users\\tester\\My Documents\\JLCEDA-Inventory');

		expect(host.getClientDocumentsPath).not.toHaveBeenCalled();
	});

	it('rejects an unusable automatic backup folder before touching the file system', async () => {
		const host = createHost({ enabled: false });
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.prepareBackupPath('relative-folder')).rejects.toThrow('unusable');

		expect(host.createDirectory).not.toHaveBeenCalled();
	});

	it('stops before returning a file path when the host rejects directory creation', async () => {
		const host = createHost({ enabled: false });
		host.createDirectory.mockResolvedValueOnce(false);
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.prepareBackupPath('D:\\Inventory')).rejects.toThrow('rejected');

		expect(host.createDirectory).toHaveBeenCalledWith('D:\\Inventory');
	});

	it('extracts Documents paths from both current and wrapped client config responses', () => {
		expect(extractDocumentsPathFromClientConfig({ documents: 'C:\\Documents' })).toBe('C:\\Documents');
		expect(extractDocumentsPathFromClientConfig({ result: { documents: '/home/tester/Documents' } })).toBe('/home/tester/Documents');
		expect(extractDocumentsPathFromClientConfig({ result: {} })).toBeUndefined();
	});

	it('writes the latest document to the configured path and stores success state', async () => {
		const host = createHost();
		const document = createEmptyInventoryDocument('2026-07-22T00:00:00.000Z');
		const backup = new EdaAutomaticInventoryBackup(host, () => '2026-07-22T01:00:00.000Z');

		await expect(backup.backupAfterSave(document)).resolves.toEqual({
			status: 'succeeded',
			completedAt: '2026-07-22T01:00:00.000Z',
		});

		expect(host.writeFile).toHaveBeenCalledWith('C:\\backup\\inventory.json', expect.any(Blob));
		expect(host.settings).toMatchObject({
			enabled: true,
			lastAttemptAt: '2026-07-22T01:00:00.000Z',
			lastSucceededAt: '2026-07-22T01:00:00.000Z',
		});
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
		expect(notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', failure: 'write-failed' }));
	});

	it('isolates unexpected backup and notification errors after the primary save commits', async () => {
		const primary = {
			load: vi.fn(),
			save: vi.fn(async () => undefined),
		} satisfies InventoryRepository;
		const backup = {
			getSettings: vi.fn(() => ({ enabled: true })),
			getDefaultFolder: vi.fn(),
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
		expect(notify).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', failure: 'write-failed' }));
	});

	it('does not touch the file system when automatic backup is disabled', async () => {
		const host = createHost({ enabled: false, path: 'C:\\backup\\inventory.json' });
		const backup = new EdaAutomaticInventoryBackup(host);

		await expect(backup.backupAfterSave(createEmptyInventoryDocument())).resolves.toEqual({ status: 'disabled' });

		expect(host.writeFile).not.toHaveBeenCalled();
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
