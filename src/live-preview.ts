import { editorLivePreviewField } from "obsidian";
import { Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import type CellCheckboxPlugin from "./main";
import { buildPattern, isTableContentLine } from "./shared";

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly checkedChar: string,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked && other.checkedChar === this.checkedChar;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cell-checkbox" + (this.checked ? " is-checked" : "");
    span.setAttribute("role", "checkbox");
    span.setAttribute("aria-checked", this.checked ? "true" : "false");
    span.setAttribute("contenteditable", "false");
    span.setAttribute("tabindex", "0");
    span.dataset.pos = String(this.pos);

    const checkedChar = this.checkedChar;

    const block = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const activate = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = Number(span.dataset.pos);
      if (!Number.isFinite(pos)) return;
      const slice = view.state.doc.sliceString(pos, pos + 3);
      if (slice.length !== 3 || slice[0] !== "[" || slice[2] !== "]") return;
      const current = slice[1];
      const newCh = current === " " ? checkedChar : " ";
      view.dispatch({
        changes: { from: pos + 1, to: pos + 2, insert: newCh },
      });
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

  ignoreEvent(): boolean {
    return true;
  }
}

export function createLivePreviewExtension(plugin: CellCheckboxPlugin): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = this.build(view);
      }

      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet) {
          this.decorations = this.build(u.view);
        }
      }

      build(view: EditorView): DecorationSet {
        const isLivePreview = view.state.field(editorLivePreviewField, false);
        if (!isLivePreview) return Decoration.none;

        const builder = new RangeSetBuilder<Decoration>();
        const cursor = view.state.selection.main;
        const checkedChar = plugin.settings.checkedChar;
        const re = buildPattern(checkedChar, true);

        for (const { from, to } of view.visibleRanges) {
          let pos = from;
          while (pos <= to) {
            const line = view.state.doc.lineAt(pos);
            if (isTableContentLine(line.text)) {
              const cursorOnLine =
                cursor.from >= line.from && cursor.from <= line.to;
              if (!cursorOnLine) {
                re.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = re.exec(line.text)) !== null) {
                  const start = line.from + m.index;
                  const end = start + 3;
                  const checked = m[1] === checkedChar;
                  builder.add(
                    start,
                    end,
                    Decoration.replace({
                      widget: new CheckboxWidget(checked, checkedChar, start),
                    }),
                  );
                }
              }
            }
            if (line.to + 1 > to) break;
            pos = line.to + 1;
          }
        }

        return builder.finish();
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}
