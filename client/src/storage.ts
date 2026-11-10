/**
 * localStorage-backed persistence: recent workspaces, the last-active one, and
 * one saved editing session per workspace. This holds only JSON-able
 * descriptors. The one non-localStorage exception is the IndexedDB handle store
 * (see sources/handles.ts), which remembers the granted folder for File System
 * Access workspaces — see CLAUDE.md.
 *
 * Each browser tab carries its own workspace in the URL (`?ws=<kind>:<root>`),
 * so several tabs can hold different workspaces and each reloads into its own.
 * `lastWorkspace` is only the default for a tab opened without one.
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

/** Drop one entry from the recent list (matched by source kind + root). Returns
 *  the updated list. The FSA handle in IndexedDB, if any, is the caller's to
 *  remove — storage.ts only owns the localStorage record. */
export function removeRecent(kind: SourceKind, root: string): RecentWorkspace[] {
  const next = getRecents().filter((r) => !(r.kind === kind && r.root === root));
  write(RECENTS_KEY, next);
  removeSession(kind, root);
  return next;
}

/** Clear the entire recent-workspace history and every saved session
 *  (localStorage records only). */
export function clearRecents(): void {
  write(RECENTS_KEY, []);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === LEGACY_SESSION_KEY || k.startsWith(SESSION_PREFIX))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}

export function getLastWorkspace(): Workspace | null {
  const ws = read<Workspace | null>(LAST_KEY, null);
  return ws ? normalize(ws) : null;
}

export function setLastWorkspace(ws: Workspace | null): void {
  write(LAST_KEY, ws);
}

/** A workspace's identity: source kind + root. */
export type WorkspaceRef = Pick<Workspace, 'kind' | 'root'>;

const WS_PARAM = 'ws';
const KINDS: readonly SourceKind[] = ['rest', 'fsa'];

/** Read the tab's workspace from a URL query string (`?ws=rest:notes`).
 *  REST may have an empty root (BASE itself); an FSA id may not. */
export function workspaceFromSearch(search: string): WorkspaceRef | null {
  const raw = new URLSearchParams(search).get(WS_PARAM);
  if (raw === null) return null;
  const sep = raw.indexOf(':');
  if (sep === -1) return null;
  const kind = raw.slice(0, sep) as SourceKind;
  const root = raw.slice(sep + 1);
  if (!KINDS.includes(kind)) return null;
  if (kind === 'fsa' && root === '') return null;
  return { kind, root };
}

/** Return `search` with the workspace param set (or removed for null), other
 *  params kept. `:` and `/` stay unescaped so the address bar is readable. */
export function searchWithWorkspace(search: string, ws: WorkspaceRef | null): string {
  const params = new URLSearchParams(search);
  if (ws) params.set(WS_PARAM, `${ws.kind}:${ws.root}`);
  else params.delete(WS_PARAM);
  const q = params.toString().replace(/%3A/gi, ':').replace(/%2F/gi, '/');
  return q ? `?${q}` : '';
}

/** Before sessions were per workspace there was one global record. */
const LEGACY_SESSION_KEY = 'lookmd.session';
const SESSION_PREFIX = 'lookmd.session:';

function sessionKey(kind: SourceKind, root: string): string {
  return `${SESSION_PREFIX}${kind}:${root}`;
}

/** A workspace's editing session to restore: its open tabs, the active one,
 *  the view mode, and whether Edit was on. Records from before the Edit toggle
 *  have no `edit` and may carry the old `mode: 'edit'` (raw editor). */
export interface Session {
  kind: SourceKind;
  root: string;
  openPaths: string[];
  activePath: string | null;
  mode: string;
  edit?: boolean;
}

function validSession(s: Session | null): Session | null {
  if (!s || typeof s.root !== 'string' || !Array.isArray(s.openPaths)) return null;
  return { ...s, kind: s.kind ?? 'rest' };
}

/** The saved session for one workspace. Falls back to the old single record
 *  when it belongs to this workspace, so an upgrade keeps your open tabs. */
export function getSession(kind: SourceKind, root: string): Session | null {
  const own = validSession(read<Session | null>(sessionKey(kind, root), null));
  if (own) return own;
  const legacy = validSession(read<Session | null>(LEGACY_SESSION_KEY, null));
  return legacy && legacy.kind === kind && legacy.root === root ? legacy : null;
}

export function setSession(s: Session): void {
  write(sessionKey(s.kind, s.root), s);
}

function removeSession(kind: SourceKind, root: string): void {
  try {
    localStorage.removeItem(sessionKey(kind, root));
    const legacy = validSession(read<Session | null>(LEGACY_SESSION_KEY, null));
    if (legacy && legacy.kind === kind && legacy.root === root) localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}
