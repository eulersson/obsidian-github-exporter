import { App, MarkdownView, Notice, TFile } from 'obsidian';
import { GitHubExporterSettings } from '../settings';
import { getSlugifiedPath } from '../utils/slug';

/** Copy the note's public Quartz URL to the clipboard. */
export function copyPublishedUrl(app: App, settings: GitHubExporterSettings): void {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	const file: TFile | null = activeView?.file || app.workspace.getActiveFile();

	if (!file) {
		new Notice('No active file');
		return;
	}

	if (!settings.hostedUrl) {
		new Notice('Please set the hosted URL in plugin settings to generate published links');
		return;
	}

	const url = `${settings.hostedUrl}/${getSlugifiedPath(file.path)}`;
	navigator.clipboard.writeText(url).then(() => {
		new Notice(`URL copied to clipboard!\n${url}`);
	}).catch(err => {
		new Notice('Failed to copy URL to clipboard');
		console.error('Failed to copy URL:', err);
	});
}
