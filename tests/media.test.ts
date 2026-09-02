import assert from 'node:assert/strict';
import test from 'node:test';
import { getLinkedMedia } from '../src/publish/media';
import { App, TFile } from './stubs/obsidian';

/** A vault holding exactly `paths`, with `Attachments` as the media folder. */
function vault(...paths: string[]): App {
	const files = new Map(paths.map(path => [path, new TFile(path)]));
	return {
		vault: {
			getAbstractFileByPath: (path: string) => files.get(path) ?? null,
			getConfig: () => 'Attachments',
		},
	};
}

test('collects an embedded image', () => {
	const app = vault('Attachments/photo.png');
	assert.deepEqual(getLinkedMedia(app, 'text ![[photo.png]] more'), ['Attachments/photo.png']);
});

test('ignores a plain link to embeddable media', () => {
	const app = vault('Attachments/photo.png');
	assert.deepEqual(getLinkedMedia(app, 'see [[photo.png]]'), []);
});

test('collects a plain wikilink to an sb3 attachment', () => {
	const app = vault('Attachments/game.sb3');
	assert.deepEqual(getLinkedMedia(app, 'Load [[game.sb3]] now'), ['Attachments/game.sb3']);
});

test('collects an sb3 wikilink carrying an alias', () => {
	const app = vault('Attachments/game.sb3');
	assert.deepEqual(getLinkedMedia(app, '[[game.sb3|the starter]]'), ['Attachments/game.sb3']);
});

test('collects an sb3 markdown link, percent-encoded and pathed', () => {
	const app = vault('Attachments/cat game.sb3');
	assert.deepEqual(
		getLinkedMedia(app, '[starter](Attachments/cat%20game.sb3)'),
		['Attachments/cat game.sb3'],
	);
});

test('collects an sb3 written as an embed', () => {
	const app = vault('Attachments/game.sb3');
	assert.deepEqual(getLinkedMedia(app, '![[game.sb3]]'), ['Attachments/game.sb3']);
});

test('de-duplicates repeated references', () => {
	const app = vault('Attachments/game.sb3');
	assert.deepEqual(
		getLinkedMedia(app, '[[game.sb3]] and again [[game.sb3]] and [x](game.sb3)'),
		['Attachments/game.sb3'],
	);
});

test('skips external URLs and unresolvable targets', () => {
	const app = vault('Attachments/game.sb3');
	assert.deepEqual(getLinkedMedia(app, '[a](https://example.com/other.sb3) [[missing.sb3]]'), []);
});

test('ignores an sb3 named in prose or in a note title', () => {
	const app = vault('Attachments/game.sb3');
	const content = 'Save it as firstname-catgame.sb3 in the shared folder. See [[Scratch Unit]].';
	assert.deepEqual(getLinkedMedia(app, content), []);
});
