/**
 * Live-preview widgets: the small DOM pieces that stand in for Markdown syntax.
 * Each carries a `kind` (read by tests) and an `eq` over its data, so CodeMirror
 * reuses unchanged widgets instead of re-creating their DOM.
 */

import { WidgetType, type EditorView } from '@codemirror/view';
import { toggleTaskAt } from './links.ts';
import { imageMeasured, liveHooks } from './hooks.ts';

export class BulletWidget extends WidgetType {
  readonly kind = 'bullet';
  override eq(other: WidgetType): boolean {
    return other instanceof BulletWidget;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-bullet';
    el.textContent = '•';
    return el;
  }
}

/** A real checkbox for `- [ ]` / `- [x]`; clicking flips the one box character. */
export class TaskWidget extends WidgetType {
  readonly kind = 'task';
  readonly checked: boolean;
  /** Offset of the `[` from the widget's start (the list marker). */
  readonly markerOffset: number;
  constructor(checked: boolean, markerOffset: number) {
    super();
    this.checked = checked;
    this.markerOffset = markerOffset;
  }
  override eq(other: WidgetType): boolean {
    return other instanceof TaskWidget && other.checked === this.checked && other.markerOffset === this.markerOffset;
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-lp-task';
    box.checked = this.checked;
    box.setAttribute('aria-label', this.checked ? 'Mark task not done' : 'Mark task done');
    box.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const spec = toggleTaskAt(view.state, view.posAtDOM(box) + this.markerOffset);
      if (spec) view.dispatch(spec);
    });
    // The state change re-renders the box; don't let the click toggle it too.
    box.addEventListener('click', (e) => e.preventDefault());
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

export class RuleWidget extends WidgetType {
  readonly kind = 'rule';
  override eq(other: WidgetType): boolean {
    return other instanceof RuleWidget;
  }
  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-rule';
    el.setAttribute('role', 'separator');
    return el;
  }
}

/**
 * An image below its line, loaded through the file source (`liveHooks`), with
 * the Read view's loading placeholder and "image not found" chip classes.
 */
export class ImageWidget extends WidgetType {
  readonly kind = 'image';
  readonly src: string;
  readonly alt: string;
  /** Rendered height once known (see `imageMeasured`), else null. */
  readonly height: number | null;
  constructor(src: string, alt: string, height: number | null = null) {
    super();
    this.src = src;
    this.alt = alt;
    this.height = height;
  }
  override eq(other: WidgetType): boolean {
    return other instanceof ImageWidget && other.src === this.src && other.alt === this.alt && other.height === this.height;
  }
  /** A new height for the same image keeps the DOM (no reload); the redraw makes the editor re-measure. */
  override updateDOM(dom: HTMLElement): boolean {
    return dom.dataset.src === this.src && dom.dataset.alt === this.alt;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-image';
    wrap.dataset.src = this.src;
    wrap.dataset.alt = this.alt;
    const report = () => {
      if (!wrap.isConnected) return; // widget gone (file switched, editor closed)
      const height = Math.round(wrap.getBoundingClientRect().height);
      if (height && height !== this.height) view.dispatch({ effects: imageMeasured.of({ src: this.src, height }) });
    };
    const loading = document.createElement('span');
    loading.className = 'img-loading';
    loading.setAttribute('aria-busy', 'true');
    wrap.appendChild(loading);
    const fail = () => {
      const chip = document.createElement('span');
      chip.className = 'img-missing';
      chip.textContent = this.alt || this.src;
      wrap.replaceChildren(chip);
      report();
    };
    view.state
      .facet(liveHooks)
      .resolveImage(this.src)
      .then((url) => {
        const img = document.createElement('img');
        img.alt = this.alt;
        img.onerror = fail;
        // The image's height arrives late; report it so the editor re-measures.
        img.onload = report;
        img.src = url;
        wrap.replaceChildren(img);
      }, fail);
    return wrap;
  }
  override get estimatedHeight(): number {
    return this.height ?? 120;
  }
}
