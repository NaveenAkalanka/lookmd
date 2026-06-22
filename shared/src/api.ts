/**
 * Shared API request/response types for lookmd.
 *
 * Imported by both the client and the server so the contract has exactly one
 * source of truth. These mirror the endpoints described in CLAUDE.md.
 *
 * Path conventions over the wire:
 *  - `root` is a POSIX-style path relative to the server BASE directory
 *    (empty string means the BASE itself).
 *  - `path` / `from` / `to` are POSIX-style paths relative to the workspace
 *    `root`. The server translates these to native paths and re-validates
 *    containment on every call.
 */

/** A POSIX-style relative path as sent over the wire. */
export type RelPath = string;

/** Content hash returned with a file so saves can detect external edits. */
export type FileHash = string;

// --- GET /api/folders --------------------------------------------------------
// Lists immediate sub-directories of `path` (relative to BASE) for the
// workspace picker.

export interface ListFoldersQuery {
  /** Directory to list, relative to BASE. Empty/absent means BASE itself. */
  path?: RelPath;
}

export interface FolderEntry {
  name: string;
  /** POSIX path relative to BASE. */
  path: RelPath;
}

export interface ListFoldersResponse {
  /** The directory that was listed, relative to BASE. */
  path: RelPath;
  /** Parent directory relative to BASE, or null when at BASE. */
  parent: RelPath | null;
  folders: FolderEntry[];
}

// --- GET /api/tree -----------------------------------------------------------
// Full file/folder tree for a workspace, as relative paths.

export interface GetTreeQuery {
  /** Workspace root, relative to BASE. */
  root: RelPath;
}

export interface TreeNode {
  name: string;
  /** POSIX path relative to the workspace root. */
  path: RelPath;
  type: 'file' | 'dir';
  /** Present only for directories. */
  children?: TreeNode[];
}

export interface GetTreeResponse {
  root: RelPath;
  tree: TreeNode[];
}

// --- GET /api/file -----------------------------------------------------------

export interface GetFileQuery {
  root: RelPath;
  path: RelPath;
}

export interface GetFileResponse {
  path: RelPath;
  content: string;
  hash: FileHash;
}

// --- PUT /api/file -----------------------------------------------------------
// Hash-checked save. If the on-disk hash differs from `baseHash`, the server
// returns 409 and does not write.

export interface PutFileRequest {
  root: RelPath;
  path: RelPath;
  content: string;
  /** Hash the client last read; guards against silent overwrite. */
  baseHash: FileHash;
}

export interface PutFileResponse {
  path: RelPath;
  hash: FileHash;
}

// --- POST /api/file ----------------------------------------------------------
// Create a new file, empty or from a template.

export interface CreateFileRequest {
  root: RelPath;
  path: RelPath;
  /** Initial content; defaults to empty. */
  content?: string;
}

export interface CreateFileResponse {
  path: RelPath;
  hash: FileHash;
}

// --- POST /api/folder --------------------------------------------------------
// Create a new (empty) directory within the workspace root. 409 if it exists.

export interface CreateFolderRequest {
  root: RelPath;
  path: RelPath;
}

export interface CreateFolderResponse {
  path: RelPath;
  created: true;
}

// --- DELETE /api/file --------------------------------------------------------

export interface DeleteFileRequest {
  root: RelPath;
  path: RelPath;
}

export interface DeleteFileResponse {
  path: RelPath;
  deleted: true;
}

// --- POST /api/move ----------------------------------------------------------
// Rename / move within the same workspace root.

export interface MoveRequest {
  root: RelPath;
  from: RelPath;
  to: RelPath;
}

export interface MoveResponse {
  from: RelPath;
  to: RelPath;
}

// --- Errors ------------------------------------------------------------------

/** Stable error codes the client can branch on. */
export type ApiErrorCode =
  | 'INVALID_PATH'
  | 'OUTSIDE_ROOT'
  | 'OUTSIDE_BASE'
  | 'DISALLOWED_TYPE'
  | 'SYMLINK_ESCAPE'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'ALREADY_EXISTS'
  | 'IO_ERROR';

export interface ApiError {
  error: string;
  code: ApiErrorCode;
}
