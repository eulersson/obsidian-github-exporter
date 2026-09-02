import { App, MarkdownView, Notice, TFile } from 'obsidian';

/** Add or remove `publish: true` in the active note's frontmatter. */
export async function togglePublishProperty(app: App): Promise<void> {
	const activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView) {
		new Notice('No active markdown file');
		return;
	}

	const file: TFile | null = activeView.file;
	if (!file) {
		new Notice('No file found');
		return;
	}

	const content = await app.vault.read(file);

	// Check if file has frontmatter
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	let newContent: string;
	let hasPublish = false;

	if (frontmatterMatch) {
		// File has frontmatter, toggle publish property
		const frontmatter = frontmatterMatch[1];
		hasPublish = frontmatter.includes('publish: true') || frontmatter.includes('publish: "true"');

		if (hasPublish) {
			// Remove publish property
			const updatedFrontmatter = frontmatter.replace(/publish:\s*(true|"true")\n?/, '').trim();
			if (updatedFrontmatter === '') {
				// If frontmatter is empty, remove it entirely and any leading newlines
				newContent = content.replace(/^---\n[\s\S]*?\n---\n*/, '');
			} else {
				// Keep the frontmatter with remaining properties
				newContent = content.replace(/^---\n[\s\S]*?\n---/, `---\n${updatedFrontmatter}\n---`);
			}
		} else {
			// Add publish property
			newContent = content.replace(/^---\n/, '---\npublish: true\n');
		}
	} else {
		// No frontmatter, add it with publish property
		newContent = `---\npublish: true\n---\n\n${content}`;
	}

	await app.vault.modify(file, newContent);
	new Notice(`Publish property ${hasPublish ? 'removed' : 'added'}`);
}
