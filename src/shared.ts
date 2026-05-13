export interface CellCheckboxSettings {
  checkedChar: string;
  debug: boolean;
}

export const DEFAULT_SETTINGS: CellCheckboxSettings = {
  checkedChar: "O",
  debug: false,
};

export function isValidCheckChar(ch: string): boolean {
  return ch.length === 1 && !/[\[\]\\\s]/.test(ch);
}

export function escapeRegex(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPattern(checkedChar: string, global: boolean): RegExp {
  const ch = escapeRegex(checkedChar);
  return new RegExp(`\\[(${ch}| )\\]`, global ? "g" : "");
}

export function isTableContentLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return false;
  // Exclude separator row: | --- | :---: | etc.
  if (/^\|[\s\-:|]+\|$/.test(t)) return false;
  return true;
}

// Strip invisible chars (ZWSP/ZWNJ/ZWJ/BOM) that some table-editor plugins insert
// into rendered DOM, and normalize NBSP to regular space. Then trim.
// Used to align DOM-derived fingerprints with source-derived ones.
export function normalizeCellText(s: string): string {
  return s
    .replace(/[​‌‍﻿]/g, "")
    .replace(/ /g, " ")
    .trim();
}

// Reduce inline markdown to its rendered plain-text equivalent so source-derived
// fingerprints match DOM-derived ones. The DOM's textContent has already had
// these markers consumed by the renderer; the source string still carries them.
export function stripInlineMarkdown(s: string): string {
  return s
    // Images: drop entirely (DOM renders <img>, textContent is empty)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Wikilinks: [[A|B]] -> B, [[A]] -> A
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, link: string, alias?: string) =>
      alias ? alias : link,
    )
    // Markdown links: [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    // Inline code: drop entirely (collectText skips CODE elements)
    .replace(/`[^`\n]+`/g, "")
    // Bold
    .replace(/\*\*([^*]+?)\*\*/g, "$1")
    .replace(/__([^_]+?)__/g, "$1")
    // Italic
    .replace(/\*([^*]+?)\*/g, "$1")
    .replace(/_([^_]+?)_/g, "$1")
    // Strikethrough
    .replace(/~~([^~]+?)~~/g, "$1");
}

export function computeSourceRowFingerprint(line: string): string {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => normalizeCellText(stripInlineMarkdown(c)))
    .join("|");
}

// State-agnostic version: collapses [O]/[ ] (and other matched brackets) to [?].
// Used for matching DOM fingerprints to source rows when DOM and source may
// disagree on bracket state (e.g., Obsidian renders [O] as a native unchecked
// checkbox in table cells, which yields [ ] DOM-side but [O] source-side).
export function fingerprintForMatch(rowFp: string, checkedChar: string): string {
  return rowFp.replace(buildPattern(checkedChar, true), "[?]");
}
