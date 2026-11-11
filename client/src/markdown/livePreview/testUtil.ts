/**
 * Test helpers for the live-preview builders (Node only, no DOM).
 *
 * `stateOf` marks the cursor with `‸` and a selection with `«…»` — characters
 * Markdown never uses, so `|` (tables) and `[ ]` (links, tasks) stay literal.
 */

import { EditorSelection, EditorState } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';

export function stateOf(marked: string): EditorState {
  let doc = marked;
  let selection: EditorSelection | undefined;
  const open = doc.indexOf('«');
  if (open >= 0) {
    doc = doc.replace('«', '');
    const close = doc.indexOf('»');
    doc = doc.replace('»', '');
    selection = EditorSelection.single(open, close);
  } else {
    const at = doc.indexOf('‸');
    if (at >= 0) {
      doc = doc.replace('‸', '');
      selection = EditorSelection.single(at);
    }
  }
  const state = EditorState.create({
    doc,
    selection,
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
}

/**
 * One readable line per decoration, sorted by position:
 * `hide 0-2`, `mark cm-lp-h1 2-7`, `widget bullet 0-1`, `line cm-lp-quote L3`.
 */
export function summarize(set: DecorationSet, state: EditorState): string[] {
  const out: { from: number; to: number; text: string }[] = [];
  set.between(0, state.doc.length, (from, to, value) => {
    const spec = value.spec as { class?: string; widget?: { kind?: string } };
    let text: string;
    if (spec.widget) text = `widget ${spec.widget.kind ?? '?'} ${from}-${to}`;
    else if (from === to && spec.class) text = `line ${spec.class} L${state.doc.lineAt(from).number}`;
    else if (spec.class) text = `mark ${spec.class} ${from}-${to}`;
    else text = `hide ${from}-${to}`;
    out.push({ from, to, text });
  });
  out.sort((a, b) => a.from - b.from || a.to - b.to || a.text.localeCompare(b.text));
  return out.map((o) => o.text);
}
