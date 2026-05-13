import { MarkdownPostProcessor, TFile } from "obsidian";
import type CellCheckboxPlugin from "./main";
import { processTableForCheckboxes } from "./widget-injector";

const LOG = "[cell-checkbox][reading]";

export function createReadingViewProcessor(plugin: CellCheckboxPlugin): MarkdownPostProcessor {
  return (el, ctx) => {
    const tables = el.querySelectorAll("table");
    if (tables.length === 0) return;
    const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile)) return;
    if (plugin.settings.debug) {
      console.log(LOG, "post-processor", { tables: tables.length, source: ctx.sourcePath });
    }
    tables.forEach((table) => processTableForCheckboxes(plugin, table, file));
  };
}
