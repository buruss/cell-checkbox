import { MarkdownPostProcessor, MarkdownPostProcessorContext, TFile } from "obsidian";
import type CellCheckboxPlugin from "./main";
import {
  buildPattern,
  computeSourceRowFingerprint,
  isTableContentLine,
} from "./shared";

const LOG = "[cell-checkbox][reading]";
let firstCallLogged = false;

export function createReadingViewProcessor(plugin: CellCheckboxPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    if (!firstCallLogged) {
      firstCallLogged = true;
      console.warn(LOG, "post-processor first call", { source: ctx.sourcePath, hasTables: el.querySelectorAll("table").length });
    }
    const tables = el.querySelectorAll("table");
    if (tables.length === 0) return;
    if (plugin.settings.debug) console.log(LOG, "post-processor", { tables: tables.length, source: ctx.sourcePath });
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
  // Reconstruct cell texts for fingerprinting, accounting for native task checkboxes
  const cellTexts = cells.map((c) => reconstructCellText(c, checkedChar));

  const test = buildPattern(checkedChar, false);
  if (!cellTexts.some((t) => test.test(t))) return;

  const fingerprint = cellTexts.join("|");
  if (plugin.settings.debug) console.log(LOG, "row", { fingerprint, cellTexts });

  // PASS 1: replace text-based patterns ([O]/[ ]) via TreeWalker (proven path)
  let matchIdx = 0;
  for (const cell of cells) {
    matchIdx = processCellText(plugin, cell, fingerprint, matchIdx, ctx);
  }
  // PASS 2: also swap any native <input type="checkbox"> in the same row, in DOM order
  for (const cell of cells) {
    matchIdx = processCellNativeCheckboxes(plugin, cell, fingerprint, matchIdx, ctx);
  }
}

function processCellText(
  plugin: CellCheckboxPlugin,
  cell: HTMLElement,
  rowFingerprint: string,
  startMatchIdx: number,
  ctx: MarkdownPostProcessorContext,
): number {
  let matchIdx = startMatchIdx;
  const test = buildPattern(plugin.settings.checkedChar, false);
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
    matchIdx = replaceTextNode(plugin, textNode, rowFingerprint, matchIdx, ctx);
  }
  return matchIdx;
}

function processCellNativeCheckboxes(
  plugin: CellCheckboxPlugin,
  cell: HTMLElement,
  rowFingerprint: string,
  startMatchIdx: number,
  ctx: MarkdownPostProcessorContext,
): number {
  let matchIdx = startMatchIdx;
  const inputs = Array.from(
    cell.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
  for (const input of inputs) {
    // Skip if inside <code> or <pre>
    let p: Node | null = input.parentNode;
    let skip = false;
    while (p && p !== cell) {
      if (p.nodeName === "CODE" || p.nodeName === "PRE") {
        skip = true;
        break;
      }
      p = p.parentNode;
    }
    if (skip) continue;
    const widget = createWidget(plugin, input.checked, rowFingerprint, matchIdx, ctx);
    input.parentNode?.replaceChild(widget, input);
    matchIdx++;
    if (plugin.settings.debug) console.log(LOG, "replaced native checkbox", { checked: input.checked, matchIdx: matchIdx - 1 });
  }
  return matchIdx;
}

// Reconstruct a cell's logical text, converting native task checkboxes back to bracket form.
// Used only for fingerprinting; does not mutate the DOM.
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
  if (last === 0) return matchIdx; // no match found in this text node
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
    if (plugin.settings.debug) {
      console.log(LOG, "widget clicked", {
        rowFp: span.dataset.rowFp,
        matchIdx: span.dataset.matchIdx,
        currentlyChecked: checked,
      });
    }
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
  if (!(file instanceof TFile)) {
    if (plugin.settings.debug) console.warn(LOG, "no TFile for", ctx.sourcePath);
    return;
  }

  const rowFp = widget.dataset.rowFp;
  const matchIdxStr = widget.dataset.matchIdx;
  if (rowFp == null || matchIdxStr == null) return;
  const matchIdx = Number(matchIdxStr);
  if (!Number.isFinite(matchIdx)) return;

  const checkedChar = plugin.settings.checkedChar;

  await plugin.app.vault.process(file, (data) => {
    const lines = data.split("\n");
    let matched = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isTableContentLine(line)) continue;
      const lineFp = computeSourceRowFingerprint(line);
      if (lineFp !== rowFp) continue;
      matched = true;

      const re = buildPattern(checkedChar, true);
      let count = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        if (count === matchIdx) {
          const newCh = m[1] === " " ? checkedChar : " ";
          if (plugin.settings.debug) {
            console.log(LOG, "toggling", {
              lineIdx: i,
              matchIdx,
              from: m[1],
              to: newCh,
              col: m.index,
            });
          }
          lines[i] = line.slice(0, m.index) + "[" + newCh + "]" + line.slice(m.index + 3);
          return lines.join("\n");
        }
        count++;
      }
    }
    if (!matched && plugin.settings.debug) {
      console.warn(LOG, "no fingerprint match for row", { rowFp });
    }
    return data;
  });
}
