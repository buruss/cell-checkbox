import { TFile } from "obsidian";
import type CellCheckboxPlugin from "./main";
import {
  buildPattern,
  computeSourceRowFingerprint,
  fingerprintForMatch,
  isTableContentLine,
  normalizeCellText,
} from "./shared";

const LOG = "[cell-checkbox][inject]";
const PROCESSED_FLAG = "cellCheckboxProcessed";

export function processTableForCheckboxes(
  plugin: CellCheckboxPlugin,
  table: HTMLTableElement,
  file: TFile,
): void {
  if (table.dataset[PROCESSED_FLAG]) return;
  table.dataset[PROCESSED_FLAG] = "1";

  const rows = table.querySelectorAll("tr");
  let touchedAny = false;
  rows.forEach((row) => {
    const touched = processRow(plugin, row, file);
    if (touched) touchedAny = true;
  });

  if (!touchedAny) {
    delete table.dataset[PROCESSED_FLAG];
  } else if (plugin.settings.debug) {
    console.log(LOG, "processed table", { file: file.path });
  }
}

function processRow(
  plugin: CellCheckboxPlugin,
  row: HTMLTableRowElement,
  file: TFile,
): boolean {
  const cells = Array.from(row.querySelectorAll("td, th")) as HTMLElement[];
  if (cells.length === 0) return false;

  const checkedChar = plugin.settings.checkedChar;

  // Per cell, decide whether it has TEXT brackets, NATIVE checkboxes, or nothing.
  // If both are present (some plugins add a native checkbox next to the source
  // text), prefer text to avoid double-counting.
  const cellInfos = cells.map((c) => analyzeCell(c, checkedChar));

  // If no cell has a bracket pattern, skip this row entirely
  if (!cellInfos.some((i) => i.hasBracket)) return false;

  const cellTexts = cellInfos.map((i) => i.fingerprintText);
  const fingerprint = cellTexts.join("|");

  if (plugin.settings.debug) {
    console.log(LOG, "row", {
      fingerprint,
      fingerprintForMatch: fingerprintForMatch(fingerprint, checkedChar),
      cellTexts,
      rowHTML: row.outerHTML.slice(0, 500),
    });
  }

  let matchIdx = 0;
  for (let i = 0; i < cells.length; i++) {
    const info = cellInfos[i];
    if (info.mode === "text") {
      matchIdx = processCellText(plugin, cells[i], fingerprint, matchIdx, file);
    } else if (info.mode === "native") {
      matchIdx = processCellNativeCheckboxes(plugin, cells[i], fingerprint, matchIdx, file);
    }
  }
  return matchIdx > 0;
}

interface CellInfo {
  mode: "text" | "native" | "none";
  hasBracket: boolean;
  fingerprintText: string;
}

function analyzeCell(cell: HTMLElement, checkedChar: string): CellInfo {
  // Pass 1: collect text content excluding native checkboxes
  const textContent = collectTextSkippingNative(cell, checkedChar);
  const textHasBracket = buildPattern(checkedChar, false).test(textContent);

  if (textHasBracket) {
    return {
      mode: "text",
      hasBracket: true,
      fingerprintText: normalizeCellText(textContent),
    };
  }

  // Pass 2: include native checkboxes
  const fullContent = collectTextIncludingNative(cell, checkedChar);
  const nativeHasBracket = buildPattern(checkedChar, false).test(fullContent);
  return {
    mode: nativeHasBracket ? "native" : "none",
    hasBracket: nativeHasBracket,
    fingerprintText: normalizeCellText(fullContent),
  };
}

function collectTextSkippingNative(node: Node, checkedChar: string): string {
  let result = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += (child as Text).data;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName === "CODE" || el.tagName === "PRE") continue;
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "checkbox") continue;
      if (el.classList?.contains("cell-checkbox")) {
        // Existing widget — represent as its current logical bracket form
        const v = el.getAttribute("aria-checked") === "true" ? checkedChar : " ";
        result += `[${v}]`;
        continue;
      }
      result += collectTextSkippingNative(el, checkedChar);
    }
  }
  return result;
}

function collectTextIncludingNative(node: Node, checkedChar: string): string {
  let result = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += (child as Text).data;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName === "CODE" || el.tagName === "PRE") continue;
      if (el.classList?.contains("cell-checkbox")) {
        const v = el.getAttribute("aria-checked") === "true" ? checkedChar : " ";
        result += `[${v}]`;
        continue;
      }
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "checkbox") {
        result += (el as HTMLInputElement).checked ? `[${checkedChar}]` : "[ ]";
        continue;
      }
      result += collectTextIncludingNative(el, checkedChar);
    }
  }
  return result;
}

function processCellText(
  plugin: CellCheckboxPlugin,
  cell: HTMLElement,
  rowFingerprint: string,
  startMatchIdx: number,
  file: TFile,
): number {
  let matchIdx = startMatchIdx;
  const test = buildPattern(plugin.settings.checkedChar, false);
  const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      let p: Node | null = node.parentNode;
      while (p && p !== cell) {
        if (p.nodeName === "CODE" || p.nodeName === "PRE") return NodeFilter.FILTER_REJECT;
        if (p.nodeType === Node.ELEMENT_NODE && (p as HTMLElement).classList?.contains("cell-checkbox")) {
          return NodeFilter.FILTER_REJECT;
        }
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
    matchIdx = replaceTextNode(plugin, textNode, rowFingerprint, matchIdx, file);
  }
  return matchIdx;
}

function processCellNativeCheckboxes(
  plugin: CellCheckboxPlugin,
  cell: HTMLElement,
  rowFingerprint: string,
  startMatchIdx: number,
  file: TFile,
): number {
  let matchIdx = startMatchIdx;
  const inputs = Array.from(
    cell.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
  for (const input of inputs) {
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
    const widget = createWidget(plugin, input.checked, rowFingerprint, matchIdx, file);
    input.parentNode?.replaceChild(widget, input);
    matchIdx++;
  }
  return matchIdx;
}

function replaceTextNode(
  plugin: CellCheckboxPlugin,
  textNode: Text,
  rowFingerprint: string,
  startMatchIdx: number,
  file: TFile,
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
    frag.appendChild(createWidget(plugin, checked, rowFingerprint, matchIdx, file));
    matchIdx++;
    last = m.index + 3;
  }
  if (last === 0) return matchIdx;
  if (last < text.length) {
    frag.appendChild(document.createTextNode(text.slice(last)));
  }
  parent.replaceChild(frag, textNode);
  return matchIdx;
}

function createWidget(
  _plugin: CellCheckboxPlugin,
  checked: boolean,
  rowFingerprint: string,
  matchIdx: number,
  file: TFile,
): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "cell-checkbox" + (checked ? " is-checked" : "");
  span.setAttribute("role", "checkbox");
  span.setAttribute("aria-checked", checked ? "true" : "false");
  span.setAttribute("tabindex", "0");
  span.setAttribute("contenteditable", "false");
  span.dataset.rowFp = rowFingerprint;
  span.dataset.matchIdx = String(matchIdx);
  span.dataset.filePath = file.path;
  // Event handling is delegated at the document level (see main.ts).
  return span;
}

export async function toggleInFile(
  plugin: CellCheckboxPlugin,
  widget: HTMLSpanElement,
  file: TFile,
) {
  const rowFp = widget.dataset.rowFp;
  const matchIdxStr = widget.dataset.matchIdx;
  if (rowFp == null || matchIdxStr == null) return;
  const matchIdx = Number(matchIdxStr);
  if (!Number.isFinite(matchIdx)) return;

  const checkedChar = plugin.settings.checkedChar;
  const rowFpMatch = fingerprintForMatch(rowFp, checkedChar);

  await plugin.app.vault.process(file, (data) => {
    const lines = data.split("\n");
    let matched = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isTableContentLine(line)) continue;
      const lineFp = computeSourceRowFingerprint(line);
      const lineFpMatch = fingerprintForMatch(lineFp, checkedChar);
      if (lineFpMatch !== rowFpMatch) continue;
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
      console.warn(LOG, "no fingerprint match for row", {
        rowFp,
        rowFpForMatch: rowFpMatch,
      });
    }
    return data;
  });
}
