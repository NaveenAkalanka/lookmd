/**
 * Annotation overlay model + persistence.
 *
 * Annotations are a *temporary marking layer* drawn over a file (pen, highlighter,
 * arrows, boxes, text notes). They are NEVER written into the document — per
 * CLAUDE.md they live only in the browser. By default they are ephemeral (held in
 * React state, gone when you leave the file); a per-file "keep" toggle persists
 * them to localStorage so they survive reload. Nothing here touches IndexedDB or
 * the file source.
 *
 * Storage mirrors settings.ts: guarded read/write so a disabled/full localStorage
 * degrades silently. Marks store a *palette key* (not a hex), resolved to a
 * `--annot-*` CSS variable at render time, keeping the "no hardcoded color" rule.
 */

const KEY_PREFIX = 'lookmd.annot.';

/** Marker palette. Fixed across themes (a highlighter is yellow everywhere); the
 *  values live in :root as --annot-* tokens. `accent` follows the active theme. */
export type AnnotColor = 'red' | 'amber' | 'green' | 'blue' | 'violet' | 'accent';

export const ANNOT_PALETTE: AnnotColor[] = ['red', 'amber', 'green', 'blue', 'violet', 'accent'];

export function colorVar(c: AnnotColor): string {
  return `var(--annot-${c})`;
}

export type ToolId = 'select' | 'pen' | 'highlighter' | 'arrow' | 'line' | 'box' | 'text' | 'eraser';

interface MarkBase {
  id: string;
  color: AnnotColor;
}

/** Freehand stroke; `points` is a flat [x0,y0,x1,y1,…] list in content space. */
export interface StrokeMark extends MarkBase {
  tool: 'pen' | 'highlighter';
  width: number;
  points: number[];
}

export interface LineMark extends MarkBase {
  tool: 'arrow' | 'line';
  width: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BoxMark extends MarkBase {
  tool: 'box';
  width: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextMark extends MarkBase {
  tool: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
}

export type Mark = StrokeMark | LineMark | BoxMark | TextMark;

export interface FileAnnotations {
  marks: Mark[];
}

export function newMarkId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Stable per-file storage key from the workspace identity + relative path. */
export function fileKey(workspaceKey: string, path: string): string {
  return `${workspaceKey}::${path}`;
}

function storageKey(key: string): string {
  return KEY_PREFIX + key;
}

export function getAnnotations(key: string): FileAnnotations | null {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FileAnnotations>;
    return Array.isArray(parsed.marks) ? { marks: parsed.marks as Mark[] } : null;
  } catch {
    return null;
  }
}

export function setAnnotations(key: string, data: FileAnnotations): void {
  try {
    localStorage.setItem(storageKey(key), JSON.stringify(data));
  } catch {
    /* storage unavailable or full — degrade silently */
  }
}

export function clearAnnotations(key: string): void {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

/** Pinned == an entry exists on disk (the "keep" toggle wrote it). */
export function isPinned(key: string): boolean {
  try {
    return localStorage.getItem(storageKey(key)) !== null;
  } catch {
    return false;
  }
}

/** The width stepper (1–12) doubles as a text-size control for text marks; these
 *  map between the two so the same control reads back consistently on select. */
export function textSizeFromWidth(w: number): number {
  return Math.max(12, Math.round(w * 5));
}
export function widthFromTextSize(s: number): number {
  return Math.max(1, Math.min(12, Math.round(s / 5)));
}

/** Axis-aligned bounding box of a mark, in content space (for the select outline). */
export function markBBox(mark: Mark): { x: number; y: number; w: number; h: number } {
  switch (mark.tool) {
    case 'pen':
    case 'highlighter': {
      const p = mark.points;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        minX = Math.min(minX, p[i]!);
        maxX = Math.max(maxX, p[i]!);
        minY = Math.min(minY, p[i + 1]!);
        maxY = Math.max(maxY, p[i + 1]!);
      }
      const pad = mark.width / 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'arrow':
    case 'line': {
      const pad = mark.width / 2 + 4;
      const x = Math.min(mark.x1, mark.x2);
      const y = Math.min(mark.y1, mark.y2);
      return { x: x - pad, y: y - pad, w: Math.abs(mark.x2 - mark.x1) + pad * 2, h: Math.abs(mark.y2 - mark.y1) + pad * 2 };
    }
    case 'box':
      return { x: mark.x, y: mark.y, w: mark.w, h: mark.h };
    case 'text':
      return { x: mark.x, y: mark.y - mark.size, w: Math.max(20, mark.text.length * mark.size * 0.6), h: mark.size * 1.3 };
  }
}

/** Geometry patch that shifts a mark by (dx, dy) from its original position.
 *  Caller snapshots the mark at drag start and passes that as `origin`. */
export function translateMark(origin: Mark, dx: number, dy: number): Partial<Mark> {
  switch (origin.tool) {
    case 'pen':
    case 'highlighter':
      return { points: origin.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy)) };
    case 'arrow':
    case 'line':
      return { x1: origin.x1 + dx, y1: origin.y1 + dy, x2: origin.x2 + dx, y2: origin.y2 + dy };
    case 'box':
      return { x: origin.x + dx, y: origin.y + dy };
    case 'text':
      return { x: origin.x + dx, y: origin.y + dy };
  }
}

/** True if a point is inside a mark's bounding box (forgiving select/move hit). */
export function markBoxHit(mark: Mark, px: number, py: number, pad: number): boolean {
  const b = markBBox(mark);
  return px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad;
}

/** Smooth-ish SVG path for a freehand stroke: quadratic curves through midpoints,
 *  which rounds the polyline without needing a spline library. */
export function pointsToPath(points: number[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M ${points[0]} ${points[1]}`;
  let d = `M ${points[0]} ${points[1]}`;
  for (let i = 2; i < points.length - 2; i += 2) {
    const mx = (points[i]! + points[i + 2]!) / 2;
    const my = (points[i + 1]! + points[i + 3]!) / 2;
    d += ` Q ${points[i]} ${points[i + 1]} ${mx} ${my}`;
  }
  const n = points.length;
  d += ` L ${points[n - 2]} ${points[n - 1]}`;
  return d;
}

/** Shortest distance from point (px,py) to segment (x1,y1)-(x2,y2). Used by the
 *  eraser to hit-test strokes/lines. */
export function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** True if a point is within `tol` px of any part of a mark (for the eraser). */
export function markHit(mark: Mark, px: number, py: number, tol: number): boolean {
  switch (mark.tool) {
    case 'pen':
    case 'highlighter': {
      const p = mark.points;
      const reach = tol + mark.width / 2;
      for (let i = 0; i < p.length - 2; i += 2) {
        if (distToSegment(px, py, p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!) <= reach) return true;
      }
      // also test the single-point / last vertex
      if (p.length >= 2) {
        const last = p.length;
        if (Math.hypot(px - p[last - 2]!, py - p[last - 1]!) <= reach) return true;
      }
      return false;
    }
    case 'arrow':
    case 'line':
      return distToSegment(px, py, mark.x1, mark.y1, mark.x2, mark.y2) <= tol + mark.width / 2;
    case 'box': {
      const within =
        px >= mark.x - tol &&
        px <= mark.x + mark.w + tol &&
        py >= mark.y - tol &&
        py <= mark.y + mark.h + tol;
      const inner =
        px > mark.x + tol &&
        px < mark.x + mark.w - tol &&
        py > mark.y + tol &&
        py < mark.y + mark.h - tol;
      return within && !inner; // near the outline, not the empty middle
    }
    case 'text':
      return px >= mark.x - tol && px <= mark.x + 160 && py >= mark.y - mark.size && py <= mark.y + tol;
  }
}
