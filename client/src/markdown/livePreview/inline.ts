/**
 * Inline live-preview decorations, built from the Lezer Markdown tree for the
 * given (visible) ranges. Pure: no DOM, so it runs under `node --test`.
 *
 * Hidden syntax is a `Decoration.replace` with no widget; styled text is a
 * `Decoration.mark` with a `cm-lp-*` class. Anything on a revealed line is left
 * raw. The returned `atomic` set holds only the hidden ranges, so the cursor
 * steps over them instead of landing inside invisible characters.
 */

import type { EditorState, Range } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { frontMatterRange, touchesReveal } from './reveal.ts';

export interface InlineDecorations {
  decorations: DecorationSet;
  atomic: DecorationSet;
}

const HIDE = Decoration.replace({});
const markCache = new Map<string, Decoration>();
function markOf(cls: string): Decoration {
  let d = markCache.get(cls);
  if (!d) {
    d = Decoration.mark({ class: cls });
    markCache.set(cls, d);
  }
  return d;
}

/** Inline spans whose delimiters hide and whose text gets a class. */
const SPANS: Record<string, { cls: string; mark: string }> = {
  StrongEmphasis: { cls: 'cm-lp-strong', mark: 'EmphasisMark' },
  Emphasis: { cls: 'cm-lp-em', mark: 'EmphasisMark' },
  Strikethrough: { cls: 'cm-lp-strike', mark: 'StrikethroughMark' },
  InlineCode: { cls: 'cm-lp-code', mark: 'CodeMark' },
};

const ATX = /^ATXHeading(\d)$/;
const SETEXT = /^SetextHeading(\d)$/;

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t';
}

export function buildInline(
  state: EditorState,
  reveal: Set<number>,
  ranges: readonly { from: number; to: number }[],
): InlineDecorations {
  const doc = state.doc;
  const fm = frontMatterRange(state);
  const tree = syntaxTree(state);
  const out: Range<Decoration>[] = [];
  const seen = new Set<string>();

  const hide = (from: number, to: number) => {
    if (to > from) out.push(HIDE.range(from, to));
  };
  const mark = (cls: string, from: number, to: number) => {
    if (to > from) out.push(markOf(cls).range(from, to));
  };
  const revealed = (from: number, to: number) => touchesReveal(state, reveal, from, to);

  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (ref) => {
        const name = ref.name;
        if (name === 'Document') return;
        if (fm && ref.from < fm.to) return false;
        const key = `${name}:${ref.from}:${ref.to}`;
        if (seen.has(key)) return false;
        seen.add(key);

        const atx = ATX.exec(name);
        if (atx) {
          const marks = ref.node.getChildren('HeaderMark');
          // Raw on the cursor line, but at heading size so the page doesn't jump.
          if (revealed(ref.from, ref.to)) {
            mark(`cm-lp-h${atx[1]}`, ref.from, ref.to);
            for (const m of marks) mark('cm-lp-syntax', m.from, m.to);
            return false;
          }
          const open = marks[0];
          if (!open) return;
          let start = open.to;
          while (start < ref.to && isSpace(doc.sliceString(start, start + 1))) start++;
          let end = ref.to;
          const close = marks.length > 1 ? marks[marks.length - 1] : undefined;
          if (close) {
            end = close.from;
            while (end > start && isSpace(doc.sliceString(end - 1, end))) end--;
          }
          if (end <= start) return false;
          hide(ref.from, start);
          mark(`cm-lp-h${atx[1]}`, start, end);
          if (close) hide(end, ref.to);
          return;
        }

        const setext = SETEXT.exec(name);
        if (setext) {
          if (revealed(ref.from, ref.to)) return false;
          const underline = ref.node.getChild('HeaderMark');
          if (!underline) return;
          const textEnd = doc.line(doc.lineAt(underline.from).number - 1).to;
          mark(`cm-lp-h${setext[1]}`, ref.from, textEnd);
          mark('cm-lp-setext', underline.from, underline.to);
          return;
        }

        const span = SPANS[name];
        if (span) {
          if (revealed(ref.from, ref.to)) return false;
          for (const m of ref.node.getChildren(span.mark)) hide(m.from, m.to);
          mark(span.cls, ref.from, ref.to);
          return;
        }
        return;
      },
    });
  }

  return {
    decorations: Decoration.set(out, true),
    atomic: Decoration.set(
      out.filter((r) => r.value === HIDE),
      true,
    ),
  };
}
