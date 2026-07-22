import type { ExternalLinkNavigator } from '../../../features/inventory/ports/external-link-navigator';
import { normalizeDatasheetUrl } from '../../../features/inventory/domain/inventory-metadata';

export class EdaExternalLinkNavigator implements ExternalLinkNavigator {
	public constructor(private readonly openWindow: (url: string) => void = openHostWindow) {}

	public open(url: string): boolean {
		try {
			const normalized = normalizeDatasheetUrl(url);
			if (!normalized) {
				return false;
			}
			this.openWindow(normalized);
			return true;
		}
		catch {
			return false;
		}
	}
}

function openHostWindow(url: string): void {
	eda.sys_Window.open(url, ESYS_WindowOpenTarget.BLANK);
}
