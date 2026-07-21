import type { EdaModelReference } from '../../inventory/domain/inventory-item';

export type CommonLibraryTarget = 'favorite' | 'personal';

export type CommonLibraryCopyAttemptStatus
	= | 'already-present'
		| 'api-error'
		| 'copied'
		| 'copy-rejected'
		| 'lookup-error'
		| 'unavailable';

export interface CommonLibraryCopyAttempt {
	target: CommonLibraryTarget;
	status: CommonLibraryCopyAttemptStatus;
}

export interface CommonLibraryCopyOptions {
	lcscPartNumber?: string;
	newName?: string;
}

export type CommonLibraryCopyResult
	= | {
		status: 'already-present' | 'copied';
		target: CommonLibraryTarget;
		attempts: CommonLibraryCopyAttempt[];
	}
	| {
		status: 'failed';
		reason: 'api-error' | 'copy-rejected' | 'no-target-library';
		attempts: CommonLibraryCopyAttempt[];
	};

export interface CommonLibrary {
	copy: (reference: EdaModelReference, options?: CommonLibraryCopyOptions) => Promise<CommonLibraryCopyResult>;
}
