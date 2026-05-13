import { App, TFile } from "obsidian";
import type CellCheckboxPlugin from "./main";
import { processTableForCheckboxes } from "./widget-injector";

const LOG = "[cell-checkbox][observer]";

export function setupDomObserver(plugin: CellCheckboxPlugin): () => void {
  const root = plugin.app.workspace.containerEl;

  const handleTable = (table: HTMLTableElement) => {
    const file = findFileForElement(table, plugin.app);
    if (!file) return;
    processTableForCheckboxes(plugin, table, file);
  };

  const scanRoot = (el: HTMLElement) => {
    if (el.tagName === "TABLE") handleTable(el as HTMLTableElement);
    el.querySelectorAll?.("table").forEach((t) => handleTable(t as HTMLTableElement));
  };

  // Initial pass: process any tables already in DOM
  scanRoot(root);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== "childList") continue;
      for (const node of Array.from(m.addedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        scanRoot(node as HTMLElement);
      }
    }
  });

  observer.observe(root, { childList: true, subtree: true });
  console.warn(LOG, "MutationObserver started");

  return () => {
    observer.disconnect();
    if (plugin.settings.debug) console.log(LOG, "MutationObserver disconnected");
  };
}

function findFileForElement(el: HTMLElement, app: App): TFile | null {
  let result: TFile | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (result) return;
    const containerEl = (leaf.view as { containerEl?: HTMLElement }).containerEl;
    if (!containerEl) return;
    if (containerEl.contains(el)) {
      const file = (leaf.view as { file?: TFile }).file;
      if (file instanceof TFile) result = file;
    }
  });
  return result;
}
