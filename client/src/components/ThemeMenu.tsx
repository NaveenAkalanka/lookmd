/**
 * Topbar theme switcher: one click opens every theme, grouped Light / Dark, each
 * with a swatch drawn in its own colors (a scoped `data-theme`, so the swatch is
 * pure tokens like everything else). Picking applies immediately and persists.
 *
 * Keyboard: Down/Up on the button opens it; opening focuses the current theme
 * (or the first); Up/Down/Home/End move; Enter or Space picks; Escape closes and
 * returns focus to the button.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { PaintBoardIcon, Tick02Icon } from '@hugeicons/core-free-icons';
import { Icon } from './Icon';
import { THEMES, type ThemeId } from '../settings';

interface Props {
  theme: ThemeId;
  onTheme: (id: ThemeId) => void;
  /** Open the full Appearance panel (fonts, editor options, theme previews). */
  onMore: () => void;
}

const GROUPS = [
  { label: 'Light', themes: THEMES.filter((t) => t.light) },
  { label: 'Dark', themes: THEMES.filter((t) => !t.light) },
];

export function ThemeMenu({ theme, onTheme, onMore }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  // Outside click closes.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // On open, focus (and scroll to) the current theme.
  useEffect(() => {
    if (!open) return;
    const current =
      popRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ??
      popRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]');
    current?.focus({ preventScroll: true });
    current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  const items = () => [...(popRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], .theme-menu-more') ?? [])];

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Tab') setOpen(false);
    else return;
    if (e.key !== 'Tab') e.preventDefault();
  };

  const pick = (id: ThemeId) => {
    onTheme(id);
    close(true);
  };

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        className={`btn icon-btn${open ? ' menu-trigger-open' : ''}`}
        title="Change theme"
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Icon icon={PaintBoardIcon} />
      </button>
      {open && (
        <div className="menu-pop theme-menu" role="menu" aria-label="Theme" ref={popRef} onKeyDown={onKeyDown}>
          {GROUPS.map((g) => (
            <div key={g.label} role="group" aria-label={`${g.label} themes`}>
              <div className="theme-menu-group">{g.label}</div>
              {g.themes.map((t) => (
                <button
                  key={t.id}
                  className="menu-item theme-menu-item"
                  role="menuitemradio"
                  aria-checked={t.id === theme}
                  data-theme-id={t.id}
                  tabIndex={-1}
                  onClick={() => pick(t.id)}
                >
                  <span className="theme-swatch" data-theme={t.id} aria-hidden="true">
                    <span className="theme-swatch-accent" />
                  </span>
                  <span className="menu-item-label">{t.label}</span>
                  {t.id === theme && <Icon icon={Tick02Icon} size={14} />}
                </button>
              ))}
            </div>
          ))}
          <div className="menu-sep" role="separator" />
          <button
            className="menu-item theme-menu-more"
            role="menuitem"
            tabIndex={-1}
            onClick={() => {
              setOpen(false);
              onMore();
            }}
          >
            <span className="menu-item-label">All appearance settings…</span>
          </button>
        </div>
      )}
    </div>
  );
}
