/**
 * GFM tables for the live preview: a plain model of a `Table` node (cells with
 * their document offsets and inline formatting) that the table widget renders.
 * Pure — no DOM.
 */

import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';

export type SpanMark = 'strong' | 'em' | 'code' | 'strike' | 'link';
export interface Span {
  text: string;
  marks: SpanMark[];
}
export interface Cell {
  /** Offsets of the cell's (trimmed) text in the document. */
  from: number;
  to: number;
  spans: Span[];
}
export type Align = 'left' | 'center' | 'right' | null;
export interface TableModel {
  head: Cell[];
  rows: Cell[][];
  align: Align[];
}

const STYLED: Record<string, { mark: SpanMark; syntax: string }> = {
  StrongEmphasis: { mark: 'strong', syntax: 'EmphasisMark' },
  Emphasis: { mark: 'em', syntax: 'EmphasisMark' },
  Strikethrough: { mark: 'strike', syntax: 'StrikethroughMark' },
  InlineCode: { mark: 'code', syntax: 'CodeMark' },
};

/** The visible text of `from..to` as runs of equally formatted text. */
export function inlineSpans(state: EditorState, from: number, to: number): Span[] {
  if (to <= from) return [];
  const hidden: [number, number][] = [];
  const styles: { from: number; to: number; mark: SpanMark }[] = [];
  syntaxTree(state).iterate({
    from,
    to,
    enter: (ref) => {
      const styled = STYLED[ref.name];
      if (styled) {
        styles.push({ from: ref.from, to: ref.to, mark: styled.mark });
        for (const m of ref.node.getChildren(styled.syntax)) hidden.push([m.from, m.to]);
        return;
      }
      if (ref.name === 'Link' || ref.name === 'Image') {
        const marks = ref.node.getChildren('LinkMark');
        const open = marks[0];
        const close = marks[1];
        if (!open || !close) return;
        hidden.push([ref.from, open.to], [close.from, ref.to]);
        if (ref.name === 'Link') styles.push({ from: open.to, to: close.from, mark: 'link' });
        return;
      }
      return;
    },
  });

  const points = new Set<number>([from, to]);
  for (const [a, b] of hidden) points.add(Math.max(from, Math.min(to, a))).add(Math.max(from, Math.min(to, b)));
  for (const s of styles) points.add(Math.max(from, Math.min(to, s.from))).add(Math.max(from, Math.min(to, s.to)));
  const cuts = [...points].sort((a, b) => a - b);

  const out: Span[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i]!;
    const b = cuts[i + 1]!;
    if (hidden.some(([h1, h2]) => h1 <= a && b <= h2)) continue;
    const marks = styles.filter((s) => s.from <= a && b <= s.to).map((s) => s.mark);
    const text = state.sliceDoc(a, b);
    const last = out[out.length - 1];
    if (last && last.marks.length === marks.length && last.marks.every((m) => marks.includes(m))) last.text += text;
    else out.push({ text, marks });
  }
  return out;
}

function isBlank(s: string): boolean {
  return s.trim() === '';
}

/** A header/body row's cells, split at its pipes (empty cells kept). */
function cellsOf(state: EditorState, row: SyntaxNode): Cell[] {
  const pipes = row.getChildren('TableDelimiter');
  const segments: [number, number][] = [];
  let prev = row.from;
  for (const p of pipes) {
    segments.push([prev, p.from]);
    prev = p.to;
  }
  segments.push([prev, row.to]);
  const first = pipes[0];
  const last = pipes[pipes.length - 1];
  if (first && isBlank(state.sliceDoc(row.from, first.from))) segments.shift();
  if (last && isBlank(state.sliceDoc(last.to, row.to))) segments.pop();
  return segments.map(([a, b]) => {
    let from = a;
    let to = b;
    while (from < to && /\s/.test(state.sliceDoc(from, from + 1))) from++;
    while (to > from && /\s/.test(state.sliceDoc(to - 1, to))) to--;
    return { from, to, spans: inlineSpans(state, from, to) };
  });
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** The table whose first line starts at (or contains) `tableFrom`, or null. */
export function parseTable(state: EditorState, tableFrom: number): TableModel | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(tableFrom, 1);
  while (node && node.name !== 'Table') node = node.parent;
  if (!node) return null;
  let head: Cell[] = [];
  const rows: Cell[][] = [];
  let align: Align[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === 'TableHeader') head = cellsOf(state, child);
    else if (child.name === 'TableRow') rows.push(cellsOf(state, child));
    else if (child.name === 'TableDelimiter') {
      const text = state.sliceDoc(child.from, child.to).trim().replace(/^\|/, '').replace(/\|$/, '');
      align = text.split('|').map(alignOf);
    }
  }
  return { head, rows, align };
}
