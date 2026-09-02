import esbuild from 'esbuild';
import { readdirSync } from 'fs';
import { resolve } from 'path';

// Bundles the pure modules under test into plain CJS so `node --test` can run
// them without a TypeScript loader. Nothing here ships with the plugin.
const entryPoints = readdirSync('tests')
	.filter(name => name.endsWith('.test.ts'))
	.map(name => `tests/${name}`);

await esbuild.build({
	entryPoints,
	bundle: true,
	platform: 'node',
	format: 'cjs',
	outdir: 'test-build',
	// The real API only exists inside Obsidian, so modules that import it get
	// the test stub instead. An absolute path keeps the alias independent of
	// which file did the importing.
	alias: { obsidian: resolve('tests/stubs/obsidian.ts') },
	logLevel: 'warning',
	// package.json sets "type": "module", so emit .cjs to keep these CommonJS
	outExtension: { '.js': '.cjs' },
});
