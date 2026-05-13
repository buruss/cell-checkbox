import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { createLivePreviewExtension } from "./live-preview";
import { createReadingViewProcessor } from "./reading-view";
import { CellCheckboxSettings, DEFAULT_SETTINGS, isValidCheckChar } from "./shared";

const BUILD_ID = "diag-1";

export default class CellCheckboxPlugin extends Plugin {
  settings!: CellCheckboxSettings;

  async onload() {
    await this.loadSettings();
    // Loud signals so we can confirm the new build is actually running
    console.warn(`[cell-checkbox] LOADED build=${BUILD_ID}`, { settings: this.settings });
    new Notice(`Cell Checkbox loaded (build=${BUILD_ID})`, 4000);
    this.addSettingTab(new CellCheckboxSettingTab(this.app, this));
    this.registerMarkdownPostProcessor(createReadingViewProcessor(this));
    try {
      this.registerEditorExtension(createLivePreviewExtension(this));
      console.warn("[cell-checkbox] CM6 extension registered");
    } catch (err) {
      console.error("[cell-checkbox] CM6 extension registration failed", err);
      new Notice("Cell Checkbox: CM6 extension failed (see console)", 8000);
    }
  }

  async loadSettings() {
    const data = (await this.loadData()) as Partial<CellCheckboxSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
    if (!isValidCheckChar(this.settings.checkedChar)) {
      this.settings.checkedChar = DEFAULT_SETTINGS.checkedChar;
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  refreshOpenViews() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as {
        previewMode?: { rerender?: (full: boolean) => void };
        editor?: { cm?: { dispatch?: (tr: { changes?: unknown }) => void } };
      };
      view?.previewMode?.rerender?.(true);
      view?.editor?.cm?.dispatch?.({});
    });
  }
}

class CellCheckboxSettingTab extends PluginSettingTab {
  plugin: CellCheckboxPlugin;

  constructor(app: App, plugin: CellCheckboxPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Checked character")
      .setDesc(
        "Character placed inside brackets to mark a cell as checked. " +
          "Default is 'O'. Use 'x' for Markdown-standard task lists. " +
          "Must be a single character (no brackets, backslash, or whitespace).",
      )
      .addText((text) => {
        text
          .setPlaceholder("O")
          .setValue(this.plugin.settings.checkedChar)
          .onChange(async (raw) => {
            const value = raw.trim();
            const input = text.inputEl;
            if (!isValidCheckChar(value)) {
              input.addClass("cell-checkbox-input-invalid");
              return;
            }
            input.removeClass("cell-checkbox-input-invalid");
            this.plugin.settings.checkedChar = value;
            await this.plugin.saveSettings();
            this.plugin.refreshOpenViews();
          });
        text.inputEl.maxLength = 1;
        text.inputEl.style.width = "4em";
        text.inputEl.style.textAlign = "center";
      });

    new Setting(containerEl)
      .setName("Debug logging")
      .setDesc(
        "Enable verbose diagnostic logs in the developer console (Ctrl+Shift+I). " +
          "Use this when reporting issues so the plugin author can see what's happening.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.debug).onChange(async (value) => {
          this.plugin.settings.debug = value;
          await this.plugin.saveSettings();
        });
      });
  }
}
