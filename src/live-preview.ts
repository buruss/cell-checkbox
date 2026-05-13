// Deprecated: CM6 Decoration approach proved unreliable for Obsidian Live Preview
// tables. Obsidian renders LP tables via a block-level widget that hides any
// inline `Decoration.replace` we add inside its range. We now use the DOM
// MutationObserver in ./dom-observer.ts to mutate the rendered table cells
// directly, which works for both Reading view (alongside the post processor)
// and Live Preview (where Obsidian's table widget is the source of cell DOM).
//
// This file is kept only to keep the diff small; nothing imports from it.
export {};
