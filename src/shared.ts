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

export function computeSourceRowFingerprint(line: string): string {
  return line
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim())
    .join("|");
}
