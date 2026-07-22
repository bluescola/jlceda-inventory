import type { BomDesignDemand, BomDiffResult } from '../../bom-analysis/domain/bom-analysis';
import type { ProjectDemandSnapshot } from '../domain/project-planning';
import { diffNormalizedBoms } from '../../bom-analysis/domain/diff-boms';

export interface ProjectSnapshotDiff {
	sameDocument: boolean;
	sourceChanged: boolean;
	boardQuantityChanged: boolean;
	beforeBoardQuantity: number;
	afterBoardQuantity: number;
	demand: BomDiffResult;
}

export function diffProjectSnapshots(
	before: ProjectDemandSnapshot,
	after: ProjectDemandSnapshot,
): ProjectSnapshotDiff {
	return {
		sameDocument: before.documentKind === after.documentKind
			&& before.documentUuid === after.documentUuid
			&& before.projectUuid === after.projectUuid,
		sourceChanged: before.sourceFingerprint !== after.sourceFingerprint,
		boardQuantityChanged: before.boardQuantity !== after.boardQuantity,
		beforeBoardQuantity: before.boardQuantity,
		afterBoardQuantity: after.boardQuantity,
		demand: diffNormalizedBoms(toBomDemands(before), toBomDemands(after)),
	};
}

function toBomDemands(snapshot: ProjectDemandSnapshot): BomDesignDemand[] {
	return snapshot.demands.map((demand, index) => ({
		sheetName: snapshot.label,
		rowNumber: index + 1,
		lcscPartNumber: demand.identity.lcscPartNumber,
		designators: [...demand.designators],
		quantity: demand.unitQuantity,
		identity: {
			name: demand.identity.name,
			manufacturerPartNumber: demand.identity.manufacturerPartNumber,
			manufacturer: demand.identity.manufacturer,
			package: demand.identity.package,
		},
	}));
}
