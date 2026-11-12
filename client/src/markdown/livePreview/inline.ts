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
import { inCodeOrHtml, wikiLinksIn } from './links.ts';
import { isExternalUrl } from '../urls.ts';
import { BulletWidget, RuleWidget, TaskWidget } from './widgets.ts';

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

const HTML_NODES = new Set(['HTMLTag', 'HTMLBlock', 'Comment', 'CommentBlock', 'ProcessingInstruction']);
const QUOTE_LINE = Decoration.line({ class: 'cm-lp-quote' });
const HIDDEN_LINE = Decoration.line({ class: 'cm-lp-hidden-line' });
const BULLET = Decoration.replace({ widget: new BulletWidget() });
const RULE = Decoration.replace({ widget: new RuleWidget() });

function linkClass(url: string): string {
  return isExternalUrl(url) || url.startsWith('#') ? 'cm-lp-link' : 'cm-lp-link cm-lp-link-internal';
}

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
  // Replacements (hidden syntax and widgets): the cursor steps over these.
  const atomic: Range<Decoration>[] = [];
  const seen = new Set<string>();

  // CodeMirror rejects view-plugin replacements that cross a line break; a
  // construct spanning lines (wrapped image alt, link url on the next line) is
  // left raw instead. This guard is the backstop for any such range.
  const oneLine = (from: number, to: number) => to <= doc.lineAt(from).to;
  const hide = (from: number, to: number) => {
    if (to > from && oneLine(from, to)) {
      const r = HIDE.range(from, to);
      out.push(r);
      atomic.push(r);
    }
  };
  const replace = (deco: Decoration, from: number, to: number) => {
    if (!oneLine(from, to)) return;
    const r = deco.range(from, to);
    out.push(r);
    atomic.push(r);
  };
  const mark = (cls: string, from: number, to: number) => {
    if (to > from) out.push(markOf(cls).range(from, to));
  };
  const revealed = (from: number, to: number) => touchesReveal(state, reveal, from, to);

  // Wiki links first: found by pattern per line (Lezer sees nested Links).
  const wikis: { from: number; to: number }[] = [];
  const wikiLines = new Set<number>();
  for (const range of ranges) {
    const last = doc.lineAt(range.to).number;
    for (let n = doc.lineAt(range.from).number; n <= last; n++) {
      if (wikiLines.has(n)) continue;
      wikiLines.add(n);
      const line = doc.line(n);
      if (fm && line.from < fm.to) continue;
      for (const w of wikiLinksIn(line.text)) {
        const from = line.from + w.from;
        if (inCodeOrHtml(tree, from)) continue;
        wikis.push({ from, to: line.from + w.to });
        if (reveal.has(n) || w.labelTo <= w.labelFrom) continue;
        hide(from, line.from + w.labelFrom);
        mark('cm-lp-link cm-lp-link-internal', line.from + w.labelFrom, line.from + w.labelTo);
        hide(line.from + w.labelTo, line.from + w.to);
      }
    }
  }
  const inWiki = (from: number, to: number) => wikis.some((w) => from < w.to && to > w.from);
  const quoteLines = new Set<number>();
  const imageLines = new Map<number, [number, number][]>();

  for (const range of ranges) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (ref) => {
        const name = ref.name;
        if (name === 'Document') return;
        if (fm && ref.from < fm.to) return false;
        // Whole-block constructs (blocks.ts): rendered by their widget, or raw
        // as a whole while revealed — never partly styled.
        if (name === 'Table' || name === 'FencedCode') return false;
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

        if (name === 'Link') {
          if (inWiki(ref.from, ref.to)) return false;
          const url = ref.node.getChild('URL');
          const marks = ref.node.getChildren('LinkMark');
          const open = marks[0];
          const close = marks[1];
          if (!url || !open || !close) return;
          if (revealed(ref.from, ref.to) || !oneLine(ref.from, ref.to)) return false;
          hide(ref.from, open.to);
          mark(linkClass(doc.sliceString(url.from, url.to)), open.to, close.from);
          hide(close.from, ref.to);
          return;
        }

        if (name === 'Autolink') {
          const url = ref.node.getChild('URL');
          if (!url || revealed(ref.from, ref.to)) return false;
          hide(ref.from, url.from);
          mark(linkClass(doc.sliceString(url.from, url.to)), url.from, url.to);
          hide(url.to, ref.to);
          return false;
        }

        if (name === 'URL') {
          // A bare URL (GFM autolink); URLs inside links/images are handled there.
          const parent = ref.node.parent?.name ?? '';
          if (parent === 'Link' || parent === 'Autolink' || parent === 'Image') return false;
          if (!revealed(ref.from, ref.to) && !inWiki(ref.from, ref.to)) mark('cm-lp-link', ref.from, ref.to);
          return false;
        }

        // Images: the picture is a block widget (blocks.ts); the syntax hides
        // off the cursor line, and an image-only line collapses.
        if (name === 'Image') {
          const line = doc.lineAt(ref.from);
          if (revealed(ref.from, ref.to) || !oneLine(ref.from, ref.to) || !ref.node.getChild('URL')) return false;
          hide(ref.from, ref.to);
          const list = imageLines.get(line.number) ?? [];
          list.push([ref.from - line.from, ref.to - line.from]);
          imageLines.set(line.number, list);
          return false;
        }

        if (name === 'ListMark') {
          if (revealed(ref.from, ref.to)) return false;
          const item = ref.node.parent;
          const list = item?.parent?.name;
          const marker = item?.getChild('Task')?.getChild('TaskMarker');
          if (marker) {
            const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
            replace(Decoration.replace({ widget: new TaskWidget(checked, marker.from - ref.from) }), ref.from, marker.to);
          } else if (list === 'BulletList') {
            replace(BULLET, ref.from, ref.to);
          } else if (list === 'OrderedList') {
            mark('cm-lp-ordered', ref.from, ref.to);
          }
          return false;
        }

        if (name === 'QuoteMark') {
          const line = doc.lineAt(ref.from);
          if (reveal.has(line.number)) return false;
          const after = doc.sliceString(ref.to, ref.to + 1);
          hide(ref.from, ref.to + (after === ' ' ? 1 : 0));
          if (!quoteLines.has(line.number)) {
            quoteLines.add(line.number);
            out.push(QUOTE_LINE.range(line.from));
          }
          return false;
        }

        if (name === 'HorizontalRule') {
          if (!revealed(ref.from, ref.to)) replace(RULE, ref.from, ref.to);
          return false;
        }

        // Raw HTML is never rendered: dimmed mono, on any line.
        if (HTML_NODES.has(name)) {
          mark('cm-lp-html', ref.from, ref.to);
          return false;
        }
        return;
      },
    });
  }

  for (const [n, spans] of imageLines) {
    const line = doc.line(n);
    let rest = line.text;
    for (const [a, b] of [...spans].sort((x, y) => y[0] - x[0])) rest = rest.slice(0, a) + rest.slice(b);
    if (!rest.trim()) out.push(HIDDEN_LINE.range(line.from));
  }

  return {
    decorations: Decoration.set(out, true),
    atomic: Decoration.set(atomic, true),
  };
}
