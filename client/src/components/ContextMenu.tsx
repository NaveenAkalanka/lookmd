/**
 * A floating right-click menu, positioned at the cursor and clamped to stay on
 * screen. App owns a single instance and feeds it a list of items; callers
 * (file tree, tabs) open it via a shared handler. Closes on selection, outside
 * click, Escape, scroll, or resize.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { IconSvgElement } from '@hugeicons/react';

export interface MenuItem {
  label: string;
  onClick: () => void;
  icon?: IconSvgElement;
  danger?: boolean;
  disabled?: boolean;
}
export type MenuEntry = MenuItem | 'separator';

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
}

interface Props {
  menu: ContextMenuState | null;
  onClose: () => void;
}

export function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Place at the cursor, then nudge back on screen once measured.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.max(8, Math.min(menu.x, window.innerWidth - r.width - 8));
    const y = Math.max(8, Math.min(menu.y, window.innerHeight - r.height - 8));
    setPos({ x, y });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="context-sep" role="separator" />
        ) : (
          <button
            key={item.label}
            className={`context-item${item.danger ? ' context-item-danger' : ''}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.icon ? (
              <Icon icon={item.icon} size={15} />
            ) : (
              <span className="context-item-noicon" />
            )}
            <span className="context-item-label">{item.label}</span>
          </button>
        ),
      )}
    </div>
  );
}
