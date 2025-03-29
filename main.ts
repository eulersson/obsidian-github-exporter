import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { Octokit } from '@octokit/core';
import * as crypto from 'crypto';

// Add type declaration for Web Crypto API
declare global {
	interface Window {
		crypto: {
			subtle: {
				digest(algorithm: string, data: ArrayBuffer): Promise<ArrayBuffer>;
			};
		};
	}
}

// Helper functions for base64 encoding/decoding
function base64Encode(str: string): string {
	// Convert string to UTF-8 bytes
	const bytes = new TextEncoder().encode(str);
	// Convert bytes to base64
	return btoa(String.fromCharCode.apply(null, bytes));
}

function base64Decode(str: string): string {
	// Convert base64 to bytes
	const bytes = atob(str).split('').map(c => c.charCodeAt(0));
	// Convert bytes to UTF-8 string
	return new TextDecoder().decode(new Uint8Array(bytes));
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	// Convert bytes to string in chunks to avoid stack overflow
	let binary = '';
	const chunkSize = 8192; // Process in 8KB chunks
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.slice(i, Math.min(i + chunkSize, bytes.length));
		binary += String.fromCharCode.apply(null, chunk);
	}
	return btoa(binary);
}

// Helper function to calculate SHA-1 hash
async function calculateSHA1(data: ArrayBuffer): Promise<string> {
	// Use the Web Crypto API if available, otherwise fall back to Node.js crypto
	if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
		const hashBuffer = await window.crypto.subtle.digest('SHA-1', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
	} else {
		// Fallback to Node.js crypto
		const hash = crypto.createHash('sha1');
		hash.update(Buffer.from(data));
		return hash.digest('hex');
	}
}

interface GitHubExporterSettings {
	githubToken: string;
	githubUsername: string;
	githubRepo: string;
	hostedUrl: string;
	targetBranch: string;
	targetDir: string;
}

const DEFAULT_SETTINGS: GitHubExporterSettings = {
	githubToken: '',
	githubUsername: '',
	githubRepo: '',
	hostedUrl: '',
	targetBranch: 'main',
	targetDir: 'content'
}

interface GitHubContentResponse {
	type: "dir" | "file" | "submodule" | "symlink";
	size: number;
	name: string;
	path: string;
	content?: string;
	sha: string;
	url: string;
	git_url: string | null;
	html_url: string | null;
	download_url: string | null;
	_links: {
		self: string;
		git: string;
		html: string;
	};
}

interface GitTreeItem {
	path: string;
	mode: '100644' | '100755' | '040000' | '160000' | '120000';
	type: 'blob' | 'tree' | 'commit';
	sha: string | null;
}

interface GitTreeResponse {
	path: string;
	mode: '100644' | '100755' | '040000' | '160000' | '120000';
	type: 'blob' | 'tree' | 'commit';
	sha: string;
}

export default class GitHubExporterPlugin extends Plugin {
	settings: GitHubExporterSettings;
	octokit: Octokit;

	async onload() {
		await this.loadSettings();
		
		console.log('GitHub Exporter plugin loaded successfully');
		
		// Initialize Octokit
		this.initializeOctokit();

		// Add ribbon icon
		this.addRibbonIcon('github', 'Publish Sync to GitHub', (evt: MouseEvent) => {
			this.publishToGitHub();
		});

		// Add command
		this.addCommand({
			id: 'publish-sync-to-github',
			name: 'Publish Sync to GitHub',
			callback: () => {
				this.publishToGitHub();
			}
		});

		// Add upload current file command
		this.addCommand({
			id: 'publish-current-file-to-github',
			name: 'Publish Current File to GitHub',
			callback: () => {
				this.uploadCurrentFile();
			}
		});

		// Add toggle publish command
		this.addCommand({
			id: 'toggle-publish',
			name: 'Toggle Publish Property',
			callback: () => {
				this.togglePublishProperty();
			}
		});

		// Add copy URL command
		this.addCommand({
			id: 'copy-published-url',
			name: 'Copy Published URL',
			callback: () => {
				const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
				const file: TFile | null = activeView?.file || this.app.workspace.getActiveFile();
				
				if (!file) {
					new Notice('No active file');
					return;
				}

				// Check if hosted URL is set
				if (!this.settings.hostedUrl) {
					new Notice('Please set the Hosted URL in plugin settings to generate published URLs');
					return;
				}

				// Get the attachments folder path from Obsidian config
				const attachmentsFolder = (this.app.vault as any).getConfig('attachmentFolderPath') || 'Attachments';
				
				// Check if the file is in the attachments folder
				const isAttachment = file.path.startsWith(attachmentsFolder);
				
				// Construct the path based on whether it's an attachment or not
				let path = file.path;
				if (isAttachment) {
					// For attachments, we want to keep the full path relative to the attachments folder
					path = file.path;
				} else {
					// For markdown files, we want to use the target directory
					path = file.path;
				}

				const slugifiedPath = this.getSlugifiedPath(path);
				const url = `${this.settings.hostedUrl}/${slugifiedPath}`;
				
				// Copy to clipboard
				navigator.clipboard.writeText(url).then(() => {
					new Notice(`URL copied to clipboard!\n${url}`);
				}).catch(err => {
					new Notice('Failed to copy URL to clipboard');
					console.error('Failed to copy URL:', err);
				});
			}
		});

		// Add settings tab
		this.addSettingTab(new GitHubExporterSettingTab(this.app, this));
	}

	async publishToGitHub() {
		try {
			// Validate settings before proceeding
			if (!this.validateSettings()) {
				return;
			}

			new Notice('Starting GitHub publish process...');
			
			// Get all markdown files
			const files = this.app.vault.getMarkdownFiles();
			
			// Filter files with publish: true
			const filesToPublish = files.filter(file => {
				const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
				return frontmatter?.publish === true || frontmatter?.publish === "true";
			});

			// Initialize tracking variables
			let stats = {
				pages: { added: 0, updated: 0, deleted: 0 },
				media: { added: 0, updated: 0, deleted: 0 }
			};

			// Get the current commit SHA of the target branch
			const { data: ref } = await this.octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
				owner: this.settings.githubUsername,
				repo: this.settings.githubRepo,
				ref: `heads/${this.settings.targetBranch}`
			});

			// Get the current tree SHA
			const { data: commit } = await this.octokit.request('GET /repos/{owner}/{repo}/git/commits/{commit_sha}', {
				owner: this.settings.githubUsername,
				repo: this.settings.githubRepo,
				commit_sha: ref.object.sha
			});

			// Get the current tree
			const { data: baseTree } = await this.octokit.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
				owner: this.settings.githubUsername,
				repo: this.settings.githubRepo,
				tree_sha: commit.tree.sha,
				recursive: '1'
			});

			// Create a map of existing files in the repository
			const existingFilesMap = new Map<string, GitTreeResponse>();
			for (const item of baseTree.tree) {
				if (item.type === 'blob' && item.path) {
					existingFilesMap.set(item.path, item as GitTreeResponse);
				}
			}

			// Prepare changes
			const changes: GitTreeItem[] = [];
			const localPaths = new Set<string>();

			// Process each file
			for (const file of filesToPublish) {
				const content = await this.app.vault.read(file);
				const path = file.path;
				localPaths.add(path);

				// Check if file exists in repository
				const existingFile = existingFilesMap.get(`${this.settings.targetDir}/${path}`);
				let blobSha: string;

				if (existingFile) {
					// Calculate SHA of new content
					const encoder = new TextEncoder();
					const contentBytes = encoder.encode(content);
					const header = `blob ${contentBytes.length}\0`;
					const headerBytes = encoder.encode(header);
					const combinedBytes = new Uint8Array(headerBytes.length + contentBytes.length);
					combinedBytes.set(headerBytes);
					combinedBytes.set(contentBytes, headerBytes.length);
					const newSha = await calculateSHA1(combinedBytes.buffer);

					if (newSha === existingFile.sha) {
						console.log(`File ${path} hasn't changed, skipping update`);
						blobSha = existingFile.sha;
					} else {
						new Notice(`Updating ${path}...`);
						stats.pages.updated++;
						// Create new blob for changed content
						const { data: blob } = await this.octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
							owner: this.settings.githubUsername,
							repo: this.settings.githubRepo,
							content: arrayBufferToBase64(contentBytes),
							encoding: 'base64'
						});
						blobSha = blob.sha;
					}
				} else {
					new Notice(`Creating ${path}...`);
					stats.pages.added++;
					// Create new blob for new content
					const encoder = new TextEncoder();
					const contentBytes = encoder.encode(content);
					const { data: blob } = await this.octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
						owner: this.settings.githubUsername,
						repo: this.settings.githubRepo,
						content: arrayBufferToBase64(contentBytes),
						encoding: 'base64'
					});
					blobSha = blob.sha;
				}

				// Add to changes array
				changes.push({
					path: `${this.settings.targetDir}/${path}`,
					mode: '100644',
					type: 'blob',
					sha: blobSha
				});

				// Process linked media
				const mediaFiles = this.getLinkedMedia(content);
				for (const mediaFile of mediaFiles) {
					const mediaFileObj = this.app.vault.getAbstractFileByPath(mediaFile);
					if (!(mediaFileObj instanceof TFile)) {
						console.warn(`Skipping media file ${mediaFile} - not found or not a file`);
						continue;
					}

					const mediaContent = await this.app.vault.readBinary(mediaFileObj);
					const mediaFilename = mediaFile.split('/').pop() || '';
					const mediaPath = mediaFilename;
					const attachmentsFolder = (this.app.vault as any).getConfig('attachmentFolderPath') || 'Attachments';
					const remoteMediaPath = `${this.settings.targetDir}/${attachmentsFolder}/${mediaPath}`;

					// Check if media file exists in repository
					const existingMedia = existingFilesMap.get(remoteMediaPath);
					let mediaBlobSha: string;

					if (existingMedia) {
						// Calculate SHA of new media content
						const mediaBytes = new Uint8Array(mediaContent);
						const header = `blob ${mediaBytes.length}\0`;
						const headerBytes = new TextEncoder().encode(header);
						const combinedBytes = new Uint8Array(headerBytes.length + mediaBytes.length);
						combinedBytes.set(headerBytes);
						combinedBytes.set(mediaBytes, headerBytes.length);
						const newSha = await calculateSHA1(combinedBytes.buffer);

						if (newSha === existingMedia.sha) {
							console.log(`Media file ${mediaPath} hasn't changed, skipping update`);
							mediaBlobSha = existingMedia.sha;
						} else {
							new Notice(`Updating media ${mediaPath}...`);
							stats.media.updated++;
							// Create new blob for changed content
							const { data: mediaBlob } = await this.octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
								owner: this.settings.githubUsername,
								repo: this.settings.githubRepo,
								content: arrayBufferToBase64(mediaContent),
								encoding: 'base64'
							});
							mediaBlobSha = mediaBlob.sha;
						}
					} else {
						new Notice(`Creating media ${mediaPath}...`);
						stats.media.added++;
						// Create new blob for new content
						const { data: mediaBlob } = await this.octokit.request('POST /repos/{owner}/{repo}/git/blobs', {
							owner: this.settings.githubUsername,
							repo: this.settings.githubRepo,
							content: arrayBufferToBase64(mediaContent),
							encoding: 'base64'
						});
						mediaBlobSha = mediaBlob.sha;
					}

					// Add to changes array
					changes.push({
						path: remoteMediaPath,
						mode: '100644',
						type: 'blob',
						sha: mediaBlobSha
					});
				}
			}

			// Get the attachments folder path from Obsidian config
			const attachmentsFolder = (this.app.vault as any).getConfig('attachmentFolderPath') || 'Attachments';

			// Get all attachments currently in use from LOCAL files with publish: true
			const attachmentsInUse = new Set<string>();
			for (const file of filesToPublish) {
				const content = await this.app.vault.read(file);
				const mediaFiles = this.getLinkedMedia(content);
				for (const mediaFile of mediaFiles) {
					const mediaFilename = mediaFile.split('/').pop() || '';
					const mediaPath = mediaFilename;
					const remoteMediaPath = `${this.settings.targetDir}/${attachmentsFolder}/${mediaPath}`;
					attachmentsInUse.add(remoteMediaPath);
				}
			}

			// Add deletions for files that are no longer marked for publishing
			for (const [path, item] of existingFilesMap) {
				if (!path.startsWith(this.settings.targetDir)) continue;
				const relativePath = path.replace(`${this.settings.targetDir}/`, '');
				
				// Skip if it's an attachment that's still in use
				if (path.includes(`/${attachmentsFolder}/`) && attachmentsInUse.has(path)) {
					continue;
				}

				if (!localPaths.has(relativePath)) {
					new Notice(`Deleting ${relativePath}...`);
					if (path.includes(`/${attachmentsFolder}/`)) {
						stats.media.deleted++;
					} else {
						stats.pages.deleted++;
					}
					changes.push({
						path: path,
						mode: '100644',
						type: 'blob',
						sha: null
					});
				}
			}

			// Create a new tree with all changes
			const { data: newTree } = await this.octokit.request('POST /repos/{owner}/{repo}/git/trees', {
				owner: this.settings.githubUsername,
				repo: this.settings.githubRepo,
				base_tree: commit.tree.sha,
				tree: changes
			});

			// Create a new commit
			const { data: newCommit } = await this.octokit.request('POST /repos/{owner}/{repo}/git/commits', {
				owner: this.settings.githubUsername,
				repo: this.settings.githubRepo,
				message: 'Update published content',
				tree: newTree.sha,
				parents: [commit.sha]
			});

			// Update the reference
			await this.octokit.request('PATCH /repos/{owner}/{repo}/git/refs/{ref}', {
				owner: this.settings.githubUsername,
				repo: this.settings.githubRepo,
				ref: `heads/${this.settings.targetBranch}`,
				sha: newCommit.sha
			});

			// Show detailed report
			const report = [
				`Pages: ${stats.pages.added} added, ${stats.pages.updated} updated, ${stats.pages.deleted} deleted`,
				`Media: ${stats.media.added} added, ${stats.media.updated} updated, ${stats.media.deleted} deleted`
			].join('\n');
			
			console.log('All files processed successfully!');
			console.log('Final statistics:', report);
			
			new Notice('Successfully published to GitHub!\n' + report);
		} catch (error) {
			console.error('Error publishing to GitHub:', error);
			new Notice('Error publishing to GitHub: ' + error.message);
		}
	}

	async uploadCurrentFile() {
		try {
			// Validate settings before proceeding
			if (!this.validateSettings()) {
				return;
			}

			const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
			const file: TFile | null = activeView?.file || this.app.workspace.getActiveFile();
			
			if (!file) {
				new Notice('No active file');
				return;
			}

			new Notice(`Starting upload of ${file.path}...`);
			
			// Process the current file
			const stats = await this.processFile(file);
			
			// Show detailed report
			const report = [
				`Pages: ${stats.pages.added} added, ${stats.pages.updated} updated, ${stats.pages.deleted} deleted`,
				`Media: ${stats.media.added} added, ${stats.media.updated} updated, ${stats.media.deleted} deleted`
			].join('\n');
			
			console.log('File processed successfully!');
			console.log('Final statistics:', report);
			
			new Notice('Successfully uploaded to GitHub!\n' + report);
		} catch (error) {
			console.error('Error uploading to GitHub:', error);
			new Notice('Error uploading to GitHub: ' + error.message);
		}
	}

	async processFile(file: TFile) {
		try {
			const content = await this.app.vault.read(file);
			const path = file.path;
			
			let fileExists = false;
			let currentSha: string | undefined;
			let currentContent: string | undefined;
			// Check if file exists in repository
			try {
				const response = await this.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
					owner: this.settings.githubUsername,
					repo: this.settings.githubRepo,
					path: `${this.settings.targetDir}/${path}`,
					ref: this.settings.targetBranch
				}) as { data: GitHubContentResponse };
				
				// Check if the response is an array (directory) or a single file
				if (Array.isArray(response.data)) {
					// If it's a directory, the file doesn't exist
					fileExists = false;
					console.log(`Path ${path} is a directory, file does not exist`);
				} else {
					fileExists = true;
					currentSha = response.data.sha;
					currentContent = response.data.content;
					console.log(`File ${path} exists with SHA: ${currentSha}`);
				}
			} catch (error) {
				if (error.status !== 404) {
					console.error(`Error checking if file exists ${path}:`, error);
					throw error;
				}
				console.log(`File ${path} does not exist in repository`);
			}

			// If file exists and content hasn't changed, skip the push
			if (fileExists && currentSha) {
				// Calculate SHA locally using Git's object format
				const encoder = new TextEncoder();
				const contentBytes = encoder.encode(content);
				const header = `blob ${contentBytes.length}\0`;
				const headerBytes = encoder.encode(header);
				const combinedBytes = new Uint8Array(headerBytes.length + contentBytes.length);
				combinedBytes.set(headerBytes);
				combinedBytes.set(contentBytes, headerBytes.length);
				const localSha = await calculateSHA1(combinedBytes.buffer);

				console.log(`Local SHA: ${localSha}, Current SHA: ${currentSha}`);

				if (localSha === currentSha) {
					console.log(`File ${path} SHA hasn't changed, skipping push`);
					return {
						pages: { added: 0, updated: 0, deleted: 0 },
						media: { added: 0, updated: 0, deleted: 0 }
					};
				}
			}

			// Prepare the request payload
			const payload: any = {
				owner: this.settings.githubUsername,
				repo: this.settings.githubRepo,
				path: `${this.settings.targetDir}/${path}`,
				message: fileExists ? `Update ${path}` : `Add ${path}`,
				content: base64Encode(content),
				branch: this.settings.targetBranch,
			};

			// Only include SHA if the file exists
			if (fileExists && currentSha) {
				payload.sha = currentSha;
			}

			// Create or update the file
			try {
				await this.octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', payload);
				console.log(`Successfully ${fileExists ? 'updated' : 'created'} markdown file ${path}`);
				new Notice(`Successfully ${fileExists ? 'updated' : 'created'} ${path}`);
			} catch (error) {
				console.error(`Error creating/updating file ${path}:`, error);
				console.error('Payload:', JSON.stringify(payload, null, 2));
				throw error;
			}

			// Process linked media
			const mediaFiles = this.getLinkedMedia(content);
			const mediaStats = {
				added: 0,
				updated: 0,
				deleted: 0
			};

			for (const mediaFile of mediaFiles) {
				const result = await this.processMediaFile(mediaFile);
				mediaStats.added += result.added;
				mediaStats.updated += result.updated;
				mediaStats.deleted += result.deleted;
			}

			return {
				pages: {
					added: fileExists ? 0 : 1,
					updated: fileExists ? 1 : 0,
					deleted: 0
				},
				media: mediaStats
			};
		} catch (error) {
			console.error(`Error processing file ${file.path}:`, error);
			throw error;
		}
	}

	async processMediaFile(mediaPath: string) {
		const file = this.app.vault.getAbstractFileByPath(mediaPath);
		if (!(file instanceof TFile)) return { added: 0, updated: 0, deleted: 0 };

		const content = await this.app.vault.readBinary(file);
		
		// Get the attachments folder path from Obsidian config
		const attachmentsFolder = (this.app.vault as any).getConfig('attachmentFolderPath') || 'Attachments';
		
		// Extract just the filename from the full path
		const filename = mediaPath.split('/').pop() || '';
		const path = filename;
		
		// Place attachments under targetDir/Attachments
		const remotePath = `${this.settings.targetDir}/${attachmentsFolder}/${path}`;

		try {
			const response = await this.octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
				owner: this.settings.githubUsername,
				repo: this.settings.githubRepo,
				path: remotePath,
				ref: this.settings.targetBranch
			}) as { data: GitHubContentResponse };
			
			console.log(`Media file ${path} exists with SHA: ${response.data.sha}`);
			
			// File exists, update it
			await this.octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
				owner: this.settings.githubUsername,
				repo: this.settings.githubRepo,
				path: remotePath,
				message: `Update media ${path}`,
				content: arrayBufferToBase64(content),
				sha: response.data.sha,
				branch: this.settings.targetBranch
			});
			console.log(`Successfully updated media file ${path}`);
			new Notice(`Updated media file ${path}`);
			return { added: 0, updated: 1, deleted: 0 };
		} catch (error) {
			if (error.status === 404) {
				console.log(`Media file ${path} does not exist in repository, creating new file`);
				// File doesn't exist, create it
				await this.octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
					owner: this.settings.githubUsername,
					repo: this.settings.githubRepo,
					path: remotePath,
					message: `Add media ${path}`,
					content: arrayBufferToBase64(content),
					branch: this.settings.targetBranch
				});
				console.log(`Successfully created new media file ${path}`);
				new Notice(`Created media file ${path}`);
				return { added: 1, updated: 0, deleted: 0 };
			} else {
				console.error(`Error processing media file ${mediaPath}:`, error);
				throw error;
			}
		}
	}

	getLinkedMedia(content: string): string[] {
		// Handle ![[filename]] syntax without requiring spaces
		const mediaRegex = /!\[\[([^\]]+\.(png|jpg|jpeg|gif|mp3|wav|mp4|pdf|ogg|m4a))\]\]/g;
		const matches = content.matchAll(mediaRegex);
		
		// Get the attachments folder path from Obsidian config
		const attachmentsFolder = (this.app.vault as any).getConfig('attachmentFolderPath') || 'Attachments';
		
		return Array.from(matches).map(match => {
			const filename = match[1];
			// First try to find the file in the attachments folder
			const attachmentPath = `${attachmentsFolder}/${filename}`;
			const attachmentFile = this.app.vault.getAbstractFileByPath(attachmentPath);
			if (attachmentFile instanceof TFile) {
				return attachmentFile.path;
			}
			// If not found in attachments, try the root
			const rootFile = this.app.vault.getAbstractFileByPath(filename);
			if (rootFile instanceof TFile) {
				return rootFile.path;
			}
			return null;
		}).filter((path): path is string => path !== null);
	}

	getSlugifiedPath(path: string): string {
		// Remove .md extension if present
		if (path.endsWith('.md')) {
			path = path.slice(0, -3);
		}
		
		return path
			.split("/")
			.map((segment) =>
				segment
					.replace(/\s/g, "-")
					.replace(/&/g, "-and-")
					.replace(/%/g, "-percent")
					.replace(/\?/g, "")
					.replace(/#/g, "")
			)
			.join("/")
			.replace(/\/$/, "");
	}

	async togglePublishProperty() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			new Notice('No active markdown file');
			return;
		}

		const file: TFile | null = activeView.file;
		if (!file) {
			new Notice('No file found');
			return;
		}

		const content = await this.app.vault.read(file);
		
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

		await this.app.vault.modify(file, newContent);
		new Notice(`Publish property ${hasPublish ? 'removed' : 'added'}`);
	}

	validateSettings(): boolean {
		const requiredSettings = [
			{ key: 'githubToken', name: 'GitHub Token' },
			{ key: 'githubUsername', name: 'GitHub Username' },
			{ key: 'githubRepo', name: 'GitHub Repository' },
			{ key: 'targetBranch', name: 'Target Branch' },
			{ key: 'targetDir', name: 'Target Directory' }
		];

		const missingSettings = requiredSettings.filter(setting => 
			!this.settings[setting.key as keyof GitHubExporterSettings] || 
			this.settings[setting.key as keyof GitHubExporterSettings] === ''
		);

		if (missingSettings.length > 0) {
			const missingNames = missingSettings.map(s => s.name).join(', ');
			new Notice(`Please configure the following settings before proceeding: ${missingNames}. Go to Settings → GitHub Exporter to complete the configuration.`);
			return false;
		}

		return true;
	}

	initializeOctokit() {
		// Initialize Octokit with current token
		this.octokit = new Octokit({
			auth: this.settings.githubToken,
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Reinitialize Octokit with updated token
		this.initializeOctokit();
	}
}

class GitHubExporterSettingTab extends PluginSettingTab {
	plugin: GitHubExporterPlugin;

	constructor(app: App, plugin: GitHubExporterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('GitHub Token')
			.setDesc('Your GitHub personal access token')
			.addText(text => text
				.setPlaceholder('Enter your token')
				.setValue(this.plugin.settings.githubToken)
				.onChange(async (value) => {
					this.plugin.settings.githubToken = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('GitHub Username')
			.setDesc('Your GitHub username')
			.addText(text => text
				.setPlaceholder('Enter your username')
				.setValue(this.plugin.settings.githubUsername)
				.onChange(async (value) => {
					this.plugin.settings.githubUsername = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('GitHub Repository')
			.setDesc('The repository to publish to')
			.addText(text => text
				.setPlaceholder('Enter repository name')
				.setValue(this.plugin.settings.githubRepo)
				.onChange(async (value) => {
					this.plugin.settings.githubRepo = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Target Branch')
			.setDesc('The branch to drop the files to.')
			.addText(text => text
				.setPlaceholder('Enter target branch')
				.setValue(this.plugin.settings.targetBranch)
				.onChange(async (value) => {
					this.plugin.settings.targetBranch = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Target Directory')
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

	}
}
