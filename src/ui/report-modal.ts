import { App, Modal } from 'obsidian';
import { PlannedFile, PublishPlan, formatStats, summarize } from '../types';

/**
 * The result of a dry run: everything a publish would change, and everything it
 * refuses to touch, without having touched anything.
 */
export class ReportModal extends Modal {
	constructor(app: App, private readonly plan: PublishPlan, private readonly title: string) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('ghx-report');
		contentEl.createEl('h2', { text: this.title });

		if (this.plan.blocked.length > 0) {
			const box = contentEl.createDiv({ cls: 'ghx-error' });
			box.createEl('strong', { text: `${this.plan.blocked.length} file(s) blocked — publishing is refused` });
			const list = box.createEl('ul');
			for (const blocked of this.plan.blocked) {
				list.createEl('li', { text: `${blocked.path} — ${blocked.reason}` });
			}
		}

		const leaks = this.plan.files.filter(file => file.historyLeak);
		if (leaks.length > 0) {
			const box = contentEl.createDiv({ cls: 'ghx-warning' });
			box.createEl('strong', { text: 'Already published unmasked' });
			box.createEl('p', {
				text: 'The copy on the remote still contains text that is masked now. ' +
					'Committing removes it from the branch tip, but it stays in the ' +
					'repository history — rewrite the history to remove it for good.',
			});
			const list = box.createEl('ul');
			for (const file of leaks) list.createEl('li', { text: file.path });
		}

		if (this.plan.files.length === 0) {
			contentEl.createEl('p', { text: 'Nothing to publish — everything is already up to date.' });
			return;
		}

		contentEl.createEl('p', { cls: 'ghx-subtle', text: formatStats(summarize(this.plan)) });
		this.renderGroup(contentEl, 'Added', this.plan.files.filter(f => f.action === 'create'));
		this.renderGroup(contentEl, 'Updated', this.plan.files.filter(f => f.action === 'update'));
		this.renderGroup(contentEl, 'Deleted', this.plan.files.filter(f => f.action === 'delete'));
	}

	private renderGroup(parent: HTMLElement, title: string, files: PlannedFile[]): void {
		if (files.length === 0) return;
		parent.createEl('h3', { text: `${title} (${files.length})` });
		const list = parent.createEl('ul', { cls: 'ghx-files' });
		for (const file of files) {
			const masked = file.maskedSpans ? ` — ${file.maskedSpans} masked region(s)` : '';
			list.createEl('li', { text: `${file.remotePath}${masked}` });
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
