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
