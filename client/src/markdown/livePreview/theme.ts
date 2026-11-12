/**
 * The live preview's reading look: the Read view's typography (font, measure,
 * heading scale) applied to the editor. Tokens only — every color and font is a
 * CSS custom property, like `.read` in styles.css.
 *
 * Selectors use `&.cm-editor` so they win over the base editor theme, which
 * sets the mono font and the 14px size.
 */

import { EditorView } from '@codemirror/view';

export const liveTheme = EditorView.theme({
  '&.cm-editor': {
    fontFamily: 'var(--font-read)',
    fontSize: 'calc(17px * var(--zoom, 1))',
  },
  '&.cm-editor .cm-scroller': {
    fontFamily: 'var(--font-read)',
    lineHeight: '1.7',
  },
  '&.cm-editor .cm-content': {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: '72ch',
    margin: '0 auto',
    padding: '48px 32px 96px',
    flexGrow: '0',
  },
  '&.cm-editor .cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-lp-h1, .cm-lp-h2, .cm-lp-h3, .cm-lp-h4, .cm-lp-h5, .cm-lp-h6': {
    fontFamily: 'var(--font-ui)',
    fontWeight: '700',
    lineHeight: '1.25',
    color: 'var(--text-primary)',
  },
  '.cm-lp-h1': { fontSize: '1.9em' },
  '.cm-lp-h2': { fontSize: '1.5em' },
  '.cm-lp-h3': { fontSize: '1.2em' },
  '.cm-lp-setext, .cm-lp-syntax': { color: 'var(--text-tertiary)' },
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-strike': { textDecoration: 'line-through' },
  '.cm-lp-link': {
    color: 'var(--link)',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },
  '.cm-lp-link-internal': { textDecorationStyle: 'dashed' },
  '.cm-lp-ordered': { color: 'var(--text-secondary)' },
  '.cm-lp-bullet': {
    display: 'inline-block',
    minWidth: '0.8em',
    color: 'var(--text-secondary)',
  },
  '.cm-lp-task': {
    margin: '0 0.35em 0 0',
    verticalAlign: 'middle',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  '.cm-line.cm-lp-quote': {
    borderLeft: '3px solid var(--accent)',
    paddingLeft: '1em',
    color: 'var(--text-secondary)',
  },
  '.cm-lp-rule': {
    display: 'inline-block',
    width: '100%',
    verticalAlign: 'middle',
    borderTop: '1px solid var(--border)',
  },
  '.cm-lp-html': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
    color: 'var(--text-tertiary)',
  },
  // An image-only line keeps its height (so arrow keys can reach it to edit
  // the syntax); off the cursor it's empty, with the picture below it.
  '.cm-lp-image': { padding: '0.4em 0' },
  '.cm-lp-image img': {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
  },
  '.cm-lp-code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '0.1em 0.35em',
  },

  // Fenced code: one panel across its lines, like Read's code block. The
  // opening fence line holds the header widget; the closing fence is hidden.
  '.cm-line.cm-lp-codeblock': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
    lineHeight: '1.55',
    backgroundColor: 'var(--background)',
    borderLeft: '1px solid var(--border)',
    borderRight: '1px solid var(--border)',
    padding: '0 16px',
  },
  '.cm-line.cm-lp-codeblock-start': {
    borderTop: '1px solid var(--border)',
    borderTopLeftRadius: '8px',
    borderTopRightRadius: '8px',
    padding: '0',
    backgroundColor: 'color-mix(in srgb, var(--surface) 60%, var(--background))',
    borderBottom: '1px solid var(--border)',
  },
  '.cm-line.cm-lp-codeblock-end': {
    borderBottom: '1px solid var(--border)',
    borderBottomLeftRadius: '8px',
    borderBottomRightRadius: '8px',
  },
  // inline-flex (not flex): a block box here pushes CodeMirror's cursor
  // helpers onto their own rows and makes the header three lines tall.
  '.cm-lp-codehead': {
    display: 'inline-flex',
    width: '100%',
    boxSizing: 'border-box',
    verticalAlign: 'middle',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px 4px 12px',
  },
  '.cm-lp-code-lang': {
    fontFamily: 'var(--font-ui)',
    fontSize: '11px',
    fontWeight: '600',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--text-tertiary)',
  },
  '.cm-lp-code-copy': {
    fontFamily: 'var(--font-ui)',
    fontSize: '11px',
    color: 'var(--text-secondary)',
    backgroundColor: 'transparent',
    border: '1px solid transparent',
    borderRadius: '5px',
    padding: '2px 7px',
    cursor: 'pointer',
  },
  '.cm-lp-code-copy:hover': {
    color: 'var(--text-primary)',
    borderColor: 'var(--border)',
  },

  // Tables: the Read view's grid.
  '.cm-lp-table-wrap': {
    overflowX: 'auto',
    padding: '0.3em 0',
  },
  '.cm-lp-table': {
    borderCollapse: 'collapse',
    cursor: 'text',
  },
  '.cm-lp-table th, .cm-lp-table td': {
    border: '1px solid var(--border)',
    padding: '6px 10px',
    verticalAlign: 'top',
  },
  '.cm-lp-table th': { fontWeight: '600' },
  '.cm-lp-table code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '0.1em 0.35em',
  },

  // Touch: the "Open link" chip above a cursor inside a link.
  '.cm-tooltip:has(> .cm-lp-link-chip)': {
    border: 'none',
    backgroundColor: 'transparent',
  },
  '.cm-lp-link-chip': {
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
    color: 'var(--text-primary)',
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '999px',
    padding: '6px 14px',
    minHeight: '34px',
    cursor: 'pointer',
  },

  // Front matter: raw, dimmed mono.
  '.cm-line.cm-lp-fm': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85em',
    color: 'var(--text-tertiary)',
  },
});
