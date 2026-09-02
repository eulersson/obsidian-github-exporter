import { App, Modal, TFile } from 'obsidian';
import { GitHubExporterSettings } from '../settings';
import { buildPublishContent, describeFailure } from '../publish/content';

/**
 * Show the exact text that would be committed for one note, so masking can be
 * verified before anything reaches a public repository.
 */
export class PreviewModal extends Modal {
	constructor(app: App, private readonly file: TFile, private readonly settings: GitHubExporterSettings) {
		super(app);
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass('ghx-preview');
		contentEl.createEl('h2', { text: 'Publish preview' });
		contentEl.createEl('p', { cls: 'ghx-subtle', text: this.file.path });

		let content;
		try {
			content = await buildPublishContent(this.app, this.file, this.settings);
		} catch (error) {
			const reason = describeFailure(error);
			const box = contentEl.createDiv({ cls: 'ghx-error' });
			box.createEl('strong', { text: 'This note cannot be published' });
			box.createEl('p', { text: reason ?? String(error) });
			return;
		}

		if (content.spans.length === 0) {
			contentEl.createEl('p', { text: 'Nothing is masked in this note — it publishes as written.' });
		} else {
			contentEl.createEl('h3', { text: `${content.spans.length} masked region(s) removed` });
			const list = contentEl.createEl('ul', { cls: 'ghx-spans' });
			for (const span of content.spans) {
				// Only where and why. The removed text stays out of the UI.
				list.createEl('li', { text: `Line ${span.line} — ${span.reason}` });
			}
		}

		contentEl.createEl('h3', { text: 'Published output' });
		contentEl.createEl('pre', { cls: 'ghx-output' }).createEl('code', { text: content.text });
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
