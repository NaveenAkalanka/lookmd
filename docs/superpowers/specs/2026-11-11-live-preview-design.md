# Live preview inside Read — design

Status: draft for review · 2026-11-11

## What we're building

Read with **Edit on** becomes an Obsidian-style *live preview*: you type directly
in the rendered page. Markdown syntax (`#`, `**`, `[ ](url)`, list markers, …) is
hidden and shown rendered everywhere **except on the lines your cursor or
selection touches**, where the raw Markdown appears so you can edit it precisely.

Decided with Naveen already:

- Views stay `Read | Source | Split`; **Edit** is a toggle on the current view.
- Read + Edit **off** = today's rendered page (react-markdown), untouched.
- Read + Edit **on** = live preview (this spec). It replaces the temporary
  "Read + Edit shows the split" fallback from step 2.
- Source + Edit = the raw editor, as now. Split = raw editor | rendered preview, as now.
- Approach: build it ourselves on CodeMirror 6's own Markdown parser (no
  third-party live-preview extension, no contenteditable-on-HTML).

## Hard constraints

- **Byte-for-byte saves.** Live preview only *decorates* the CodeMirror document;
  it never rewrites it. The only text changes are the user's own typing,
  toolbar/shortcut commands (already byte-exact), and the task-checkbox click
  (a one-character `[ ]` ↔ `[x]` change). CRLF/LF preservation is unchanged
  (`markdown/eol.ts`).
- **Locked stack.** CodeMirror 6 + `@codemirror/lang-markdown` (GFM is built in:
  tables, task lists, strikethrough). One new dependency:
  `@codemirror/language-data` (official CodeMirror package, MIT) for syntax
  highlighting inside fenced code blocks; languages load lazily per block.
- **Tokens only.** Every color and font comes from existing CSS custom
  properties (`--font-read`, `--syntax-*`, `--link`, …).
- **Raw HTML is never rendered** (same rule as the Read view's `skipHtml`).

## Non-goals

- No WYSIWYG / rich-text model, no re-serialising Markdown.
- No math, Mermaid, footnote rendering (they stay as styled raw text).
- No live preview for non-Markdown files (they only have Source).

## Architecture

### One editor, two looks

`Editor` gains a `variant` prop: `'source' | 'live'`. The live-preview extension
and the reading theme sit in a CodeMirror `Compartment`; switching Read ⇄ Source
while editing reconfigures that compartment on the *same* EditorView, so cursor,
selection, scroll position and undo history are kept. FilePane already renders
Source and Split in one editor slot; Read + Edit joins that same slot.

| View + Edit | Renders |
|---|---|
| Read, off | `ReadView` (react-markdown), as today |
| Read, on | `Editor variant="live"` |
| Source, off | `SourceView` (highlighted, read-only), as today |
| Source, on | `Editor variant="source"` |
| Split, off/on | raw side (`SourceView` / `Editor variant="source"`) + `ReadView` preview |

### New module: `client/src/markdown/livePreview/`

- `decorations.ts` — a **pure** function `buildDecorations(state, revealLines)`
  that walks the Lezer syntax tree for the visible ranges and returns a
  `DecorationSet`. No DOM access, so it is unit-testable in Node.
- `widgets.ts` — `WidgetType` subclasses: image, task checkbox, bullet, rule,
  table, code-block header (language badge + copy).
- `index.ts` — the CodeMirror extension: a `ViewPlugin` that rebuilds
  decorations on `docChanged`, `viewportChanged` and `selectionSet`, plus
  `EditorView.atomicRanges` over hidden syntax so arrow keys step over it, plus
  click handlers (links, checkboxes), plus the reading theme.

### The reveal rule

- A line is **revealed** (raw) when any selection range touches it, or while an
  IME composition is active on it.
- Inline constructs (emphasis, code, links, wiki links) are revealed per line.
- Block constructs (fenced code, tables, front matter) are revealed **as a
  whole** when the cursor is anywhere inside them.
- Everything else is rendered.

## Element by element

| Element | Rendered (cursor elsewhere) | Notes |
|---|---|---|
| Headings `#`–`######` | marks + space hidden; text styled with the Read heading scale | setext headings (`===`) keep their underline line, dimmed |
| Bold / italic / strike / inline code | delimiters hidden; text styled | nested emphasis handled by the tree |
| Links `[text](url)` | brackets and `(url)` hidden; text styled as `--link` | **Ctrl/Cmd-click** opens: internal → existing `onNavigate`, external → new tab. A plain click places the cursor (reveals raw) |
| Wiki links `[[Note\|alias]]` | shows alias (or note name), link-styled | same click rule; resolution identical to Read's `remarkWikiLink` |
| Autolinks / bare URLs | link-styled | |
| Images `![alt](src)` | a block widget below the line shows the image via the existing `resolveImage`; the syntax line itself is hidden | loading placeholder; on failure the same "image not found" chip as Read |
| Bullet lists | marker replaced by a `•` widget (indent kept) | |
| Ordered lists | numbers kept, dimmed slightly | |
| Task items `- [ ]` | marker + box replaced by a real checkbox widget | clicking toggles `[ ]`↔`[x]` (one character; undoable) |
| Blockquote `>` | marker hidden; line styled like Read's blockquote | |
| Horizontal rule | replaced by a rule widget | |
| Fenced code | fence lines hidden; block gets the code background, a language badge + copy button header, and syntax highlighting via `language-data` | cursor inside → whole block raw (fences visible) |
| Tables (GFM) | replaced by a table widget; cell text gets inline formatting (bold/italic/code/strike/links) | click a cell → cursor moves into the raw table, which reveals; editing is raw |
| Raw HTML, front matter | shown raw, dimmed mono | never rendered |

## Integration with existing features

- **Typography & zoom:** Read + Edit uses `--font-read`, the Read measure and
  heading scale, and the `read` zoom slot (not the Split slots).
- **Outline:** jumping to a heading while live preview is showing scrolls the
  editor to that heading's line (headings are extracted with line numbers;
  the existing `reveal` mechanism moves the cursor there).
- **Find/replace (in-editor):** works as in Source; a selected match reveals
  its line.
- **Annotations:** offered on Read + Edit; while drawing, typing is locked
  (same as Source + Edit), scroll host is `.cm-scroller`.
- **Toolbar & shortcuts:** unchanged, they already act on the editor.
- **Read-only build / no write access:** Edit is hidden, so Read is always the
  react-markdown page.
- **Phones:** same behaviour; tap = click. Ctrl/Cmd-click has no touch
  equivalent, so on coarse pointers a link tap shows a small "Open link" chip
  next to the cursor.

## Performance

Decorations are built only for the visible viewport (plus a margin) from the
incremental syntax tree, so typing cost is independent of file length. Widgets
implement `eq()` so unchanged images/tables are not re-created. Budget: no
dropped frames typing in a 5,000-line file.

## Testing

Unit (Node, `node --test`):

- `buildDecorations` per element: what is hidden, styled, or widgeted, with the
  cursor away from / on the line (and inside / outside a block).
- Checkbox toggle changes exactly one character.
- Round-trip: building decorations never changes `state.doc`.

Browser (Playwright, the existing scratch harness):

- Type in Read + Edit; raw appears only on the active line; save → bytes on disk
  equal the edit (LF and CRLF files).
- Read ⇄ Source while editing keeps the same editor instance and undo history.
- Images load through the file source; broken image shows the chip.
- Ctrl/Cmd-click internal link opens the file; external opens a new tab.
- Checkbox click toggles and is undoable.
- Table and code block reveal when the cursor enters, render when it leaves.
- Outline jump scrolls the live editor; annotations lock typing.
- Phone sizes: no sideways scroll; link chip on tap.
- Typing latency check in a 5,000-line generated file.

## Build order (one commit each)

1. Editor `variant` + compartment; Read + Edit mounts the live editor in the
   shared slot (replacing the split fallback) with headings, emphasis, inline
   code and the reveal rule.
2. Links, wiki links, autolinks (+ Ctrl/Cmd-click), lists, task checkboxes,
   blockquotes, rules.
3. Images via `resolveImage`.
4. Fenced code (highlighting via `language-data`, header widget) and tables.
5. Outline, annotations, phone link chip; CLAUDE.md "Views + Edit" note updated
   to drop "currently the split".
