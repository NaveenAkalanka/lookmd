/**
 * The live-preview CodeMirror extension: Markdown renders in place and shows
 * raw only on the lines the cursor touches (see reveal.ts).
 *
 * The decorations themselves come from pure builders (inline.ts); this file is
 * the glue: when to rebuild, mouse/link handling, and the host hooks (images,
 * links) the widgets and click handlers call into.
 */

import { EditorSelection, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, showTooltip, type DecorationSet, type Tooltip, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { buildInline } from './inline.ts';
import { revealField } from './reveal.ts';
import { isLinkClick, linkAt } from './links.ts';
import { blocksFor } from './blocks.ts';
import { imageHeights, liveHooks } from './hooks.ts';

export { liveHooks, type LiveHooks } from './hooks.ts';

/**
 * Bumped by any transaction that carries effects but no edit — notably the
 * parser's background progress — so block decorations below the first screen
 * appear once that part of the document is parsed.
 */
const parseTick = StateField.define<number>({
  create: () => 0,
  update: (n, tr) => (!tr.docChanged && tr.effects.length > 0 ? n + 1 : n),
});

/** Block decorations (images, …) must come from state, not a plugin. */
const blockDecorations = EditorView.decorations.compute(['doc', revealField, parseTick, imageHeights], (state) =>
  blocksFor(state, state.field(revealField), state.field(imageHeights)),
);

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

class InlinePlugin {
  decorations: DecorationSet = Decoration.none;

  constructor(view: EditorView) {
    this.build(view);
  }

  update(u: ViewUpdate) {
    if (
      u.docChanged ||
      u.viewportChanged ||
      u.startState.field(revealField) !== u.state.field(revealField) ||
      syntaxTree(u.startState) !== syntaxTree(u.state)
    ) {
      this.build(u.view);
    }
  }

  private build(view: EditorView) {
    this.decorations = buildInline(view.state, view.state.field(revealField), view.visibleRanges).decorations;
  }
}

const inlinePlugin = ViewPlugin.fromClass(InlinePlugin, {
  decorations: (p) => p.decorations,
});

/**
 * A click that doesn't move places a cursor where the button went down.
 *
 * Clicking a rendered line reveals its raw Markdown on mousedown, which shifts
 * the text under the pointer; CodeMirror's default style would then read the
 * mouseup as a drag from the old position to the shifted one (clicking a
 * heading's start selected its "# "). Shift-click is handled the same way;
 * drags still follow the pointer; multi-clicks and Ctrl/Cmd/Alt clicks keep the
 * default behaviour.
 */
const CLICK_SLOP = 4;
const stableClick = EditorView.mouseSelectionStyle.of((view, down) => {
  if (down.button !== 0 || down.detail > 1 || down.altKey || down.ctrlKey || down.metaKey) {
    return null;
  }
  // Positions are taken at mousedown, against the layout the user aimed at.
  // Shift-click extends from the current anchor to that position.
  const start = view.posAtCoords({ x: down.clientX, y: down.clientY }, false);
  let head = start;
  let anchor = down.shiftKey ? view.state.selection.main.anchor : start;
  return {
    update(u) {
      anchor = u.changes.mapPos(anchor);
      head = u.changes.mapPos(head);
    },
    get(cur) {
      const still = Math.abs(cur.clientX - down.clientX) <= CLICK_SLOP && Math.abs(cur.clientY - down.clientY) <= CLICK_SLOP;
      if (still) return EditorSelection.single(anchor, head);
      return EditorSelection.single(anchor, view.posAtCoords({ x: cur.clientX, y: cur.clientY }, false));
    },
  };
});

/**
 * Ctrl/Cmd-click opens a link; a plain click just places the cursor (which
 * reveals the raw link for editing).
 */
const linkClicks = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0 || !isLinkClick(e, IS_MAC)) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false;
    const href = linkAt(view.state, pos);
    if (!href) return false;
    e.preventDefault();
    view.state.facet(liveHooks).openLink(href);
    return true;
  },
});

/**
 * Touch has no Ctrl/Cmd-click: on coarse pointers, a cursor inside a link
 * shows a small "Open link" chip above it.
 */
const linkChip = showTooltip.compute(['selection', 'doc'], (state): Tooltip | null => {
  const hooks = state.facet(liveHooks);
  const sel = state.selection.main;
  if (!sel.empty || !hooks.coarsePointer()) return null;
  const href = linkAt(state, sel.head);
  if (!href) return null;
  return {
    pos: sel.head,
    above: true,
    create: () => {
      const dom = document.createElement('button');
      dom.type = 'button';
      dom.className = 'cm-lp-link-chip';
      dom.textContent = 'Open link';
      dom.title = href;
      // Keep the editor's focus (and the keyboard up) while tapping the chip.
      dom.addEventListener('mousedown', (e) => e.preventDefault());
      dom.addEventListener('click', () => hooks.openLink(href));
      return { dom };
    },
  };
});

/** The live-preview behaviour (pair it with `liveTheme`). */
export function livePreview(): Extension {
  return [revealField, parseTick, imageHeights, blockDecorations, stableClick, linkClicks, linkChip, inlinePlugin];
}

export { liveTheme } from './theme.ts';
