import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { Octokit } from '@octokit/core';
import { copyPublishedUrl } from './commands/copy-url';
import { togglePublishProperty } from './commands/toggle-publish';
import { createOctokit } from './github';
import { applyPublishPlan } from './publish/apply';
import { computePublishPlan } from './publish/plan';
import { DEFAULT_SETTINGS, GitHubExporterSettings, mergeSettings } from './settings';
import { PublishPlan, formatStats } from './types';
import { PreviewModal } from './ui/preview-modal';
import { ReportModal } from './ui/report-modal';
import { GitHubExporterSettingTab } from './ui/settings-tab';

export default class GitHubExporterPlugin extends Plugin {
	settings: GitHubExporterSettings = DEFAULT_SETTINGS;
	octokit!: Octokit;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.octokit = createOctokit(this.settings);

		this.addRibbonIcon('github', 'Publish sync to GitHub', () => {
			void this.publish();
		});

		this.addCommand({
			id: 'publish-sync-to-github',
			name: 'Publish sync to GitHub',
			icon: 'upload-cloud',
			callback: () => this.publish(),
		});

		this.addCommand({
			id: 'publish-current-file-to-github',
			name: 'Publish current file to GitHub',
			icon: 'file-up',
			callback: () => this.publish(this.activeFile()),
		});

		this.addCommand({
			id: 'dry-run-publish',
			name: 'Dry run: show what publishing would change',
			icon: 'search-check',
			callback: () => this.dryRun(),
		});

		this.addCommand({
			id: 'preview-publish-output',
			name: 'Preview publish output for current file',
			icon: 'eye',
			callback: () => {
				const file = this.activeFile();
				if (!file) {
					new Notice('No active file');
					return;
				}
				new PreviewModal(this.app, file, this.settings).open();
			},
		});

		this.addCommand({
			id: 'toggle-publish',
			name: 'Toggle publish property',
			icon: 'toggle-right',
			callback: () => togglePublishProperty(this.app),
		});

		this.addCommand({
			id: 'copy-published-url',
			name: 'Copy published URL',
			icon: 'link',
			callback: () => copyPublishedUrl(this.app, this.settings),
		});

		this.addSettingTab(new GitHubExporterSettingTab(this.app, this));
	}

	private activeFile(): TFile | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView)?.file
			|| this.app.workspace.getActiveFile();
	}

	/** Publish everything, or just `only` when a single file was requested. */
	private async publish(only?: TFile | null): Promise<void> {
		if (only === null) {
			new Notice('No active file');
			return;
		}
		if (!this.validateSettings()) return;

		try {
			new Notice(only ? `Publishing ${only.path}...` : 'Starting GitHub publish process...');
			const plan = await this.plan(only ?? undefined);

			if (plan.blocked.length > 0) {
				new Notice(`Publish aborted — ${plan.blocked.length} file(s) could not be masked safely.`);
				new ReportModal(this.app, plan, 'Publish blocked').open();
				return;
			}

			if (plan.files.length === 0) {
				new Notice('Nothing to publish — everything is already up to date.');
				return;
			}

			const stats = await applyPublishPlan(this.octokit, this.settings, plan, {
				message: only ? `Update ${only.path}` : undefined,
				onProgress: message => console.debug(message),
			});

			const report = formatStats(stats);
			new Notice(`Successfully published to GitHub!\n${report}`);

			// Masked text that is still in the published history needs a rewrite,
			// so it is surfaced after the commit rather than buried in the log.
			if (plan.files.some(file => file.historyLeak)) {
				new ReportModal(this.app, plan, 'Published — masked text is still in the history').open();
			}
		} catch (error) {
			console.error('Error publishing to GitHub:', error);
			new Notice(`Error publishing to GitHub: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async dryRun(): Promise<void> {
		if (!this.validateSettings()) return;

		try {
			new Notice('Working out what would change...');
			const plan = await this.plan();
			new ReportModal(this.app, plan, 'Dry run — nothing was published').open();
		} catch (error) {
			console.error('Error computing the publish plan:', error);
			new Notice(`Error computing the publish plan: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private plan(only?: TFile): Promise<PublishPlan> {
		return computePublishPlan(this.app, this.octokit, this.settings, {
			only,
			onProgress: message => console.debug(message),
		});
	}

	private validateSettings(): boolean {
		const required: Array<[keyof GitHubExporterSettings, string]> = [
			['githubToken', 'GitHub token'],
			['githubUsername', 'GitHub username'],
			['githubRepo', 'GitHub repository'],
			['targetBranch', 'Target branch'],
			['targetDir', 'Target directory'],
		];

		const missing = required
			.filter(([key]) => !this.settings[key])
			.map(([, name]) => name);

		if (missing.length > 0) {
			new Notice(
				`Please configure the following settings before proceeding: ${missing.join(', ')}. ` +
				'Go to Settings → GitHub Exporter to complete the configuration.',
			);
			return false;
		}
		return true;
	}

	async loadSettings(): Promise<void> {
		this.settings = mergeSettings(await this.loadData() as Partial<GitHubExporterSettings> | null);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Reinitialize Octokit with updated token
		this.octokit = createOctokit(this.settings);
	}
}
