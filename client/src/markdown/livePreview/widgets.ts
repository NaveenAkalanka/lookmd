/**
 * Live-preview widgets: the small DOM pieces that stand in for Markdown syntax.
 * Each carries a `kind` (read by tests) and an `eq` over its data, so CodeMirror
 * reuses unchanged widgets instead of re-creating their DOM.
 */

import { WidgetType, type EditorView } from '@codemirror/view';
import { toggleTaskAt } from './links.ts';
import { imageMeasured, liveHooks } from './hooks.ts';
import type { Cell, Span, SpanMark, TableModel } from './table.ts';

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

/** While an image's src is being typed, wait this long before loading it. */
const EDIT_LOAD_DELAY = 400;
const LOAD_TIMERS = new WeakMap<HTMLElement, number>();

/**
 * An image inside a link (a README badge): rendered inline in the link text.
 * Events go to the editor, so Ctrl/Cmd-click opens the link around it.
 */
export class InlineImageWidget extends WidgetType {
  readonly kind = 'inline-image';
  readonly src: string;
  readonly alt: string;
  constructor(src: string, alt: string) {
    super();
    this.src = src;
    this.alt = alt;
  }
  override eq(other: WidgetType): boolean {
    return other instanceof InlineImageWidget && other.src === this.src && other.alt === this.alt;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-lp-image-inline';
    el.textContent = this.alt;
    view.state
      .facet(liveHooks)
      .resolveImage(this.src)
      .then((url) => {
        const img = document.createElement('img');
        img.alt = this.alt;
        img.onerror = () => el.replaceChildren(this.alt || this.src);
        img.src = url;
        el.replaceChildren(img);
      }, () => el.replaceChildren(this.alt || this.src));
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
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
  /** The src is being edited: wait before loading (not part of `eq`). */
  readonly deferred: boolean;
  constructor(src: string, alt: string, height: number | null = null, deferred = false) {
    super();
    this.src = src;
    this.alt = alt;
    this.height = height;
    this.deferred = deferred;
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
    const load = () => {
      LOAD_TIMERS.delete(wrap);
      if (!wrap.isConnected && this.deferred) return; // replaced while waiting
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
    };
    if (this.deferred) LOAD_TIMERS.set(wrap, window.setTimeout(load, EDIT_LOAD_DELAY));
    else load();
    return wrap;
  }
  override destroy(dom: HTMLElement): void {
    const timer = LOAD_TIMERS.get(dom);
    if (timer !== undefined) window.clearTimeout(timer);
    LOAD_TIMERS.delete(dom);
  }
  override get estimatedHeight(): number {
    return this.height ?? 120;
  }
}

/** A fenced block's header: language badge + copy button (like Read's CodeBlock). */
export class CodeHeadWidget extends WidgetType {
  readonly kind = 'codehead';
  readonly lang: string;
  readonly code: string;
  constructor(lang: string, code: string) {
    super();
    this.lang = lang;
    this.code = code;
  }
  override eq(other: WidgetType): boolean {
    return other instanceof CodeHeadWidget && other.lang === this.lang && other.code === this.code;
  }
  toDOM(): HTMLElement {
    const head = document.createElement('span');
    head.className = 'cm-lp-codehead';
    const lang = document.createElement('span');
    lang.className = 'cm-lp-code-lang';
    lang.textContent = this.lang || 'text';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'cm-lp-code-copy';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', 'Copy code');
    copy.addEventListener('mousedown', (e) => e.preventDefault());
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.code).then(() => {
        copy.textContent = 'Copied';
        window.setTimeout(() => (copy.textContent = 'Copy'), 1200);
      });
    });
    head.append(lang, copy);
    return head;
  }
  /** The copy button handles its own events; a click elsewhere edits the block. */
  override ignoreEvent(e: Event): boolean {
    return e.target instanceof Element && !!e.target.closest('.cm-lp-code-copy');
  }
}

const MARK_TAGS: Record<SpanMark, string> = { strong: 'strong', em: 'em', code: 'code', strike: 's', link: 'span' };

function renderSpans(parent: HTMLElement, spans: Span[]) {
  for (const span of spans) {
    let node: Node = document.createTextNode(span.text);
    for (const mark of span.marks) {
      const el = document.createElement(MARK_TAGS[mark]);
      if (mark === 'link') el.className = 'cm-lp-link';
      el.appendChild(node);
      node = el;
    }
    parent.appendChild(node);
  }
}

/**
 * A rendered GFM table standing in for its lines. Clicking a cell moves the
 * cursor into that cell's raw text (which reveals the table for editing).
 */
export class TableWidget extends WidgetType {
  readonly kind = 'table';
  readonly model: TableModel;
  /** The table's source text: equal source = same widget. */
  readonly source: string;
  /** Start of the replaced range; cell offsets are kept relative to it. */
  readonly rangeFrom: number;
  constructor(model: TableModel, source: string, rangeFrom: number) {
    super();
    this.model = model;
    this.source = source;
    this.rangeFrom = rangeFrom;
  }
  override eq(other: WidgetType): boolean {
    return other instanceof TableWidget && other.source === this.source;
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-lp-table-wrap';
    const table = document.createElement('table');
    table.className = 'cm-lp-table';
    const cols = Math.max(this.model.head.length, ...this.model.rows.map((r) => r.length));
    const addRow = (parent: HTMLElement, cells: Cell[], tag: 'th' | 'td') => {
      const tr = document.createElement('tr');
      for (let i = 0; i < cols; i++) {
        const cell = cells[i];
        const el = document.createElement(tag);
        const align = this.model.align[i];
        if (align) el.style.textAlign = align;
        if (cell) {
          el.dataset.at = String(cell.from - this.rangeFrom);
          renderSpans(el, cell.spans);
        }
        tr.appendChild(el);
      }
      parent.appendChild(tr);
    };
    const thead = document.createElement('thead');
    addRow(thead, this.model.head, 'th');
    const tbody = document.createElement('tbody');
    for (const row of this.model.rows) addRow(tbody, row, 'td');
    table.append(thead, tbody);
    wrap.appendChild(table);
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const cell = (e.target as Element).closest('[data-at]') as HTMLElement | null;
      const rel = cell ? Number(cell.dataset.at) : 0;
      const anchor = Math.min(view.state.doc.length, view.posAtDOM(wrap) + rel);
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}
