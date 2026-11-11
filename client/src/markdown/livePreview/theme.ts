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
  '.cm-lp-code': {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.88em',
    backgroundColor: 'var(--background)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '0.1em 0.35em',
  },
});
