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
const SIDEBAR_KEY = 'lookmd.sidebar';
const SIDEBAR_WIDTH_KEY = 'lookmd.sidebarWidth';
const LINE_NUMBERS_KEY = 'lookmd.lineNumbers';

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

export interface SidebarPref {
  /** Manual collapse state, used when not auto-hiding. */
  collapsed: boolean;
  /** When true the sidebar floats as an overlay, revealed on hover at the edge
   *  and hidden again after you open a file. */
  autoHide: boolean;
}

export const DEFAULT_SIDEBAR: SidebarPref = { collapsed: false, autoHide: false };

/** Sidebar width is drag-resizable; the value is clamped to this range. */
export const SIDEBAR_WIDTH_MIN = 200;
export const SIDEBAR_WIDTH_MAX = 520;
export const DEFAULT_SIDEBAR_WIDTH = 260;

function clampWidth(px: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)));
}

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

export function getSidebar(): SidebarPref {
  const raw = readRaw(SIDEBAR_KEY);
  if (!raw) return { ...DEFAULT_SIDEBAR };
  try {
    const parsed = JSON.parse(raw) as Partial<SidebarPref>;
    return {
      collapsed: typeof parsed.collapsed === 'boolean' ? parsed.collapsed : false,
      autoHide: typeof parsed.autoHide === 'boolean' ? parsed.autoHide : false,
    };
  } catch {
    return { ...DEFAULT_SIDEBAR };
  }
}

export function setSidebar(pref: SidebarPref): void {
  writeRaw(SIDEBAR_KEY, JSON.stringify(pref));
}

export function getSidebarWidth(): number {
  const n = parseInt(readRaw(SIDEBAR_WIDTH_KEY) ?? '', 10);
  return Number.isFinite(n) ? clampWidth(n) : DEFAULT_SIDEBAR_WIDTH;
}

export function setSidebarWidth(px: number): void {
  writeRaw(SIDEBAR_WIDTH_KEY, String(clampWidth(px)));
}

/** Show line numbers in Source mode and the editor gutter. Defaults on. */
export function getLineNumbers(): boolean {
  return readRaw(LINE_NUMBERS_KEY) !== '0';
}

export function setLineNumbers(on: boolean): void {
  writeRaw(LINE_NUMBERS_KEY, on ? '1' : '0');
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
