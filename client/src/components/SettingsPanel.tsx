/**
 * Appearance settings as a floating window: theme picker + reading/mono font
 * choosers, centered over a dim backdrop. Pure UI — it reports changes upward;
 * persistence and application live in `settings.ts`. Closes on backdrop click,
 * the close button, or Escape.
 */

import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import {
  THEMES,
  READING_FONTS,
  MONO_FONTS,
  type ThemeId,
  type Fonts,
  type FontOption,
  type SidebarPref,
} from '../settings';

interface Props {
  theme: ThemeId;
  fonts: Fonts;
  sidebar: SidebarPref;
  lineNumbers: boolean;
  onTheme: (theme: ThemeId) => void;
  onFonts: (fonts: Fonts) => void;
  onSidebar: (sidebar: SidebarPref) => void;
  onLineNumbers: (on: boolean) => void;
  onClose: () => void;
}

export function SettingsPanel({
  theme,
  fonts,
  sidebar,
  lineNumbers,
  onTheme,
  onFonts,
  onSidebar,
  onLineNumbers,
  onClose,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="settings-backdrop" onMouseDown={onClose}>
      <div
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-label="Appearance"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-window-head">
          <h2 className="settings-title">Appearance</h2>
          <button className="btn icon-btn" aria-label="Close settings" onClick={onClose}>
            <Icon icon={Cancel01Icon} size={16} />
          </button>
        </div>
        <div className="settings-window-body">
          <section className="settings-section">
        <span className="settings-heading">Theme</span>
        <div className="theme-grid">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-chip${theme === t.id ? ' theme-chip-active' : ''}`}
              aria-pressed={theme === t.id}
              onClick={() => onTheme(t.id)}
            >
              <span className="theme-swatch" data-theme={t.id}>
                <span className="theme-swatch-bg" />
                <span className="theme-swatch-accent" />
                <span className="theme-swatch-accent2" />
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <span className="settings-heading">Fonts</span>
        <FontPicker
          label="Reading"
          value={fonts.read}
          options={READING_FONTS}
          onChange={(read) => onFonts({ ...fonts, read })}
        />
        <FontPicker
          label="Editor / mono"
          value={fonts.mono}
          options={MONO_FONTS}
          onChange={(mono) => onFonts({ ...fonts, mono })}
        />
      </section>

      <section className="settings-section">
        <span className="settings-heading">Sidebar</span>
        <label className="setting-check">
          <input
            type="checkbox"
            checked={sidebar.autoHide}
            onChange={(e) => onSidebar({ ...sidebar, autoHide: e.target.checked })}
          />
          Auto-hide — reveal on hover at the left edge
        </label>
        <p className="setting-hint">Toggle the sidebar anytime from the toolbar or with Ctrl/Cmd-B.</p>
          </section>

          <section className="settings-section">
            <span className="settings-heading">Editor</span>
            <label className="setting-check">
              <input
                type="checkbox"
                checked={lineNumbers}
                onChange={(e) => onLineNumbers(e.target.checked)}
              />
              Show line numbers (Source &amp; Edit)
            </label>
          </section>
        </div>
      </div>
    </div>
  );
}

const CUSTOM = '__custom__';

interface FontPickerProps {
  label: string;
  value: string;
  options: FontOption[];
  onChange: (value: string) => void;
}

function FontPicker({ label, value, options, onChange }: FontPickerProps) {
  const matched = options.some((o) => o.value === value);
  const [custom, setCustom] = useState(!matched);

  const selectValue = custom ? CUSTOM : value;

  return (
    <div className="setting-block">
      <label className="setting-label">{label}</label>
      <select
        className="setting-control"
        value={selectValue}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
          } else {
            setCustom(false);
            onChange(e.target.value);
          }
        }}
      >
        {options.map((o) => (
          <option key={o.label} value={o.value}>
            {o.label}
          </option>
        ))}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {custom && (
        <input
          className="setting-control"
          placeholder="e.g. 'Inter', sans-serif"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
