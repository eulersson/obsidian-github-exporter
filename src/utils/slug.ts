/**
 * Mirror Quartz's path slugification so the plugin can predict the published
 * URL of a note: https://quartz.jzhao.xyz/advanced/paths
 */
export function getSlugifiedPath(path: string): string {
	// Remove .md extension if present
	if (path.endsWith('.md')) {
		path = path.slice(0, -3);
	}

	return path
		.split('/')
		.map((segment) =>
			segment
				.replace(/\s/g, '-')
				.replace(/&/g, '-and-')
				.replace(/%/g, '-percent')
				.replace(/\?/g, '')
				.replace(/#/g, '')
		)
		.join('/')
		.replace(/\/$/, '');
}
