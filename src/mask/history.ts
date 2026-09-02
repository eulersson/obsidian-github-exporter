import { MaskSpan } from './types';

/**
 * Does the published copy still contain text that is masked locally now?
 *
 * A yes means the secret was published at some point and survives in the
 * repository's history — dropping it from the branch tip is not enough.
 */
export function remoteRetainsMaskedText(remote: string, spans: MaskSpan[]): boolean {
	for (const span of spans) {
		for (const line of maskedPayload(span).split('\n')) {
			const trimmed = line.trim();
			// Short fragments match by coincidence; only trust substantial lines.
			if (trimmed.length >= 12 && remote.includes(trimmed)) return true;
		}
	}
	return false;
}

/** The masked text without its own markers — what a reader would have seen. */
function maskedPayload(span: MaskSpan): string {
	if (span.reason !== 'region') return span.text;
	return span.text
		.replace(/^(%%\s*mask-start\s*%%|<!--\s*mask-start\s*-->)/, '')
		.replace(/(%%\s*mask-end\s*%%|<!--\s*mask-end\s*-->)$/, '');
}
