/**
 * Welcome / empty state. Lets you reopen a recent workspace or browse BASE for
 * a folder to open as the active workspace. Browsing stays scoped to BASE — the
 * backend rejects anything that escapes it.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FolderEntry } from '@lookmd/shared';
import { api, ApiRequestError } from '../api';
import {
  getRecents,
  workspaceName,
  type Workspace,
  type RecentWorkspace,
} from '../storage';

interface Props {
  onOpen: (ws: Workspace) => void;
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

  return (
    <div className="picker">
      <div className="picker-card">
        <h1 className="picker-title">lookmd</h1>
        <p className="picker-subtitle">Open a folder to start reading and editing Markdown.</p>

        {recents.length > 0 && (
          <section className="picker-section">
            <h2 className="picker-heading">Recent</h2>
            <ul className="picker-list">
              {recents.map((r) => (
                <li key={r.root}>
                  <button className="picker-item" onClick={() => onOpen({ root: r.root, name: r.name })}>
                    <span className="picker-item-name">{r.name}</span>
                    <span className="picker-item-path">{r.root || '/'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="picker-section">
          <h2 className="picker-heading">Browse</h2>
          <div className="picker-breadcrumb">
            <code>/{path}</code>
            <button
              className="btn"
              disabled={parent === null || loading}
              onClick={() => parent !== null && browse(parent)}
            >
              ↑ Up
            </button>
            <button className="btn btn-accent" onClick={() => onOpen({ root: path, name: workspaceName(path) })}>
              Open this folder
            </button>
          </div>

          {error && <p className="error">{error}</p>}
          {loading && <p className="muted">Loading…</p>}
          {!loading && !error && folders.length === 0 && (
            <p className="muted">No sub-folders here. You can open this folder.</p>
          )}

          <ul className="picker-list">
            {folders.map((f) => (
              <li key={f.path}>
                <button className="picker-item" onClick={() => browse(f.path)}>
                  <span className="picker-item-name">📁 {f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
