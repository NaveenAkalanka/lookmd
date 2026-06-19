/**
 * Read-side filesystem operations for a workspace. Thin: every function routes
 * its path through the security helper before any I/O, then does the minimum
 * read needed and returns shared-typed data. No rendering, no business logic.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import type {
  ListFoldersResponse,
  GetTreeResponse,
  GetFileResponse,
  PutFileResponse,
  CreateFileResponse,
  DeleteFileResponse,
  MoveResponse,
  TreeNode,
  FolderEntry,
} from '@lookmd/shared';

import {
  resolveInRoot,
  assertNoSymlinkEscape,
  assertAllowedFile,
  isAllowedFile,
  isInside,
  toPosix,
} from './security/paths.ts';
import { HttpError } from './errors.ts';

/** Directories never descended into, even though they aren't dotfiles. */
const SKIP_DIRS: ReadonlySet<string> = new Set(['node_modules']);

export function hashContent(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Full validation for a file target inside a workspace (containment + type +
 * symlink), returning the resolved absolute paths. Shared by read and write. */
function resolveFile(base: string, root: string, relPath: string) {
  if (relPath.trim() === '') {
    throw new HttpError(400, 'INVALID_PATH', 'path is required');
  }
  const resolved = resolveInRoot({ base, root, relPath });
  assertNoSymlinkEscape(base, resolved.rootAbs); // workspace root truly inside BASE
  assertAllowedFile(resolved.targetAbs);
  assertNoSymlinkEscape(resolved.rootAbs, resolved.targetAbs); // file truly inside root
  return resolved;
}

/** Sort directories before files, then case-insensitively by name. */
function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** GET /api/folders — immediate sub-directories of `relPath` within BASE. */
export async function listFolders(
  base: string,
  relPath: string,
): Promise<ListFoldersResponse> {
  const { targetAbs } = resolveInRoot({ base, root: '', relPath });
  assertNoSymlinkEscape(base, targetAbs);

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(targetAbs);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', `folder not found: ${relPath || '.'}`);
  }
  if (!stat.isDirectory()) {
    throw new HttpError(400, 'INVALID_PATH', `not a folder: ${relPath}`);
  }

  const entries = await fsp.readdir(targetAbs, { withFileTypes: true });
  const folders: FolderEntry[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      // Only surface a link if it resolves to a directory inside BASE.
      try {
        const real = fs.realpathSync.native(path.join(targetAbs, entry.name));
        if (!isInside(base, real)) continue;
        isDir = fs.statSync(real).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDir) continue;
    folders.push({
      name: entry.name,
      path: toPosix(path.relative(base, path.join(targetAbs, entry.name))),
    });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const relToBase = toPosix(path.relative(base, targetAbs));
  const parent = relToBase === '' ? null : toPosix(path.dirname(relToBase) === '.' ? '' : path.dirname(relToBase));

  return { path: relToBase, parent, folders };
}

/** GET /api/tree — full file/folder tree of a workspace root, relative paths. */
export async function getTree(base: string, root: string): Promise<GetTreeResponse> {
  const { rootAbs } = resolveInRoot({ base, root, relPath: '' });
  assertNoSymlinkEscape(base, rootAbs);

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(rootAbs);
  } catch {
    throw new HttpError(404, 'NOT_FOUND', `workspace not found: ${root || '.'}`);
  }
  if (!stat.isDirectory()) {
    throw new HttpError(400, 'INVALID_PATH', `workspace is not a folder: ${root}`);
  }

  const tree = walkTree(rootAbs, rootAbs);
  return { root: toPosix(path.relative(base, rootAbs)), tree };
}

function walkTree(rootAbs: string, dirAbs: string): TreeNode[] {
  const entries = fs.readdirSync(dirAbs, { withFileTypes: true });
  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;

    const childAbs = path.join(dirAbs, entry.name);
    let isDir = entry.isDirectory();

    if (entry.isSymbolicLink()) {
      // Refuse links that resolve outside the workspace root entirely.
      let real: string;
      try {
        real = fs.realpathSync.native(childAbs);
      } catch {
        continue;
      }
      if (!isInside(rootAbs, real)) continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      try {
        isDir = fs.statSync(childAbs).isDirectory();
      } catch {
        continue;
      }
    }

    const relPosix = toPosix(path.relative(rootAbs, childAbs));
    if (isDir) {
      nodes.push({
        name: entry.name,
        path: relPosix,
        type: 'dir',
        children: walkTree(rootAbs, childAbs),
      });
    } else if (isAllowedFile(entry.name)) {
      nodes.push({ name: entry.name, path: relPosix, type: 'file' });
    }
  }
  nodes.sort(compareNodes);
  return nodes;
}

/** GET /api/file — one file's content plus a hash for conflict detection. */
export async function readFile(
  base: string,
  root: string,
  relPath: string,
): Promise<GetFileResponse> {
  const { rootAbs, targetAbs } = resolveFile(base, root, relPath);

  let buf: Buffer;
  try {
    buf = await fsp.readFile(targetAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HttpError(404, 'NOT_FOUND', `file not found: ${relPath}`);
    }
    if ((err as NodeJS.ErrnoException).code === 'EISDIR') {
      throw new HttpError(400, 'INVALID_PATH', `path is a directory: ${relPath}`);
    }
    throw err;
  }

  // utf8 round-trips CRLF/LF as ordinary characters, so line endings survive.
  return {
    path: toPosix(path.relative(rootAbs, targetAbs)),
    content: buf.toString('utf8'),
    hash: hashContent(buf),
  };
}

/**
 * PUT /api/file — hash-checked save of an existing file.
 *
 * The file must already exist (creation is POST). If its current on-disk hash
 * differs from `baseHash` — i.e. it changed under us since the client last read
 * it — we refuse with 409 and write nothing, so external edits (Obsidian, git)
 * are never silently clobbered. Content is written verbatim as UTF-8, so the
 * client controls the line endings and they are preserved.
 */
export async function writeFile(
  base: string,
  root: string,
  relPath: string,
  content: string,
  baseHash: string,
): Promise<PutFileResponse> {
  const { rootAbs, targetAbs } = resolveFile(base, root, relPath);

  let current: Buffer;
  try {
    current = await fsp.readFile(targetAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HttpError(404, 'NOT_FOUND', `file not found: ${relPath}`);
    }
    if ((err as NodeJS.ErrnoException).code === 'EISDIR') {
      throw new HttpError(400, 'INVALID_PATH', `path is a directory: ${relPath}`);
    }
    throw err;
  }

  if (hashContent(current) !== baseHash) {
    throw new HttpError(
      409,
      'CONFLICT',
      'file changed on disk since it was opened; reload before saving',
    );
  }

  const next = Buffer.from(content, 'utf8');
  await fsp.writeFile(targetAbs, next);

  return {
    path: toPosix(path.relative(rootAbs, targetAbs)),
    hash: hashContent(next),
  };
}

/** POST /api/file — create a new file (empty or from `content`). 409 if it
 *  already exists. Missing parent folders within the root are created. */
export async function createFile(
  base: string,
  root: string,
  relPath: string,
  content = '',
): Promise<CreateFileResponse> {
  const { rootAbs, targetAbs } = resolveFile(base, root, relPath);

  await fsp.mkdir(path.dirname(targetAbs), { recursive: true });
  const buf = Buffer.from(content, 'utf8');
  try {
    // 'wx' fails if the path already exists — atomic create, no clobber.
    await fsp.writeFile(targetAbs, buf, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new HttpError(409, 'ALREADY_EXISTS', `file already exists: ${relPath}`);
    }
    throw err;
  }

  return {
    path: toPosix(path.relative(rootAbs, targetAbs)),
    hash: hashContent(buf),
  };
}

/** DELETE /api/file — remove a single file. Directories are refused. */
export async function deleteFile(
  base: string,
  root: string,
  relPath: string,
): Promise<DeleteFileResponse> {
  const { rootAbs, targetAbs } = resolveFile(base, root, relPath);

  let stat: fs.Stats;
  try {
    stat = await fsp.lstat(targetAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HttpError(404, 'NOT_FOUND', `file not found: ${relPath}`);
    }
    throw err;
  }
  if (stat.isDirectory()) {
    throw new HttpError(400, 'INVALID_PATH', `cannot delete a directory: ${relPath}`);
  }

  await fsp.unlink(targetAbs);
  return { path: toPosix(path.relative(rootAbs, targetAbs)), deleted: true };
}

/** POST /api/move — rename/move a file within the same workspace root. 404 if
 *  the source is missing, 409 if the destination already exists. */
export async function moveFile(
  base: string,
  root: string,
  from: string,
  to: string,
): Promise<MoveResponse> {
  const src = resolveFile(base, root, from);
  const dst = resolveFile(base, root, to);

  let srcStat: fs.Stats;
  try {
    srcStat = await fsp.lstat(src.targetAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HttpError(404, 'NOT_FOUND', `file not found: ${from}`);
    }
    throw err;
  }
  if (srcStat.isDirectory()) {
    throw new HttpError(400, 'INVALID_PATH', `cannot move a directory: ${from}`);
  }

  // Never silently overwrite an existing destination.
  if (fs.existsSync(dst.targetAbs)) {
    throw new HttpError(409, 'ALREADY_EXISTS', `destination already exists: ${to}`);
  }

  await fsp.mkdir(path.dirname(dst.targetAbs), { recursive: true });
  await fsp.rename(src.targetAbs, dst.targetAbs);

  return {
    from: toPosix(path.relative(src.rootAbs, src.targetAbs)),
    to: toPosix(path.relative(dst.rootAbs, dst.targetAbs)),
  };
}
