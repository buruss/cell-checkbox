import { MarkdownPostProcessor, TFile } from "obsidian";
import type CellCheckboxPlugin from "./main";
import { processTableForCheckboxes } from "./widget-injector";

export function createReadingViewProcessor(plugin: CellCheckboxPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    const tables = el.querySelectorAll("table");
    if (tables.length === 0) return;
    const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;
    tables.forEach((table) => processTableForCheckboxes(plugin, table, file));
  };
}
