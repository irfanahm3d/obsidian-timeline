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
    dateProperty: "creation_date",
    searchIn: 'both',
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
                width: 80%;
                margin: 20px auto;
                padding: 40px 0;
            }

            /* Central vertical line */
            .timeline-container::before {
                content: '';
                position: absolute;
                left: 50%;
                top: 0;
                bottom: 0;
                width: 4px;
                background: #ccc;
                transform: translateX(-50%);
            }

            /* Timeline items */
            .timeline-item {
                position: absolute;
                width: 45%;
                padding: 10px 20px;
                box-sizing: border-box;
            }

            /* Alternating sides */
            .timeline-item.left {
                left: 0;
                text-align: right;
            }

            .timeline-item.right {
                left: 55%;
                text-align: left;
            }

            /* Connector lines */
            .timeline-item::before {
                content: '';
                position: absolute;
                top: 20px; /* Adjust based on item height */
                width: 0;
                height: 0;
                border: 10px solid transparent;
            }

            .timeline-item.left::before {
                right: -20px;
                border-left-color: #fff;
            }

            .timeline-item.right::before {
                left: -20px;
                border-right-color: #fff;
            }

            /* Timeline notes */
            .timeline-note {
                background-color: #fff;
                border: 1px solid #ddd;
                padding: 15px;
                border-radius: 5px;
                cursor: pointer;
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

            /* Year labels */
            .year-label {
                position: absolute;
                left: 50%;
                transform: translateX(-50%);
                background: #f0f0f0;
                padding: 2px 8px;
                border-radius: 4px;
                font-size: 12px;
                color: #333;
            }
        `;
        document.head.appendChild(style);
        console.log('Styles added to the document');

        // Add settings tab
        this.addSettingTab(new TimelineSettingTab(this.app, this));
        console.log('Settings tab added');

        // Add a command to render the timeline
        this.addCommand({
            id: 'render-timeline',
            name: 'Render Document Timeline',
            callback: () => this.renderTimeline(),
        });
        console.log('Render timeline command added');
    }

    onunload() {
        console.log('Unloading Document Timeline Plugin');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        console.log('Settings loaded:', this.settings);
    }

    async saveSettings() {
        await this.saveData(this.settings);
        console.log('Settings saved:', this.settings);
    }

    async renderTimeline() {
        console.log('Render timeline command triggered');

        // Get all markdown files
        const allFiles = this.app.vault.getMarkdownFiles();
        console.log(`Total markdown files found: ${allFiles.length}`);

        // Normalize the tag (remove '#' if present)
        const normalizedTag = this.settings.tag.startsWith('#') ? this.settings.tag.slice(1) : this.settings.tag;
        console.log(`Normalized tag: ${normalizedTag}`);

        // Filter files based on the specified tag
        const files: TFile[] = [];
        for (const file of allFiles) {
            const content = await this.app.vault.read(file);
            const frontmatter = this.extractFrontmatter(content);
            console.log(`Processing file: ${file.path}`);

            let hasTag = false;

            // Check frontmatter tags
            if (this.settings.searchIn === 'frontmatter' || this.settings.searchIn === 'both') {
                if (frontmatter.tags) {
                    if (Array.isArray(frontmatter.tags)) {
                        hasTag = frontmatter.tags.includes(normalizedTag);
                        console.log(`Found tag in frontmatter (array): ${hasTag}`);
                    } else if (typeof frontmatter.tags === 'string') {
                        const tagsArray = frontmatter.tags.split(',').map(tag => tag.trim());
                        hasTag = tagsArray.includes(normalizedTag);
                        console.log(`Found tag in frontmatter (string): ${hasTag}`);
                    }
                }
            }

            // If not found in frontmatter, check inline tags
            if (!hasTag && (this.settings.searchIn === 'inline' || this.settings.searchIn === 'both')) {
                hasTag = content.includes(this.settings.tag);
                console.log(`Found tag inline: ${hasTag}`);
            }

            if (hasTag) {
                files.push(file);
                console.log(`File added to timeline: ${file.path}`);
            }
        }

        console.log(`Total files matching tag: ${files.length}`);

        if (files.length === 0) {
            new Notice("No files found with the specified tag.");
            console.log("No files matched the tag.");
            return;
        }

        // Proceed with processing the filtered files
        const fileData = await Promise.all(files.map(async file => {
            const content = await this.app.vault.read(file);
            // Extract date from frontmatter or use file creation date
            const frontmatter = this.extractFrontmatter(content);
            let date: Date;
            if (frontmatter[this.settings.dateProperty]) {
                date = new Date(frontmatter[this.settings.dateProperty]);
                console.log(`Extracted date from frontmatter for ${file.path}: ${date}`);
            } else {
                // Fallback to file's creation date
                const stats = await this.app.vault.adapter.stat(file.path);
                if (stats?.ctime) {
                    date = new Date(stats.ctime);
                    console.log(`Extracted creation date for ${file.path}: ${date}`);
                } else {
                    date = new Date(); // Default to current date if none found
                    console.log(`Default date for ${file.path}: ${date}`);
                }
            }
            // Extract a snippet from the content
            const snippet = this.extractSnippet(content);
            console.log(`Extracted snippet for ${file.path}: ${snippet}`);
            return {
                file,
                date,
                snippet
            };
        }));

        // Sort files by date (latest first)
        fileData.sort((a, b) => b.date.getTime() - a.date.getTime());
        console.log("Files sorted by date (latest first)");

        // Determine the date range
        const dates = fileData.map(data => data.date);
        const latestDate = new Date(Math.max(...dates.map(d => d.getTime())));
        const oldestDate = new Date(Math.min(...dates.map(d => d.getTime())));
        console.log(`Date range: ${oldestDate.toDateString()} to ${latestDate.toDateString()}`);

        // Calculate total years and map to timeline container height
        const totalYears = latestDate.getFullYear() - oldestDate.getFullYear() + 1;
        const yearHeight = 100 / totalYears; // Percentage per year

        // Create HTML content for the timeline
        let html = `<div class="timeline-container">`;
        // Add year labels
        for (let year = oldestDate.getFullYear(); year <= latestDate.getFullYear(); year++) {
            const yearDate = new Date(year, 0, 1);
            const position = this.calculatePosition(yearDate, oldestDate, latestDate);
            html += `
                <div class="year-label" style="top: ${position}%; transform: translateX(-50%) translateY(-50%);">
                    ${year}
                </div>
            `;
        }

        // Alternate sides
        let isLeft = true;
        // Keep track of occupied positions to prevent overlapping
        const occupiedPositions: number[] = [];

        fileData.forEach(data => {
            const sideClass = isLeft ? 'left' : 'right';
            isLeft = !isLeft; // Toggle side for next item

            let position = this.calculatePosition(data.date, oldestDate, latestDate);

            // Adjust position to prevent overlapping
            position = this.adjustPosition(position, occupiedPositions);

            occupiedPositions.push(position);

            html += `
                <div class="timeline-item ${sideClass}" style="top: ${position}%;">
                    <div class="timeline-note" onclick="app.workspace.openLinkText('${data.file.path}', '', true)">
                        <h4>${data.file.basename}</h4>
                        <p>${data.snippet}</p>
                        <span>${data.date.toDateString()}</span>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        console.log("HTML content for timeline generated");

        // Get the most recent leaf or create a new one
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
            await view.setViewData(html, true);
            //this.app.workspace.revealLeaf(leaf); // Ensure the leaf is visible
            console.log("Timeline rendered in the current view");
        } else {
            new Notice("Unable to open a pane for the timeline.");
            console.log("No active leaf found to render the timeline.");
        }
    }

    extractFrontmatter(content: string): Record<string, any> {
        const fmRegex = /^---\n([\s\S]*?)\n---/;
        const match = content.match(fmRegex);
        if (match && match[1]) {
			//console.log(`matched frontmatter: ${match[1]}`)
            return this.parseYAML(match[1]);
        }
        return {};
    }

    parseYAML(yamlContent: string): Record<string, any> {
		try {
			return yaml.load(yamlContent) as Record<string, any>;
		} catch (e) {
			console.error("Failed to parse YAML:", e);
			return {};
		}
	}

    extractSnippet(content: string, maxLength: number = 100): string {
        // Remove frontmatter
        const fmRegex = /^---\n([\s\S]*?)\n---\n/;
        content = content.replace(fmRegex, '');
        // Extract the first few lines or up to maxLength
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        const snippet = lines.slice(0, 2).join(' '); // Get first two non-empty lines
        return snippet.length > maxLength ? snippet.substring(0, maxLength) + '...' : snippet;
    }

    /**
     * Calculate the vertical position as a percentage based on the date range.
     * Latest date at the top (0%) and oldest at the bottom (100%).
     */
    calculatePosition(date: Date, oldest: Date, latest: Date): number {
        const total = latest.getTime() - oldest.getTime();
        const current = latest.getTime() - date.getTime(); // Invert to have latest on top
        const position = (current / total) * 100;
        return Math.min(Math.max(position, 0), 100); // Clamp between 0 and 100
    }

    /**
     * Adjust the position to prevent overlapping.
     * Simple implementation: if a position is already occupied within a certain threshold, move it down.
     */
    adjustPosition(position: number, occupied: number[]): number {
        const threshold = 2; // Percentage to offset to prevent overlap
        let newPos = position;
        while (occupied.some(pos => Math.abs(pos - newPos) < threshold)) {
            newPos += threshold;
            if (newPos > 100) break; // Prevent going out of bounds
        }
        return newPos;
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
        containerEl.createEl('h2', { text: 'Document Timeline Settings' });

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
