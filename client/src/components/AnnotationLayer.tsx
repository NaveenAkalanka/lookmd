/**
 * The SVG drawing surface for the annotation overlay.
 *
 * It fills the pane's content viewport (its parent must be `position:relative`)
 * and keeps every mark in *content coordinates* inside a `<g>` that is translated
 * by the scroll host's current offset — so marks stay anchored to the text as you
 * scroll, in all three view modes, without touching CodeMirror's DOM. Drawing
 * adds the scroll offset to pointer coords, so stored coordinates are absolute in
 * content space. Vectors mean marks also scale with the page's `--zoom`.
 *
 * The Select tool clicks a mark to select it (the toolbar then recolours/resizes
 * it); double-clicking a text mark re-opens its editor. Text boxes are created on
 * *click* (after the pointer gesture) and focused on the next frame, so the
 * gesture's own focus shuffle can't blur and discard them.
 */

import { useEffect, useRef, useState } from 'react';
import {
  type Mark,
  type ToolId,
  type AnnotColor,
  colorVar,
  newMarkId,
  pointsToPath,
  markHit,
  markBoxHit,
  markBBox,
  translateMark,
  textSizeFromWidth,
} from '../annotations';

interface TextDraft {
  x: number;
  y: number;
  value: string;
  /** Set when editing an existing text mark rather than creating a new one. */
  id?: string;
}

interface Props {
  marks: Mark[];
  tool: ToolId;
  color: AnnotColor;
  width: number;
  selectedId: string | null;
  /** Element whose scroll offset the overlay tracks (mode-dependent). */
  scrollHost: HTMLElement | null;
  onCommit: (mark: Mark) => void;
  onErase: (id: string, coalesce?: string) => void;
  onSelect: (id: string | null) => void;
  onUpdate: (id: string, patch: Partial<Mark>, coalesce?: string) => void;
}

const HIGHLIGHT_FACTOR = 4; // highlighter is much fatter than the pen
const ERASE_TOL = 8;
const SELECT_TOL = 10;

export function AnnotationLayer({
  marks,
  tool,
  color,
  width,
  selectedId,
  scrollHost,
  onCommit,
  onErase,
  onSelect,
  onUpdate,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [draft, setDraft] = useState<Mark | null>(null);
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null);
  const drawing = useRef(false);
  // Drag-to-move state for the Select tool: the mark snapshot at grab time plus
  // the start point, so each move re-derives position from the original (no drift).
  const drag = useRef<{ id: string; origin: Mark; startX: number; startY: number; txn: string } | null>(null);
  // Coalesce key for the current eraser sweep, so one stroke is one undo step.
  const eraseTxn = useRef<string | null>(null);

  // Mirror the scroll host's offset into the translate group.
  useEffect(() => {
    if (!scrollHost) {
      setScroll({ left: 0, top: 0 });
      return;
    }
    const sync = () => setScroll({ left: scrollHost.scrollLeft, top: scrollHost.scrollTop });
    sync();
    scrollHost.addEventListener('scroll', sync, { passive: true });
    return () => scrollHost.removeEventListener('scroll', sync);
  }, [scrollHost]);

  // Focus a freshly opened text box on the next frame — after the click gesture
  // has settled — so it isn't blurred and discarded mid-creation.
  const textOpen = textDraft !== null;
  useEffect(() => {
    if (!textOpen) return;
    const r = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(r);
  }, [textOpen, textDraft?.id]);

  /** Client coords → content-space coords. */
  function toContent(clientX: number, clientY: number): { x: number; y: number } {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left + scroll.left, y: clientY - rect.top + scroll.top };
  }

  /** Topmost mark whose bounding box contains the point (forgiving select/move). */
  function hitTest(x: number, y: number): Mark | null {
    for (let i = marks.length - 1; i >= 0; i--) {
      if (markBoxHit(marks[i]!, x, y, SELECT_TOL)) return marks[i]!;
    }
    return null;
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const { x, y } = toContent(e.clientX, e.clientY);

    if (tool === 'select') {
      const hit = hitTest(x, y);
      onSelect(hit?.id ?? null);
      if (hit) {
        // Begin a potential drag; if the pointer never moves it's just a select.
        drag.current = { id: hit.id, origin: hit, startX: x, startY: y, txn: newMarkId() };
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      return;
    }
    if (tool === 'text') return; // created on click, below
    if (tool === 'eraser') {
      drawing.current = true;
      eraseTxn.current = newMarkId();
      svgRef.current?.setPointerCapture(e.pointerId);
      eraseAt(x, y);
      return;
    }

    e.preventDefault();
    drawing.current = true;
    svgRef.current?.setPointerCapture(e.pointerId);

    if (tool === 'pen' || tool === 'highlighter') {
      setDraft({
        id: newMarkId(),
        tool,
        color,
        width: tool === 'highlighter' ? width * HIGHLIGHT_FACTOR : width,
        points: [x, y],
      });
    } else if (tool === 'arrow' || tool === 'line') {
      setDraft({ id: newMarkId(), tool, color, width, x1: x, y1: y, x2: x, y2: y });
    } else if (tool === 'box') {
      setDraft({ id: newMarkId(), tool, color, width, x, y, w: 0, h: 0 });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    // Dragging a selected mark (Select tool).
    if (drag.current) {
      const { x, y } = toContent(e.clientX, e.clientY);
      const d = drag.current;
      onUpdate(d.id, translateMark(d.origin, x - d.startX, y - d.startY), d.txn);
      return;
    }
    if (!drawing.current) return;
    const { x, y } = toContent(e.clientX, e.clientY);

    if (tool === 'eraser') {
      eraseAt(x, y);
      return;
    }
    setDraft((d) => {
      if (!d) return d;
      if (d.tool === 'pen' || d.tool === 'highlighter') {
        return { ...d, points: [...d.points, x, y] };
      }
      if (d.tool === 'arrow' || d.tool === 'line') {
        return { ...d, x2: x, y2: y };
      }
      if (d.tool === 'box') {
        return { ...d, x: Math.min(d.x, x), y: Math.min(d.y, y), w: Math.abs(x - d.x), h: Math.abs(y - d.y) };
      }
      return d;
    });
  }

  function onPointerUp(e: React.PointerEvent) {
    if (drag.current) {
      drag.current = null;
      svgRef.current?.releasePointerCapture(e.pointerId);
      return;
    }
    if (!drawing.current) return;
    drawing.current = false;
    svgRef.current?.releasePointerCapture(e.pointerId);
    if (tool === 'eraser') return;

    setDraft((d) => {
      if (d && isMeaningful(d)) onCommit(d);
      return null;
    });
  }

  function onClick(e: React.MouseEvent) {
    if (tool !== 'text' || textDraft) return;
    const { x, y } = toContent(e.clientX, e.clientY);
    setTextDraft({ x, y, value: '' });
  }

  function onDoubleClick(e: React.MouseEvent) {
    if (tool !== 'select') return;
    const { x, y } = toContent(e.clientX, e.clientY);
    const hit = hitTest(x, y);
    if (hit && hit.tool === 'text') {
      onSelect(hit.id);
      setTextDraft({ x: hit.x, y: hit.y, value: hit.text, id: hit.id });
    }
  }

  function eraseAt(x: number, y: number) {
    for (const m of marks) {
      if (markHit(m, x, y, ERASE_TOL)) onErase(m.id, eraseTxn.current ?? undefined);
    }
  }

  // The overlay sits above (not inside) the scroll container, so wheel events
  // can't bubble to it. Forward them so the page still scrolls while annotating;
  // the scroll listener then keeps the marks anchored.
  function onWheel(e: React.WheelEvent) {
    if (!scrollHost) return;
    scrollHost.scrollTop += e.deltaY;
    scrollHost.scrollLeft += e.deltaX;
  }

  function commitText() {
    setTextDraft((t) => {
      if (t && t.value.trim()) {
        if (t.id) {
          onUpdate(t.id, { text: t.value.trim() });
        } else {
          onCommit({
            id: newMarkId(),
            tool: 'text',
            color,
            x: t.x,
            y: t.y,
            text: t.value.trim(),
            size: textSizeFromWidth(width),
          });
        }
      }
      return null;
    });
  }

  const selected = selectedId ? marks.find((m) => m.id === selectedId) ?? null : null;

  return (
    <>
      <svg
        ref={svgRef}
        className={`annotation-layer annotation-tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      >
        <g transform={`translate(${-scroll.left} ${-scroll.top})`}>
          {marks.map((m) => (
            <MarkShape key={m.id} mark={m} />
          ))}
          {draft && <MarkShape mark={draft} />}
          {selected && <SelectionOutline mark={selected} />}
        </g>
      </svg>
      {textDraft && (
        <input
          ref={inputRef}
          className="annotation-text-input"
          value={textDraft.value}
          style={{
            left: textDraft.x - scroll.left,
            top: textDraft.y - scroll.top - textSizeFromWidth(width),
            color: colorVar(color),
            fontSize: textSizeFromWidth(width),
          }}
          onChange={(e) => setTextDraft((t) => (t ? { ...t, value: e.target.value } : t))}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitText();
            else if (e.key === 'Escape') setTextDraft(null);
          }}
          onBlur={commitText}
          placeholder="note…"
        />
      )}
    </>
  );
}

/** A draft is worth keeping only if it actually has extent (not a stray click). */
function isMeaningful(m: Mark): boolean {
  switch (m.tool) {
    case 'pen':
    case 'highlighter':
      return m.points.length >= 4;
    case 'arrow':
    case 'line':
      return Math.hypot(m.x2 - m.x1, m.y2 - m.y1) >= 4;
    case 'box':
      return m.w >= 4 && m.h >= 4;
    case 'text':
      return m.text.trim().length > 0;
  }
}

function SelectionOutline({ mark }: { mark: Mark }) {
  const b = markBBox(mark);
  const pad = 4;
  return (
    <rect
      className="annotation-selection"
      x={b.x - pad}
      y={b.y - pad}
      width={b.w + pad * 2}
      height={b.h + pad * 2}
      fill="none"
      rx={3}
    />
  );
}

function MarkShape({ mark }: { mark: Mark }) {
  const stroke = colorVar(mark.color);

  switch (mark.tool) {
    case 'pen':
      return (
        <path
          d={pointsToPath(mark.points)}
          fill="none"
          stroke={stroke}
          strokeWidth={mark.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'highlighter':
      return (
        <path
          className="annotation-highlight"
          d={pointsToPath(mark.points)}
          fill="none"
          stroke={stroke}
          strokeWidth={mark.width}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'line':
      return <line x1={mark.x1} y1={mark.y1} x2={mark.x2} y2={mark.y2} stroke={stroke} strokeWidth={mark.width} strokeLinecap="round" />;
    case 'arrow':
      return <Arrow mark={mark} stroke={stroke} />;
    case 'box':
      return (
        <rect
          x={mark.x}
          y={mark.y}
          width={mark.w}
          height={mark.h}
          fill="none"
          stroke={stroke}
          strokeWidth={mark.width}
          rx={3}
        />
      );
    case 'text':
      // Two layers so the colour is always on top of the readable halo, with no
      // reliance on paint-order support.
      return (
        <g className="annotation-text">
          <text x={mark.x} y={mark.y} fontSize={mark.size} fill="var(--surface)" stroke="var(--surface)" strokeWidth={4}>
            {mark.text}
          </text>
          <text x={mark.x} y={mark.y} fontSize={mark.size} fill={stroke}>
            {mark.text}
          </text>
        </g>
      );
  }
}

function Arrow({ mark, stroke }: { mark: import('../annotations').LineMark; stroke: string }) {
  const { x1, y1, x2, y2, width } = mark;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 8 + width * 2;
  const a1 = angle - Math.PI / 7;
  const a2 = angle + Math.PI / 7;
  return (
    <g stroke={stroke} strokeWidth={width} strokeLinecap="round" fill="none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x2} y1={y2} x2={x2 - head * Math.cos(a1)} y2={y2 - head * Math.sin(a1)} />
      <line x1={x2} y1={y2} x2={x2 - head * Math.cos(a2)} y2={y2 - head * Math.sin(a2)} />
    </g>
  );
}
