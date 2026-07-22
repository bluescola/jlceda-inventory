import type { DesignComponentsSnapshot } from '../../design-stock-check/ports/design-component-reader';
import type { ProjectDemandSnapshot } from '../domain/project-planning';
import { aggregateDesignComponents, assertBoardQuantity } from '../../design-stock-check/domain/design-stock-check';
import { normalizeInventoryText } from '../../inventory/domain/inventory-item';

export interface CreateProjectSnapshotInput {
	id: string;
	label: string;
	boardQuantity: number;
	capturedAt: string;
	source: DesignComponentsSnapshot;
}

export async function createProjectSnapshot(input: CreateProjectSnapshotInput): Promise<ProjectDemandSnapshot> {
	const id = requiredText(input.id, 'Snapshot ID', 256);
	const label = requiredText(input.label, 'Snapshot label', 128);
	const documentUuid = requiredText(input.source.document.uuid, 'Document UUID', 256);
	const projectUuid = optionalText(input.source.document.projectUuid, 256);
	const capturedAt = normalizeTimestamp(input.capturedAt, 'Snapshot capture time');
	const boardQuantity = assertBoardQuantity(input.boardQuantity);
	const demands = aggregateDesignComponents(input.source.components.map(component => ({
		designator: component.designator,
		identity: {
			lcscPartNumber: component.lcscPartNumber,
			manufacturerPartNumber: component.manufacturerPartNumber,
			manufacturer: component.manufacturer,
			name: component.name,
			package: component.package,
		},
	}))).map(({ firstSourceIndex: _firstSourceIndex, ...demand }) => demand);
	const sourceFingerprint = await sha256(JSON.stringify({
		projectUuid,
		documentUuid,
		documentKind: input.source.document.kind,
		demands: demands.map(demand => ({
			key: demand.key,
			identity: demand.identity,
			designators: [...demand.designators].toSorted(),
			unitQuantity: demand.unitQuantity,
		})),
	}));
	return {
		id,
		projectUuid,
		documentUuid,
		documentKind: input.source.document.kind,
		label,
		boardQuantity,
		demands,
		sourceFingerprint,
		capturedAt,
		revision: 1,
	};
}

async function sha256(value: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new Error('Web Crypto SHA-256 is not available in this environment.');
	}
	const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function requiredText(value: string, label: string, maximumLength: number): string {
	const normalized = normalizeInventoryText(value);
	if (!normalized || normalized.length > maximumLength) {
		throw new TypeError(`${label} must contain between 1 and ${maximumLength} characters.`);
	}
	return normalized;
}

function optionalText(value: string | undefined, maximumLength: number): string | undefined {
	if (value === undefined) {
		return undefined;
	}
	const normalized = normalizeInventoryText(value);
	return normalized && normalized.length <= maximumLength ? normalized : undefined;
}

function normalizeTimestamp(value: string, label: string): string {
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) {
		throw new TypeError(`${label} must be a valid timestamp.`);
	}
	return new Date(timestamp).toISOString();
}
