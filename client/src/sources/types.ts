/**
 * The file-source abstraction. The app addresses files by their path relative
 * to one workspace root; *where* those bytes live is the source's business.
 *
 * Two implementations exist:
 *  - `rest`  — the Node backend over HTTP (local-first; Tailscale edit build).
 *  - `fsa`   — the browser File System Access API, so a statically-hosted build
 *              can open folders on the user's own machine with no server.
 *
 * Both honour the same contract — including the hash/409 save check — so the UI
 * (Read/Source/Edit, dirty guard, conflict banner) never knows the difference.
 */

import type {
  TreeNode,
  GetFileResponse,
  PutFileResponse,
  CreateFileResponse,
  DeleteFileResponse,
  MoveResponse,
} from '@lookmd/shared';

export type SourceKind = 'rest' | 'fsa';

/**
 * A workspace-bound file source. The root (a server-relative path for REST, a
 * directory handle for FSA) is captured at construction, so every method takes
 * only a path relative to that root.
 */
export interface FileSource {
  readonly kind: SourceKind;
  /** Full file/folder tree of the workspace, directories before files. */
  tree(): Promise<TreeNode[]>;
  /** One file's content plus a hash for conflict detection. */
  file(path: string): Promise<GetFileResponse>;
  /** Hash-checked save; rejects with a CONFLICT error if the file changed. */
  save(path: string, content: string, baseHash: string): Promise<PutFileResponse>;
  /** Create a new file (empty or from content); rejects if it already exists. */
  create(path: string, content?: string): Promise<CreateFileResponse>;
  /** Delete a single file. */
  remove(path: string): Promise<DeleteFileResponse>;
  /** Rename / move a file within the same workspace. */
  move(from: string, to: string): Promise<MoveResponse>;
  /** A URL usable as an <img> src for an asset (image) at `path`, relative to
   *  the workspace root. REST returns an endpoint URL; FSA a blob: URL. */
  assetUrl(path: string): Promise<string>;
}
