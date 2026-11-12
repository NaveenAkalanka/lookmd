/**
 * Link and task helpers for the live preview (pure; Node-testable).
 *
 * Wiki links (`[[Note|alias]]`) aren't a Lezer construct — they parse as a
 * nested ordinary Link — so they're found by pattern here and resolved with the
 * same `parseWikiLink` the Read view's remark plugin uses.
 */

import type { EditorState, TransactionSpec } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode, Tree } from '@lezer/common';
import { parseWikiLink } from '../remarkWikiLink.ts';

export { isExternalUrl } from '../urls.ts';

export interface WikiMatch {
  /** Offsets within the line text: the whole `[[...]]` … */
  from: number;
  to: number;
  /** … and the visible label (alias or target, trimmed). */
  labelFrom: number;
  labelTo: number;
  inner: string;
}

const WIKI = /\[\[([^\]]+)\]\]/g;

/** Every `[[...]]` on one line of text. */
export function wikiLinksIn(text: string): WikiMatch[] {
  const out: WikiMatch[] = [];
  WIKI.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI.exec(text)) !== null) {
    const inner = m[1] ?? '';
    const bar = inner.indexOf('|');
    let start = bar >= 0 ? bar + 1 : 0;
    let end = bar >= 0 && inner.indexOf('|', bar + 1) >= 0 ? inner.indexOf('|', bar + 1) : inner.length;
    while (start < end && /\s/.test(inner[start] ?? '')) start++;
    while (end > start && /\s/.test(inner[end - 1] ?? '')) end--;
    const base = m.index + 2;
    out.push({ from: m.index, to: m.index + m[0].length, labelFrom: base + start, labelTo: base + end, inner });
  }
  return out;
}

const CODE_LIKE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'HTMLBlock', 'HTMLTag', 'Comment', 'CommentBlock']);

/** True when `pos` sits inside code or raw HTML (where nothing is a link). */
export function inCodeOrHtml(tree: Tree, pos: number): boolean {
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent) {
    if (CODE_LIKE.has(n.name)) return true;
  }
  return false;
}

/** The href of the link at `pos` (Markdown link, wiki link, autolink, bare URL), or null. */
export function linkAt(state: EditorState, pos: number): string | null {
  const tree = syntaxTree(state);
  const line = state.doc.lineAt(pos);
  for (const w of wikiLinksIn(line.text)) {
    if (pos >= line.from + w.from && pos <= line.from + w.to && !inCodeOrHtml(tree, line.from + w.from)) {
      return parseWikiLink(w.inner).url;
    }
  }
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (n.name === 'Link' || n.name === 'Autolink') {
        const url = n.getChild('URL');
        if (url) return state.sliceDoc(url.from, url.to);
        break;
      }
      if (n.name === 'URL' && !['Link', 'Autolink', 'Image'].includes(n.parent?.name ?? '')) {
        return state.sliceDoc(n.from, n.to);
      }
      // An image inside a link (badge) belongs to that link: keep walking up.
      if (CODE_LIKE.has(n.name)) break;
    }
  }
  return null;
}

/**
 * The modifier that opens a link on click: Cmd on macOS (where Ctrl-click is a
 * right-click and opens the context menu), Ctrl (or Meta) elsewhere.
 */
export function isLinkClick(e: { ctrlKey: boolean; metaKey: boolean }, mac: boolean): boolean {
  return mac ? e.metaKey : e.ctrlKey || e.metaKey;
}

/** Flip the task box `[ ]` ↔ `[x]` starting at `markerFrom`: a one-character change. */
export function toggleTaskAt(state: EditorState, markerFrom: number): TransactionSpec | null {
  const box = state.sliceDoc(markerFrom, markerFrom + 3);
  if (!/^\[[ xX]\]$/.test(box)) return null;
  const checked = box[1] !== ' ';
  return {
    changes: { from: markerFrom + 1, to: markerFrom + 2, insert: checked ? ' ' : 'x' },
    userEvent: 'input.toggle',
  };
}
