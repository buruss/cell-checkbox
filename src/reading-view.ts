import { MarkdownPostProcessor, MarkdownPostProcessorContext, TFile } from "obsidian";
import type CellCheckboxPlugin from "./main";
import {
  buildPattern,
  computeSourceRowFingerprint,
  isTableContentLine,
} from "./shared";

export function createReadingViewProcessor(plugin: CellCheckboxPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    const tables = el.querySelectorAll("table");
    tables.forEach((table) => processTable(plugin, table, ctx));
  };
}

function processTable(
  plugin: CellCheckboxPlugin,
  table: HTMLTableElement,
  ctx: MarkdownPostProcessorContext,
) {
  const rows = table.querySelectorAll("tr");
  rows.forEach((row) => processRow(plugin, row, ctx));
}

function processRow(
  plugin: CellCheckboxPlugin,
  row: HTMLTableRowElement,
  ctx: MarkdownPostProcessorContext,
) {
  const cells = Array.from(row.querySelectorAll("td, th")) as HTMLElement[];
  if (cells.length === 0) return;

  const checkedChar = plugin.settings.checkedChar;
  const cellTexts = cells.map((c) => reconstructCellText(c, checkedChar));
  const test = buildPattern(checkedChar, false);
  if (!cellTexts.some((t) => test.test(t))) return;

  const fingerprint = cellTexts.join("|");

  let matchIdx = 0;
  for (const cell of cells) {
    matchIdx = processNode(plugin, cell, cell, fingerprint, matchIdx, ctx);
  }
}

// Reconstruct cell text including bracket-form for native task checkboxes
function reconstructCellText(node: Node, checkedChar: string): string {
  let result = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += (child as Text).data;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName === "CODE" || el.tagName === "PRE") continue;
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "checkbox") {
        result += (el as HTMLInputElement).checked ? `[${checkedChar}]` : "[ ]";
      } else {
        result += reconstructCellText(el, checkedChar);
      }
    }
  }
  return result.trim();
}

function processNode(
  plugin: CellCheckboxPlugin,
  cell: HTMLElement,
  node: Node,
  rowFingerprint: string,
  startMatchIdx: number,
  ctx: MarkdownPostProcessorContext,
): number {
  let matchIdx = startMatchIdx;
  const children = Array.from(node.childNodes);

  for (const child of children) {
    if (child.nodeType === Node.TEXT_NODE) {
      matchIdx = replaceTextNode(plugin, child as Text, rowFingerprint, matchIdx, ctx);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName === "CODE" || el.tagName === "PRE") continue;
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "checkbox") {
        const checked = (el as HTMLInputElement).checked;
        const widget = createWidget(plugin, checked, rowFingerprint, matchIdx, ctx);
        el.parentNode?.replaceChild(widget, el);
        matchIdx++;
      } else {
        matchIdx = processNode(plugin, cell, el, rowFingerprint, matchIdx, ctx);
      }
    }
  }
  return matchIdx;
}

function replaceTextNode(
  plugin: CellCheckboxPlugin,
  textNode: Text,
  rowFingerprint: string,
  startMatchIdx: number,
  ctx: MarkdownPostProcessorContext,
): number {
  let matchIdx = startMatchIdx;
  const text = textNode.data;
  const parent = textNode.parentNode;
  if (!parent) return matchIdx;

  const checkedChar = plugin.settings.checkedChar;
  const re = buildPattern(checkedChar, true);
  if (!re.test(text)) return matchIdx;
  re.lastIndex = 0;

  const frag = document.createDocumentFragment();
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    }
    const checked = m[1] === checkedChar;
    frag.appendChild(createWidget(plugin, checked, rowFingerprint, matchIdx, ctx));
    matchIdx++;
    last = m.index + 3;
  }
  if (last < text.length) {
    frag.appendChild(document.createTextNode(text.slice(last)));
  }
  parent.replaceChild(frag, textNode);
  return matchIdx;
}

function createWidget(
  plugin: CellCheckboxPlugin,
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
  // Prevent the contenteditable host (Live Preview's rendered table) from claiming this node
  span.setAttribute("contenteditable", "false");
  span.dataset.rowFp = rowFingerprint;
  span.dataset.matchIdx = String(matchIdx);

  const block = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const activate = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    void toggleInFile(plugin, span, ctx);
  };

  span.addEventListener("pointerdown", block);
  span.addEventListener("mousedown", block);
  span.addEventListener("touchstart", block, { passive: false });

  span.addEventListener("click", activate);
  span.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") activate(e);
  });

  return span;
}

async function toggleInFile(
  plugin: CellCheckboxPlugin,
  widget: HTMLSpanElement,
  ctx: MarkdownPostProcessorContext,
) {
  const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(file instanceof TFile)) return;

  const rowFp = widget.dataset.rowFp;
  const matchIdxStr = widget.dataset.matchIdx;
  if (rowFp == null || matchIdxStr == null) return;
  const matchIdx = Number(matchIdxStr);
  if (!Number.isFinite(matchIdx)) return;

  const checkedChar = plugin.settings.checkedChar;

  await plugin.app.vault.process(file, (data) => {
    const lines = data.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isTableContentLine(line)) continue;
      if (computeSourceRowFingerprint(line) !== rowFp) continue;

      const re = buildPattern(checkedChar, true);
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
