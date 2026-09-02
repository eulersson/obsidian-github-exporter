/** A half-open `[start, end)` character range in a document. */
export interface Range {
	start: number;
	end: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

export interface CodeRanges {
	ranges: Range[];
	/**
	 * Where an unterminated fence starts, if there is one. Everything after it
	 * counts as code, which would silently swallow any mask marker inside — so
	 * callers treat markers past this point as an error rather than ignoring them.
	 */
	unterminatedFenceAt: number | null;
}

/**
 * Character ranges that markdown treats as code: fenced blocks and inline code
 * spans. Mask markers found inside these are ignored, so a note that documents
 * the masking syntax does not mask itself.
 */
export function computeCodeRanges(text: string): CodeRanges {
	const ranges: Range[] = [];
	const lines = text.split('\n');

	let offset = 0;
	let fenceStart = -1;
	let fenceMarker = '';
	for (const line of lines) {
		const lineEnd = offset + line.length;
		if (fenceStart < 0) {
			const open = FENCE_OPEN.exec(line);
			if (open) {
				fenceStart = offset;
				fenceMarker = open[1];
			}
		} else {
			// A fence closes on a line of the same character, at least as long,
			// with nothing else on it.
			const char = fenceMarker[0];
			const closer = new RegExp(`^ {0,3}\\${char}{${fenceMarker.length},}\\s*$`);
			if (closer.test(line)) {
				ranges.push({ start: fenceStart, end: lineEnd });
				fenceStart = -1;
				fenceMarker = '';
			}
		}
		offset = lineEnd + 1; // + the newline
	}
	// An unclosed fence protects everything to the end of the file.
	const unterminatedFenceAt = fenceStart >= 0 ? fenceStart : null;
	if (fenceStart >= 0) {
		ranges.push({ start: fenceStart, end: text.length });
	}

	// Inline code, but only in the gaps between fenced blocks.
	let cursor = 0;
	for (const fenced of [...ranges, { start: text.length, end: text.length }]) {
		collectInlineCode(text, cursor, fenced.start, ranges);
		cursor = fenced.end;
	}

	return { ranges: mergeRanges(ranges), unterminatedFenceAt };
}

function collectInlineCode(text: string, from: number, to: number, into: Range[]): void {
	if (to <= from) return;
	const slice = text.slice(from, to);
	// Deliberately single-line: a stray pair of backticks several paragraphs
	// apart would otherwise mark everything between them as code, and any mask
	// marker caught in there would be ignored.
	const inline = /(`+)[^\n]*?\1/g;
	for (const match of slice.matchAll(inline)) {
		const start = from + (match.index ?? 0);
		into.push({ start, end: start + match[0].length });
	}
}

export function mergeRanges(ranges: Range[]): Range[] {
	if (ranges.length === 0) return [];
	const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: Range[] = [sorted[0]];
	for (const range of sorted.slice(1)) {
		const last = merged[merged.length - 1];
		if (range.start <= last.end) {
			last.end = Math.max(last.end, range.end);
		} else {
			merged.push({ ...range });
		}
	}
	return merged;
}

/** True when `[start, end)` touches any of the (merged, sorted) ranges. */
export function overlaps(ranges: Range[], start: number, end: number): boolean {
	for (const range of ranges) {
		if (range.start >= end) return false;
		if (range.end > start) return true;
	}
	return false;
}

/** Cut every range out of the text in one pass. Ranges may overlap. */
export function applyRemovals(text: string, ranges: Range[]): string {
	const merged = mergeRanges(ranges);
	if (merged.length === 0) return text;

	let out = '';
	let cursor = 0;
	for (const range of merged) {
		out += text.slice(cursor, range.start);
		cursor = range.end;
	}
	return out + text.slice(cursor);
}

/** Maps a character offset to a 1-based line number. */
export function lineAt(text: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index && i < text.length; i++) {
		if (text[i] === '\n') line++;
	}
	return line;
}

/**
 * Tidy the seams left behind by removals: collapse runs of blank lines, drop
 * leading blank lines, and end with exactly one newline. Code fences are passed
 * through untouched, and the transform is idempotent so it cannot cause churn.
 */
export function normalizeBlankLines(text: string): string {
	const lines = text.split('\n');
	const out: string[] = [];

	let inFence = false;
	let fenceMarker = '';
	for (const line of lines) {
		if (!inFence) {
			const open = FENCE_OPEN.exec(line);
			if (open) {
				inFence = true;
				fenceMarker = open[1];
				out.push(line);
				continue;
			}
		} else {
			const char = fenceMarker[0];
			const closer = new RegExp(`^ {0,3}\\${char}{${fenceMarker.length},}\\s*$`);
			if (closer.test(line)) {
				inFence = false;
				fenceMarker = '';
			}
			out.push(line);
			continue;
		}

		if (/^\s*$/.test(line)) {
			// At most one blank line in a row, and none at the top of the file.
			if (out.length === 0 || out[out.length - 1] === '') continue;
			out.push('');
		} else {
			out.push(line);
		}
	}

	while (out.length > 0 && out[out.length - 1] === '') out.pop();
	return out.length === 0 ? '' : `${out.join('\n')}\n`;
}
