/**
 * App shell. Holds the active workspace, the open file, and the editing loop:
 * a Read/Source/Edit toggle over one draft buffer, explicit hash-checked save,
 * 409-conflict handling, and a dirty-buffer guard. Layout is VS Code-style:
 * header + file-tree sidebar + content pane.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { TreeNode, GetFileResponse } from '@lookmd/shared';
import { ApiRequestError } from './api';
import { createRestSource } from './sources/rest';
import type { FileSource } from './sources/types';
import {
  addRecent,
  getLastWorkspace,
  setLastWorkspace,
  type Workspace,
} from './storage';
import { WorkspacePicker } from './components/WorkspacePicker';
import { FileTree } from './components/FileTree';
// The view components carry the heavy rendering/highlighting stacks
// (react-markdown, highlight.js, CodeMirror). The first screen is just the
// picker, so load them only once a file is actually open.
const ReadView = lazy(() =>
  import('./components/ReadView').then((m) => ({ default: m.ReadView })),
);
const SourceView = lazy(() =>
  import('./components/SourceView').then((m) => ({ default: m.SourceView })),
);
const Editor = lazy(() =>
  import('./components/Editor').then((m) => ({ default: m.Editor })),
);
import { ModeToggle, type ViewMode } from './components/ModeToggle';
import { SettingsPanel } from './components/SettingsPanel';
import {
  getTheme,
  getFonts,
  getSidebar,
  setTheme as persistTheme,
  setFonts as persistFonts,
  setSidebar as persistSidebar,
  type ThemeId,
  type Fonts,
  type SidebarPref,
} from './settings';

/** Default a bare name to `.md` so it passes the backend's text allowlist. */
function ensureTextExt(name: string): string {
  if (name === '') return '';
  return /\.(md|markdown|mdown|mkd|txt|text)$/i.test(name) ? name : `${name}.md`;
}

export function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(() => {
    const last = getLastWorkspace();
    // FSA workspaces need a user gesture to re-grant permission, so they can't
    // be auto-restored — only reopen REST ones; FSA recents wait in the picker.
    return last && last.kind === 'rest' ? last : null;
  });
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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

  // Appearance (already applied to the DOM at bootstrap; mirror it in state).
  const [theme, setTheme] = useState<ThemeId>(() => getTheme());
  const [fonts, setFonts] = useState<Fonts>(() => getFonts());
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Sidebar: a persisted pref (manual collapse + auto-hide) plus a transient
  // `peek` for the hover-reveal used in auto-hide mode.
  const [sidebar, setSidebarState] = useState<SidebarPref>(() => getSidebar());
  const [peek, setPeek] = useState(false);
  const sidebarVisible = sidebar.autoHide ? peek : !sidebar.collapsed;

  const changeTheme = useCallback((t: ThemeId) => {
    setTheme(t);
    persistTheme(t);
  }, []);
  const changeFonts = useCallback((f: Fonts) => {
    setFonts(f);
    persistFonts(f);
  }, []);
  const changeSidebar = useCallback((s: SidebarPref) => {
    setSidebarState(s);
    persistSidebar(s);
    if (s.autoHide) setPeek(false); // start hidden when auto-hide turns on
  }, []);
  const toggleSidebar = useCallback(() => {
    if (sidebar.autoHide) setPeek((p) => !p);
    else changeSidebar({ ...sidebar, collapsed: !sidebar.collapsed });
  }, [sidebar, changeSidebar]);

  const dirty = file !== null && draft !== file.content;

  // The active workspace's file source, set by whoever opened it. REST sources
  // can be rebuilt synchronously on restore; FSA ones arrive via the picker.
  const [source, setSource] = useState<FileSource | null>(() =>
    workspace ? createRestSource(workspace.root) : null,
  );

  const loadTree = useCallback(async () => {
    if (!source) return;
    setTreeLoading(true);
    setTreeError(null);
    try {
      const nodes = await source.tree();
      setTree(nodes);
    } catch (err) {
      setTreeError(err instanceof ApiRequestError ? err.message : 'failed to load workspace');
    } finally {
      setTreeLoading(false);
    }
  }, [source]);

  // (Re)load the tree whenever the workspace changes.
  useEffect(() => {
    setTree([]);
    void loadTree();
  }, [loadTree]);

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
    (ws: Workspace | null, src: FileSource | null = null) => {
      if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
      setOpenPath(null);
      setFile(null);
      setDraft('');
      setFileError(null);
      setConflict(false);
      setSaveError(null);
      if (ws && src) {
        setWorkspace(ws);
        setSource(src);
        setLastWorkspace(ws);
        addRecent(ws);
      } else {
        setWorkspace(null);
        setSource(null);
      }
    },
    [dirty],
  );

  const openFile = useCallback(
    (path: string) => {
      if (!source) return;
      if (path === openPath) return;
      if (dirty && !window.confirm('You have unsaved changes. Discard them?')) return;
      setPeek(false); // collapse the auto-hide overlay once a file is chosen
      setOpenPath(path);
      setFile(null);
      setDraft('');
      setFileError(null);
      setSaveError(null);
      setConflict(false);
      setFileLoading(true);
      source
        .file(path)
        .then((res) => {
          setFile(res);
          setDraft(res.content);
        })
        .catch((err: unknown) => {
          setFileError(err instanceof ApiRequestError ? err.message : 'failed to open file');
        })
        .finally(() => setFileLoading(false));
    },
    [source, openPath, dirty],
  );

  const save = useCallback(async () => {
    if (!source || !file || !openPath || saving) return;
    if (draft === file.content) return; // nothing to save
    setSaving(true);
    setSaveError(null);
    setConflict(false);
    try {
      const res = await source.save(openPath, draft, file.hash);
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
  }, [source, file, openPath, draft, saving]);

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

  // Ctrl/Cmd-B toggles the sidebar (collapse in pinned mode, peek in auto-hide).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleSidebar]);

  // Conflict resolution: discard local edits and re-read from disk.
  const discardAndReload = useCallback(async () => {
    if (!source || !openPath) return;
    try {
      const fresh = await source.file(openPath);
      setFile(fresh);
      setDraft(fresh.content);
      setConflict(false);
      setSaveError(null);
      setReloadNonce((n) => n + 1);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : 'reload failed');
    }
  }, [source, openPath]);

  // Conflict resolution: keep local edits and overwrite, re-reading only to get
  // the current hash so the second save passes the check.
  const overwrite = useCallback(async () => {
    if (!source || !openPath) return;
    setSaving(true);
    try {
      const fresh = await source.file(openPath);
      const res = await source.save(openPath, draft, fresh.hash);
      setFile({ path: openPath, content: draft, hash: res.hash });
      setConflict(false);
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof ApiRequestError ? err.message : 'overwrite failed');
    } finally {
      setSaving(false);
    }
  }, [source, openPath, draft]);

  // --- Tree actions (create / rename / delete) ---------------------------
  // The backend only operates on text files (and refuses to move/delete dirs),
  // so the UI matches: new-file lives on folders, rename/delete on files.

  const newFile = useCallback(
    async (dir: string) => {
      if (!source) return;
      const input = window.prompt(`New file name${dir ? ` in ${dir}/` : ''}:`, 'untitled.md');
      if (input === null) return;
      const name = ensureTextExt(input.trim());
      if (!name) return;
      const path = dir ? `${dir}/${name}` : name;
      setActionError(null);
      try {
        await source.create(path);
        await loadTree();
        openFile(path);
      } catch (err) {
        setActionError(err instanceof ApiRequestError ? err.message : 'could not create file');
      }
    },
    [source, loadTree, openFile],
  );

  const renameFile = useCallback(
    async (path: string) => {
      if (!source) return;
      const base = path.split('/').pop() ?? path;
      const input = window.prompt('Rename file to:', base);
      if (input === null) return;
      const newName = ensureTextExt(input.trim());
      if (!newName || newName === base) return;
      const slash = path.lastIndexOf('/');
      const to = slash >= 0 ? `${path.slice(0, slash)}/${newName}` : newName;
      setActionError(null);
      try {
        await source.move(path, to);
        if (openPath === path) {
          setOpenPath(to);
          setFile((f) => (f ? { ...f, path: to } : f));
        }
        await loadTree();
      } catch (err) {
        setActionError(err instanceof ApiRequestError ? err.message : 'could not rename file');
      }
    },
    [source, openPath, loadTree],
  );

  const deleteFile = useCallback(
    async (path: string) => {
      if (!source) return;
      if (!window.confirm(`Delete "${path}"?\n\nThis cannot be undone.`)) return;
      setActionError(null);
      try {
        await source.remove(path);
        if (openPath === path) {
          setOpenPath(null);
          setFile(null);
          setDraft('');
          setMode('read');
        }
        await loadTree();
      } catch (err) {
        setActionError(err instanceof ApiRequestError ? err.message : 'could not delete file');
      }
    },
    [source, openPath, loadTree],
  );

  const docKey = useMemo(
    () => `${workspace?.root ?? ''}::${openPath ?? ''}#${reloadNonce}`,
    [workspace, openPath, reloadNonce],
  );

  const settingsControl = (
    <span className="settings-anchor">
      <button
        className="btn icon-btn"
        title="Appearance"
        aria-label="Appearance settings"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen((o) => !o)}
      >
        ⚙
      </button>
      {settingsOpen && (
        <SettingsPanel
          theme={theme}
          fonts={fonts}
          sidebar={sidebar}
          onTheme={changeTheme}
          onFonts={changeFonts}
          onSidebar={changeSidebar}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </span>
  );

  if (!workspace) {
    return (
      <div className="picker-shell">
        <div className="settings-corner">{settingsControl}</div>
        <WorkspacePicker onOpen={(ws, src) => switchWorkspace(ws, src)} />
      </div>
    );
  }

  const hasFile = openPath !== null && file !== null && !fileLoading && !fileError;

  return (
    <div className="app">
      <header className="topbar">
        <button
          className="btn icon-btn"
          title="Toggle sidebar (Ctrl/Cmd-B)"
          aria-label="Toggle sidebar"
          aria-expanded={sidebarVisible}
          onClick={toggleSidebar}
        >
          ☰
        </button>
        <span className="brand">lookmd</span>
        <span className="workspace-name" title={workspace.root || '/'}>
          {workspace.name}
        </span>
        <button className="btn" onClick={() => switchWorkspace(null)}>
          Change workspace
        </button>
        {settingsControl}
      </header>

      <div
        className={`body${sidebar.autoHide ? ' body-autohide' : ''}${
          sidebarVisible ? '' : ' sidebar-hidden'
        }`}
      >
        {sidebar.autoHide && !sidebarVisible && (
          <div
            className="sidebar-reveal"
            onMouseEnter={() => setPeek(true)}
            aria-hidden="true"
          />
        )}
        <aside
          className="sidebar"
          onMouseLeave={() => {
            if (sidebar.autoHide) setPeek(false);
          }}
        >
          <div className="sidebar-head">
            <span className="sidebar-head-label">Files</span>
            <button
              className="tree-action"
              title="New file in workspace root"
              aria-label="New file in workspace root"
              onClick={() => void newFile('')}
            >
              ＋
            </button>
          </div>
          {actionError && (
            <p className="error sidebar-empty sidebar-action-error" onClick={() => setActionError(null)}>
              {actionError} <span className="muted">(dismiss)</span>
            </p>
          )}
          {treeLoading && <p className="muted sidebar-empty">Loading…</p>}
          {treeError && <p className="error sidebar-empty">{treeError}</p>}
          {!treeLoading && !treeError && (
            <FileTree
              tree={tree}
              activePath={openPath}
              onOpenFile={openFile}
              onNewFile={(dir) => void newFile(dir)}
              onRename={(path) => void renameFile(path)}
              onDelete={(path) => void deleteFile(path)}
            />
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
            {hasFile && (
              <Suspense fallback={<div className="placeholder">Loading…</div>}>
                {mode === 'read' && <ReadView content={draft} />}
                {mode === 'source' && <SourceView content={draft} />}
                {mode === 'edit' && (
                  <Editor value={draft} docKey={docKey} onChange={setDraft} onSave={() => void save()} />
                )}
              </Suspense>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
