/**
 * localStorage-backed persistence: recent workspaces and the last-active one.
 * Per CLAUDE.md this is the only browser persistence — no cookies, no IndexedDB.
 * All access is guarded so a disabled/again full storage never crashes the app.
 */

const RECENTS_KEY = 'lookmd.recents';
const LAST_KEY = 'lookmd.lastWorkspace';
const MAX_RECENTS = 8;

export interface Workspace {
  /** POSIX path of the workspace root, relative to BASE ('' === BASE itself). */
  root: string;
  /** Display label. */
  name: string;
}

export interface RecentWorkspace extends Workspace {
  openedAt: number;
}

export function workspaceName(root: string): string {
  if (root === '') return 'base (workspace root)';
  const parts = root.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? root;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — degrade silently */
  }
}

export function getRecents(): RecentWorkspace[] {
  const list = read<RecentWorkspace[]>(RECENTS_KEY, []);
  return Array.isArray(list) ? list : [];
}

export function addRecent(ws: Workspace): void {
  const next: RecentWorkspace[] = [
    { ...ws, openedAt: Date.now() },
    ...getRecents().filter((r) => r.root !== ws.root),
  ].slice(0, MAX_RECENTS);
  write(RECENTS_KEY, next);
}

export function getLastWorkspace(): Workspace | null {
  return read<Workspace | null>(LAST_KEY, null);
}

export function setLastWorkspace(ws: Workspace | null): void {
  write(LAST_KEY, ws);
}
