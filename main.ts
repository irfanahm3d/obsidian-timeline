import { App, Plugin, PluginSettingTab, Setting, TFile, Notice, MarkdownView } from 'obsidian';
import * as yaml from 'js-yaml';


// Define the settings interface
interface TimelinePluginSettings {
    tag: string;
    dateProperty: string; // e.g., "creation_date"
    searchIn: 'frontmatter' | 'inline' | 'both';
}

const DEFAULT_SETTINGS: TimelinePluginSettings = {
    tag: "#timeline",
    dateProperty: "date",
    searchIn: 'frontmatter',
}

export default class TimelinePlugin extends Plugin {
    settings: TimelinePluginSettings;

    async onload() {
        console.log('Loading Document Timeline Plugin');

        // Load or initialize settings
        await this.loadSettings();

        // Add styles directly to the document
        const style = document.createElement('style');
        style.textContent = `
            .timeline-container {
            position: relative;
            width: 100%;
            height: 800px; /* Increased height for better vertical spacing */
            border-left: 2px solid #ccc;
            margin: 20px 0;
        }
        .timeline-item {
            position: absolute;
            left: 50%; /* Center items horizontally */
            transform: translateX(-50%);
            /* Remove top: 0; since we'll set it dynamically */
        }
        .timeline-note {
            background-color: #fff;
            border: 1px solid #ddd;
            padding: 10px;
            border-radius: 5px;
            cursor: pointer;
            width: 150px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
            transition: transform 0.2s;
        }
        .timeline-note:hover {
            transform: scale(1.05);
        }
        .timeline-note h4 {
            margin: 0 0 5px 0;
            font-size: 16px;
        }
        .timeline-note p {
            margin: 0 0 5px 0;
            font-size: 12px;
            color: #555;
        }
        .timeline-note span {
            font-size: 10px;
            color: #999;
        }
        `;
        document.head.appendChild(style);

		// Add settings tab
		this.addSettingTab(new TimelineSettingTab(this.app, this));

		// Add a command to render the timeline
		this.addCommand({
			id: 'render-timeline',
			name: 'Render Document Timeline',
			callback: () => this.renderTimeline(),
		});
    }

    onunload() {
        console.log('Unloading Timeline Plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async renderTimeline() {
        // Get all markdown files
        const allFiles = this.app.vault.getMarkdownFiles();

        // Normalize the tag (remove '#' if present)
        const normalizedTag = this.settings.tag.startsWith('#') ? this.settings.tag.slice(1) : this.settings.tag;

        // Filter files based on the specified tag
        const files = [];
        for (const file of allFiles) {
            const content = await this.app.vault.read(file);
            const frontmatter = this.extractFrontmatter(content);

            let hasTag = false;

            // Check frontmatter tags
            if (this.settings.searchIn === 'frontmatter' || this.settings.searchIn === 'both') {
                if (frontmatter.tags) {
                    if (Array.isArray(frontmatter.tags)) {
                        hasTag = frontmatter.tags.includes(normalizedTag);
                    } else if (typeof frontmatter.tags === 'string') {
                        hasTag = frontmatter.tags.split(',').map(tag => tag.trim()).includes(normalizedTag);
                    }
                }
            }

            // If not found in frontmatter, check inline tags
            if (!hasTag && (this.settings.searchIn === 'inline' || this.settings.searchIn === 'both')) {
                hasTag = content.includes(this.settings.tag);
            }

            if (hasTag) {
                files.push(file);
            }
        }

        // Proceed with processing the filtered files
        const fileData = await Promise.all(files.map(async file => {
            const content = await this.app.vault.read(file);
            // Extract date from frontmatter or use file creation date
            const frontmatter = this.extractFrontmatter(content);
            let date: Date;
            if (frontmatter[this.settings.dateProperty]) {
                date = new Date(frontmatter[this.settings.dateProperty]);
            } else {
                // Fallback to file's creation date
                const stats = await this.app.vault.adapter.stat(file.path);
                if (stats?.ctime) {
                    date = new Date(stats.ctime);
                } else {
                    date = new Date(); // Default to current date if none found
                }
            }
            // Extract a snippet from the content
            const snippet = this.extractSnippet(content);
            return {
                file,
                date,
                snippet
            };
        }));

        // Sort files by date
        fileData.sort((a, b) => a.date.getTime() - b.date.getTime());

        // Create HTML content for the timeline
        let html = `<div class="timeline-container">`;
        fileData.forEach(data => {
            html += `
                <div class="timeline-item" style="top: ${this.calculatePosition(data.date)}%;">
                    <div class="timeline-note" onclick="app.workspace.openLinkText('${data.file.path}', '', true)">
                        <h4>${data.file.basename}</h4>
                        <p>${data.snippet}</p>
                        <span>${data.date.toDateString()}</span>
                    </div>
                </div>
            `;
        });
        html += `</div>`;

        // Get the most recent leaf or create a new one
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            await view.setViewData(html, true);
            //this.app.workspace.revealLeaf(leaf); // Ensure the leaf is visible
            console.log("Timeline rendered in the current view");
        } else {
            new Notice("Unable to open a pane for the timeline.");
        }
    }

    extractFrontmatter(content: string): Record<string, any> {
        const fmRegex = /^---\n([\s\S]*?)\n---/;
        const match = content.match(fmRegex);
        if (match && match[1]) {
            return this.parseYAML(match[1]);
        }
        return {};
    }

    parseYAML(yaml: string): Record<string, any> {
        const lines = yaml.split('\n');
        const data: Record<string, any> = {};
        lines.forEach(line => {
            const [key, ...rest] = line.split(':');
            if (key && rest) {
                // Handle array notation and single values
                const value = rest.join(':').trim();
                if (value.startsWith('[') && value.endsWith(']')) {
                    data[key.trim()] = value.slice(1, -1).split(',').map(tag => tag.trim());
                } else {
                    data[key.trim()] = value;
                }
            }
        });
        return data;
    }

    extractSnippet(content: string, maxLength: number = 100): string {
        // Remove frontmatter
        const fmRegex = /^---\n([\s\S]*?)\n---\n/;
        content = content.replace(fmRegex, '');
        // Extract the first few lines or up to maxLength
        const snippet = content.split('\n').find(line => line.trim().length > 0) || '';
        return snippet.substring(0, maxLength) + (snippet.length > maxLength ? '...' : '');
    }

    calculatePosition(date: Date): number {
        // Define the time range for the timeline (e.g., one year)
        const now = new Date();
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(now.getFullYear() - 1);

        // Clamp the date within the range
        if (date < oneYearAgo) date = oneYearAgo;
        if (date > now) date = now;

        const total = now.getTime() - oneYearAgo.getTime();
        const current = date.getTime() - oneYearAgo.getTime();
        const position = (current / total) * 100;
        return Math.min(Math.max(position, 0), 100); // Clamp between 0 and 100
    }
}

class TimelineSettingTab extends PluginSettingTab {
    plugin: TimelinePlugin;

    constructor(app: App, plugin: TimelinePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();
        containerEl.createEl('h2', { text: 'Timeline Settings' });

        new Setting(containerEl)
            .setName('Tag to Filter')
            .setDesc('Specify the tag to filter documents for the timeline. Use #tag or tag.')
            .addText(text => text
                .setPlaceholder('#timeline')
                .setValue(this.plugin.settings.tag)
                .onChange(async (value) => {
                    this.plugin.settings.tag = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Date Property')
            .setDesc('Specify the frontmatter property that contains the creation date. Leave empty to use file creation date.')
            .addText(text => text
                .setPlaceholder('creation_date')
                .setValue(this.plugin.settings.dateProperty)
                .onChange(async (value) => {
                    this.plugin.settings.dateProperty = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Search In')
            .setDesc('Specify where to search for the tag: Frontmatter, Inline, or Both.')
            .addDropdown(dropdown => dropdown
                .addOption('frontmatter', 'Frontmatter')
                .addOption('inline', 'Inline Content')
                .addOption('both', 'Both')
                .setValue(this.plugin.settings.searchIn)
                .onChange(async (value) => {
                    this.plugin.settings.searchIn = value as 'frontmatter' | 'inline' | 'both';
                    await this.plugin.saveSettings();
                }));
    }
}
