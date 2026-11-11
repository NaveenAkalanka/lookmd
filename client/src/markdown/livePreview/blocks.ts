/**
 * Block live-preview decorations: things that sit between lines or replace
 * whole lines (images now; fenced code, tables and front matter in Task 4).
 *
 * CodeMirror only accepts block widgets from state (not a view plugin), so
 * these are built for the whole document from the syntax tree; the walk only
 * descends into block containers, so it stays cheap. Pure (no DOM).
 */

import type { EditorState, Range } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { frontMatterRange } from './reveal.ts';
import { ImageWidget } from './widgets.ts';

/** Nodes that never hold an image (skipped entirely). */
const SKIP = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock', 'CommentBlock', 'InlineCode', 'HTMLTag', 'Comment']);

/** Source and alt text of an `Image` node. */
export function imageParts(state: EditorState, from: number, to: number, url: { from: number; to: number } | null, marks: { from: number; to: number }[]) {
  const open = marks[0];
  const close = marks[1];
  const alt = open && close ? state.sliceDoc(open.to, close.from) : '';
  return { src: url ? state.sliceDoc(url.from, url.to) : '', alt, from, to };
}

export function buildBlocks(
  state: EditorState,
  _reveal: Set<number>,
  heights: ReadonlyMap<string, number> = new Map(),
): DecorationSet {
  const out: Range<Decoration>[] = [];
  const fm = frontMatterRange(state);
  let side = 1;
  syntaxTree(state).iterate({
    enter: (ref) => {
      if (ref.name === 'Document') return;
      if (fm && ref.from < fm.to) return false;
      if (SKIP.has(ref.name)) return false;
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
