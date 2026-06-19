/**
 * App shell. Holds the active workspace and the open file, loads the tree, and
 * lays out the VS Code-style chrome: header + file-tree sidebar + content pane.
 * Day 1 scope: Read mode only. Source/Edit and tabs come on Day 2.
 */

import { useCallback, useEffect, useState } from 'react';
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

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(() => getLastWorkspace());
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);

  const [openPath, setOpenPath] = useState<string | null>(null);
  const [file, setFile] = useState<GetFileResponse | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);

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

  const chooseWorkspace = useCallback((ws: Workspace) => {
    setOpenPath(null);
    setFile(null);
    setFileError(null);
    setWorkspace(ws);
    setLastWorkspace(ws);
    addRecent(ws);
  }, []);

  const openFile = useCallback(
    (path: string) => {
      if (!workspace) return;
      setOpenPath(path);
      setFile(null);
      setFileError(null);
      setFileLoading(true);
      api
        .file(workspace.root, path)
        .then((res) => setFile(res))
        .catch((err: unknown) => {
          setFileError(err instanceof ApiRequestError ? err.message : 'failed to open file');
        })
        .finally(() => setFileLoading(false));
    },
    [workspace],
  );

  if (!workspace) {
    return <WorkspacePicker onOpen={chooseWorkspace} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">lookmd</span>
        <span className="workspace-name" title={workspace.root || '/'}>
          {workspace.name}
        </span>
        <button className="btn" onClick={() => setWorkspace(null)}>
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
          {!openPath && <div className="placeholder">Select a file to read.</div>}
          {openPath && fileLoading && <div className="placeholder">Loading {openPath}…</div>}
          {openPath && fileError && <div className="placeholder error">{fileError}</div>}
          {openPath && file && !fileLoading && !fileError && <ReadView content={file.content} />}
        </main>
      </div>
    </div>
  );
}
