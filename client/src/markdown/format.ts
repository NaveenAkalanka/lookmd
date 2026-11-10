/**
 * Markdown formatting commands for the editing toolbar and shortcuts.
 *
 * Each command reads a CodeMirror EditorState and returns the transaction that
 * applies it (or null when there is nothing to do). They only insert or remove
 * Markdown syntax around what the user selected — the rest of the document is
 * never touched, so saving stays byte-for-byte apart from the user's own edit.
 * CodeMirror keeps line breaks as `\n`; the Editor restores the file's own line
 * ending (CRLF or LF) when it reports the text, so commands use `\n` freely.
 *
 * Toggle semantics: pressing a command again on already-formatted text removes
 * the formatting (bold, italic, strike, code, headings, quote, lists).
 */

import { EditorSelection, type EditorState, type Line, type TransactionSpec } from '@codemirror/state';

export type FormatId =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'paragraph'
  | 'quote'
  | 'bullet'
  | 'numbered'
  | 'task'
  | 'link'
  | 'image'
  | 'table'
  | 'codeblock'
  | 'divider';

const USER_EVENT = 'input.format';

// --- Inline marks -------------------------------------------------------------

type Inline = { marker: string; present: (run: number) => boolean };

const INLINE: Record<'bold' | 'italic' | 'strike' | 'code', Inline> = {
  // `*` runs: 1 = italic, 2 = bold, 3 = both. Italic is present on odd runs.
  bold: { marker: '**', present: (n) => n >= 2 },
  italic: { marker: '*', present: (n) => n % 2 === 1 },
  strike: { marker: '~~', present: (n) => n >= 2 },
  code: { marker: '`', present: (n) => n >= 1 },
};

/** How many `ch` characters run from `pos` in direction `dir`, staying in [min, max). */
function runLength(state: EditorState, pos: number, dir: 1 | -1, ch: string, min: number, max: number): number {
  let n = 0;
  let p = dir === 1 ? pos : pos - 1;
  while (p >= min && p < max && state.doc.sliceString(p, p + 1) === ch) {
    n++;
    p += dir;
  }
  return n;
}

function toggleInline(state: EditorState, kind: Inline): TransactionSpec {
  const { marker } = kind;
  const m = marker.length;
  const ch = marker.charAt(0);
  const len = state.doc.length;
  return state.changeByRange((range) => {
    const { from, to } = range;
    // Markers just outside the selection (or around the cursor).
    const outside = Math.min(runLength(state, from, -1, ch, 0, len), runLength(state, to, 1, ch, 0, len));
    if (kind.present(outside)) {
      return {
        changes: [
          { from: from - m, to: from },
          { from: to, to: to + m },
        ],
        range: EditorSelection.range(from - m, to - m),
      };
    }
    // Markers just inside a selection like `**word**`.
    if (to - from > 2 * m) {
      const lead = runLength(state, from, 1, ch, from, to);
      const trail = runLength(state, to, -1, ch, from, to);
      if (lead < to - from && kind.present(Math.min(lead, trail))) {
        return {
          changes: [
            { from, to: from + m },
            { from: to - m, to },
          ],
          range: EditorSelection.range(from, to - 2 * m),
        };
      }
    }
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker },
      ],
      range: EditorSelection.range(from + m, to + m),
    };
  });
}

// --- Line formats -------------------------------------------------------------

/** The lines a selection covers. A multi-line selection that ends at the very
 *  start of a line does not include that line. */
function selectedLines(state: EditorState): Line[] {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  let last = state.doc.lineAt(to);
  if (to > from && last.from === to && last.number > first.number) last = state.doc.line(last.number - 1);
  const out: Line[] = [];
  for (let n = first.number; n <= last.number; n++) out.push(state.doc.line(n));
  return out;
}

interface LineEdit {
  /** Offset within the line where the replaced prefix starts. */
  start: number;
  /** Length of the prefix being replaced. */
  length: number;
  insert: string;
}

/** Apply one prefix edit per line and keep the selection on the same text. */
function editLines(state: EditorState, lines: Line[], edit: (line: Line, i: number) => LineEdit | null): TransactionSpec | null {
  const specs: { from: number; to: number; insert: string }[] = [];
  lines.forEach((line, i) => {
    const e = edit(line, i);
    if (!e) return;
    if (e.length === 0 && e.insert === '') return;
    specs.push({ from: line.from + e.start, to: line.from + e.start + e.length, insert: e.insert });
  });
  if (specs.length === 0) return null;
  const changes = state.changes(specs);
  const { anchor, head } = state.selection.main;
  return {
    changes,
    selection: EditorSelection.single(changes.mapPos(anchor, 1), changes.mapPos(head, 1)),
    scrollIntoView: true,
    userEvent: USER_EVENT,
  };
}

const HEADING_RE = /^(#{1,6})(?:[ \t]+|$)/;

function setHeading(state: EditorState, level: number): TransactionSpec | null {
  const lines = selectedLines(state);
  const levelOf = (l: Line) => HEADING_RE.exec(l.text)?.[1]?.length ?? 0;
  // Pressing the level a line already has turns it back into a paragraph.
  const target = level > 0 && lines.every((l) => levelOf(l) === level) ? 0 : level;
  return editLines(state, lines, (line) => {
    const match = HEADING_RE.exec(line.text);
    const insert = target === 0 ? '' : '#'.repeat(target) + ' ';
    return { start: 0, length: match ? match[0].length : 0, insert };
  });
}

const QUOTE_RE = /^(\s*)>[ \t]?/;

function toggleQuote(state: EditorState): TransactionSpec | null {
  const lines = selectedLines(state);
  const content = lines.filter((l) => l.text.trim() !== '');
  const allQuoted = content.length > 0 && content.every((l) => QUOTE_RE.test(l.text));
  return editLines(state, lines, (line) => {
    if (line.text.trim() === '' && lines.length > 1) return null;
    const indent = /^\s*/.exec(line.text)![0].length;
    if (allQuoted) {
      const match = QUOTE_RE.exec(line.text)!;
      return { start: match[1]!.length, length: match[0].length - match[1]!.length, insert: '' };
    }
    return { start: indent, length: 0, insert: '> ' };
  });
}

type ListKind = 'bullet' | 'numbered' | 'task';
const LIST_RE = /^(\s*)(?:([-*+])[ \t]+(\[[ xX]\][ \t]+)?|(\d+)[.)][ \t]+)/;

function listKindOf(text: string): ListKind | null {
  const m = LIST_RE.exec(text);
  if (!m) return null;
  if (m[4] !== undefined) return 'numbered';
  return m[3] !== undefined ? 'task' : 'bullet';
}

function toggleList(state: EditorState, kind: ListKind): TransactionSpec | null {
  const lines = selectedLines(state);
  const content = lines.filter((l) => l.text.trim() !== '');
  const allKind = content.length > 0 && content.every((l) => listKindOf(l.text) === kind);
  let n = 0;
  return editLines(state, lines, (line) => {
    if (line.text.trim() === '' && lines.length > 1) return null;
    const match = LIST_RE.exec(line.text);
    const indent = match ? match[1]!.length : /^\s*/.exec(line.text)![0].length;
    const oldLength = match ? match[0].length - indent : 0;
    if (allKind) return { start: indent, length: oldLength, insert: '' };
    n++;
    const insert = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${n}. `;
    return { start: indent, length: oldLength, insert };
  });
}

// --- Inserts ------------------------------------------------------------------

function wrapLinkLike(state: EditorState, image: boolean): TransactionSpec {
  const { from, to } = state.selection.main;
  const text = state.sliceDoc(from, to);
  const bang = image ? '!' : '';
  const label = text || (image ? 'alt' : 'text');
  const insert = `${bang}[${label}](url)`;
  // With a selection, the label is done: select the url to type over. Without
  // one, select the placeholder label first.
  const start = from + bang.length + 1;
  const selection = text
    ? EditorSelection.single(start + label.length + 2, start + label.length + 5)
    : EditorSelection.single(start, start + label.length);
  return { changes: { from, to, insert }, selection, scrollIntoView: true, userEvent: USER_EVENT };
}

/** Insert a block after the cursor's line, separated from text by a blank line.
 *  `select` is the range to select, relative to the start of `block`. */
function insertBlock(state: EditorState, block: string, select: [number, number]): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head);
  const empty = line.text.trim() === '';
  const at = empty ? line.from : line.to;
  const prefix = empty ? '' : '\n\n';
  const insert = prefix + block;
  const base = at + prefix.length;
  return {
    changes: { from: at, to: empty ? line.to : line.to, insert },
    selection: EditorSelection.single(base + select[0], base + select[1]),
    scrollIntoView: true,
    userEvent: USER_EVENT,
  };
}

function codeBlock(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  if (from === to) return insertBlock(state, '```\n\n```', [4, 4]);
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  return {
    changes: [
      { from: first.from, insert: '```\n' },
      { from: last.to, insert: '\n```' },
    ],
    selection: EditorSelection.single(from + 4, to + 4),
    scrollIntoView: true,
    userEvent: USER_EVENT,
  };
}

const TABLE = '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n';

export function formatCommand(id: FormatId, state: EditorState): TransactionSpec | null {
  switch (id) {
    case 'bold':
    case 'italic':
    case 'strike':
    case 'code':
      return { ...toggleInline(state, INLINE[id]), scrollIntoView: true, userEvent: USER_EVENT };
    case 'h1':
      return setHeading(state, 1);
    case 'h2':
      return setHeading(state, 2);
    case 'h3':
      return setHeading(state, 3);
    case 'paragraph':
      return setHeading(state, 0);
    case 'quote':
      return toggleQuote(state);
    case 'bullet':
    case 'numbered':
    case 'task':
      return toggleList(state, id);
    case 'link':
      return wrapLinkLike(state, false);
    case 'image':
      return wrapLinkLike(state, true);
    case 'table':
      return insertBlock(state, TABLE, [2, 10]);
    case 'codeblock':
      return codeBlock(state);
    case 'divider':
      return insertBlock(state, '---\n', [4, 4]);
  }
}
