/**
 * Live-preview widgets: the small DOM pieces that stand in for Markdown syntax.
 * Each carries a `kind` (read by tests) and an `eq` over its data, so CodeMirror
 * reuses unchanged widgets instead of re-creating their DOM.
 */

import { WidgetType, type EditorView } from '@codemirror/view';
import { toggleTaskAt } from './links.ts';

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
