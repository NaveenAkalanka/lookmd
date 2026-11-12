/**
 * Block live-preview decorations: things that sit between lines or replace
 * whole lines — images, fenced code, tables and front matter.
 *
 * Fenced code and tables are revealed as a whole: with the cursor on any of
 * their lines they show raw, so the cursor never lands in half-rendered syntax.
 *
 * CodeMirror only accepts block widgets from state (not a view plugin), so
 * these are built for the whole document from the syntax tree; the walk only
 * descends into block containers, so it stays cheap. Pure (no DOM).
 */

import type { EditorState, Range } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { frontMatterRange, touchesReveal } from './reveal.ts';
import { CodeHeadWidget, ImageWidget, TableWidget } from './widgets.ts';
import { parseTable } from './table.ts';

/** Inline-only containers: worth entering only if they can hold an image. */
const INLINE_CONTAINERS = /^(Paragraph|ATXHeading\d|SetextHeading\d)$/;

/** Nodes that never hold an image (skipped entirely). */
const SKIP = new Set(['CodeBlock', 'HTMLBlock', 'CommentBlock', 'InlineCode', 'HTMLTag', 'Comment']);

const FM_LINE = Decoration.line({ class: 'cm-lp-fm' });
const CODE_START = Decoration.line({ class: 'cm-lp-codeblock cm-lp-codeblock-start' });
const CODE_LINE = Decoration.line({ class: 'cm-lp-codeblock' });
const CODE_END = Decoration.line({ class: 'cm-lp-codeblock cm-lp-codeblock-end' });
const HIDE = Decoration.replace({});

/** Source and alt text of an `Image` node. */
export function imageParts(state: EditorState, from: number, to: number, url: { from: number; to: number } | null, marks: { from: number; to: number }[]) {
  const open = marks[0];
  const close = marks[1];
  const alt = open && close ? state.sliceDoc(open.to, close.from) : '';
  return { src: url ? state.sliceDoc(url.from, url.to) : '', alt, from, to };
}

let last: {
  doc: unknown;
  tree: unknown;
  reveal: Set<number>;
  heights: ReadonlyMap<string, number>;
  result: DecorationSet;
} | null = null;

/**
 * `buildBlocks`, but returning the previous set when the document, syntax tree,
 * revealed lines and image heights are all the same objects as last time —
 * e.g. for transactions that only carry unrelated effects (search panel,
 * parser bookkeeping). The cache holds one entry; another editor's state
 * simply misses it.
 */
export function blocksFor(
  state: EditorState,
  reveal: Set<number>,
  heights: ReadonlyMap<string, number>,
): DecorationSet {
  const tree = syntaxTree(state);
  if (last && last.doc === state.doc && last.tree === tree && last.reveal === reveal && last.heights === heights) {
    return last.result;
  }
  const result = buildBlocks(state, reveal, heights);
  last = { doc: state.doc, tree, reveal, heights, result };
  return result;
}

export function buildBlocks(
  state: EditorState,
  reveal: Set<number>,
  heights: ReadonlyMap<string, number> = new Map(),
): DecorationSet {
  const out: Range<Decoration>[] = [];
  const doc = state.doc;
  const fm = frontMatterRange(state);
  if (fm) {
    const last = doc.lineAt(fm.to).number;
    for (let n = 1; n <= last; n++) out.push(FM_LINE.range(doc.line(n).from));
  }
  let side = 1;
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'Document') return;
      if (fm && ref.from < fm.to) return false;
      if (SKIP.has(ref.name)) return false;
      if (INLINE_CONTAINERS.test(ref.name) && !doc.sliceString(ref.from, ref.to).includes('![')) return false;

      if (ref.name === 'FencedCode') {
        const fences = ref.node.getChildren('CodeMark');
        const first = doc.lineAt(ref.from);
        const last = doc.lineAt(ref.to);
        // Unclosed (still being typed) or revealed: raw, as a whole.
        if (fences.length < 2 || last.number === first.number || touchesReveal(state, reveal, ref.from, ref.to)) return false;
        const info = ref.node.getChild('CodeInfo');
        const text = ref.node.getChild('CodeText');
        const lang = info ? doc.sliceString(info.from, info.to) : '';
        const code = text ? doc.sliceString(text.from, text.to) : '';
        out.push(CODE_START.range(first.from));
        out.push(Decoration.replace({ widget: new CodeHeadWidget(lang, code) }).range(first.from, first.to));
        for (let n = first.number + 1; n < last.number; n++) out.push(CODE_LINE.range(doc.line(n).from));
        out.push(CODE_END.range(last.from));
        if (last.to > last.from) out.push(HIDE.range(last.from, last.to));
        return false;
      }

      if (ref.name === 'Table') {
        if (touchesReveal(state, reveal, ref.from, ref.to)) return false;
        const from = doc.lineAt(ref.from).from;
        const to = doc.lineAt(ref.to).to;
        const model = parseTable(state, ref.from);
        if (!model) return false;
        const widget = new TableWidget(model, doc.sliceString(from, to), from);
        out.push(Decoration.replace({ widget, block: true }).range(from, to));
        return false;
      }

      if (ref.name === 'Image') {
        const parts = imageParts(state, ref.from, ref.to, ref.node.getChild('URL'), ref.node.getChildren('LinkMark'));
        if (parts.src) {
          const lineEnd = state.doc.lineAt(ref.to).to;
          out.push(Decoration.widget({ widget: new ImageWidget(parts.src, parts.alt, heights.get(parts.src) ?? null), block: true, side: side++ }).range(lineEnd));
        }
        return false;
      }
      return;
    },
  });
  return Decoration.set(out, true);
}
