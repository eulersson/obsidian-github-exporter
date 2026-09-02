import { App, TFile } from 'obsidian';

/** Media Obsidian renders inline, so notes reference it with embed syntax. */
const MEDIA_EXTENSIONS = 'png|jpg|jpeg|gif|mp3|wav|mp4|pdf|ogg|m4a';

/**
 * Attachments Obsidian cannot render. A note points at these with an ordinary
 * link (`[[game.sb3]]`) rather than an embed, so they are collected from links
 * too — otherwise the published note links to a file that was never uploaded.
 */
const LINKED_EXTENSIONS = 'sb3';

export function getAttachmentsFolder(app: App): string {
	return (app.vault as unknown as { getConfig(key: string): string })
		.getConfig('attachmentFolderPath') || 'Attachments';
}

/**
 * Resolve every local media file embedded in `content`.
 *
 * Always call this with the *masked* text: media embedded inside a masked
 * region must neither be uploaded nor counted as still in use, or the
 * attachment stays on the remote after its note stops referencing it.
 */
export function getLinkedMedia(app: App, content: string): string[] {
	// Collect raw link targets from both supported syntaxes:
	// 1. Obsidian embeds: ![[filename.ext]], optionally followed by a `|` tail
	//    (the Image Captions plugin's caption, or a `|300` size) or a `#anchor`.
	// 2. Markdown images:  ![alt](path.ext) — including the linked-image form
	//    [![alt](path.ext)](url), where only the inner ![alt](path) matches here.
	//    The path may be URL-encoded (%20) and/or wrapped in <...>.
	// The leading `!` is required for embeddable media (a plain [[photo.png]]
	// link is not an embed) but optional for LINKED_EXTENSIONS, which are only
	// ever written as plain links.
	const rawTargets: string[] = [];
	const groups = [
		{ extensions: MEDIA_EXTENSIONS, embed: '!' },
		{ extensions: LINKED_EXTENSIONS, embed: '!?' },
	];
	for (const { extensions, embed } of groups) {
		const wikiRegex = new RegExp(`${embed}\\[\\[([^\\[\\]|#]+\\.(?:${extensions}))(?:[|#][^\\]]*)?\\]\\]`, 'gi');
		const mdRegex = new RegExp(`${embed}\\[[^\\]]*\\]\\(\\s*<?([^)>\\s]+\\.(?:${extensions}))[^)]*\\)`, 'gi');
		for (const m of content.matchAll(wikiRegex)) if (m[1]) rawTargets.push(m[1]);
		for (const m of content.matchAll(mdRegex)) if (m[1]) rawTargets.push(m[1]);
	}

	const attachmentsFolder = getAttachmentsFolder(app);

	const resolved = rawTargets.map(raw => {
		// Skip external URLs (e.g. ![](https://.../img.png)) — not local media.
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
			return null;
		}
		// Markdown links percent-encode spaces; decode and normalise the path.
		let target = raw;
		try {
			target = decodeURIComponent(raw);
		} catch {
			// leave as-is if it isn't valid percent-encoding
		}
		target = target.replace(/^\.?\//, '');
		const filename = target.split('/').pop() || target;

		// First honour the path exactly as written (relative to the vault root).
		const exactFile = app.vault.getAbstractFileByPath(target);
		if (exactFile instanceof TFile) {
			return exactFile.path;
		}
		// Then try the attachments folder by filename.
		const attachmentFile = app.vault.getAbstractFileByPath(`${attachmentsFolder}/${filename}`);
		if (attachmentFile instanceof TFile) {
			return attachmentFile.path;
		}
		// Finally try the vault root by filename.
		const rootFile = app.vault.getAbstractFileByPath(filename);
		if (rootFile instanceof TFile) {
			return rootFile.path;
		}
		return null;
	}).filter((path): path is string => path !== null);

	// De-duplicate: the same media may be referenced more than once.
	return Array.from(new Set(resolved));
}
