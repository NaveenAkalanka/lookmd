/**
 * localStorage-backed persistence: recent workspaces and the last-active one.
 * This holds only JSON-able descriptors. The one non-localStorage exception is
 * the IndexedDB handle store (see sources/handles.ts), which remembers the
 * granted folder for File System Access workspaces — see CLAUDE.md.
 * All access is guarded so a disabled/full storage never crashes the app.
 */

import type { SourceKind } from './sources/types';

const RECENTS_KEY = 'lookmd.recents';
const LAST_KEY = 'lookmd.lastWorkspace';
const MAX_RECENTS = 8;

export interface Workspace {
  /** Which file source backs this workspace. */
  kind: SourceKind;
  /**
   * REST: POSIX path of the root relative to BASE ('' === BASE itself).
   * FSA: an opaque id keying the directory handle in IndexedDB.
   */
  root: string;
  /** Display label. */
  name: string;
}

/** Older records predate `kind`; treat them as REST. */
function normalize(ws: Workspace): Workspace {
  return { kind: ws.kind ?? 'rest', root: ws.root, name: ws.name };
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
  return Array.isArray(list) ? list.map((r) => ({ ...normalize(r), openedAt: r.openedAt })) : [];
}

export function addRecent(ws: Workspace): void {
  const next: RecentWorkspace[] = [
    { ...ws, openedAt: Date.now() },
    ...getRecents().filter((r) => !(r.kind === ws.kind && r.root === ws.root)),
  ].slice(0, MAX_RECENTS);
  write(RECENTS_KEY, next);
}

export function getLastWorkspace(): Workspace | null {
  const ws = read<Workspace | null>(LAST_KEY, null);
  return ws ? normalize(ws) : null;
}

export function setLastWorkspace(ws: Workspace | null): void {
  write(LAST_KEY, ws);
}

const SESSION_KEY = 'lookmd.session';

/** The editing session to restore on reload: which workspace, its open tabs,
 *  the active one, and the view mode. */
export interface Session {
  kind: SourceKind;
  root: string;
  openPaths: string[];
  activePath: string | null;
  mode: string;
}

export function getSession(): Session | null {
  const s = read<Session | null>(SESSION_KEY, null);
  if (!s || typeof s.root !== 'string' || !Array.isArray(s.openPaths)) return null;
  return { ...s, kind: s.kind ?? 'rest' };
}

export function setSession(s: Session): void {
  write(SESSION_KEY, s);
}
