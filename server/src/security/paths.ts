/**
 * Path containment + safety for lookmd.
 *
 * The single trust boundary of the server. Every file-touching request flows
 * through here before any I/O. The rules (from CLAUDE.md):
 *
 *   - Resolve BASE, the workspace root, and the joined target to canonical
 *     ABSOLUTE paths, then verify  target ⊆ root ⊆ base.
 *   - Containment is checked with `path.relative`, never a naive string
 *     `startsWith` on un-normalized paths.
 *   - Wire paths are POSIX-relative; they are translated to native here.
 *   - Reject symlinks that resolve outside the root.
 *   - Operate only on an allowlist of Markdown / plain-text extensions.
 *
 * The lexical checks (`resolveInRoot`) touch no filesystem and are pure, so
 * they are exhaustively unit-testable. The symlink check needs the real
 * filesystem and is kept separate.
 */

import path from 'node:path';
import fs from 'node:fs';

/** Extensions the server is willing to read or write. */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  '.md',
  '.markdown',
  '.mdown',
  '.mkd',
  '.txt',
  '.text',
]);

export type PathErrorCode =
  | 'INVALID_PATH'
  | 'OUTSIDE_BASE'
  | 'OUTSIDE_ROOT'
  | 'DISALLOWED_TYPE'
  | 'SYMLINK_ESCAPE';

export class PathValidationError extends Error {
  readonly code: PathErrorCode;
  constructor(code: PathErrorCode, message: string) {
    super(message);
    this.name = 'PathValidationError';
    this.code = code;
  }
}

// --- Wire <-> native translation --------------------------------------------

/** Convert a POSIX wire path to a native relative path. */
export function fromPosix(rel: string): string {
  return rel.split('/').join(path.sep);
}

/** Convert a native path to a POSIX wire path. */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Reject wire paths that are not plain, relative, POSIX strings before they
 * ever reach `path.resolve`. This stops absolute paths, drive letters, null
 * bytes, and backslash separators — each of which can defeat containment on
 * one platform or another.
 */
function assertValidWirePath(rel: string, label: string): void {
  if (typeof rel !== 'string') {
    throw new PathValidationError('INVALID_PATH', `${label} must be a string`);
  }
  if (rel.includes('\0')) {
    throw new PathValidationError('INVALID_PATH', `${label} contains a null byte`);
  }
  if (rel.includes('\\')) {
    throw new PathValidationError(
      'INVALID_PATH',
      `${label} must use POSIX "/" separators`,
    );
  }
  if (rel.startsWith('/')) {
    throw new PathValidationError('INVALID_PATH', `${label} must be relative`);
  }
  if (/^[a-zA-Z]:/.test(rel)) {
    throw new PathValidationError(
      'INVALID_PATH',
      `${label} must not contain a drive letter`,
    );
  }
}

// --- Containment ------------------------------------------------------------

/**
 * True when `childAbs` is `parentAbs` itself or lives beneath it. Both must be
 * absolute. Uses `path.relative`, which is separator- and case-aware per
 * platform — far safer than string prefix matching.
 */
export function isInside(parentAbs: string, childAbs: string): boolean {
  const rel = path.relative(parentAbs, childAbs);
  if (rel === '') return true; // same path
  if (rel === '..') return false;
  if (rel.startsWith('..' + path.sep)) return false;
  if (path.isAbsolute(rel)) return false; // different drive on Windows
  return true;
}

export interface ResolveOptions {
  /** The server BASE directory (may be relative; resolved against cwd). */
  base: string;
  /** Workspace root, POSIX-relative to BASE. Empty means BASE itself. */
  root: string;
  /** Target, POSIX-relative to the workspace root. Empty means the root. */
  relPath: string;
}

export interface Resolved {
  baseAbs: string;
  rootAbs: string;
  targetAbs: string;
}

/**
 * Lexically resolve and validate  target ⊆ root ⊆ base. No filesystem access.
 * Throws `PathValidationError` on any containment or format violation.
 */
export function resolveInRoot(opts: ResolveOptions): Resolved {
  const baseAbs = path.resolve(opts.base);

  const rootRel = opts.root ?? '';
  if (rootRel !== '') assertValidWirePath(rootRel, 'root');
  const rootAbs = path.resolve(baseAbs, fromPosix(rootRel));
  if (!isInside(baseAbs, rootAbs)) {
    throw new PathValidationError(
      'OUTSIDE_BASE',
      'workspace root escapes the base directory',
    );
  }

  const relPath = opts.relPath ?? '';
  if (relPath !== '') assertValidWirePath(relPath, 'path');
  const targetAbs = path.resolve(rootAbs, fromPosix(relPath));
  if (!isInside(rootAbs, targetAbs)) {
    throw new PathValidationError(
      'OUTSIDE_ROOT',
      'target escapes the workspace root',
    );
  }

  return { baseAbs, rootAbs, targetAbs };
}

// --- File-type allowlist -----------------------------------------------------

export function isAllowedFile(p: string): boolean {
  return ALLOWED_EXTENSIONS.has(path.extname(p).toLowerCase());
}

export function assertAllowedFile(p: string): void {
  if (!isAllowedFile(p)) {
    throw new PathValidationError(
      'DISALLOWED_TYPE',
      `file type not permitted: ${path.basename(p)}`,
    );
  }
}

/** Image types the server will serve read-only (for inline rendering). */
export const ALLOWED_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.avif',
  '.bmp',
  '.ico',
]);

export function isAllowedImage(p: string): boolean {
  return ALLOWED_IMAGE_EXTENSIONS.has(path.extname(p).toLowerCase());
}

export function assertAllowedImage(p: string): void {
  if (!isAllowedImage(p)) {
    throw new PathValidationError(
      'DISALLOWED_TYPE',
      `image type not permitted: ${path.basename(p)}`,
    );
  }
}

// --- Symlink containment (filesystem) ---------------------------------------

/**
 * Walk up from `p` to the deepest ancestor that exists on disk. Used so the
 * symlink check works for not-yet-created targets (create/move destinations):
 * we canonicalize the nearest real directory instead.
 */
function deepestExisting(p: string): string {
  let cur = path.resolve(p);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return cur; // reached a filesystem root
    cur = parent;
  }
}

/**
 * Defend against symlinks (or junctions) that point outside the workspace.
 * Canonicalizes both the root and the deepest existing part of the target via
 * `realpath`, then re-checks containment on the real paths. The root must
 * exist. Throws `SYMLINK_ESCAPE` if the real target leaves the real root.
 */
export function assertNoSymlinkEscape(rootAbs: string, targetAbs: string): void {
  let realRoot: string;
  try {
    realRoot = fs.realpathSync.native(rootAbs);
  } catch {
    throw new PathValidationError(
      'SYMLINK_ESCAPE',
      'workspace root could not be resolved',
    );
  }

  const realTarget = fs.realpathSync.native(deepestExisting(targetAbs));
  if (!isInside(realRoot, realTarget)) {
    throw new PathValidationError(
      'SYMLINK_ESCAPE',
      'target resolves outside the workspace root via a link',
    );
  }
}

// --- Composed guard ----------------------------------------------------------

/**
 * Full validation for a file target: lexical containment, extension allowlist,
 * and (by default) symlink containment. Returns the resolved absolute paths.
 *
 * Pass `checkSymlinks: false` only when the filesystem is intentionally not
 * consulted (e.g. pure path math in tests).
 */
export function validateFileTarget(
  opts: ResolveOptions,
  checkSymlinks = true,
): Resolved {
  const resolved = resolveInRoot(opts);
  assertAllowedFile(resolved.targetAbs);
  if (checkSymlinks) assertNoSymlinkEscape(resolved.rootAbs, resolved.targetAbs);
  return resolved;
}
