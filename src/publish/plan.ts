import { App, TFile } from 'obsidian';
import { Octokit } from '@octokit/core';
import { MaskSpan, remoteRetainsMaskedText } from '../mask';
import { GitHubExporterSettings } from '../settings';
import { BlockedFile, GitTreeResponse, PlannedFile, PublishPlan } from '../types';
import { base64ToString, gitBlobSha } from '../utils/encoding';
import { buildPublishContent, describeFailure } from './content';
import { getAttachmentsFolder, getLinkedMedia } from './media';

export interface PlanOptions {
	/** Restrict the plan to a single file. Skips the deletion sweep. */
	only?: TFile;
	onProgress?: (message: string) => void;
}

/**
 * Work out exactly what a publish would change, without changing anything.
 *
 * Read-only by design: no blobs, no commits. The same plan drives both the dry
 * run and the real publish, so what the dry run shows is what gets committed.
 */
export async function computePublishPlan(
	app: App,
	octokit: Octokit,
	settings: GitHubExporterSettings,
	options: PlanOptions = {},
): Promise<PublishPlan> {
	const owner = settings.githubUsername;
	const repo = settings.githubRepo;
	const progress = options.onProgress ?? (() => undefined);

	const { data: ref } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
		owner, repo, ref: `heads/${settings.targetBranch}`,
	});
	const { data: commit } = await octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
		owner, repo, commit_sha: ref.object.sha,
	});
	const { data: baseTree } = await octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
		owner, repo, tree_sha: commit.tree.sha, recursive: '1',
	});

	const existingFiles = new Map<string, GitTreeResponse>();
	for (const item of baseTree.tree) {
		if (item.type === 'blob' && item.path) {
			existingFiles.set(item.path, item as GitTreeResponse);
		}
	}

	const files: PlannedFile[] = [];
	const blocked: BlockedFile[] = [];
	const localPaths = new Set<string>();
	const mediaInUse = new Set<string>();
	const attachmentsFolder = getAttachmentsFolder(app);

	const notes = collectNotes(app, options.only);
	for (const file of notes) {
		progress(`Checking ${file.path}...`);

		let content;
		try {
			content = await buildPublishContent(app, file, settings);
		} catch (error) {
			const reason = describeFailure(error);
			if (reason === null) throw error;
			// Keep whatever is already on the remote; never fall back to raw text.
			blocked.push({ path: file.path, reason });
			localPaths.add(file.path);
			continue;
		}

		// HTML has no parsed frontmatter, so a marker comment gates it instead.
		// Unmarked HTML is left out of `localPaths` so the sweep can remove it.
		if (!options.only && file.extension === 'html' && !htmlIsMarkedForPublish(content.text)) {
			continue;
		}

		localPaths.add(file.path);
		const remotePath = `${settings.targetDir}/${file.path}`;
		const existing = existingFiles.get(remotePath);
		const sha = await gitBlobSha(content.bytes);

		if (!existing) {
			files.push({
				path: file.path, remotePath, action: 'create', kind: 'page',
				content: content.bytes, maskedSpans: content.spans.length,
			});
		} else if (existing.sha !== sha) {
			const historyLeak = content.spans.length > 0 &&
				await remoteStillHasSecret(octokit, settings, existing.sha, content.spans);
			files.push({
				path: file.path, remotePath, action: 'update', kind: 'page',
				content: content.bytes, maskedSpans: content.spans.length, historyLeak,
			});
		}

		// Media is resolved from the *masked* text, so anything embedded inside a
		// masked region is neither uploaded nor treated as still in use below.
		for (const mediaPath of getLinkedMedia(app, content.text)) {
			const mediaFile = app.vault.getAbstractFileByPath(mediaPath);
			if (!(mediaFile instanceof TFile)) {
				console.warn(`Skipping media file ${mediaPath} - not found or not a file`);
				continue;
			}
			const remoteMediaPath = `${settings.targetDir}/${attachmentsFolder}/${mediaFile.name}`;
			// Recorded even when unchanged: an attachment still in use must not be
			// swept away below.
			if (mediaInUse.has(remoteMediaPath)) continue;
			mediaInUse.add(remoteMediaPath);

			const bytes = new Uint8Array(await app.vault.readBinary(mediaFile));
			const existingMedia = existingFiles.get(remoteMediaPath);
			// Only changed media is carried in the plan — holding every published
			// attachment in memory for the whole run would cost tens of megabytes.
			if (existingMedia && existingMedia.sha === await gitBlobSha(bytes)) continue;

			files.push({
				path: mediaFile.path,
				remotePath: remoteMediaPath,
				action: existingMedia ? 'update' : 'create',
				kind: 'media',
				content: bytes,
			});
		}
	}

	if (!options.only) {
		collectDeletions(settings, existingFiles, localPaths, mediaInUse, attachmentsFolder, files);
	}

	return { baseCommitSha: commit.sha, baseTreeSha: commit.tree.sha, files, blocked };
}

/**
 * Notes eligible for publishing: markdown with `publish: true`, plus standalone
 * `.html` gated on `<!-- publish: true -->` (HTML has no parsed frontmatter).
 * A single-file publish takes the file as given.
 */
function collectNotes(app: App, only?: TFile): TFile[] {
	if (only) return [only];

	const markdown = app.vault.getMarkdownFiles().filter(file => {
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		return frontmatter?.publish === true || frontmatter?.publish === 'true';
	});
	const html = app.vault.getFiles().filter(file => file.extension === 'html');
	return [...markdown, ...html];
}

/**
 * Anything under the target directory that no published note claims any more.
 * Attachments are kept only while some published note still embeds them.
 */
function collectDeletions(
	settings: GitHubExporterSettings,
	existingFiles: Map<string, GitTreeResponse>,
	localPaths: Set<string>,
	mediaInUse: Set<string>,
	attachmentsFolder: string,
	files: PlannedFile[],
): void {
	for (const remotePath of existingFiles.keys()) {
		if (!remotePath.startsWith(settings.targetDir)) continue;
		const relativePath = remotePath.replace(`${settings.targetDir}/`, '');

		const isAttachment = remotePath.includes(`/${attachmentsFolder}/`);
		if (isAttachment && mediaInUse.has(remotePath)) continue;
		if (localPaths.has(relativePath)) continue;

		files.push({
			path: relativePath,
			remotePath,
			action: 'delete',
			kind: isAttachment ? 'media' : 'page',
		});
	}
}

/** Fetch the published copy and check whether it still holds now-masked text. */
async function remoteStillHasSecret(
	octokit: Octokit,
	settings: GitHubExporterSettings,
	blobSha: string,
	spans: MaskSpan[],
): Promise<boolean> {
	try {
		const { data: blob } = await octokit.request('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', {
			owner: settings.githubUsername, repo: settings.githubRepo, file_sha: blobSha,
		});
		if (blob.encoding !== 'base64') return false;
		return remoteRetainsMaskedText(base64ToString(blob.content), spans);
	} catch (error) {
		console.warn('Could not check the published copy for masked text:', error);
		return false;
	}
}

/** Standalone HTML is only published when it carries the marker comment. */
function htmlIsMarkedForPublish(content: string): boolean {
	return /<!--\s*publish:\s*true\s*-->/.test(content);
}
