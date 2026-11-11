# Live Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read + Edit becomes an Obsidian-style live preview: a CodeMirror editor
that renders Markdown everywhere except the lines the cursor touches.

**Architecture:** One `Editor` with a `variant` (`'source' | 'live'`) held in a
CodeMirror `Compartment`, so Read ⇄ Source keeps the same EditorView. A new
module `client/src/markdown/livePreview/` builds decorations from the Lezer
Markdown tree: pure builders (unit-tested in Node) plus thin CodeMirror glue.

**Tech Stack:** React 19, CodeMirror 6 (`@codemirror/view`, `state`,
`language`, `lang-markdown` 6.5 / `@lezer/markdown` 1.6), new
`@codemirror/language-data`, Node `--test`, Playwright (scratch harness).

**Spec:** `docs/superpowers/specs/2026-11-11-live-preview-design.md`

## Global Constraints

- Byte-for-byte saves: live preview only decorates; the only programmatic text
  change it adds is the task checkbox (`[ ]` ↔ `[x]`, one character, undoable).
- CRLF/LF preservation stays in `markdown/eol.ts`; nothing in livePreview touches it.
- One new dependency only: `@codemirror/language-data` (exact current version, `^` range like the others).
- No hardcoded color or font: every value is a CSS custom property
  (`--font-read`, `--font-mono`, `--font-ui`, `--link`, `--border`, `--background`,
  `--text-*`, `--syntax-*`, `--accent`).
- Raw HTML and front matter are never rendered — shown raw, dimmed mono.
- Read + Edit off stays the react-markdown `ReadView`, untouched.
- Read-only build / `canWrite=false`: Edit hidden, so live preview never mounts.
- Commits: conventional messages, no `Co-authored-by` trailer, no assistant footer
  (user's global CLAUDE.md overrides the harness attribution reminder).

## Facts found while planning (they change the spec's sketch)

1. **The editor parses without GFM today.** `markdown()` yields no `Table`,
   `Task`, `Strikethrough` nodes. Use `markdown({ base: markdownLanguage, codeLanguages: languages })`
   for both variants (Source also gains table/strike highlighting and fenced-code colors).
2. **Block decorations can't come from a ViewPlugin** (CodeMirror rejects block
   widgets and replacements that cross line breaks from plugins). So the
   spec's single ViewPlugin is split: a **StateField** for block constructs
   (tables, images, fenced code, front matter) and a **ViewPlugin** over
   `view.visibleRanges` for inline constructs. Same behaviour, legal API.
3. **Front matter is not parsed** by Lezer (it reads as HorizontalRule +
   SetextHeading2). Detect it ourselves and skip every node inside it.
4. **`[[Note|alias]]` parses as a nested `Link`.** Detect wiki links by regex on
   line text and skip `Link` nodes overlapping a match.

Node names confirmed in the GFM tree: `ATXHeading1-6`, `SetextHeading1-2`,
`HeaderMark`, `StrongEmphasis`, `Emphasis`, `EmphasisMark`, `Strikethrough`,
`StrikethroughMark`, `InlineCode`, `CodeMark`, `Link`, `Image`, `LinkMark`,
`URL`, `HTMLTag`, `Blockquote`, `QuoteMark`, `HorizontalRule`, `FencedCode`,
`CodeInfo`, `CodeText`, `BulletList`, `OrderedList`, `ListItem`, `ListMark`,
`Task`, `TaskMarker`, `Table`, `TableHeader`, `TableRow`, `TableCell`, `TableDelimiter`.

## File Structure

`client/src/markdown/livePreview/`

| File | Responsibility |
|---|---|
| `reveal.ts` | which lines show raw; front-matter range |
| `inline.ts` | pure `buildInline` — headings, emphasis, code, links, wiki links, lists, tasks, quotes, rules, HTML |
| `blocks.ts` | pure `buildBlocks` — fenced code, tables, images, front matter |
| `table.ts` | pure `parseTable`, `inlineSpans` (cell formatting model) |
| `links.ts` | pure `linkAt`, `toggleTaskAt`; `parseWikiLink` lives in `remarkWikiLink.ts` |
| `widgets.ts` | `WidgetType` classes (DOM only) |
| `theme.ts` | `liveTheme` (reading typography, tokens only) |
| `index.ts` | `livePreview()` extension, `liveHooks` facet, click/tap handlers |
| `testUtil.ts` | `stateOf`, `summarize` for unit tests |
| `*.test.ts` | unit tests per pure module |

Modified: `components/Editor.tsx`, `components/FilePane.tsx`, `components/Outline.tsx`,
`App.tsx`, `markdown/remarkWikiLink.ts`, `client/package.json`, `styles.css` (only `.editor-live` gutter rule), `CLAUDE.md`.

## Shared conventions (every task)

- Decorations carry a class or a widget `kind`, so tests can read them:
  marks `cm-lp-h1`…`cm-lp-h6`, `cm-lp-strong`, `cm-lp-em`, `cm-lp-strike`,
  `cm-lp-code`, `cm-lp-link`, `cm-lp-link-internal`, `cm-lp-ordered`, `cm-lp-html`;
  line classes `cm-lp-quote`, `cm-lp-fm`, `cm-lp-codeblock`, `cm-lp-codeblock-end`,
  `cm-lp-hidden-line`; hidden syntax = `Decoration.replace({})`.
- Every widget class has `readonly kind: 'bullet' | 'task' | 'rule' | 'image' | 'table' | 'codehead'` and an `eq()` comparing its data.
- `testUtil.ts`:
  - `stateOf(marked: string): EditorState` — `|` marks the cursor, `[`…`]` a selection
    (removed from the doc); extensions `markdown({ base: markdownLanguage })`;
    calls `ensureSyntaxTree(state, len, 5000)`.
  - `summarize(set: DecorationSet, state): string[]` — sorted entries
    `hide 0-2`, `mark cm-lp-h1 2-7`, `widget bullet 0-1`, `line cm-lp-quote L3`
    (L = 1-based line).
- Browser checks: new scratch script `live.cjs` in the scratchpad (pattern of
  `zoom.cjs`). Before each run: `npm run build`, then (re)start the test server
  `node server/src/index.ts --base <scratchpad>/base --port 4399` with
  `LOOKMD_STATIC_DIR=client/dist` (static file list is read at startup — always
  restart after a build). Read-only checks use `--read-only` on port 4397.
- Unit run: `npm test --workspace client`; also `npm run typecheck`.

## Review Focus

1. **IME / composition** (CJK, Android keyboards): decorations must not change
   on the composing line mid-composition, or input is mangled. → Task 1 test
   `revealedLines includes the composing line`; Task 5 Android check types via
   `insertText` in Pixel 7 and asserts the saved bytes.
2. **Undo after switching Read ⇄ Source mid-edit** must undo the last typed
   text, not a reconfigure. → Task 1 browser check.
3. **CRLF file with a table / fenced code** edited in live mode keeps CRLF on
   save. → Task 4 browser check on `crlf.md` extended with a table.
4. **Unclosed constructs** while typing (`**bold` without close, a ``` fence
   with no end, a table with only a header row) render raw, never throw. →
   Task 1 and Task 4 unit tests `unclosed … stays raw`.
5. **Huge file**: decorating stays viewport-bound. → Task 5 latency check in a
   5,000-line file (median keystroke→paint under 16 ms, measured with
   `performance.now()` around `insertText` + `requestAnimationFrame`).

---

### Task 1: Editor variant + live core (headings, emphasis, inline code, reveal rule)

**Files:**
- Create: `client/src/markdown/livePreview/{reveal,inline,theme,index,testUtil}.ts`, `reveal.test.ts`, `inline.test.ts`
- Modify: `client/src/components/Editor.tsx`, `client/src/components/FilePane.tsx`, `client/src/App.tsx` (`slotsShown`), `client/src/styles.css`

**Interfaces:**
- Produces:
  - `revealedLines(state: EditorState, composingLine?: number | null): Set<number>` — 1-based lines touched by any selection range (a range spanning lines adds every line in it).
  - `frontMatterRange(state: EditorState): { from: number; to: number } | null` — line 1 is exactly `---`, closed by a `---` or `...` line within the first 200 lines.
  - `buildInline(state: EditorState, reveal: Set<number>, ranges: readonly { from: number; to: number }[]): { decorations: DecorationSet; atomic: DecorationSet }` — `atomic` holds only the `replace` decorations.
  - `livePreview(): Extension`; `liveHooks: Facet<LiveHooks, LiveHooks>` with
    `interface LiveHooks { resolveImage(src: string): Promise<string>; openLink(href: string): void; coarsePointer(): boolean }` (defaults: reject / no-op / false).
  - `liveTheme: Extension`.
  - `Editor` props added: `variant?: 'source' | 'live'` (default `'source'`), `resolveImage?`, `onNavigate?`.

- [ ] **Step 1: Write failing tests** (`reveal.test.ts`, `inline.test.ts`)

```ts
// reveal
it('cursor reveals its line only', () =>
  assert.deepEqual([...revealedLines(stateOf('a\nb|\nc'))], [2]));
it('a selection reveals every line it spans', () =>
  assert.deepEqual([...revealedLines(stateOf('[a\nb\nc]'))].sort(), [1, 2, 3]));
it('revealedLines includes the composing line', () =>
  assert.ok(revealedLines(stateOf('|a\nb'), 2).has(2)));
it('front matter needs a closing fence', () => {
  assert.deepEqual(frontMatterRange(stateOf('---\nt: x\n---\n# H')), { from: 0, to: 12 });
  assert.equal(frontMatterRange(stateOf('---\nt: x\n# H')), null);
});
// inline — `all` = summarize(decorations), cursor on another line
it('heading hides "# " and styles the text', () =>
  assert.deepEqual(all('# Title\n|x'), ['hide 0-2', 'mark cm-lp-h1 2-7']));
it('heading on the cursor line stays raw', () =>
  assert.deepEqual(all('# Ti|tle'), []));
it('bold, italic, strike, code hide delimiters', () =>
  assert.deepEqual(all('**b** *i* ~~s~~ `c`\n|'), [
    'hide 0-2', 'mark cm-lp-strong 0-5', 'hide 3-5', 'hide 6-7', 'mark cm-lp-em 6-9', 'hide 8-9',
    'hide 10-12', 'mark cm-lp-strike 10-15', 'hide 13-15', 'hide 16-17', 'mark cm-lp-code 16-19', 'hide 18-19']));
it('unclosed **bold stays raw', () => assert.deepEqual(all('**bold\n|'), []));
it('setext heading keeps its underline, dimmed', () =>
  assert.deepEqual(all('Set\n===\n|'), ['mark cm-lp-h1 0-3', 'mark cm-lp-setext 4-7']));
it('atomic holds only the hidden ranges', () => …every entry of summarize(atomic) starts with "hide");
it('building never changes the document', () => …state.doc.toString() equal before/after);
```

(Order in `summarize` is by `from`, then `to`; adjust the literal arrays to the sort, not the code.)

- [ ] **Step 2: Run** `npm test --workspace client` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `reveal.ts`, `inline.ts` (headings + emphasis + strike + inline code + setext), `testUtil.ts`**

`buildInline` iterates `syntaxTree(state)` within each range; skips a node whose
line(s) are in `reveal`, and every node inside `frontMatterRange`. Heading
marks hide `HeaderMark` plus the following space. Uses `RangeSetBuilder` fed in
sorted order (collect, sort by from/startSide, then add).

- [ ] **Step 4: Run** unit tests — Expected: PASS.

- [ ] **Step 5: Implement `theme.ts`, `index.ts`, and the Editor variant**

- `liveTheme`: `&` font `var(--font-read)`, size `calc(17px * var(--zoom, 1))`;
  `.cm-content` max-width `72ch`, margin `0 auto`, padding `48px 32px 96px`,
  line-height `1.7`; heading classes copy `.read h1–h4` (font `var(--font-ui)`,
  1.9em / 1.5em with bottom border / 1.2em); `.cm-activeLine` transparent;
  `cm-lp-code` like `.read code`; `cm-lp-setext` color `var(--text-tertiary)`.
- `index.ts`: ViewPlugin recomputing on `docChanged || viewportChanged || selectionSet`
  or syntax-tree change, passing `view.composing ? lineOf(selection.main.head) : null`;
  `EditorView.decorations` + `EditorView.atomicRanges` from the plugin's two sets.
- `Editor.tsx`: `const variantSlot = new Compartment()` per instance (in a ref);
  base extensions get `markdown({ base: markdownLanguage })` and
  `liveHooks.of({...})` reading `resolveImageRef`/`onNavigateRef`; an effect on
  `variant` dispatches `variantSlot.reconfigure(variant === 'live' ? [livePreview(), liveTheme] : [])`.
  Wrapper class gets `editor-live` when live; `styles.css`: `.editor-live .cm-gutters { display: none; }`.
- `FilePane.tsx`: drop the `shown` fallback (`shown = mode`); `editorShown = editOn`
  (every view has the editor when Edit is on); `live = editOn && mode === 'read'`. Editor slot renders for
  `source | split | live`; ReadView only for `read && !live`; editor slot zoom slot
  = `live ? 'read' : split ? 'splitEditor' : 'source'` (pill label "Read" when live);
  pane-body's own Read pill/zoom-host only when `read && !live`. Pass
  `variant`, `resolveImage`, `onNavigate` to Editor. Update the header comment.
- `App.tsx` `slotsShown`: remove the `ed && m === 'read' ? 'split'` fallback.

- [ ] **Step 6: Browser check** (`live.cjs`, section 1) — PASS for:
  Read+Edit shows `.editor-live .cm-content` (no `.split-preview`); `# Alpha one`
  renders without `#` off the cursor line and shows `#` on it; type `X` at end of
  line 5 then Ctrl-S → file bytes equal expected (a1.md LF, crlf.md CRLF);
  Read→Source→Read while editing keeps the same `.cm-editor` node and Ctrl-Z
  undoes the typed `X`; zoom pill in live reads the Read level; zoom.cjs still
  passes after updating its "Read + Edit uses the Split editor level" check to
  expect the Read level.

- [ ] **Step 7: Commit** `feat(editor): live preview core in Read with Edit on`

---

### Task 2: Links, wiki links, autolinks, lists, tasks, quotes, rules, HTML

**Files:**
- Create: `livePreview/links.ts`, `links.test.ts`, `livePreview/widgets.ts`
- Modify: `livePreview/inline.ts`, `inline.test.ts`, `livePreview/index.ts`, `livePreview/theme.ts`, `markdown/remarkWikiLink.ts`

**Interfaces:**
- Consumes: Task 1's `buildInline`, `liveHooks`.
- Produces:
  - `parseWikiLink(inner: string): { url: string; label: string }` exported from `remarkWikiLink.ts` (plugin refactored to use it; behaviour unchanged).
  - `linkAt(state: EditorState, pos: number): string | null` — href of a `Link` (its `URL`), wiki link (`parseWikiLink(...).url`), or autolink/bare `URL` at `pos`; null otherwise.
  - `toggleTaskAt(state: EditorState, markerFrom: number): TransactionSpec | null` — `TaskMarker` at `markerFrom` (`[ ]`/`[x]`/`[X]`) → one-char change at `markerFrom + 1`.
  - Widgets: `BulletWidget`, `TaskWidget(checked: boolean)`, `RuleWidget`.

- [ ] **Step 1: Failing tests**

```ts
it('link shows only its text', () =>
  assert.deepEqual(all('[t](u.md)\n|'), ['hide 0-1', 'mark cm-lp-link cm-lp-link-internal 1-2', 'hide 2-9']));
it('wiki link shows the alias', () =>
  assert.deepEqual(all('[[Note|al]]\n|'), ['hide 0-7', 'mark cm-lp-link cm-lp-link-internal 7-9', 'hide 9-11']));
it('wiki link without alias shows the note name', …'[[Note]]' → hide 0-2, mark 2-6, hide 6-8);
it('bare URL is link-styled, nothing hidden', …);
it('bullet marker becomes a bullet widget', () => assert.deepEqual(all('- a\n|'), ['widget bullet 0-1']));
it('ordered numbers stay, dimmed', () => assert.deepEqual(all('1. a\n|'), ['mark cm-lp-ordered 0-2']));
it('task replaces marker and box with a checkbox', () =>
  assert.deepEqual(all('- [x] a\n|'), ['widget task 0-5']));
it('blockquote hides "> " and styles the line', …['hide 0-2', 'line cm-lp-quote L1']);
it('rule becomes a rule widget', …all('***\n|') → ['widget rule 0-3']);
it('raw HTML is dimmed, never hidden', …all('<b>x</b>\n|') → two 'mark cm-lp-html' entries);
// links.test.ts
it('linkAt finds url, wiki and bare links', …);
it('linkAt is null in plain text', …);
it('toggleTaskAt flips one character each way', () => {
  const s = stateOf('- [ ] a');
  const after = s.update(toggleTaskAt(s, 2)!).state.doc.toString();
  assert.equal(after, '- [x] a');
  // and back, and [X] → [ ]
});
it('parseWikiLink adds .md only when there is no extension', …);
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** in `inline.ts`, `links.ts`, `widgets.ts`, refactor `remarkWikiLink.ts`. Internal vs external uses the same rule as ReadView's `isExternalUrl` — move that function to `links.ts` and import it in `ReadView.tsx`.
- [ ] **Step 4: Run** — Expected: PASS (and existing tests still pass).
- [ ] **Step 5: Wire clicks in `index.ts`**: `EditorView.domEventHandlers.mousedown` —
  Ctrl/Cmd + `linkAt(state, posAtCoords)` → `preventDefault`, `hooks.openLink(href)`.
  `Editor` maps `openLink`: `#…` → ignore; external → `window.open(href, '_blank', 'noopener,noreferrer')`; else `onNavigate(href)`.
  `TaskWidget.toDOM(view)` mousedown → `preventDefault`, dispatch `toggleTaskAt(view.state, view.posAtDOM(dom))`.
  Theme: `cm-lp-link` color `var(--link)`, underline; internal dashed;
  `cm-lp-quote` like `.read blockquote`; rule widget `border-top: 1px solid var(--border)`.
- [ ] **Step 6: Browser check** (`live.cjs` §2): checkbox click toggles, file dirty, Ctrl-Z restores; Ctrl-click `[a2](a2.md)` opens a2.md; plain click reveals raw link; Ctrl-click external opens a popup page (`context.waitForEvent('page')`).
- [ ] **Step 7: Commit** `feat(editor): live preview links, lists, tasks, quotes and rules`

---

### Task 3: Images

**Files:**
- Create: `livePreview/blocks.ts`, `blocks.test.ts`
- Modify: `livePreview/widgets.ts`, `livePreview/index.ts`, `livePreview/inline.ts`

**Interfaces:**
- Produces: `buildBlocks(state: EditorState, reveal: Set<number>): DecorationSet` (StateField source; grows in Task 4); `ImageWidget(src: string, alt: string)`.

- [ ] **Step 1: Failing tests**: `'![a](p.png)\n|'` → `['hide 0-11', 'line cm-lp-hidden-line L1']` from inline and `['widget image 11-11']` (block, side 1) from blocks; on the cursor line the syntax is raw but the image widget **stays** (`['widget image 11-11']`); text + image on one line → image hidden-syntax but no `cm-lp-hidden-line`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `ImageWidget.toDOM(view)` reads `view.state.facet(liveHooks).resolveImage`; shows an `.img-loading` span, then `<img>`, or on reject a `.img-missing` chip with text `alt || src` (same classes as ReadView, no icon). `eq` compares `src`+`alt`. StateField in `index.ts` recomputes on `docChanged`, `selection`, or tree change; provides `EditorView.decorations`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Browser check** (§3): add `base/alpha/pic.png` (tiny PNG) and a broken `![x](nope.png)`; image visible in live; broken shows `.img-missing`.
- [ ] **Step 6: Commit** `feat(editor): live preview images`

---

### Task 4: Fenced code and tables

**Files:**
- Create: `livePreview/table.ts`, `table.test.ts`
- Modify: `livePreview/blocks.ts`, `blocks.test.ts`, `livePreview/widgets.ts`, `livePreview/theme.ts`, `components/Editor.tsx`, `client/package.json`

**Interfaces:**
- Produces:
  - `interface Cell { from: number; to: number; spans: Span[] }`, `interface Span { text: string; marks: ('strong' | 'em' | 'code' | 'strike' | 'link')[] }`
  - `parseTable(state: EditorState, tableFrom: number): { head: Cell[]; rows: Cell[][]; align: ('left' | 'center' | 'right' | null)[] } | null`
  - `inlineSpans(state: EditorState, from: number, to: number): Span[]`
  - `TableWidget(model, source: string)` (`eq` by `source`), `CodeHeadWidget(lang: string, code: string)`.

- [ ] **Step 1: Failing tests**
  - fenced code, cursor outside: opening fence line content replaced by `widget codehead`, closing fence hidden with `line cm-lp-codeblock-end`, every line `line cm-lp-codeblock`.
  - cursor anywhere inside the block (even on the middle line) → no decorations in the block.
  - `unclosed fence stays raw`: '```js\nlet a\n|' → none.
  - table, cursor outside → one `widget table` spanning `Table.from`–`Table.to` (block); cursor in any row → none.
  - `parseTable` reads `| a | **b** |\n|:-|-:|\n| 1 | `c` |` → head spans, `align ['left','right']`, cell `from/to` match the cell text offsets.
  - `unclosed table (header only)` → not a `Table` node → raw.
  - front matter → `line cm-lp-fm` on each of its lines, nothing hidden.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `table.ts`, then blocks. Block-whole reveal: a block is raw when any of its lines is in `reveal`. `TableWidget.toDOM(view)` builds `<table>` from spans (`<strong>/<em>/<code>/<s>/<span class=cm-lp-link>`); mousedown on a cell → `view.dispatch({ selection: { anchor: cell.from } })` then focus (widget data holds offsets; recompute from `view.posAtDOM(dom)` + relative offsets so stale offsets are never used). `CodeHeadWidget` = language badge + copy button (`navigator.clipboard.writeText(code)`), classes mirror `.read .code-block-head`.
- [ ] **Step 4: Add dependency**: `npm install @codemirror/language-data --workspace client`; Editor uses `markdown({ base: markdownLanguage, codeLanguages: languages })`.
- [ ] **Step 5: Run** unit tests + typecheck — PASS.
- [ ] **Step 6: Browser check** (§4): table renders as `<table>`, clicking a cell reveals raw table with cursor in that cell; leaving re-renders; code block shows a badge and highlighted tokens (`.cm-line span` with a `--syntax-*` color); copy writes code to clipboard; CRLF file with a table edited in live saves with CRLF intact.
- [ ] **Step 7: Commit** `feat(editor): live preview fenced code and tables`

---

### Task 5: Outline, annotations, phone link chip, docs

**Files:**
- Modify: `components/Outline.tsx`, `App.tsx`, `components/FilePane.tsx`, `livePreview/index.ts`, `livePreview/theme.ts`, `CLAUDE.md`

**Interfaces:**
- Consumes: `linkAt`, `liveHooks.coarsePointer`.
- Produces: Outline `Heading` gains `line: number` (1-based); `onJump(slug: string, line: number)`.

- [ ] **Step 1: Outline + jump.** `extractHeadings` records the line number. `jumpToHeading(slug, line)`: keeps `setMode('read')`; if the primary pane is editing and `canWrite`, `setReveal({ line, nonce + 1 })` instead of `scrollIntoView` by id.
- [ ] **Step 2: Annotations.** FilePane scroll host: `editorShown ? '.cm-scroller' : shown === 'read' ? view : '.source-wrap' ?? '.split-scroll'`; Read + Edit is annotatable and locks typing (existing `annotate-locked` path).
- [ ] **Step 3: Phone link chip.** In `index.ts` a StateField providing `showTooltip`: when `hooks.coarsePointer()` and the main cursor is inside `linkAt(...)`, a tooltip button "Open link" calling `openLink`. Editor passes `coarsePointer: () => matchMedia('(pointer: coarse)').matches`. Styled with `--surface`/`--border`/`--font-ui`.
- [ ] **Step 4: CLAUDE.md** File handling bullet: replace "live editing, currently the split until live preview lands" with "live preview (rendered, raw only on the cursor's lines)".
- [ ] **Step 5: Browser check** (§5): outline click scrolls live editor to the heading line; annotate on Read + Edit shows the locked pill and typing does nothing; Pixel 7: tap a link → `Open link` chip → opens the file; no sideways scroll; `insertText` on Android saves the expected bytes; read-only server (4397): no Edit button, Read is the react-markdown page; 5,000-line file median keystroke→paint < 16 ms; all older suites (zoom, edit, sidebar, android, fallback) still pass.
- [ ] **Step 6: Run** `npm test` and `npm run typecheck` at root — PASS.
- [ ] **Step 7: Commit** `feat(editor): live preview outline jump, annotations and touch links`
