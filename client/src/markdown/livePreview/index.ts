/**
 * The live-preview CodeMirror extension: Markdown renders in place and shows
 * raw only on the lines the cursor touches (see reveal.ts).
 *
 * The decorations themselves come from pure builders (inline.ts); this file is
 * the glue: when to rebuild, the atomic ranges, and the host hooks (images,
 * links) the widgets and click handlers call into.
 */

import { EditorSelection, Facet, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { buildInline } from './inline.ts';
import { revealField } from './reveal.ts';

/** What the live preview needs from its host (the Editor component). */
export interface LiveHooks {
  /** Resolve an image `src` through the active file source. */
  resolveImage(src: string): Promise<string>;
  /** Open a link the user Ctrl/Cmd-clicked (or tapped "Open link" on). */
  openLink(href: string): void;
  /** True on touch-first devices (no Ctrl/Cmd-click). */
  coarsePointer(): boolean;
}

const DEFAULT_HOOKS: LiveHooks = {
  resolveImage: () => Promise.reject(new Error('No image source')),
  openLink: () => {},
  coarsePointer: () => false,
};

export const liveHooks = Facet.define<LiveHooks, LiveHooks>({
  combine: (values) => values[0] ?? DEFAULT_HOOKS,
});

/** The revealed lines, plus the line an IME composition is active on. */
function currentReveal(view: EditorView): Set<number> {
  const lines = view.state.field(revealField);
  if (!view.composing) return lines;
  const withComposing = new Set(lines);
  withComposing.add(view.state.doc.lineAt(view.state.selection.main.head).number);
  return withComposing;
}

class InlinePlugin {
  decorations: DecorationSet = Decoration.none;
  atomic: DecorationSet = Decoration.none;
  private composing = false;

  constructor(view: EditorView) {
    this.build(view);
  }

  update(u: ViewUpdate) {
    if (
      u.docChanged ||
      u.viewportChanged ||
      u.startState.field(revealField) !== u.state.field(revealField) ||
      u.view.composing !== this.composing ||
      syntaxTree(u.startState) !== syntaxTree(u.state)
    ) {
      this.build(u.view);
    }
  }

  private build(view: EditorView) {
    this.composing = view.composing;
    const reveal = currentReveal(view);
    const built = buildInline(view.state, reveal, view.visibleRanges);
    this.decorations = built.decorations;
    this.atomic = built.atomic;
  }
}

const inlinePlugin = ViewPlugin.fromClass(InlinePlugin, {
  decorations: (p) => p.decorations,
  provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
});

/**
 * A click that doesn't move places a cursor where the button went down.
 *
 * Clicking a rendered line reveals its raw Markdown on mousedown, which shifts
 * the text under the pointer; CodeMirror's default style would then read the
 * mouseup as a drag from the old position to the shifted one (clicking a
 * heading's start selected its "# "). Drags, multi-clicks and modifier clicks
 * keep the default behaviour.
 */
const CLICK_SLOP = 4;
const stableClick = EditorView.mouseSelectionStyle.of((view, down) => {
  if (down.button !== 0 || down.detail > 1 || down.shiftKey || down.altKey || down.ctrlKey || down.metaKey) {
    return null;
  }
  const start = view.posAtCoords({ x: down.clientX, y: down.clientY }, false);
  let anchor = start;
  return {
    update(u) {
      anchor = u.changes.mapPos(anchor);
    },
    get(cur) {
      const still = Math.abs(cur.clientX - down.clientX) <= CLICK_SLOP && Math.abs(cur.clientY - down.clientY) <= CLICK_SLOP;
      if (still) return EditorSelection.single(anchor);
      const head = view.posAtCoords({ x: cur.clientX, y: cur.clientY }, false);
      return EditorSelection.single(anchor, head);
    },
  };
});

/** The live-preview behaviour (pair it with `liveTheme`). */
export function livePreview(): Extension {
  return [revealField, stableClick, inlinePlugin];
}

export { liveTheme } from './theme.ts';
