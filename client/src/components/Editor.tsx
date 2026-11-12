/**
 * The Markdown editor (any view with Edit on): a thin CodeMirror 6 integration.
 *
 * Two looks on one EditorView: `variant="source"` is the raw editor (Source and
 * Split's editing side); `variant="live"` is the live preview inside Read, which
 * renders Markdown everywhere except the lines the cursor touches. The variant
 * lives in a Compartment, so switching Read ⇄ Source keeps the cursor, scroll
 * position and undo history.
 *
 * The view is created once and kept across renders; we only push new content
 * when the *file identity* (`docKey`) changes, so typing never tears down the
 * editor. All colors/fonts come from CSS custom properties via `themeFromTokens`
 * — the editor obeys the active theme like every other component.
 *
 * Line endings: CodeMirror stores every line break as `\n` internally, so
 * `doc.toString()` alone would silently turn a CRLF file into LF. We detect the
 * file's line ending when a document is loaded and restore it on every change
 * (`toFileText`), so CRLF and LF files round-trip byte-for-byte. A file that
 * mixes both is written back in its majority ending once it is edited.
 */

import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { Annotation, Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { undo, redo } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';
import type { EditorApi } from '../editorApi';
import { detectEol, toFileText, type Eol } from '../markdown/eol';
import { formatCommand, type FormatId } from '../markdown/format';
import { livePreview, liveHooks, liveTheme } from '../markdown/livePreview/index.ts';
import { isExternalUrl, isOpenableExternalUrl } from '../markdown/urls';

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
  /** This editor's command API on mount, null on unmount (for its pane's toolbar). */
  onApi?: (api: EditorApi | null) => void;
  /** 'source' = raw editor (default); 'live' = live preview inside Read. */
  variant?: 'source' | 'live';
  /** Resolve an image src through the file source (live preview images). */
  resolveImage?: (src: string) => Promise<string>;
  /** Open an internal link (live preview Ctrl/Cmd-click). */
  onNavigate?: (href: string) => void;
}

/** A CodeMirror theme whose every value points at a lookmd CSS variable. */
const themeFromTokens = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'calc(14px * var(--zoom, 1))',
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
const codeHighlights = [
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword, t.definitionKeyword, t.operatorKeyword], color: 'var(--syntax-keyword)' },
  { tag: [t.string, t.docString], color: 'var(--syntax-string)' },
  { tag: [t.regexp], color: 'var(--syntax-regex)' },
  { tag: [t.escape, t.special(t.string), t.character], color: 'var(--syntax-escape)', fontWeight: '600' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: [t.meta, t.annotation, t.processingInstruction, t.macroName, t.documentMeta], color: 'var(--syntax-decorator)' },
  { tag: [t.number, t.integer, t.float, t.unit], color: 'var(--syntax-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--syntax-function)' },
  { tag: [t.standard(t.name), t.standard(t.variableName), t.special(t.variableName)], color: 'var(--syntax-builtin)' },
  { tag: [t.typeName, t.className], color: 'var(--syntax-type)' },
  { tag: [t.namespace], color: 'var(--syntax-namespace)' },
  { tag: [t.bool, t.null, t.atom, t.constant(t.variableName)], color: 'var(--syntax-constant)' },
  { tag: [t.local(t.variableName), t.special(t.propertyName)], color: 'var(--syntax-parameter)' },
  { tag: [t.variableName, t.self], color: 'var(--syntax-variable)' },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.bitwiseOperator, t.compareOperator], color: 'var(--syntax-operator)' },
  { tag: [t.punctuation, t.separator, t.bracket, t.brace, t.paren, t.squareBracket], color: 'var(--syntax-punctuation)' },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: 'var(--syntax-property)' },
  { tag: [t.tagName, t.angleBracket, t.attributeValue], color: 'var(--syntax-tag)' },
  { tag: t.invalid, color: 'var(--danger)' },
];
const markdownHighlights = [
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--syntax-heading)', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: 'var(--syntax-link)', textDecoration: 'underline' },
  { tag: t.strong, fontWeight: 'bold', color: 'var(--text-primary)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.list, t.quote], color: 'var(--syntax-punctuation)' },
  { tag: [t.monospace, t.literal], color: 'var(--syntax-string)' },
];
const lookmdHighlightStyle = HighlightStyle.define([...codeHighlights, ...markdownHighlights]);
const liveHighlightStyle = HighlightStyle.define(codeHighlights);

/** The extensions that differ between the two looks. */
function variantExtensions(variant: 'source' | 'live'): Extension {
  return variant === 'live'
    ? [syntaxHighlighting(liveHighlightStyle), livePreview(), liveTheme]
    : syntaxHighlighting(lookmdHighlightStyle);
}

/** Marks the programmatic document swap on file switch, which is a load, not
 *  an edit — it must not be reported as a draft change. */
const documentLoad = Annotation.define<boolean>();

export function Editor({
  value,
  docKey,
  onChange,
  onSave,
  lineNumbers = true,
  onFocusApi,
  onReleaseApi,
  reveal,
  onApi,
  variant = 'source',
  resolveImage,
  onNavigate,
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
  const onApiRef = useRef(onApi);
  onApiRef.current = onApi;
  const resolveImageRef = useRef(resolveImage);
  resolveImageRef.current = resolveImage;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const variantRef = useRef(variant);
  // One compartment per editor instance holds the variant's extensions.
  const variantSlot = useRef<Compartment | null>(null);
  if (!variantSlot.current) variantSlot.current = new Compartment();
  // Line ending of the loaded file; reset whenever a new document is loaded.
  const eolRef = useRef<Eol>(detectEol(value));

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
      format: (id: FormatId) => {
        const view = viewRef.current;
        if (!view) return;
        const spec = formatCommand(id, view.state);
        if (spec) view.dispatch(spec);
        view.focus();
      },
    };
  }

  // Build the editor once.
  useEffect(() => {
    if (!hostRef.current) return;

    // Highest precedence so these win over basicSetup (whose Mod-i selects the
    // parent syntax node). Handled keys are preventDefault-ed, which the app's
    // window-level shortcuts (Ctrl/Cmd-B = sidebar) check and then skip.
    const formatKey = (key: string, id: FormatId) => ({
      key,
      preventDefault: true,
      run: () => {
        apiRef.current?.format(id);
        return true;
      },
    });
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
        formatKey('Mod-b', 'bold'),
        formatKey('Mod-i', 'italic'),
        formatKey('Mod-k', 'link'),
      ]),
    );

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          saveKeymap,
          basicSetup,
          // GFM, plus syntax highlighting inside fenced code (languages load lazily).
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          themeFromTokens,
          variantSlot.current!.of(variantExtensions(variantRef.current)),
          liveHooks.of({
            resolveImage: (src) =>
              resolveImageRef.current ? resolveImageRef.current(src) : Promise.reject(new Error('No image source')),
            openLink: (href) => {
              if (href.startsWith('#')) return;
              if (isExternalUrl(href)) {
                // Never javascript:/data: — the document text is untrusted.
                if (isOpenableExternalUrl(href)) window.open(href, '_blank', 'noopener,noreferrer');
              } else {
                onNavigateRef.current?.(href);
              }
            },
            coarsePointer: () => window.matchMedia?.('(pointer: coarse)').matches ?? false,
          }),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            const isLoad = update.transactions.some((tr) => tr.annotation(documentLoad));
            if (update.docChanged && !isLoad) {
              onChangeRef.current(toFileText(update.state.doc.toString(), eolRef.current));
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
    onApiRef.current?.(apiRef.current);

    return () => {
      onApiRef.current?.(null);
      if (apiRef.current) onReleaseApi?.(apiRef.current);
      view.destroy();
      viewRef.current = null;
    };
  }, [onReleaseApi]);

  // Switch the look in place (same view: cursor, scroll and undo survive).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || variantRef.current === variant) return;
    variantRef.current = variant;
    view.dispatch({ effects: variantSlot.current!.reconfigure(variantExtensions(variant)) });
  }, [variant]);

  // Replace the document when a different file is opened. We compare identity
  // (docKey), not content, so a save that returns the same text won't reset the
  // cursor and external `value` updates for the *same* file are ignored here.
  const lastDocKey = useRef(docKey);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (lastDocKey.current === docKey) return;
    lastDocKey.current = docKey;
    eolRef.current = detectEol(value);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      annotations: documentLoad.of(true),
    });
  }, [docKey, value]);

  // Scroll to and select a line on demand (Find-in-Files result navigation).
  // Declared after the document swap above so that, when a result opens a
  // different file, the new document is loaded before its line is selected.
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

  // basicSetup always renders the gutter; hide it with a class when disabled,
  // so toggling never tears down the editor or resets the cursor.
  const cls = `editor${lineNumbers ? '' : ' editor-no-gutter'}${variant === 'live' ? ' editor-live' : ''}`;
  return <div className={cls} ref={hostRef} />;
}
