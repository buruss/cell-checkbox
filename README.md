# Cell Checkbox

An Obsidian plugin that turns `[ ]` / `[O]` text inside Markdown table cells into tappable checkboxes. Designed for reviewing checklist-style tables on mobile and tablet without opening the virtual keyboard.

## Example

```markdown
| Section    | Reviewed | Notes |
| ---------- | :------: | ----- |
| 1. Intro   | [O]      |       |
| 2. Body    | [ ]      |       |
| 3. Closing | [ ]      |       |
```

- In both Reading view and Live Preview, the `[ ]` / `[O]` text is rendered as a small checkbox widget.
- Tap or click to toggle `[ ]` ↔ `[O]`. The source file is updated immediately.
- On mobile, tapping the widget does not focus the editor, so the virtual keyboard stays closed.
- In Source mode, the raw `[O]` text is left untouched.

## Installation

### Option A — BRAT (recommended)

[BRAT](https://github.com/TfTHacker/obsidian42-brat) installs and auto-updates plugins straight from a GitHub repository, no manual file handling.

1. In Obsidian, open **Settings → Community plugins** and install **Obsidian42 - BRAT**. Enable it.
2. Open **Settings → BRAT → Add Beta plugin**.
3. Paste the repository URL of this plugin (e.g. `https://github.com/<owner>/cell-checkbox`) and confirm.
4. BRAT downloads the latest release, installs it, and from then on updates automatically whenever a new release is published.

### Option B — Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [Release](../../releases/latest).
2. Copy them into `<your-vault>/.obsidian/plugins/cell-checkbox/`.
3. Enable **Cell Checkbox** under **Settings → Community plugins**.

## Settings

**Settings → Cell Checkbox**

- **Checked character** — the character placed inside the brackets to mark a cell as checked. Default is `O`. Use `x` if you prefer the Markdown task-list convention (`[x]` / `[ ]`). Must be a single non-whitespace character (no `[`, `]`, `\`, or whitespace).
- **Debug logging** — verbose diagnostic logs in the developer console (Ctrl+Shift+I). Leave off unless you are filing a bug report.

Changing the checked character re-renders open notes so the new convention takes effect immediately. Existing brackets in your files that use the old character will no longer be recognized — you may need to bulk-convert them.

## How it works

The plugin uses two complementary mechanisms to cover both Obsidian view modes, plus document-level event delegation so widgets remain interactive regardless of how the host DOM is re-rendered.

### Reading view
A registered Markdown post-processor walks rendered `<td>` and `<th>` elements, replacing bracket text patterns and any native task `<input type="checkbox">` Obsidian or other plugins emit inside the same cell. Content inside `<code>` / `<pre>` is skipped, so legend cells containing backticked `` `[ ]` `` stay untouched.

### Live Preview (editing mode)
A `MutationObserver` watches the workspace for `<table>` elements rendered by CodeMirror's Live Preview widget. The same widget-injection logic runs against those tables, and a debounced re-process fires when the cell content changes (for example after a toggle re-renders the table).

> An earlier prototype used a CodeMirror `ViewPlugin` with `Decoration.replace`, but Obsidian renders Live Preview tables via a block-level widget that hides any inline decoration inside its range. The DOM-observer approach mutates the already-rendered table directly and works reliably.

### Click handling — document-level delegation
A single set of listeners on `document` intercepts `click`, `keydown`, `pointerdown`, `mousedown`, and `touchstart` events that originate from `.cell-checkbox` elements. The widget carries enough state (`data-file-path`, `data-row-fp`, `data-match-idx`) on its DOM node to identify itself when activated. This survives any DOM cloning or re-mounting the host might perform.

### Row matching when toggling
Each widget records its row fingerprint (the joined, normalized cell texts of its `<tr>`) and the bracket's index within the row. On click the plugin reads the source file, finds the table row whose fingerprint matches state-agnostically (treating both `[O]` and `[ ]` as `[?]` for the purposes of matching), locates the Nth bracket on that line, and toggles it via `app.vault.process()` for atomic write.

Zero-width spaces and non-breaking spaces inserted by some table-editor plugins (e.g. `markdown-table-editor`, `table-extended`) are normalized out before matching.

### Mobile keyboard suppression
The delegated `pointerdown` / `mousedown` / `touchstart` handlers call `preventDefault()` and `stopPropagation()` in the capture phase before the editor sees them, preventing the contenteditable from claiming focus. Widgets also carry `contenteditable="false"`.

## Limitations

- Only the exact bracket forms `[ ]` ← → `[<checked-char>]` are toggled (case-sensitive).
- A cell containing markdown emphasis around the bracket (e.g. `**[O]**`) may break fingerprint matching — plain text is assumed.
- When the cursor is inside a table row in Live Preview, that row reverts to raw markdown so you can edit it directly. Widgets in the other rows continue to work.
- The plugin coexists with `markdown-table-editor` / `table-extended`, but those plugins may insert their own native checkbox; the cell text is preferred over the native checkbox when both are present.

## Development

```bash
pnpm install
pnpm run dev      # esbuild watch mode
```

For convenient testing, junction the plugin folder directly into your vault:

```powershell
# Windows (admin PowerShell)
New-Item -ItemType Junction `
  -Path "<vault>\.obsidian\plugins\cell-checkbox" `
  -Target "D:\obsidian-plugins\cell-checkbox"
```

Production build:

```bash
pnpm run build    # tsc check + esbuild bundle
```

> pnpm 11+ requires explicit approval for dependency build scripts (esbuild downloads its platform binary on install). The repo includes a `pnpm-workspace.yaml` that approves it. If you switch package managers, `npm install && npm run build` works without that step.

## Releasing (maintainers)

Releases are automated by `.github/workflows/release.yml`. To cut a new version:

1. Bump the version in `manifest.json` (and `versions.json` if you want to declare a `minAppVersion` change). Commit.
2. Create and push a matching git tag:
   ```bash
   git tag 0.2.0
   git push origin 0.2.0
   ```
3. The workflow builds the plugin and creates a GitHub Release with `main.js`, `manifest.json`, and `styles.css` attached. BRAT users get the update automatically on their next sync.

The workflow refuses to publish if the tag does not match `manifest.json`'s `version` field.

## License

MIT — see [LICENSE](LICENSE).
