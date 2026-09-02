import esbuild from 'esbuild';
import { readdirSync } from 'fs';

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
	external: ['obsidian'],
	logLevel: 'warning',
	// package.json sets "type": "module", so emit .cjs to keep these CommonJS
	outExtension: { '.js': '.cjs' },
});
