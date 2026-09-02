import { Octokit } from '@octokit/core';
import { GitHubExporterSettings } from '../settings';
import { GitTreeItem, PublishPlan, PublishStats, summarize } from '../types';
import { arrayBufferToBase64 } from '../utils/encoding';

export interface ApplyOptions {
	message?: string;
	onProgress?: (message: string) => void;
}

/**
 * Commit a plan. One blob per changed file, then a single tree, commit and ref
 * update — so a publish either lands whole or not at all.
 */
export async function applyPublishPlan(
	octokit: Octokit,
	settings: GitHubExporterSettings,
	plan: PublishPlan,
	options: ApplyOptions = {},
): Promise<PublishStats> {
	if (plan.blocked.length > 0) {
		// Refusing everything is deliberate: a blocked file usually means a secret
		// slipped through, and that deserves attention rather than a buried notice.
		throw new Error(
			`Publish aborted — ${plan.blocked.length} file(s) could not be masked safely.`,
		);
	}

	const owner = settings.githubUsername;
	const repo = settings.githubRepo;
	const progress = options.onProgress ?? (() => undefined);

	const changes: GitTreeItem[] = [];
	for (const file of plan.files) {
		if (file.action === 'delete') {
			changes.push({ path: file.remotePath, mode: '100644', type: 'blob', sha: null });
			continue;
		}
		if (!file.content) continue;

		progress(`Uploading ${file.path}...`);
		const { data: blob } = await octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
			owner, repo,
			content: arrayBufferToBase64(file.content),
			encoding: 'base64',
		});
		changes.push({ path: file.remotePath, mode: '100644', type: 'blob', sha: blob.sha });
	}

	// Unchanged entries are inherited from base_tree; GitHub rejects an empty
	// tree with 422 "Invalid tree info", so an empty plan must not get here.
	const { data: newTree } = await octokit.request('POST /repos/{owner}/{repo}/git/trees', {
		owner, repo, base_tree: plan.baseTreeSha, tree: changes,
	});

	const { data: newCommit } = await octokit.request('POST /repos/{owner}/{repo}/git/commits', {
		owner, repo,
		message: options.message ?? 'Update published content',
		tree: newTree.sha,
		parents: [plan.baseCommitSha],
	});

	await octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
		owner, repo, ref: `heads/${settings.targetBranch}`, sha: newCommit.sha,
	});

	return summarize(plan);
}
