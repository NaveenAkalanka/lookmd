/**
 * Welcome / empty state. Three ways in:
 *  - reopen a recent workspace (REST path or a remembered local folder);
 *  - browse the server BASE for a folder (REST; scoped to BASE by the backend);
 *  - open a local folder directly via the File System Access API (no server),
 *    shown only where the browser supports it.
 *
 * The picker builds the matching FileSource and hands it to `onOpen`, so the app
 * shell stays agnostic about where a workspace's bytes come from.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FolderEntry } from '@lookmd/shared';
import { api, ApiRequestError } from '../api';
import { createRestSource } from '../sources/rest';
import {
  createFsaSource,
  fsaSupported,
  pickDirectory,
  ensurePermission,
} from '../sources/fsa';
import { getHandle, putHandle } from '../sources/handles';
import type { FileSource } from '../sources/types';
import {
  getRecents,
  workspaceName,
  type Workspace,
  type RecentWorkspace,
} from '../storage';
import { Icon } from './Icon';
import { Folder01Icon, ComputerIcon, ArrowUp01Icon } from '@hugeicons/core-free-icons';

interface Props {
  onOpen: (ws: Workspace, source: FileSource) => void;
}

export function WorkspacePicker({ onOpen }: Props) {
  const [recents] = useState<RecentWorkspace[]>(() => getRecents());
  const [path, setPath] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const browse = useCallback((to: string) => {
    setLoading(true);
    setError(null);
    api
      .folders(to)
      .then((res) => {
        setPath(res.path);
        setParent(res.parent);
        setFolders(res.folders);
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiRequestError ? err.message : 'failed to list folders');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    browse('');
  }, [browse]);

  // Reopen a recent: rebuild the right source. FSA needs its handle back from
  // IndexedDB plus a (re-)granted permission, which the click gesture allows.
  const openRecent = useCallback(
    async (r: RecentWorkspace) => {
      setError(null);
      if (r.kind === 'fsa') {
        try {
          const rec = await getHandle(r.root);
          if (!rec) {
            setError('That local folder is no longer remembered — open it again below.');
            return;
          }
          if (!(await ensurePermission(rec.handle))) {
            setError('Permission to that folder was denied.');
            return;
          }
          onOpen({ kind: 'fsa', root: r.root, name: r.name }, createFsaSource(rec.handle));
        } catch {
          setError('Could not reopen that local folder.');
        }
      } else {
        onOpen({ kind: 'rest', root: r.root, name: r.name }, createRestSource(r.root));
      }
    },
    [onOpen],
  );

  const openLocal = useCallback(async () => {
    setError(null);
    try {
      const handle = await pickDirectory();
      const id = crypto.randomUUID();
      await putHandle({ id, name: handle.name, handle });
      onOpen({ kind: 'fsa', root: id, name: handle.name }, createFsaSource(handle));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return; // cancelled
      setError(err instanceof ApiRequestError ? err.message : 'Could not open the folder.');
    }
  }, [onOpen]);

  const openRestFolder = useCallback(() => {
    onOpen({ kind: 'rest', root: path, name: workspaceName(path) }, createRestSource(path));
  }, [onOpen, path]);

  return (
    <div className="picker">
      <div className="picker-card">
        <h1 className="picker-title">lookmd</h1>
        <p className="picker-subtitle">Open a folder to start reading and editing Markdown.</p>

        {error && <p className="error">{error}</p>}

        {fsaSupported && (
          <section className="picker-section">
            <h2 className="picker-heading">This computer</h2>
            <button className="btn btn-accent" onClick={() => void openLocal()}>
              Open a local folder…
            </button>
            <p className="picker-hint muted">
              Opens a folder on this device directly in the browser — works even when
              lookmd is hosted elsewhere. (Chromium browsers only.)
            </p>
          </section>
        )}

        {recents.length > 0 && (
          <section className="picker-section">
            <h2 className="picker-heading">Recent</h2>
            <ul className="picker-list">
              {recents.map((r) => (
                <li key={`${r.kind}:${r.root}`}>
                  <button className="picker-item" onClick={() => void openRecent(r)}>
                    <span className="picker-item-name">
                      {r.kind === 'fsa' && <Icon icon={ComputerIcon} size={16} />}
                      {r.name}
                    </span>
                    <span className="picker-item-path">
                      {r.kind === 'fsa' ? 'local folder' : r.root || '/'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="picker-section">
          <h2 className="picker-heading">Browse the server</h2>
          <div className="picker-breadcrumb">
            <code>/{path}</code>
            <button
              className="btn"
              disabled={parent === null || loading}
              onClick={() => parent !== null && browse(parent)}
            >
              <Icon icon={ArrowUp01Icon} size={15} /> Up
            </button>
            <button className="btn btn-accent" onClick={openRestFolder}>
              Open this folder
            </button>
          </div>

          {loading && <p className="muted">Loading…</p>}
          {!loading && folders.length === 0 && (
            <p className="muted">No sub-folders here. You can open this folder.</p>
          )}

          <ul className="picker-list">
            {folders.map((f) => (
              <li key={f.path}>
                <button className="picker-item" onClick={() => browse(f.path)}>
                  <span className="picker-item-name">
                    <Icon icon={Folder01Icon} size={16} /> {f.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
