import type { DesignComponentSnapshot, DesignStockCheckRow, DesignStockCheckStatus } from '../../design-stock-check/domain/design-stock-check';
import type { InventoryItem } from '../../inventory/domain/inventory-item';
import type { ProjectDemandSnapshot } from '../domain/project-planning';
import { checkDesignStock } from '../../design-stock-check/application/check-design-stock';

export interface ProjectDemandSource {
	snapshotId: string;
	label: string;
	boardQuantity: number;
}

export interface ProjectDemandAnalysisRow extends DesignStockCheckRow {
	sources: ProjectDemandSource[];
}

export interface ProjectDemandAnalysis {
	snapshotCount: number;
	rows: ProjectDemandAnalysisRow[];
	summary: Record<DesignStockCheckStatus, number>;
}

export interface ProcurementSuggestion extends ProjectDemandAnalysisRow {
	suggestedQuantity: number | null;
}

export function analyzeProjectDemand(
	snapshots: readonly ProjectDemandSnapshot[],
	inventory: readonly InventoryItem[],
): ProjectDemandAnalysis {
	const components: DesignComponentSnapshot[] = [];
	const sourceByIndex: ProjectDemandSource[] = [];
	const sourcesByPartNumber = new Map<string, Map<string, ProjectDemandSource>>();
	for (const snapshot of snapshots) {
		assertSnapshot(snapshot);
		const source = {
			snapshotId: snapshot.id,
			label: snapshot.label,
			boardQuantity: snapshot.boardQuantity,
		};
		for (const demand of snapshot.demands) {
			const quantity = multiplySafeIntegers(demand.unitQuantity, snapshot.boardQuantity);
			components.push({
				designator: demand.designators.join(', ') || undefined,
				identity: { ...demand.identity },
				quantity,
			});
			sourceByIndex.push(source);
			const partNumber = demand.identity.lcscPartNumber;
			if (partNumber) {
				let sourceMap = sourcesByPartNumber.get(partNumber);
				if (!sourceMap) {
					sourceMap = new Map();
					sourcesByPartNumber.set(partNumber, sourceMap);
				}
				sourceMap.set(snapshot.id, source);
			}
		}
	}
	const report = checkDesignStock({ components, inventory, boardQuantity: 1 });
	const rows = report.rows.map((row) => {
		const sources = row.identity.lcscPartNumber
			? [...(sourcesByPartNumber.get(row.identity.lcscPartNumber)?.values() ?? [])]
			: sourceByIndex[row.firstSourceIndex] ? [sourceByIndex[row.firstSourceIndex]] : [];
		return { ...row, sources };
	});
	return {
		snapshotCount: snapshots.length,
		rows,
		summary: rows.reduce<Record<DesignStockCheckStatus, number>>((summary, row) => {
			summary[row.status] += 1;
			return summary;
		}, {
			'sufficient': 0,
			'insufficient': 0,
			'review-required': 0,
			'stocktake-required': 0,
			'inventory-missing': 0,
			'identity-unmatched': 0,
		}),
	};
}

export function createProcurementSuggestions(analysis: ProjectDemandAnalysis): ProcurementSuggestion[] {
	return analysis.rows
		.filter(row => row.status !== 'sufficient')
		.map(row => ({
			...row,
			sources: row.sources.map(source => ({ ...source })),
			suggestedQuantity: row.status === 'insufficient' || row.status === 'inventory-missing'
				? row.shortageQuantity
				: null,
		}));
}

function assertSnapshot(snapshot: ProjectDemandSnapshot): void {
	if (!Number.isSafeInteger(snapshot.boardQuantity) || snapshot.boardQuantity <= 0) {
		throw new TypeError('Snapshot board quantity must be a positive safe integer.');
	}
	for (const demand of snapshot.demands) {
		if (!Number.isSafeInteger(demand.unitQuantity) || demand.unitQuantity <= 0) {
			throw new TypeError('Snapshot unit quantity must be a positive safe integer.');
		}
	}
}

function multiplySafeIntegers(left: number, right: number): number {
	const result = left * right;
	if (!Number.isSafeInteger(result)) {
		throw new RangeError('Project demand quantity exceeds the safe integer range.');
	}
	return result;
}
