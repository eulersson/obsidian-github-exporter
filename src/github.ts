import { Octokit } from '@octokit/core';
import { GitHubExporterSettings } from './settings';

/**
 * Octokit configured to bypass every layer of HTTP cache:
 *   - a custom fetch with `cache: 'no-store'` defeats Chromium's HTTP cache
 *   - an empty If-None-Match prevents ETag/304 reuse
 *   - Cache-Control: no-cache asks GitHub's CDN for a fresh copy
 *   - a cache-busting query param defeats any remaining intermediary
 * Stale reads here would mean publishing against an outdated tree.
 */
export function createOctokit(settings: GitHubExporterSettings): Octokit {
	const noCacheFetch: typeof fetch = (input, init) => {
		let url = typeof input === 'string' ? input : (input as Request).url;
		const method = (init?.method || 'GET').toUpperCase();
		if (method === 'GET') {
			url += (url.includes('?') ? '&' : '?') + '_=' + Date.now();
		}
		return fetch(url, { ...(init || {}), cache: 'no-store' });
	};

	return new Octokit({
		auth: settings.githubToken,
		request: {
			fetch: noCacheFetch,
			headers: {
				'If-None-Match': '',
				'Cache-Control': 'no-cache',
			},
		},
	});
}
