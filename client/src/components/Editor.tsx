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
import { undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import type { EditorApi } from '../editorApi';

interface Props {
  /** Current buffer contents (the draft). */
  value: string;
  /** Identity of the open file; changing it reloads the document. */
  docKey: string;
  onChange: (next: string) => void;
  /** Invoked on Ctrl/Cmd-S from inside the editor. */
  onSave: () => void;
  /** Show the line-number gutter (default true). */
  lineNumbers?: boolean;
  /** Report this editor's command API when it gains focus (for the Edit menu). */
  onFocusApi?: (api: EditorApi) => void;
  /** Called on unmount so the app can drop this editor if it was the focused one. */
  onReleaseApi?: (api: EditorApi) => void;
  /** Bump `nonce` to scroll/select a 1-based line (e.g. from Find-in-Files). */
  reveal?: { line: number; nonce: number };
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
  // Find/replace highlights.
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent-2) 26%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent-2) 48%, transparent)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  },
  // The find/replace panel — themed to match the rest of the chrome.
  '.cm-panels': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text-primary)',
  },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panel.cm-search': {
    padding: '7px 8px',
    fontFamily: 'var(--font-ui)',
    fontSize: '12px',
  },
  '.cm-panel.cm-search label': {
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--background)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: '5px',
    padding: '3px 6px',
    fontFamily: 'var(--font-ui)',
  },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--accent)' },
  '.cm-button': {
    backgroundColor: 'var(--surface)',
    backgroundImage: 'none',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
    borderRadius: '5px',
    padding: '3px 9px',
    fontFamily: 'var(--font-ui)',
    cursor: 'pointer',
  },
  '.cm-button:hover': { borderColor: 'var(--accent)' },
  '.cm-button:active': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  },
  '.cm-panel.cm-search [name="close"]': {
    color: 'var(--text-tertiary)',
    cursor: 'pointer',
    fontSize: '16px',
  },
  '.cm-panel.cm-search [name="close"]:hover': { color: 'var(--text-primary)' },
  // Autocomplete popup.
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--text-primary)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 20%, transparent)',
    color: 'var(--text-primary)',
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

export function Editor({
  value,
  docKey,
  onChange,
  onSave,
  lineNumbers = true,
  onFocusApi,
  onReleaseApi,
  reveal,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Keep the latest callbacks/value reachable from the long-lived extensions
  // without rebuilding the editor on every render.
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const valueRef = useRef(value);
  const onFocusApiRef = useRef(onFocusApi);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  valueRef.current = value;
  onFocusApiRef.current = onFocusApi;

  // A stable command API for the Edit menu, bound to this editor's view.
  const apiRef = useRef<EditorApi | null>(null);
  if (!apiRef.current) {
    const withView = (fn: (view: EditorView) => void) => () => {
      const view = viewRef.current;
      if (!view) return;
      fn(view);
    };
    apiRef.current = {
      undo: withView((view) => {
        undo(view);
        view.focus();
      }),
      redo: withView((view) => {
        redo(view);
        view.focus();
      }),
      copy: withView((view) => {
        const { from, to } = view.state.selection.main;
        const text = view.state.sliceDoc(from, to);
        if (text) void navigator.clipboard?.writeText(text);
        view.focus();
      }),
      cut: withView((view) => {
        const { from, to } = view.state.selection.main;
        const text = view.state.sliceDoc(from, to);
        if (text) {
          void navigator.clipboard?.writeText(text);
          view.dispatch({ changes: { from, to }, scrollIntoView: true });
        }
        view.focus();
      }),
      paste: withView((view) => {
        void navigator.clipboard?.readText().then((text) => {
          if (text) view.dispatch(view.state.replaceSelection(text));
          view.focus();
        });
      }),
      find: withView((view) => {
        openSearchPanel(view);
      }),
      replace: withView((view) => {
        openSearchPanel(view);
      }),
      focus: withView((view) => view.focus()),
    };
  }

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
            // Register as the active editor for the Edit menu on focus.
            if (update.focusChanged && update.view.hasFocus && apiRef.current) {
              onFocusApiRef.current?.(apiRef.current);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    // Register immediately so the menu works even before the first click.
    if (apiRef.current) onFocusApiRef.current?.(apiRef.current);

    return () => {
      if (apiRef.current) onReleaseApi?.(apiRef.current);
      view.destroy();
      viewRef.current = null;
    };
  }, [onReleaseApi]);

  // Scroll to and select a line on demand (Find-in-Files result navigation).
  const lastReveal = useRef(0);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal || reveal.nonce === lastReveal.current) return;
    lastReveal.current = reveal.nonce;
    const lineNo = Math.min(Math.max(1, reveal.line), view.state.doc.lines);
    const line = view.state.doc.line(lineNo);
    view.dispatch({
      selection: { anchor: line.from, head: line.to },
      scrollIntoView: true,
    });
    view.focus();
  }, [reveal]);

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

  // basicSetup always renders the gutter; hide it with a class when disabled,
  // so toggling never tears down the editor or resets the cursor.
  return <div className={`editor${lineNumbers ? '' : ' editor-no-gutter'}`} ref={hostRef} />;
}
