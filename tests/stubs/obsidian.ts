/**
 * The slice of the Obsidian API the unit tests need.
 *
 * Nothing here ships with the plugin: `esbuild.test.mjs` aliases `obsidian` to
 * this file so modules that talk to the real API can be exercised outside the
 * app. Keep it minimal — it is a test fixture, not a reimplementation.
 */

export class TFile {
	path: string;

	constructor(path: string) {
		this.path = path;
	}

	get name(): string {
		return this.path.split('/').pop() ?? this.path;
	}

	get extension(): string {
		return this.name.split('.').pop() ?? '';
	}
}

export class TFolder {
	path: string;

	constructor(path: string) {
		this.path = path;
	}
}

export interface App {
	vault: {
		getAbstractFileByPath(path: string): TFile | TFolder | null;
		getConfig(key: string): string;
	};
}
