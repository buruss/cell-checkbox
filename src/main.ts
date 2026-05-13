import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { setupDomObserver } from "./dom-observer";
import { createReadingViewProcessor } from "./reading-view";
import { CellCheckboxSettings, DEFAULT_SETTINGS, isValidCheckChar } from "./shared";
import { toggleInFile } from "./widget-injector";

const BUILD_ID = "diag-4";

export default class CellCheckboxPlugin extends Plugin {
  settings!: CellCheckboxSettings;

  async onload() {
    await this.loadSettings();
    console.warn(`[cell-checkbox] LOADED build=${BUILD_ID}`, { settings: this.settings });
    new Notice(`Cell Checkbox loaded (build=${BUILD_ID})`, 4000);
    this.addSettingTab(new CellCheckboxSettingTab(this.app, this));
    this.registerMarkdownPostProcessor(createReadingViewProcessor(this));

    const cleanup = setupDomObserver(this);
    this.register(cleanup);

    this.registerWidgetEventDelegation();
  }

  // Document-level event delegation. Per-widget listeners proved unreliable —
  // Reading view's post-processed widgets received clicks but listeners didn't
  // fire (likely the DOM is cloned/re-mounted somewhere between attachment and
  // user interaction). A single document handler always fires.
  private registerWidgetEventDelegation() {
    const findWidget = (e: Event): HTMLElement | null => {
      const target = e.target as HTMLElement | null;
      return target?.closest?.(".cell-checkbox") as HTMLElement | null;
    };

    // Prevent focus changes / virtual keyboard (capture phase, before editor handlers)
    const focusBlock = (e: Event) => {
      if (!findWidget(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener("pointerdown", focusBlock, { capture: true });
    document.addEventListener("mousedown", focusBlock, { capture: true });
    document.addEventListener("touchstart", focusBlock, { capture: true, passive: false });

    // Click → toggle
    const onClick = (e: MouseEvent) => {
      const widget = findWidget(e);
      if (!widget) return;
      e.preventDefault();
      e.stopPropagation();
      this.handleWidgetActivate(widget);
    };
    document.addEventListener("click", onClick, true);

    // Keyboard accessibility
    const onKey = (e: KeyboardEvent) => {
      const widget = findWidget(e);
      if (!widget) return;
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      e.stopPropagation();
      this.handleWidgetActivate(widget);
    };
    document.addEventListener("keydown", onKey, true);

    this.register(() => {
      document.removeEventListener("pointerdown", focusBlock, { capture: true } as EventListenerOptions);
      document.removeEventListener("mousedown", focusBlock, { capture: true } as EventListenerOptions);
      document.removeEventListener("touchstart", focusBlock, { capture: true } as EventListenerOptions);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    });
  }

  private handleWidgetActivate(widget: HTMLElement) {
    const filePath = widget.dataset.filePath;
    if (!filePath) {
      if (this.settings.debug) console.warn("[cell-checkbox] widget missing filePath", widget);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      if (this.settings.debug) console.warn("[cell-checkbox] file not found", filePath);
      return;
    }
    if (this.settings.debug) {
      console.log("[cell-checkbox][delegate] widget activated", {
        rowFp: widget.dataset.rowFp,
        matchIdx: widget.dataset.matchIdx,
        isChecked: widget.classList.contains("is-checked"),
        file: filePath,
      });
    }
    void toggleInFile(this, widget as HTMLSpanElement, file);
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
