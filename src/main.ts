import { App, MarkdownPostProcessorContext, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";

interface CellCheckboxSettings {
  checkedChar: string;
}

const DEFAULT_SETTINGS: CellCheckboxSettings = {
  checkedChar: "O",
};

function isValidCheckChar(ch: string): boolean {
  // Single visible character, excluding bracket/backslash/whitespace
  return ch.length === 1 && !/[\[\]\\\s]/.test(ch);
}

function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default class CellCheckboxPlugin extends Plugin {
  settings!: CellCheckboxSettings;

  async onload() {
    await this.loadSettings();
    this.addSettingTab(new CellCheckboxSettingTab(this.app, this));
    this.registerMarkdownPostProcessor((el, ctx) => {
      this.processElement(el, ctx);
    });
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
      const view = leaf.view as { previewMode?: { rerender?: (full: boolean) => void } };
      view?.previewMode?.rerender?.(true);
    });
  }

  buildPattern(global: boolean): RegExp {
    const ch = escapeRegex(this.settings.checkedChar);
    return new RegExp(`\\[(${ch}| )\\]`, global ? "g" : "");
  }

  private processElement(el: HTMLElement, ctx: MarkdownPostProcessorContext) {
    const tables = el.querySelectorAll("table");
    tables.forEach((table) => this.processTable(table, ctx));
  }

  private processTable(table: HTMLTableElement, ctx: MarkdownPostProcessorContext) {
    const rows = table.querySelectorAll("tr");
    rows.forEach((row) => this.processRow(row, ctx));
  }

  private processRow(row: HTMLTableRowElement, ctx: MarkdownPostProcessorContext) {
    const cells = Array.from(row.querySelectorAll("td, th")) as HTMLElement[];
    if (cells.length === 0) return;

    const test = this.buildPattern(false);
    const cellTexts = cells.map((c) => (c.textContent ?? "").trim());
    if (!cellTexts.some((t) => test.test(t))) return;

    const fingerprint = cellTexts.join("|");

    let matchIdx = 0;
    for (const cell of cells) {
      matchIdx = this.processCell(cell, fingerprint, matchIdx, ctx);
    }
  }

  private processCell(
    cell: HTMLElement,
    rowFingerprint: string,
    startMatchIdx: number,
    ctx: MarkdownPostProcessorContext,
  ): number {
    let matchIdx = startMatchIdx;
    const test = this.buildPattern(false);
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        let p: Node | null = node.parentNode;
        while (p && p !== cell) {
          if (p.nodeName === "CODE" || p.nodeName === "PRE") return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return test.test((node as Text).data)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    });

    const targets: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) targets.push(n as Text);

    for (const textNode of targets) {
      matchIdx = this.replaceTextNode(textNode, rowFingerprint, matchIdx, ctx);
    }
    return matchIdx;
  }

  private replaceTextNode(
    textNode: Text,
    rowFingerprint: string,
    startMatchIdx: number,
    ctx: MarkdownPostProcessorContext,
  ): number {
    let matchIdx = startMatchIdx;
    const text = textNode.data;
    const parent = textNode.parentNode;
    if (!parent) return matchIdx;

    const re = this.buildPattern(true);
    const checkedChar = this.settings.checkedChar;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const checked = m[1] === checkedChar;
      frag.appendChild(this.createWidget(checked, rowFingerprint, matchIdx, ctx));
      matchIdx++;
      last = m.index + 3;
    }
    if (last < text.length) {
      frag.appendChild(document.createTextNode(text.slice(last)));
    }
    parent.replaceChild(frag, textNode);
    return matchIdx;
  }

  private createWidget(
    checked: boolean,
    rowFingerprint: string,
    matchIdx: number,
    ctx: MarkdownPostProcessorContext,
  ): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "cell-checkbox" + (checked ? " is-checked" : "");
    span.setAttribute("role", "checkbox");
    span.setAttribute("aria-checked", checked ? "true" : "false");
    span.setAttribute("tabindex", "0");
    span.dataset.rowFp = rowFingerprint;
    span.dataset.matchIdx = String(matchIdx);

    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const activate = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      void this.toggleInFile(span, ctx);
    };

    // Prevent CodeMirror from claiming focus (avoids opening the virtual keyboard on mobile)
    span.addEventListener("pointerdown", block);
    span.addEventListener("mousedown", block);
    span.addEventListener("touchstart", block, { passive: false });

    span.addEventListener("click", activate);
    span.addEventListener("keydown", (e) => {
      if (e.key === " " || e.key === "Enter") activate(e);
    });

    return span;
  }

  private async toggleInFile(widget: HTMLSpanElement, ctx: MarkdownPostProcessorContext) {
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;

    const rowFp = widget.dataset.rowFp;
    const matchIdxStr = widget.dataset.matchIdx;
    if (rowFp == null || matchIdxStr == null) return;
    const matchIdx = Number(matchIdxStr);
    if (!Number.isFinite(matchIdx)) return;

    const checkedChar = this.settings.checkedChar;

    await this.app.vault.process(file, (data) => {
      const lines = data.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!isTableContentLine(line)) continue;
        if (computeSourceRowFingerprint(line) !== rowFp) continue;

        const re = this.buildPattern(true);
        let count = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          if (count === matchIdx) {
            const newCh = m[1] === " " ? checkedChar : " ";
            lines[i] = line.slice(0, m.index) + "[" + newCh + "]" + line.slice(m.index + 3);
            return lines.join("\n");
          }
          count++;
        }
      }
      return data;
    });
  }
}

function isTableContentLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return false;
  if (/^\|[\s\-:|]+\|$/.test(t)) return false;
  return true;
}

function computeSourceRowFingerprint(line: string): string {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim())
    .join("|");
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
  }
}
