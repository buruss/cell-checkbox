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

  // Initial pass
  scanRoot(root);

  // Debounce per-table reprocessing to avoid flurries during edits
  const pending = new Map<HTMLTableElement, number>();
  const scheduleReprocess = (table: HTMLTableElement) => {
    const existing = pending.get(table);
    if (existing) window.clearTimeout(existing);
    const timeoutId = window.setTimeout(() => {
      pending.delete(table);
      if (!document.contains(table)) return;
      // Allow re-processing: clear the processed flag so widgets are
      // (re-)injected for any new bracket text introduced by the editor.
      delete (table as HTMLTableElement).dataset.cellCheckboxProcessed;
      handleTable(table);
    }, 30);
    pending.set(table, timeoutId);
  };

  const observer = new MutationObserver((mutations) => {
    const newTables = new Set<HTMLTableElement>();
    const changedTables = new Set<HTMLTableElement>();

    for (const m of mutations) {
      if (m.type !== "childList") continue;

      // Tables added or contained within added subtrees
      for (const node of Array.from(m.addedNodes)) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const el = node as HTMLElement;
        if (el.tagName === "TABLE") newTables.add(el as HTMLTableElement);
        el.querySelectorAll?.("table").forEach((t) => newTables.add(t as HTMLTableElement));
      }

      // Mutations inside existing tables (cell content changed after a toggle, etc.)
      let ancestor: Node | null = m.target;
      while (ancestor && ancestor !== root) {
        if (
          ancestor.nodeType === Node.ELEMENT_NODE &&
          (ancestor as HTMLElement).tagName === "TABLE"
        ) {
          changedTables.add(ancestor as HTMLTableElement);
          break;
        }
        ancestor = ancestor.parentNode;
      }
    }

    for (const t of newTables) handleTable(t);
    for (const t of changedTables) {
      if (newTables.has(t)) continue;
      scheduleReprocess(t);
    }
  });

  observer.observe(root, { childList: true, subtree: true });
  console.warn(LOG, "MutationObserver started");

  return () => {
    observer.disconnect();
    pending.forEach((id) => window.clearTimeout(id));
    pending.clear();
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
