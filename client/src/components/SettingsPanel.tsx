/**
 * Appearance settings as a spacious floating dialog: theme gallery on the left,
 * fonts and editor options on the right. Scoped `data-theme` on each card
 * renders a live mini-preview of that theme's tokens without touching the page.
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

  const lightThemes = THEMES.filter((t) => t.light);
  const darkThemes = THEMES.filter((t) => !t.light);

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
            <Icon icon={Cancel01Icon} size={18} />
          </button>
        </div>

        <div className="settings-window-body">
          {/* ── Left: Theme gallery ── */}
          <div className="settings-pane-themes">
            <span className="settings-heading">Light</span>
            <div className="theme-grid">
              {lightThemes.map((t) => (
                <ThemeCard
                  key={t.id}
                  id={t.id}
                  label={t.label}
                  active={theme === t.id}
                  onSelect={onTheme}
                />
              ))}
            </div>

            <span className="settings-heading" style={{ marginTop: 20, display: 'block' }}>Dark</span>
            <div className="theme-grid">
              {darkThemes.map((t) => (
                <ThemeCard
                  key={t.id}
                  id={t.id}
                  label={t.label}
                  active={theme === t.id}
                  onSelect={onTheme}
                />
              ))}
            </div>
          </div>

          {/* ── Right: Options ── */}
          <div className="settings-pane-options">
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
              <p className="setting-hint">Toggle anytime with Ctrl/Cmd-B.</p>
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
    </div>
  );
}

interface ThemeCardProps {
  id: ThemeId;
  label: string;
  active: boolean;
  onSelect: (id: ThemeId) => void;
}

function ThemeCard({ id, label, active, onSelect }: ThemeCardProps) {
  return (
    <button
      className={`theme-card${active ? ' theme-card-active' : ''}`}
      aria-pressed={active}
      onClick={() => onSelect(id)}
      title={label}
    >
      {/* Mini app-window preview, inherits this theme's CSS tokens */}
      <span className="theme-preview" data-theme={id}>
        <span className="theme-preview-topbar">
          <span className="theme-preview-dot" />
          <span className="theme-preview-dot" />
          <span className="theme-preview-dot" />
        </span>
        <span className="theme-preview-body">
          <span className="theme-preview-sidebar">
            <span className="theme-preview-sidebar-line" />
            <span className="theme-preview-sidebar-line" />
            <span className="theme-preview-sidebar-line" />
          </span>
          <span className="theme-preview-content">
            <span className="theme-preview-content-line" />
            <span className="theme-preview-content-line" />
            <span className="theme-preview-content-line" />
            <span className="theme-preview-content-line" />
          </span>
        </span>
      </span>
      {label}
    </button>
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
