/**
 * Appearance settings: theme + reading/mono fonts, persisted to localStorage
 * (the only browser storage, per CLAUDE.md) and applied to the document root.
 *
 * A theme is just a token-value set selected via `data-theme`. Fonts are applied
 * as inline overrides of `--font-read` / `--font-mono`; an empty value removes
 * the override so the active theme's default font shows through.
 */

import {
  FILE_TYPE_GROUPS,
  DEFAULT_FILE_TYPE_IDS,
  extensionOf,
  type TreeNode,
} from '@lookmd/shared';

const THEME_KEY = 'lookmd.theme';
const FONTS_KEY = 'lookmd.fonts';
const SIDEBAR_KEY = 'lookmd.sidebar';
const SIDEBAR_WIDTH_KEY = 'lookmd.sidebarWidth';
const LINE_NUMBERS_KEY = 'lookmd.lineNumbers';
const ZOOM_KEY = 'lookmd.zoom';
const FILETYPES_KEY = 'lookmd.fileTypes';

export type ThemeId =
  | 'paper'
  | 'daylight'
  | 'slate'
  | 'sanctum'
  | 'nord'
  | 'mocha'
  | 'latte'
  | 'tokyo-night'
  | 'gruvbox'
  | 'rose-pine'
  | 'solarized'
  | 'dracula'
  | 'midnight'
  | 'forest'
  | 'obsidian'
  | 'amber'
  | 'espresso'
  | 'cyberpunk';

export const THEMES: { id: ThemeId; label: string; light?: boolean }[] = [
  // — Light —
  { id: 'paper', label: 'Paper', light: true },
  { id: 'daylight', label: 'Daylight', light: true },
  { id: 'latte', label: 'Latte', light: true },
  { id: 'solarized', label: 'Solarized', light: true },
  // — Dark —
  { id: 'slate', label: 'Slate' },
  { id: 'nord', label: 'Nord' },
  { id: 'mocha', label: 'Mocha' },
  { id: 'tokyo-night', label: 'Tokyo Night' },
  { id: 'dracula', label: 'Dracula' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'rose-pine', label: 'Rosé Pine' },
  { id: 'gruvbox', label: 'Gruvbox' },
  { id: 'obsidian', label: 'Obsidian' },
  { id: 'sanctum', label: 'Sanctum' },
  { id: 'forest', label: 'Forest' },
  { id: 'amber', label: 'Amber' },
  { id: 'espresso', label: 'Espresso' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
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

/** Content zoom — a unitless multiplier on the Read/Source/Editor font sizes. */
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.4;
export const ZOOM_STEP = 0.1;
export const DEFAULT_ZOOM = 1;

export function clampZoom(z: number): number {
  // Round to one decimal so repeated stepping doesn't accrue float drift.
  const r = Math.round(z * 10) / 10;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, r));
}

export function getZoom(): number {
  const n = parseFloat(readRaw(ZOOM_KEY) ?? '');
  return Number.isFinite(n) ? clampZoom(n) : DEFAULT_ZOOM;
}

export function setZoom(z: number): void {
  writeRaw(ZOOM_KEY, String(clampZoom(z)));
}

/**
 * File-type display preference: the set of group ids whose files appear in the
 * tree. Markdown is always included. The server still serves every allowed text
 * type — this only governs what the client *shows*.
 */
export function getFileTypes(): string[] {
  const raw = readRaw(FILETYPES_KEY);
  if (!raw) return [...DEFAULT_FILE_TYPE_IDS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const ids = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    const valid = ids.filter((id) => FILE_TYPE_GROUPS.some((g) => g.id === id));
    return Array.from(new Set(['markdown', ...valid]));
  } catch {
    return [...DEFAULT_FILE_TYPE_IDS];
  }
}

export function setFileTypes(ids: string[]): void {
  const valid = ids.filter((id) => FILE_TYPE_GROUPS.some((g) => g.id === id));
  writeRaw(FILETYPES_KEY, JSON.stringify(Array.from(new Set(['markdown', ...valid]))));
}

/** Flatten enabled group ids to the concrete set of visible extensions. */
export function enabledExtensions(ids: string[]): Set<string> {
  const set = new Set<string>();
  for (const g of FILE_TYPE_GROUPS) {
    if (g.always || ids.includes(g.id)) g.extensions.forEach((e) => set.add(e));
  }
  return set;
}

/** Prune a tree to files whose extension is enabled, dropping now-empty dirs. */
export function filterTreeByFileTypes(nodes: TreeNode[], exts: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    if (n.type === 'dir') {
      const children = filterTreeByFileTypes(n.children ?? [], exts);
      if (children.length) out.push({ ...n, children });
    } else if (exts.has(extensionOf(n.name))) {
      out.push(n);
    }
  }
  return out;
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
