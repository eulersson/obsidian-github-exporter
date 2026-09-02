import { DEFAULT_MASK_SETTINGS, MaskSettings } from './mask';

export interface GitHubExporterSettings {
	githubToken: string;
	githubUsername: string;
	githubRepo: string;
	hostedUrl: string;
	targetBranch: string;
	targetDir: string;
	mask: MaskSettings;
}

export const DEFAULT_SETTINGS: GitHubExporterSettings = {
	githubToken: '',
	githubUsername: '',
	githubRepo: '',
	hostedUrl: '',
	targetBranch: 'main',
	targetDir: 'content',
	mask: DEFAULT_MASK_SETTINGS,
};

/**
 * Merge stored data over the defaults. `mask` needs its own merge — a shallow
 * `Object.assign` would either drop new mask fields from an older `data.json`
 * or hand out the shared default object for callers to mutate in place.
 */
export function mergeSettings(stored: Partial<GitHubExporterSettings> | null): GitHubExporterSettings {
	const mask: Partial<MaskSettings> = stored?.mask ?? {};
	return {
		...DEFAULT_SETTINGS,
		...(stored ?? {}),
		mask: {
			...DEFAULT_MASK_SETTINGS,
			...mask,
			privateCallouts: [...(mask.privateCallouts ?? DEFAULT_MASK_SETTINGS.privateCallouts)],
			rules: [...(mask.rules ?? [])],
			denyPatterns: [...(mask.denyPatterns ?? [])],
		},
	};
}
