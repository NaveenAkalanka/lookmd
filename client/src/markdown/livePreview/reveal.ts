/**
 * The live-preview reveal rule: which lines show their raw Markdown.
 *
 * A line is revealed when any selection range touches it. That also guards IME
 * composition (re-decorating a composing line would mangle input): composition
 * happens at the selection, so its line is always revealed.
 * Block constructs (fenced code, tables, front matter) widen this to the whole
 * block; that is decided where the block is built, from these lines.
 */

import { StateField, type EditorSelection, type EditorState, type Text } from '@codemirror/state';

function linesOf(doc: Text, selection: EditorSelection): Set<number> {
  const lines = new Set<number>();
  for (const r of selection.ranges) {
    const first = doc.lineAt(r.from).number;
    const last = doc.lineAt(r.to).number;
    for (let l = first; l <= last; l++) lines.add(l);
  }
  return lines;
}

/** 1-based numbers of the lines touched by any selection range. */
export function revealedLines(state: EditorState): Set<number> {
  return linesOf(state.doc, state.selection);
}

/** The editor's revealed lines (selection only; composition is added by the view). */
export const revealField = StateField.define<Set<number>>({
  create: (state) => linesOf(state.doc, state.selection),
  update(value, tr) {
    if (!tr.docChanged && !tr.selection) return value;
    const next = linesOf(tr.newDoc, tr.newSelection);
    // Same lines (cursor moved within them): keep the identical set, so the
    // block decorations that depend on it aren't rebuilt.
    if (next.size === value.size && [...next].every((l) => value.has(l))) return value;
    return next;
  },
});

/** True when any line from `from` to `to` is revealed. */
export function touchesReveal(state: EditorState, reveal: Set<number>, from: number, to: number): boolean {
  const last = state.doc.lineAt(to).number;
  for (let l = state.doc.lineAt(from).number; l <= last; l++) if (reveal.has(l)) return true;
  return false;
}

const FRONT_MATTER_MAX_LINES = 200;

/**
 * YAML front matter: the document's first line is exactly `---`, closed by a
 * `---` or `...` line within the first 200 lines. Lezer doesn't parse it (it
 * reads as a rule plus a setext heading), so we find it ourselves.
 */
export function frontMatterRange(state: EditorState): { from: number; to: number } | null {
  const doc = state.doc;
  if (doc.lines < 2 || doc.line(1).text !== '---') return null;
  const last = Math.min(doc.lines, FRONT_MATTER_MAX_LINES);
  for (let l = 2; l <= last; l++) {
    const line = doc.line(l);
    if (line.text === '---' || line.text === '...') return { from: 0, to: line.to };
  }
  return null;
}
