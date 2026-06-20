/**
 * App shell. Holds the active workspace, the open file, and the editing loop:
 * a Read/Source/Edit toggle over one draft buffer, explicit hash-checked save,
 * 409-conflict handling, and a dirty-buffer guard. Layout is VS Code-style:
 * header + file-tree sidebar + content pane.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TreeNode, GetFileResponse } from '@lookmd/shared';
import { api, ApiRequestError } from './api';
import {
  addRecent,
  getLastWorkspace,
  setLastWorkspace,
  type Workspace,
} from './storage';
import { WorkspacePicker } from './components/WorkspacePicker';
import { FileTree } from './components/FileTree';
import { ReadView } from './components/ReadView';
import { SourceView } from './components/SourceView';
import { Editor } from './components/Editor';
import { ModeToggle, type ViewMode } from './components/ModeToggle';

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(() => getLastWorkspace());
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const [openPath, setOpenPath] = useState<string | null>(null);
  // `file` is the last-saved snapshot (content + hash). `draft` is the live
  // buffer shown in every mode; dirty === they differ.
  const [file, setFile] = useState<GetFileResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

  const [mode, setMode] = useState<ViewMode>('read');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // Bumped on a reload so the editor re-seeds its document from fresh content.
  const [reloadNonce, setReloadNonce] = useState(0);

  const dirty = file !== null && draft !== file.content;

  // Load the tree whenever the workspace changes.
  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    setTreeLoading(true);
    setTreeError(null);
    setTree([]);
    api
      .tree(workspace.root)
      .then((res) => {
        if (!cancelled) setTree(res.tree);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTreeError(err instanceof ApiRequestError ? err.message : 'failed to load workspace');
        }
      })
      .finally(() => {
        if (!cancelled) setTreeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspace]);

  // Warn on tab close / reload while there are unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const switchWorkspace = useCallback(
    (ws: Workspace | null) => {
      if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
      setOpenPath(null);
      setFile(null);
      setDraft('');
      setFileError(null);
      setConflict(false);
      setSaveError(null);
      if (ws) {
        setWorkspace(ws);
        setLastWorkspace(ws);
        addRecent(ws);
      } else {
        setWorkspace(null);
      }
    },
    [dirty],
  );

  const openFile = useCallback(
    (path: string) => {
      if (!workspace) return;
      if (path === openPath) return;
      if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
      setOpenPath(path);
      setFile(null);
      setDraft('');
      setFileError(null);
      setSaveError(null);
      setConflict(false);
      setFileLoading(true);
      api
        .file(workspace.root, path)
        .then((res) => {
          setFile(res);
          setDraft(res.content);
        })
        .catch((err: unknown) => {
          setFileError(err instanceof ApiRequestError ? err.message : 'failed to open file');
        })
        .finally(() => setFileLoading(false));
    },
    [workspace, openPath, dirty],
  );

  const save = useCallback(async () => {
    if (!workspace || !file || !openPath || saving) return;
    if (draft === file.content) return; // nothing to save
    setSaving(true);
    setSaveError(null);
    setConflict(false);
    try {
      const res = await api.save({
        root: workspace.root,
        path: openPath,
        content: draft,
        baseHash: file.hash,
      });
      setFile({ path: openPath, content: draft, hash: res.hash });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        setConflict(true);
      } else {
        setSaveError(err instanceof ApiRequestError ? err.message : 'save failed');
      }
    } finally {
      setSaving(false);
    }
  }, [workspace, file, openPath, draft, saving]);

  // Global Ctrl/Cmd-S so saving works in any mode (and never triggers the
  // browser's own save dialog).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  // Conflict resolution: discard local edits and re-read from disk.
  const discardAndReload = useCallback(async () => {
    if (!workspace || !openPath) return;
    try {
      const fresh = await api.file(workspace.root, openPath);
      setFile(fresh);
      setDraft(fresh.content);
      setConflict(false);
      setSaveError(null);
      setReloadNonce((n) => n + 1);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : 'reload failed');
    }
  }, [workspace, openPath]);

  // Conflict resolution: keep local edits and overwrite, re-reading only to get
  // the current hash so the second save passes the check.
  const overwrite = useCallback(async () => {
    if (!workspace || !openPath) return;
    setSaving(true);
    try {
      const fresh = await api.file(workspace.root, openPath);
      const res = await api.save({
        root: workspace.root,
        path: openPath,
        content: draft,
        baseHash: fresh.hash,
      });
      setFile({ path: openPath, content: draft, hash: res.hash });
      setConflict(false);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : 'overwrite failed');
    } finally {
      setSaving(false);
    }
  }, [workspace, openPath, draft]);

  const docKey = useMemo(
    () => `${workspace?.root ?? ''}::${openPath ?? ''}#${reloadNonce}`,
    [workspace, openPath, reloadNonce],
  );

  if (!workspace) {
    return <WorkspacePicker onOpen={(ws) => switchWorkspace(ws)} />;
  }

  const hasFile = openPath !== null && file !== null && !fileLoading && !fileError;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">lookmd</span>
        <span className="workspace-name" title={workspace.root || '/'}>
          {workspace.name}
        </span>
        <button className="btn" onClick={() => switchWorkspace(null)}>
          Change workspace
        </button>
      </header>

      <div className="body">
        <aside className="sidebar">
          {treeLoading && <p className="muted sidebar-empty">Loading…</p>}
          {treeError && <p className="error sidebar-empty">{treeError}</p>}
          {!treeLoading && !treeError && (
            <FileTree tree={tree} activePath={openPath} onOpenFile={openFile} />
          )}
        </aside>

        <main className="content">
          {hasFile && (
            <div className="file-bar">
              <span className="file-bar-name" title={openPath ?? undefined}>
                {openPath}
                {dirty && <span className="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes">●</span>}
              </span>
              <ModeToggle mode={mode} onChange={setMode} />
              <button
                className="btn btn-accent"
                onClick={() => void save()}
                disabled={!dirty || saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}

          {conflict && (
            <div className="banner banner-warn">
              <span>
                This file changed on disk since you opened it. Saving now would clobber
                that change.
              </span>
              <span className="banner-actions">
                <button className="btn" onClick={() => void discardAndReload()}>
                  Reload from disk
                </button>
                <button className="btn" onClick={() => void overwrite()} disabled={saving}>
                  Overwrite anyway
                </button>
              </span>
            </div>
          )}
          {saveError && <div className="banner banner-error">{saveError}</div>}

          <div className="view">
            {!openPath && <div className="placeholder">Select a file to read.</div>}
            {openPath && fileLoading && <div className="placeholder">Loading {openPath}…</div>}
            {openPath && fileError && <div className="placeholder error">{fileError}</div>}
            {hasFile && mode === 'read' && <ReadView content={draft} />}
            {hasFile && mode === 'source' && <SourceView content={draft} />}
            {hasFile && mode === 'edit' && (
              <Editor value={draft} docKey={docKey} onChange={setDraft} onSave={() => void save()} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
