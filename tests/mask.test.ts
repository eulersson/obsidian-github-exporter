import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MASK_SETTINGS, MaskError, MaskSettings, applyMask, remoteRetainsMaskedText, scanDenied } from '../src/mask';

function settings(overrides: Partial<MaskSettings> = {}): MaskSettings {
	return { ...DEFAULT_MASK_SETTINGS, privateCallouts: ['private'], rules: [], denyPatterns: [], ...overrides };
}

test('leaves an unmasked note byte-identical', () => {
	const input = 'Title\n\n\n\nStill three blank lines above.\n   \n';
	const { output, spans } = applyMask(input, settings());
	assert.equal(output, input, 'untouched notes must not be rewritten');
	assert.equal(spans.length, 0);
});

test('removes a block region and leaves a single blank line', () => {
	const input = 'before\n%%mask-start%%\nsecret\n%%mask-end%%\nafter\n';
	const { output, spans } = applyMask(input, settings());
	assert.equal(output, 'before\n\nafter\n');
	assert.equal(spans.length, 1);
	assert.equal(spans[0].line, 2);
	assert.equal(spans[0].reason, 'region');
});

test('removes an inline region mid-sentence', () => {
	const { output } = applyMask('Salary is %%mask-start%%42k%%mask-end%%.\n', settings());
	assert.equal(output, 'Salary is .\n');
});

test('accepts HTML alias markers for standalone .html files', () => {
	const { output } = applyMask('<p>a</p>\n<!-- mask-start -->\n<p>secret</p>\n<!--mask-end-->\n<p>b</p>\n', settings());
	assert.equal(output, '<p>a</p>\n\n<p>b</p>\n');
});

test('refuses to publish when a region is never closed', () => {
	assert.throws(() => applyMask('a\n%%mask-start%%\nsecret\n', settings()), (error: unknown) => {
		assert.ok(error instanceof MaskError);
		assert.equal(error.line, 2);
		return true;
	});
});

test('refuses an end marker with no start, and nested starts', () => {
	assert.throws(() => applyMask('a\n%%mask-end%%\n', settings()), MaskError);
	assert.throws(() => applyMask('%%mask-start%%\n%%mask-start%%\nx\n%%mask-end%%\n', settings()), MaskError);
});

test('ignores markers inside fenced code so a note can document the syntax', () => {
	const input = 'intro\n\n```md\n%%mask-start%%\nexample\n%%mask-end%%\n```\n\nend\n';
	const { output, spans } = applyMask(input, settings());
	assert.equal(output, input);
	assert.equal(spans.length, 0);
});

test('strips a private callout with all of its continuation lines', () => {
	const input = '# Note\n\n> [!private]\n> line one\n> line two\n\n> [!note]\n> kept\n';
	const { output, spans } = applyMask(input, settings());
	assert.equal(output, '# Note\n\n> [!note]\n> kept\n');
	assert.equal(spans[0].reason, 'callout: private');
});

test('masks a heading section down to the next same-or-higher heading', () => {
	const input = '# Top\n\n## Costs %%mask-section%%\n\nsecret\n\n### Detail\n\nalso secret\n\n## Public\n\nkept\n';
	const { output, spans } = applyMask(input, settings());
	assert.equal(output, '# Top\n\n## Public\n\nkept\n');
	assert.match(spans[0].reason, /^section: ## Costs$/);
});

test('masks a heading section that runs to the end of the note', () => {
	const { output } = applyMask('# Top\n\nkept\n\n## Private %%mask-section%%\n\nsecret\n', settings());
	assert.equal(output, '# Top\n\nkept\n');
});

test('rejects the section tag anywhere but a heading', () => {
	assert.throws(() => applyMask('a paragraph %%mask-section%%\nmore\n', settings()), (error: unknown) => {
		assert.ok(error instanceof MaskError);
		assert.equal(error.line, 1);
		return true;
	});
});

test('strips plain Obsidian comments but not code', () => {
	const input = 'kept %%an editorial note%% kept\n\n`%%not a comment%%`\n';
	const { output } = applyMask(input, settings());
	assert.equal(output, 'kept  kept\n\n`%%not a comment%%`\n');
});

test('drops media embedded inside a masked region', () => {
	const input = 'intro\n\n%%mask-start%%\n![[receipt.png]]\n%%mask-end%%\n\n![[public.png]]\n';
	const { output } = applyMask(input, settings());
	assert.ok(!output.includes('receipt.png'), 'masked media must not survive into the published text');
	assert.ok(output.includes('public.png'));
});

test('applies literal and regex rules, skipping code by default', () => {
	const masked = settings({
		rules: [
			{ pattern: 'sk-[a-z0-9]+', isRegex: true, flags: '', inCodeBlocks: false, label: 'API keys' },
			{ pattern: 'Acme Corp', isRegex: false, flags: '', inCodeBlocks: false, label: 'client' },
		],
	});
	const input = 'key sk-abc123 for Acme Corp\n\n```\nsk-inside-code\n```\n';
	const { output, spans } = applyMask(input, masked);
	assert.equal(output, 'key  for \n\n```\nsk-inside-code\n```\n');
	assert.deepEqual(spans.map(span => span.reason), ['rule: API keys', 'rule: client']);
});

test('a rule can opt into code blocks', () => {
	const masked = settings({
		rules: [{ pattern: 'sk-[a-z0-9-]+', isRegex: true, flags: '', inCodeBlocks: true, label: 'API keys' }],
	});
	const { output } = applyMask('```\nsk-inside-code\n```\n', masked);
	assert.equal(output, '```\n\n```\n');
});

test('an invalid rule aborts instead of being skipped', () => {
	const masked = settings({
		rules: [{ pattern: '([unclosed', isRegex: true, flags: '', inCodeBlocks: false, label: 'broken' }],
	});
	assert.throws(() => applyMask('anything\n', masked), MaskError);
});

test('a rule that matches its own output is rejected as unstable', () => {
	// Removing "ab" from "aabb" leaves a fresh "ab": the file would change on
	// every publish and commit forever.
	const masked = settings({
		rules: [{ pattern: 'ab', isRegex: false, flags: '', inCodeBlocks: false, label: 'unstable' }],
	});
	assert.throws(() => applyMask('aabb\n', masked), (error: unknown) => {
		assert.ok(error instanceof MaskError);
		assert.match(error.message, /not stable/);
		return true;
	});
});

test('is deterministic across repeated runs and files', () => {
	const masked = settings({
		rules: [{ pattern: 'secret\\d', isRegex: true, flags: 'g', inCodeBlocks: false, label: 'secrets' }],
	});
	const a = 'one secret1 two\n';
	const b = 'three secret2 four\n';
	const first = [applyMask(a, masked).output, applyMask(b, masked).output];
	const second = [applyMask(a, masked).output, applyMask(b, masked).output];
	// A shared global regex would carry lastIndex between files and diverge here.
	assert.deepEqual(first, second);
	assert.deepEqual(first, ['one  two\n', 'three  four\n']);
});

test('masking is a fixed point', () => {
	const input = '# Top\n\n> [!private]\n> hidden\n\n%%mask-start%%\nmore\n%%mask-end%%\n\n%% note %%\n\ntail\n';
	const once = applyMask(input, settings()).output;
	assert.equal(applyMask(once, settings()).output, once);
});

test('normalisation does not reformat fenced code', () => {
	const input = '%%mask-start%%\ngone\n%%mask-end%%\n\n```\na\n\n\n\nb\n```\n';
	const { output } = applyMask(input, settings());
	assert.equal(output, '```\na\n\n\n\nb\n```\n');
});

test('deny patterns report where, never what', () => {
	const hits = scanDenied('line one\nmy token is sk-live-1234\n', [
		{ pattern: 'sk-live-\\d+', isRegex: true, flags: '', label: 'live keys' },
	]);
	assert.deepEqual(hits, [{ line: 2, label: 'live keys' }]);
});

test('empty patterns are ignored rather than matching everything', () => {
	assert.deepEqual(scanDenied('anything', [{ pattern: '', isRegex: true, flags: '', label: 'blank' }]), []);
	const { output } = applyMask('anything\n', settings({
		rules: [{ pattern: '', isRegex: true, flags: '', inCodeBlocks: false, label: 'blank' }],
	}));
	assert.equal(output, 'anything\n');
});

test('detects masked text that is still in the published copy', () => {
	const spans = applyMask('a\n%%mask-start%%\nthe quarterly figures are bad\n%%mask-end%%\nb\n', settings()).spans;
	assert.equal(remoteRetainsMaskedText('a\nthe quarterly figures are bad\nb\n', spans), true);
	assert.equal(remoteRetainsMaskedText('a\nb\n', spans), false);
});

test('refuses a marker hidden inside an unterminated code fence', () => {
	// A stray ``` would otherwise turn the rest of the note into "code", where
	// the marker is ignored and the secret ships.
	const input = 'intro\n\n```\nunclosed\n\n%%mask-start%%\nsecret\n%%mask-end%%\n';
	assert.throws(() => applyMask(input, settings()), (error: unknown) => {
		assert.ok(error instanceof MaskError);
		assert.match(error.message, /unterminated code fence/);
		return true;
	});
});

test('a stray pair of backticks cannot swallow a marker on later lines', () => {
	// `inline code` is matched a line at a time, so these two loose backticks
	// do not mark the paragraphs between them as code.
	const input = 'a ` stray\n\nmiddle ` tick\n\n%%mask-start%%\nsecret\n%%mask-end%%\n\nend\n';
	const { output, spans } = applyMask(input, settings());
	assert.equal(spans.length, 1);
	assert.ok(!output.includes('secret'));
});

test('tilde fences protect their contents too', () => {
	const input = 'a\n\n~~~\n%%mask-start%%\nx\n%%mask-end%%\n~~~\n\nb\n';
	assert.equal(applyMask(input, settings()).output, input);
});

test('leaves frontmatter intact when the body is masked', () => {
	const input = '---\npublish: true\n---\n\n# Title\n\n%%mask-start%%\nsecret\n%%mask-end%%\n\nend\n';
	assert.equal(applyMask(input, settings()).output, '---\npublish: true\n---\n\n# Title\n\nend\n');
});

test('keeps frontmatter first when the mask sits directly beneath it', () => {
	const input = '---\npublish: true\n---\n\n%%mask-start%%\nsecret\n%%mask-end%%\n\n# Title\n';
	const { output } = applyMask(input, settings());
	assert.ok(output.startsWith('---\npublish: true\n---\n'), 'frontmatter must stay on line 1');
	assert.equal(output, '---\npublish: true\n---\n\n# Title\n');
});
