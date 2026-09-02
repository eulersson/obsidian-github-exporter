import { App, TFile } from 'obsidian';
import { MaskError, MaskSpan, applyMask, scanDenied } from '../mask';
import { GitHubExporterSettings } from '../settings';

/** A deny pattern matched the finished bytes. The file must not be published. */
export class PublishBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PublishBlockedError';
	}
}

export interface PublishContent {
	/** The exact text that will be committed. */
	text: string;
	bytes: Uint8Array;
	/** Everything that was removed on the way here. */
	spans: MaskSpan[];
}

/**
 * The single place a note is turned into the bytes that go to GitHub.
 *
 * Every caller — bulk publish, single-file publish, preview, dry run — must go
 * through here. A second path that reads the file directly would publish the
 * unmasked text, and change detection would then compare the wrong bytes.
 */
export async function buildPublishContent(
	app: App,
	file: TFile,
	settings: GitHubExporterSettings,
): Promise<PublishContent> {
	const raw = await app.vault.read(file);
	const { output, spans } = applyMask(raw, settings.mask);

	// Checked against the finished bytes, so it also catches anything the mask
	// rules missed entirely.
	const hits = scanDenied(output, settings.mask.denyPatterns);
	if (hits.length > 0) {
		const where = hits.map(hit => `"${hit.label}" (line ${hit.line})`).join(', ');
		throw new PublishBlockedError(`Deny pattern matched: ${where}`);
	}

	return { text: output, bytes: new TextEncoder().encode(output), spans };
}

/** Turn a masking/deny failure into a short reason for reports. */
export function describeFailure(error: unknown): string | null {
	if (error instanceof MaskError) {
		return error.line ? `${error.message} (line ${error.line})` : error.message;
	}
	if (error instanceof PublishBlockedError) {
		return error.message;
	}
	return null;
}
