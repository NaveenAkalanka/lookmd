/**
 * A draggable divider between two flex children (Split's editor | preview, or
 * two file panes). It reports the first side's share as a ratio (0.2–0.8); the
 * parent applies it as that side's flex-basis.
 *
 * The axis follows the container's own flex-direction, so the same divider
 * resizes widths side by side and heights when the layout stacks (phones,
 * stacked panes). Drag with a pointer, nudge with the arrow keys (5%), jump to
 * the limits with Home/End, and double-click to reset to an even split.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RATIO_MAX, RATIO_MIN, clampRatio } from '../settings';

interface Props {
  ratio: number;
  /** Live updates while dragging or nudging. */
  onChange: (ratio: number) => void;
  /** The settled value (end of a drag, a key press, a reset) — persist this. */
  onCommit: (ratio: number) => void;
  label: string;
}

type Axis = 'x' | 'y';

function axisOf(el: HTMLElement | null): Axis {
  const parent = el?.parentElement;
  if (!parent) return 'x';
  return getComputedStyle(parent).flexDirection.startsWith('column') ? 'y' : 'x';
}

export function Divider({ ratio, onChange, onCommit, label }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [axis, setAxis] = useState<Axis>('x');
  const [dragging, setDragging] = useState(false);

  // Re-read the axis when the layout may have flipped (resize, split toggle).
  useEffect(() => {
    const update = () => setAxis(axisOf(ref.current));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  });

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      const parent = el?.parentElement;
      if (!el || !parent || e.button !== 0) return;
      e.preventDefault();
      const a = axisOf(el);
      const rect = parent.getBoundingClientRect();
      const at = (ev: PointerEvent) =>
        clampRatio(a === 'x' ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height);
      let last = ratio;
      setDragging(true);
      document.body.classList.add(a === 'x' ? 'resizing-col' : 'resizing-row');
      const move = (ev: PointerEvent) => {
        last = at(ev);
        onChange(last);
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing-col', 'resizing-row');
        setDragging(false);
        onCommit(last);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    [ratio, onChange, onCommit],
  );

  const set = (r: number) => {
    const c = clampRatio(r);
    onChange(c);
    onCommit(c);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (e.key === back) set(ratio - 0.05);
    else if (e.key === fwd) set(ratio + 0.05);
    else if (e.key === 'Home') set(RATIO_MIN);
    else if (e.key === 'End') set(RATIO_MAX);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className={`divider divider-${axis}${dragging ? ' divider-dragging' : ''}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      // A separator between side-by-side panes is a vertical line.
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuemin={Math.round(RATIO_MIN * 100)}
      aria-valuemax={Math.round(RATIO_MAX * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={() => set(0.5)}
      onKeyDown={onKeyDown}
    />
  );
}
