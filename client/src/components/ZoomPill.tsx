/**
 * The floating zoom control for one view side: a small "− 100% +" pill in the
 * side's bottom-right corner. It stays out of the document: hidden until the
 * side is hovered (CSS, via the `.zoom-host` parent), shown briefly after each
 * zoom change, and faint-but-present on touch screens. Clicking the level
 * resets it to 100%.
 */

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { MinusSignIcon, PlusSignIcon } from '@hugeicons/core-free-icons';
import { ZOOM_MAX, ZOOM_MIN } from '../settings';

interface Props {
  zoom: number;
  /** What this side shows, for the accessible names ("Read", "Preview", …). */
  label: string;
  onIn: () => void;
  onOut: () => void;
  onReset: () => void;
}

export function ZoomPill({ zoom, label, onIn, onOut, onReset }: Props) {
  const [flash, setFlash] = useState(false);
  const first = useRef(true);

  // Show the pill for a moment whenever the level changes (e.g. from the
  // keyboard), so the new value is visible without hovering.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setFlash(true);
    const t = window.setTimeout(() => setFlash(false), 1200);
    return () => window.clearTimeout(t);
  }, [zoom]);

  const pct = Math.round(zoom * 100);
  return (
    <div className={`zoom-pill${flash ? ' zoom-pill-flash' : ''}`} role="group" aria-label={`${label} zoom`}>
      <button onClick={onOut} disabled={zoom <= ZOOM_MIN} title="Zoom out (Ctrl/Cmd −)" aria-label={`Zoom out ${label}`}>
        <Icon icon={MinusSignIcon} size={13} />
      </button>
      <button
        className="zoom-pill-level"
        onClick={onReset}
        title="Reset to 100% (Ctrl/Cmd 0)"
        aria-label={`${label} zoom ${pct} percent, click to reset`}
      >
        {pct}%
      </button>
      <button onClick={onIn} disabled={zoom >= ZOOM_MAX} title="Zoom in (Ctrl/Cmd +)" aria-label={`Zoom in ${label}`}>
        <Icon icon={PlusSignIcon} size={13} />
      </button>
    </div>
  );
}
