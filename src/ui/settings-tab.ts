import { App, PluginSettingTab, Setting } from 'obsidian';
import type GitHubExporterPlugin from '../main';
import { DenyRule, MaskRule } from '../mask';

export class GitHubExporterSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: GitHubExporterPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('GitHub token')
			.setDesc('Your GitHub personal access token')
			.addText(text => text
				.setPlaceholder('Enter your token')
				.setValue(this.plugin.settings.githubToken)
				.onChange(async (value) => {
					this.plugin.settings.githubToken = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('GitHub username')
			.setDesc('Your GitHub username')
			.addText(text => text
				.setPlaceholder('Enter your username')
				.setValue(this.plugin.settings.githubUsername)
				.onChange(async (value) => {
					this.plugin.settings.githubUsername = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('GitHub repository')
			.setDesc('The repository to publish to')
			.addText(text => text
				.setPlaceholder('Enter repository name')
				.setValue(this.plugin.settings.githubRepo)
				.onChange(async (value) => {
					this.plugin.settings.githubRepo = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Target branch')
			.setDesc('The branch to drop the files to.')
			.addText(text => text
				.setPlaceholder('Enter target branch')
				.setValue(this.plugin.settings.targetBranch)
				.onChange(async (value) => {
					this.plugin.settings.targetBranch = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Target directory')
			.setDesc('The directory in the repository to drop the files to.')
			.addText(text => text
				.setPlaceholder('Enter target directory')
				.setValue(this.plugin.settings.targetDir)
				.onChange(async (value) => {
					this.plugin.settings.targetDir = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Hosted URL')
			.setDesc('Required for generating published URLs. The base URL where your site will be accessible (e.g. https://example.com)')
			.addText(text => text
				.setPlaceholder('Enter hosted URL (e.g. https://example.com)')
				.setValue(this.plugin.settings.hostedUrl)
				.onChange(async (value) => {
					this.plugin.settings.hostedUrl = value;
					await this.plugin.saveSettings();
				}));

		this.displayMasking(containerEl);
	}

	private displayMasking(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Masking').setHeading();

		const intro = containerEl.createEl('p', { cls: 'setting-item-description' });
		intro.appendText('Masked content is removed before anything is uploaded. Always on — ');
		intro.appendText('use ');
		intro.createEl('code', { text: '%%mask-start%%' });
		intro.appendText(' / ');
		intro.createEl('code', { text: '%%mask-end%%' });
		intro.appendText(' around a region, a ');
		intro.createEl('code', { text: '> [!private]' });
		intro.appendText(' callout, ');
		intro.createEl('code', { text: '%%mask-section%%' });
		intro.appendText(' on a heading, or a plain ');
		intro.createEl('code', { text: '%% comment %%' });
		intro.appendText('.');

		new Setting(containerEl)
			.setName('Private callout types')
			.setDesc('Comma-separated callout types stripped from published notes, e.g. private, secret.')
			.addText(text => text
				.setPlaceholder('private')
				.setValue(this.plugin.settings.mask.privateCallouts.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.mask.privateCallouts = value
						.split(',')
						.map(type => type.trim())
						.filter(type => type.length > 0);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Mask rules')
			.setDesc('Every match is removed from the published copy. Applied to the file as written on disk.')
			.addButton(button => button
				.setButtonText('Add rule')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.mask.rules.push({
						pattern: '', isRegex: true, flags: 'g', inCodeBlocks: false, label: '',
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		this.plugin.settings.mask.rules.forEach((rule, index) => {
			this.renderRule(containerEl, rule, index);
		});

		new Setting(containerEl)
			.setName('Deny patterns')
			.setDesc('Checked against the finished bytes. A match aborts the whole publish — the safety net for a region you forgot to mask.')
			.addButton(button => button
				.setButtonText('Add pattern')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.mask.denyPatterns.push({
						pattern: '', isRegex: true, flags: 'g', label: '',
					});
					await this.plugin.saveSettings();
					this.display();
				}));

		this.plugin.settings.mask.denyPatterns.forEach((rule, index) => {
			this.renderDenyPattern(containerEl, rule, index);
		});
	}

	private renderRule(containerEl: HTMLElement, rule: MaskRule, index: number): void {
		const setting = new Setting(containerEl)
			.setClass('ghx-rule')
			.addText(text => text
				.setPlaceholder('Label')
				.setValue(rule.label)
				.onChange(async (value) => {
					rule.label = value;
					await this.plugin.saveSettings();
				}))
			.addText(text => text
				.setPlaceholder('Pattern')
				.setValue(rule.pattern)
				.onChange(async (value) => {
					rule.pattern = value;
					await this.plugin.saveSettings();
				}))
			.addToggle(toggle => toggle
				.setTooltip('Treat the pattern as a regular expression')
				.setValue(rule.isRegex)
				.onChange(async (value) => {
					rule.isRegex = value;
					await this.plugin.saveSettings();
				}))
			.addToggle(toggle => toggle
				.setTooltip('Also match inside code blocks')
				.setValue(rule.inCodeBlocks)
				.onChange(async (value) => {
					rule.inCodeBlocks = value;
					await this.plugin.saveSettings();
				}));

		this.addRemoveButton(setting, () => this.plugin.settings.mask.rules.splice(index, 1));
	}

	private renderDenyPattern(containerEl: HTMLElement, rule: DenyRule, index: number): void {
		const setting = new Setting(containerEl)
			.setClass('ghx-rule')
			.addText(text => text
				.setPlaceholder('Label')
				.setValue(rule.label)
				.onChange(async (value) => {
					rule.label = value;
					await this.plugin.saveSettings();
				}))
			.addText(text => text
				.setPlaceholder('Pattern')
				.setValue(rule.pattern)
				.onChange(async (value) => {
					rule.pattern = value;
					await this.plugin.saveSettings();
				}))
			.addToggle(toggle => toggle
				.setTooltip('Treat the pattern as a regular expression')
				.setValue(rule.isRegex)
				.onChange(async (value) => {
					rule.isRegex = value;
					await this.plugin.saveSettings();
				}));

		this.addRemoveButton(setting, () => this.plugin.settings.mask.denyPatterns.splice(index, 1));
	}

	private addRemoveButton(setting: Setting, remove: () => void): void {
		setting.addExtraButton(button => button
			.setIcon('trash-2')
			.setTooltip('Remove')
			.onClick(async () => {
				remove();
				await this.plugin.saveSettings();
				this.display();
			}));
	}
}
