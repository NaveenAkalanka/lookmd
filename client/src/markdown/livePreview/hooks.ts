/** What the live preview needs from its host (the Editor component). */

import { Facet, StateEffect, StateField } from '@codemirror/state';

/**
 * An image widget's rendered height, reported once it loads (or fails). Feeding
 * it back into the decorations makes CodeMirror redraw and re-measure: a plain
 * requestMeasure() doesn't re-read line heights when the content element's own
 * height is pinned (short documents), which left clicks below a freshly loaded
 * image landing on the wrong line.
 */
export const imageMeasured = StateEffect.define<{ src: string; height: number }>();

export const imageHeights = StateField.define<ReadonlyMap<string, number>>({
  create: () => new Map(),
  update(map, tr) {
    let next: Map<string, number> | null = null;
    for (const e of tr.effects) {
      if (!e.is(imageMeasured) || map.get(e.value.src) === e.value.height) continue;
      next ??= new Map(map);
      next.set(e.value.src, e.value.height);
    }
    return next ?? map;
  },
});

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
