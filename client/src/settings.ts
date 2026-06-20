/**
 * Appearance settings: theme + reading/mono fonts, persisted to localStorage
 * (the only browser storage, per CLAUDE.md) and applied to the document root.
 *
 * A theme is just a token-value set selected via `data-theme`. Fonts are applied
 * as inline overrides of `--font-read` / `--font-mono`; an empty value removes
 * the override so the active theme's default font shows through.
 */

const THEME_KEY = 'lookmd.theme';
const FONTS_KEY = 'lookmd.fonts';

export type ThemeId = 'paper' | 'daylight' | 'slate' | 'sanctum';

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'paper', label: 'Paper' },
  { id: 'daylight', label: 'Daylight' },
  { id: 'slate', label: 'Slate' },
  { id: 'sanctum', label: 'Sanctum' },
];

const DEFAULT_THEME: ThemeId = 'paper';

export interface Fonts {
  /** font-family for the rendered Read view. '' = theme default. */
  read: string;
  /** font-family for Source/Edit. '' = theme default. */
  mono: string;
}

export const DEFAULT_FONTS: Fonts = { read: '', mono: '' };

export interface FontOption {
  label: string;
  value: string;
}

export const READING_FONTS: FontOption[] = [
  { label: 'Default (theme)', value: '' },
  { label: 'Georgia (serif)', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Iowan / Palatino', value: "'Iowan Old Style', 'Palatino Linotype', Palatino, serif" },
  { label: 'Charter', value: "Charter, 'Bitstream Charter', Georgia, serif" },
  { label: 'System sans', value: "system-ui, -apple-system, 'Segoe UI', sans-serif" },
];

export const MONO_FONTS: FontOption[] = [
  { label: 'Default (theme)', value: '' },
  { label: 'System mono', value: "ui-monospace, 'SFMono-Regular', 'Consolas', monospace" },
  { label: 'Consolas', value: "Consolas, 'Courier New', monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace" },
  { label: 'JetBrains / Fira', value: "'JetBrains Mono', 'Fira Code', monospace" },
];

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — degrade silently */
  }
}

export function getTheme(): ThemeId {
  const raw = readRaw(THEME_KEY);
  return THEMES.some((t) => t.id === raw) ? (raw as ThemeId) : DEFAULT_THEME;
}

export function getFonts(): Fonts {
  const raw = readRaw(FONTS_KEY);
  if (!raw) return { ...DEFAULT_FONTS };
  try {
    const parsed = JSON.parse(raw) as Partial<Fonts>;
    return {
      read: typeof parsed.read === 'string' ? parsed.read : '',
      mono: typeof parsed.mono === 'string' ? parsed.mono : '',
    };
  } catch {
    return { ...DEFAULT_FONTS };
  }
}

export function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
}

export function applyFonts(fonts: Fonts): void {
  const root = document.documentElement;
  if (fonts.read) root.style.setProperty('--font-read', fonts.read);
  else root.style.removeProperty('--font-read');
  if (fonts.mono) root.style.setProperty('--font-mono', fonts.mono);
  else root.style.removeProperty('--font-mono');
}

export function setTheme(theme: ThemeId): void {
  writeRaw(THEME_KEY, theme);
  applyTheme(theme);
}

export function setFonts(fonts: Fonts): void {
  writeRaw(FONTS_KEY, JSON.stringify(fonts));
  applyFonts(fonts);
}

/** Apply persisted appearance immediately, before React renders, to avoid a
 *  flash of the default theme. Call once from the entry point. */
export function bootstrapAppearance(): void {
  applyTheme(getTheme());
  applyFonts(getFonts());
}
