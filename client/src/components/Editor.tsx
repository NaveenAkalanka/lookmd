/**
 * Edit mode: a thin CodeMirror 6 integration.
 *
 * The view is created once and kept across renders; we only push new content
 * when the *file identity* (`docKey`) changes, so typing never tears down the
 * editor. All colors/fonts come from CSS custom properties via `themeFromTokens`
 * — the editor obeys the active theme like every other component.
 *
 * Line endings are never normalized here: CodeMirror edits the exact string we
 * give it and `onChange` reports the exact string back, so CRLF survives.
 */

import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

interface Props {
  /** Current buffer contents (the draft). */
  value: string;
  /** Identity of the open file; changing it reloads the document. */
  docKey: string;
  onChange: (next: string) => void;
  /** Invoked on Ctrl/Cmd-S from inside the editor. */
  onSave: () => void;
}

/** A CodeMirror theme whose every value points at a lookmd CSS variable. */
const themeFromTokens = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    overflow: 'auto',
  },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-tertiary)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLine': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 7%, transparent)',
    color: 'var(--text-secondary)',
  },
});

/**
 * Syntax highlighting whose every color is a `--syntax-*` token, so the editor
 * recolors with the active theme like everything else. basicSetup registers the
 * library's defaultHighlightStyle only as a *fallback*, so this non-fallback
 * style replaces it wholesale. Tags cover both Markdown structure (headings,
 * emphasis, links, lists) and the code embedded in fenced blocks.
 */
const lookmdHighlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], color: 'var(--syntax-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syntax-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [t.number, t.integer, t.float], color: 'var(--syntax-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--syntax-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.name)], color: 'var(--syntax-type)' },
  { tag: [t.bool, t.null, t.atom, t.constant(t.variableName)], color: 'var(--syntax-constant)' },
  { tag: [t.variableName, t.self], color: 'var(--syntax-variable)' },
  { tag: [t.operator, t.operatorKeyword, t.derefOperator], color: 'var(--syntax-operator)' },
  { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.paren], color: 'var(--syntax-punctuation)' },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: 'var(--syntax-property)' },
  { tag: [t.tagName, t.angleBracket], color: 'var(--syntax-tag)' },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--syntax-heading)', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: 'var(--syntax-link)', textDecoration: 'underline' },
  { tag: t.strong, fontWeight: 'bold', color: 'var(--text-primary)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.list, t.quote], color: 'var(--syntax-punctuation)' },
  { tag: [t.monospace, t.literal], color: 'var(--syntax-string)' },
  { tag: t.invalid, color: 'var(--danger)' },
]);

export function Editor({ value, docKey, onChange, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Keep the latest callbacks/value reachable from the long-lived extensions
  // without rebuilding the editor on every render.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const valueRef = useRef(value);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  valueRef.current = value;

  // Build the editor once.
  useEffect(() => {
    if (!hostRef.current) return;

    const saveKeymap = Prec.highest(
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            onSaveRef.current();
            return true;
          },
        },
      ]),
    );

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          saveKeymap,
          basicSetup,
          markdown(),
          syntaxHighlighting(lookmdHighlightStyle),
          themeFromTokens,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  // Replace the document when a different file is opened. We compare identity
  // (docKey), not content, so a save that returns the same text won't reset the
  // cursor and external `value` updates for the *same* file are ignored here.
  const lastDocKey = useRef(docKey);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (lastDocKey.current === docKey) return;
    lastDocKey.current = docKey;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    });
  }, [docKey, value]);

  return <div className="editor" ref={hostRef} />;
}
