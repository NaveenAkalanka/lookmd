/**
 * FileSource backed by the browser File System Access API.
 *
 * All file I/O happens client-side against a directory handle the user granted,
 * so a statically-hosted build (no server) can edit folders on the user's own
 * machine. It mirrors the REST backend's semantics on purpose, so the UI can't
 * tell them apart:
 *   - same extension allowlist; dotfiles and node_modules skipped in the tree;
 *   - directories sorted before files, case-insensitively;
 *   - sha256 hash check on save -> CONFLICT (the dirty-guard / 409 flow);
 *   - NOT_FOUND / ALREADY_EXISTS / DISALLOWED_TYPE thrown as ApiRequestError,
 *     the same error type the REST source throws, so callers branch identically.
 *
 * Containment needs no path math here: the handle *is* the root, and segment
 * lookups reject "/" and ".." structurally, so a target can't escape it.
 *
 * Availability is Chromium-only (Chrome/Edge/Brave/Opera); `fsaSupported`
 * gates the UI so it never appears where it can't work.
 */

import type { TreeNode } from '@lookmd/shared';
import { ApiRequestError } from '../api';
import type { FileSource } from './types';

/** True only where the File System Access directory picker exists. */
export const fsaSupported =
  typeof window !== 'undefined' && 'showDirectoryPicker' in window;

type DirPicker = (options?: {
  mode?: 'read' | 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;

/** Open the native folder picker; throws AbortError if the user cancels. */
export function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  const picker = (window as unknown as { showDirectoryPicker?: DirPicker })
    .showDirectoryPicker;
  if (!picker) {
    throw new ApiRequestError(0, 'IO_ERROR', 'this browser cannot open local folders');
  }
  return picker({ mode: 'readwrite' });
}

/** Re-grant (or confirm) read/write permission. Must run in a user gesture. */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission?.(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

/** Whether read/write access is already granted — a silent query (no prompt),
 *  so it can run on page load without a user gesture. */
export async function hasPermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  return (await handle.queryPermission?.({ mode: 'readwrite' })) === 'granted';
}

// --- shared helpers ---------------------------------------------------------

/** Extensions we read or write — mirrors the server's ALLOWED_EXTENSIONS. */
const ALLOWED = /\.(md|markdown|mdown|mkd|txt|text)$/i;
/** Directories never descended into, matching the server's SKIP_DIRS. */
const SKIP_DIRS = new Set(['node_modules']);

const encoder = new TextEncoder();
// ignoreBOM keeps a leading BOM as a real character, matching Node's utf8 read.
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });

async function sha256Hex(data: BufferSource): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'NotFoundError';
}

/** Normalize FSA / DOM errors into the same ApiRequestError the UI expects. */
function mapError(e: unknown): never {
  if (e instanceof ApiRequestError) throw e;
  if (e instanceof DOMException) {
    if (e.name === 'NotFoundError') throw new ApiRequestError(404, 'NOT_FOUND', 'file not found');
    if (e.name === 'NotAllowedError') throw new ApiRequestError(403, 'IO_ERROR', 'permission denied');
    if (e.name === 'TypeMismatchError') throw new ApiRequestError(400, 'INVALID_PATH', 'expected a file, found a folder');
  }
  throw new ApiRequestError(0, 'IO_ERROR', e instanceof Error ? e.message : 'file system error');
}

function splitPath(p: string): string[] {
  const parts = p.split('/').filter((s) => s.length > 0);
  for (const seg of parts) {
    if (seg === '.' || seg === '..') {
      throw new ApiRequestError(400, 'INVALID_PATH', 'invalid path');
    }
  }
  return parts;
}

function assertAllowed(p: string): void {
  if (!ALLOWED.test(p)) {
    throw new ApiRequestError(400, 'DISALLOWED_TYPE', `file type not permitted: ${p}`);
  }
}

/** Sort directories before files, then case-insensitively by name. */
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export function createFsaSource(root: FileSystemDirectoryHandle): FileSource {
  // Blob URLs for assets, cached per path so repeated renders reuse one object
  // URL. They live until the page unloads — acceptable for a local tool.
  const assetCache = new Map<string, string>();

  /** Walk down to the directory holding `parts`, optionally creating it. */
  async function dirFor(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let cur = root;
    for (const seg of parts) {
      cur = await cur.getDirectoryHandle(seg, { create });
    }
    return cur;
  }

  /** Resolve a file path to its parent directory handle + file name. */
  function locate(p: string): { parts: string[]; name: string } {
    const parts = splitPath(p);
    const name = parts.pop();
    if (name === undefined) {
      throw new ApiRequestError(400, 'INVALID_PATH', 'path is required');
    }
    return { parts, name };
  }

  async function walk(
    dir: FileSystemDirectoryHandle,
    prefix: string,
  ): Promise<TreeNode[]> {
    const nodes: TreeNode[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (name.startsWith('.')) continue;
      const rel = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        if (SKIP_DIRS.has(name)) continue;
        nodes.push({
          name,
          path: rel,
          type: 'dir',
          children: await walk(handle, rel),
        });
      } else if (ALLOWED.test(name)) {
        nodes.push({ name, path: rel, type: 'file' });
      }
    }
    nodes.sort(compareNodes);
    return nodes;
  }

  return {
    kind: 'fsa',

    async tree() {
      try {
        return await walk(root, '');
      } catch (e) {
        mapError(e);
      }
    },

    async file(path) {
      assertAllowed(path);
      const { parts, name } = locate(path);
      try {
        const dir = await dirFor(parts, false);
        const fh = await dir.getFileHandle(name, { create: false });
        const buf = await (await fh.getFile()).arrayBuffer();
        return { path, content: decoder.decode(buf), hash: await sha256Hex(buf) };
      } catch (e) {
        mapError(e);
      }
    },

    async save(path, content, baseHash) {
      assertAllowed(path);
      const { parts, name } = locate(path);
      try {
        const dir = await dirFor(parts, false);
        const fh = await dir.getFileHandle(name, { create: false });
        const current = await (await fh.getFile()).arrayBuffer();
        if ((await sha256Hex(current)) !== baseHash) {
          throw new ApiRequestError(
            409,
            'CONFLICT',
            'file changed on disk since it was opened; reload before saving',
          );
        }
        const bytes = encoder.encode(content);
        const writable = await fh.createWritable();
        await writable.write(bytes);
        await writable.close();
        return { path, hash: await sha256Hex(bytes) };
      } catch (e) {
        mapError(e);
      }
    },

    async create(path, content = '') {
      assertAllowed(path);
      const { parts, name } = locate(path);
      try {
        const dir = await dirFor(parts, true);
        let exists = true;
        try {
          await dir.getFileHandle(name, { create: false });
        } catch (e) {
          if (isNotFound(e)) exists = false;
          else throw e;
        }
        if (exists) {
          throw new ApiRequestError(409, 'ALREADY_EXISTS', `file already exists: ${path}`);
        }
        const fh = await dir.getFileHandle(name, { create: true });
        const bytes = encoder.encode(content);
        const writable = await fh.createWritable();
        await writable.write(bytes);
        await writable.close();
        return { path, hash: await sha256Hex(bytes) };
      } catch (e) {
        mapError(e);
      }
    },

    async remove(path) {
      assertAllowed(path);
      const { parts, name } = locate(path);
      try {
        const dir = await dirFor(parts, false);
        // getFileHandle 404s if missing and rejects a directory (TypeMismatch).
        await dir.getFileHandle(name, { create: false });
        await dir.removeEntry(name);
        return { path, deleted: true };
      } catch (e) {
        mapError(e);
      }
    },

    async move(from, to) {
      assertAllowed(from);
      assertAllowed(to);
      const src = locate(from);
      const dst = locate(to);
      try {
        const srcDir = await dirFor(src.parts, false);
        const srcFh = await srcDir.getFileHandle(src.name, { create: false });
        const bytes = await (await srcFh.getFile()).arrayBuffer();

        const dstDir = await dirFor(dst.parts, true);
        let destExists = true;
        try {
          await dstDir.getFileHandle(dst.name, { create: false });
        } catch (e) {
          if (isNotFound(e)) destExists = false;
          else throw e;
        }
        if (destExists) {
          throw new ApiRequestError(409, 'ALREADY_EXISTS', `destination already exists: ${to}`);
        }

        const dstFh = await dstDir.getFileHandle(dst.name, { create: true });
        const writable = await dstFh.createWritable();
        await writable.write(bytes);
        await writable.close();
        await srcDir.removeEntry(src.name);
        return { from, to };
      } catch (e) {
        mapError(e);
      }
    },

    async assetUrl(path) {
      const cached = assetCache.get(path);
      if (cached) return cached;
      const { parts, name } = locate(path);
      try {
        const dir = await dirFor(parts, false);
        const fh = await dir.getFileHandle(name, { create: false });
        const url = URL.createObjectURL(await fh.getFile());
        assetCache.set(path, url);
        return url;
      } catch (e) {
        mapError(e);
      }
    },
  };
}
