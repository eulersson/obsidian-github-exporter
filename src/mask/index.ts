import {
	DenyHit,
	DenyRule,
	MaskError,
	MaskResult,
	MaskRule,
	MaskSettings,
	MaskSpan,
} from './types';
import {
	Range,
	applyRemovals,
	computeCodeRanges,
	lineAt,
	mergeRanges,
	normalizeBlankLines,
	overlaps,
} from './ranges';

export * from './types';
export { remoteRetainsMaskedText } from './history';

/** `%%mask-start%%` / `%%mask-end%%`, plus HTML aliases for standalone `.html` files. */
const REGION_TOKEN = /%%\s*mask-(start|end)\s*%%|<!--\s*mask-(start|end)\s*-->/g;
/** `%%mask-section%%` on a heading masks that heading and everything under it. */
const SECTION_TAG = /%%\s*mask-section\s*%%|<!--\s*mask-section\s*-->/g;
const HEADING = /^(#{1,6})\s+/;
const CALLOUT = /^\s*>\s*\[!([A-Za-z0-9_-]+)\]/;
const OBSIDIAN_COMMENT = /%%[\s\S]*?%%/g;

interface Collected {
	ranges: Range[];
	spans: MaskSpan[];
}

/**
 * Strip every masked region from a note before it is published.
 *
 * All removals are computed against the *original* text and applied in a single
 * pass, so span line numbers stay accurate and the result does not depend on the
 * order the rules happen to be evaluated in.
 *
 * Throws {@link MaskError} whenever the outcome is uncertain — unbalanced
 * markers, an invalid rule, or a rule that keeps matching its own output.
 * Callers must never fall back to the unmasked text.
 */
export function applyMask(content: string, settings: MaskSettings): MaskResult {
	const collected = collect(content, settings);
	if (collected.spans.length === 0) {
		// Nothing was masked, so leave the bytes exactly as they are on disk.
		// Normalising here would rewrite untouched notes for no reason.
		return { output: content, spans: [] };
	}

	const output = normalizeBlankLines(applyRemovals(content, collected.ranges));

	// Masking must be a fixed point: running it again has to be a no-op. A rule
	// whose removal creates a fresh match would otherwise produce a different
	// file on every publish, and an endless stream of commits.
	const second = collect(output, settings);
	const unstable = second.spans[0];
	if (unstable) {
		throw new MaskError(
			`Masking is not stable — ${unstable.reason} still matches after masking. ` +
			'Fix the rule so it cannot match its own output.',
			unstable.line,
		);
	}

	return { output, spans: collected.spans };
}

function collect(content: string, settings: MaskSettings): Collected {
	const { ranges: codeRanges, unterminatedFenceAt } = computeCodeRanges(content);
	assertNoMarkersInUnterminatedFence(content, unterminatedFenceAt);

	const ranges: Range[] = [];
	const spans: MaskSpan[] = [];

	collectRegions(content, codeRanges, ranges, spans);
	const claimed = mergeRanges(ranges);
	collectSections(content, codeRanges, claimed, ranges, spans);
	collectCallouts(content, codeRanges, settings.privateCallouts, ranges, spans);
	collectComments(content, codeRanges, mergeRanges(ranges), ranges, spans);
	collectRuleMatches(content, codeRanges, mergeRanges(ranges), settings.rules, ranges, spans);

	spans.sort((a, b) => a.line - b.line);
	return { ranges, spans };
}

/**
 * A stray ``` turns the rest of the note into code, where markers are ignored.
 * Silently publishing that content is the one outcome worth refusing outright.
 */
function assertNoMarkersInUnterminatedFence(content: string, fenceAt: number | null): void {
	if (fenceAt === null) return;
	const tail = content.slice(fenceAt);
	if (new RegExp(REGION_TOKEN).test(tail) || new RegExp(SECTION_TAG).test(tail)) {
		throw new MaskError(
			'A mask marker sits inside an unterminated code fence, where it would be ignored. ' +
			'Close the fence so the marker means what it says.',
			lineAt(content, fenceAt),
		);
	}
}

function collectRegions(content: string, codeRanges: Range[], ranges: Range[], spans: MaskSpan[]): void {
	let openAt = -1;
	for (const match of content.matchAll(new RegExp(REGION_TOKEN))) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (overlaps(codeRanges, start, end)) continue;

		const kind = match[1] ?? match[2];
		if (kind === 'start') {
			if (openAt >= 0) {
				throw new MaskError(
					'Nested %%mask-start%% — close the first region before opening another.',
					lineAt(content, start),
				);
			}
			openAt = start;
		} else {
			if (openAt < 0) {
				throw new MaskError(
					'%%mask-end%% without a matching %%mask-start%%.',
					lineAt(content, start),
				);
			}
			ranges.push({ start: openAt, end });
			spans.push({
				line: lineAt(content, openAt),
				reason: 'region',
				text: content.slice(openAt, end),
			});
			openAt = -1;
		}
	}

	if (openAt >= 0) {
		throw new MaskError(
			'Unclosed %%mask-start%% — the region never ends, so nothing can be published safely.',
			lineAt(content, openAt),
		);
	}
}

/** A source line paired with its character offset in the document. */
interface DocLine {
	text: string;
	start: number;
}

/** Splits `content` into lines tagged with where each one begins. */
function splitLines(content: string): DocLine[] {
	const out: DocLine[] = [];
	let offset = 0;
	for (const text of content.split('\n')) {
		out.push({ text, start: offset });
		offset += text.length + 1;
	}
	return out;
}

function collectSections(
	content: string,
	codeRanges: Range[],
	claimed: Range[],
	ranges: Range[],
	spans: MaskSpan[],
): void {
	const lines = splitLines(content);

	for (let i = 0; i < lines.length; i++) {
		const current = lines[i];
		if (!current) continue;
		const tag = new RegExp(SECTION_TAG).exec(current.text);
		if (!tag) continue;

		const tagStart = current.start + tag.index;
		if (overlaps(codeRanges, tagStart, tagStart + tag[0].length)) continue;
		// Already inside a masked region — the tag goes with it.
		if (overlaps(claimed, tagStart, tagStart + tag[0].length)) continue;

		const level = HEADING.exec(current.text)?.[1]?.length;
		if (level === undefined) {
			throw new MaskError(
				'%%mask-section%% is only valid on a heading line. ' +
				'Use %%mask-start%% / %%mask-end%% to mask anything else.',
				i + 1,
			);
		}

		// The section runs until the next heading of the same or a higher level.
		let end = content.length;
		for (let j = i + 1; j < lines.length; j++) {
			const candidate = lines[j];
			if (!candidate) continue;
			const next = HEADING.exec(candidate.text);
			if (!next || (next[1]?.length ?? 0) > level) continue;
			if (overlaps(codeRanges, candidate.start, candidate.start + candidate.text.length)) continue;
			end = candidate.start;
			break;
		}

		ranges.push({ start: current.start, end });
		spans.push({
			line: i + 1,
			reason: `section: ${current.text.replace(new RegExp(SECTION_TAG), '').trim()}`,
			text: content.slice(current.start, end),
		});
		// Skip the lines we just consumed.
		while (i + 1 < lines.length && (lines[i + 1]?.start ?? end) < end) i++;
	}
}

function collectCallouts(
	content: string,
	codeRanges: Range[],
	privateCallouts: string[],
	ranges: Range[],
	spans: MaskSpan[],
): void {
	if (privateCallouts.length === 0) return;
	const wanted = new Set(privateCallouts.map(type => type.toLowerCase()));

	const lines = splitLines(content);

	for (let i = 0; i < lines.length; i++) {
		const current = lines[i];
		if (!current) continue;
		const type = CALLOUT.exec(current.text)?.[1]?.toLowerCase();
		if (!type || !wanted.has(type)) continue;
		if (overlaps(codeRanges, current.start, current.start + current.text.length)) continue;

		// A callout owns every following line that continues the blockquote.
		let last = i;
		while (last + 1 < lines.length && /^\s*>/.test(lines[last + 1]?.text ?? '')) last++;

		const end = last + 1 < lines.length ? (lines[last + 1]?.start ?? content.length) : content.length;
		ranges.push({ start: current.start, end });
		spans.push({
			line: i + 1,
			reason: `callout: ${type}`,
			text: content.slice(current.start, end),
		});
		i = last;
	}
}

function collectComments(
	content: string,
	codeRanges: Range[],
	claimed: Range[],
	ranges: Range[],
	spans: MaskSpan[],
): void {
	for (const match of content.matchAll(new RegExp(OBSIDIAN_COMMENT))) {
		const start = match.index ?? 0;
		const end = start + match[0].length;
		if (overlaps(codeRanges, start, end)) continue;
		if (overlaps(claimed, start, end)) continue;

		ranges.push({ start, end });
		spans.push({ line: lineAt(content, start), reason: 'comment', text: match[0] });
	}
}

function collectRuleMatches(
	content: string,
	codeRanges: Range[],
	claimed: Range[],
	rules: MaskRule[],
	ranges: Range[],
	spans: MaskSpan[],
): void {
	for (const rule of rules) {
		if (rule.pattern.length === 0) continue;
		// Built fresh for every file: a shared global regex carries `lastIndex`
		// between calls, which would make the output depend on publish order.
		const regex = buildRegex(rule, `mask rule "${rule.label || rule.pattern}"`);

		for (const match of content.matchAll(regex)) {
			if (match[0].length === 0) continue;
			const start = match.index ?? 0;
			const end = start + match[0].length;
			if (!rule.inCodeBlocks && overlaps(codeRanges, start, end)) continue;
			// Already removed by a marker — counting it again would inflate the
			// masked-region count shown in the preview.
			if (overlaps(claimed, start, end)) continue;

			ranges.push({ start, end });
			spans.push({
				line: lineAt(content, start),
				reason: `rule: ${rule.label || rule.pattern}`,
				text: match[0],
			});
		}
	}
}

function buildRegex(rule: MaskRule | DenyRule, description: string): RegExp {
	const source = rule.isRegex ? rule.pattern : escapeRegex(rule.pattern);
	const flags = rule.flags.includes('g') ? rule.flags : `${rule.flags}g`;
	try {
		return new RegExp(source, flags);
	} catch (error) {
		throw new MaskError(
			`Invalid ${description}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function escapeRegex(literal: string): string {
	return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Last line of defence: patterns that must never reach the remote, checked
 * against the finished bytes. Returns where each hit is, never what it was.
 */
export function scanDenied(text: string, denyPatterns: DenyRule[]): DenyHit[] {
	const hits: DenyHit[] = [];
	for (const rule of denyPatterns) {
		if (rule.pattern.length === 0) continue;
		const regex = buildRegex(rule, `deny pattern "${rule.label || rule.pattern}"`);
		for (const match of text.matchAll(regex)) {
			if (match[0].length === 0) continue;
			hits.push({ line: lineAt(text, match.index ?? 0), label: rule.label || rule.pattern });
		}
	}
	return hits.sort((a, b) => a.line - b.line);
}
