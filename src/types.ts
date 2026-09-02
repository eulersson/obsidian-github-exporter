export interface GitTreeItem {
	path: string;
	mode: '100644' | '100755' | '040000' | '160000' | '120000';
	type: 'blob' | 'tree' | 'commit';
	sha: string | null;
}

export interface GitTreeResponse {
	path: string;
	mode: '100644' | '100755' | '040000' | '160000' | '120000';
	type: 'blob' | 'tree' | 'commit';
	sha: string;
}

export type PlannedAction = 'create' | 'update' | 'delete';
export type PlannedKind = 'page' | 'media';

export interface PlannedFile {
	/** Vault-relative path, or the remote path for orphaned deletions. */
	path: string;
	remotePath: string;
	action: PlannedAction;
	kind: PlannedKind;
	/** Bytes to upload. Absent for deletions. */
	content?: Uint8Array;
	/** Number of masked regions removed from this file. */
	maskedSpans?: number;
	/** The copy already on the remote still contains text that is masked now. */
	historyLeak?: boolean;
}

/** A file that will not be published, and why. */
export interface BlockedFile {
	path: string;
	reason: string;
}

export interface PublishPlan {
	baseCommitSha: string;
	baseTreeSha: string;
	files: PlannedFile[];
	blocked: BlockedFile[];
}

export interface PublishStats {
	pages: { added: number; updated: number; deleted: number };
	media: { added: number; updated: number; deleted: number };
}

export function summarize(plan: PublishPlan): PublishStats {
	const stats: PublishStats = {
		pages: { added: 0, updated: 0, deleted: 0 },
		media: { added: 0, updated: 0, deleted: 0 },
	};
	for (const file of plan.files) {
		const bucket = file.kind === 'media' ? stats.media : stats.pages;
		if (file.action === 'create') bucket.added++;
		else if (file.action === 'update') bucket.updated++;
		else bucket.deleted++;
	}
	return stats;
}

export function formatStats(stats: PublishStats): string {
	return [
		`Pages: ${stats.pages.added} added, ${stats.pages.updated} updated, ${stats.pages.deleted} deleted`,
		`Media: ${stats.media.added} added, ${stats.media.updated} updated, ${stats.media.deleted} deleted`,
	].join('\n');
}
