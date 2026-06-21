/**
 * App shell. Holds the active workspace and a set of open files as tabs. Each
 * tab carries its own draft, last-saved snapshot, and conflict/save state, so
 * switching tabs preserves edits. Per file: a Read/Source/Edit toggle over the
 * tab's draft, explicit hash-checked save, 409-conflict handling, and a
 * dirty-buffer guard. Layout is VS Code-style: header + file-tree sidebar +
 * tab strip + content pane.
 */

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { TreeNode } from '@lookmd/shared';
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
import { CommandPalette } from './components/CommandPalette';
import { Outline } from './components/Outline';
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
  getLineNumbers,
  setTheme as persistTheme,
  setFonts as persistFonts,
  setSidebar as persistSidebar,
  setLineNumbers as persistLineNumbers,
  type ThemeId,
  type Fonts,
  type SidebarPref,
} from './settings';

/** One open file. `content`/`hash` are the last-saved snapshot (null until the
 *  initial load resolves); `draft` is the live buffer shown in every mode. */
interface Tab {
  path: string;
  content: string | null;
  hash: string | null;
  draft: string;
  loading: boolean;
  error: string | null;
  conflict: boolean;
  saveError: string | null;
  saving: boolean;
  /** Bumped on a reload so the editor re-seeds its document from fresh content. */
  reloadNonce: number;
}

function newTab(path: string): Tab {
  return {
    path,
    content: null,
    hash: null,
    draft: '',
    loading: true,
    error: null,
    conflict: false,
    saveError: null,
    saving: false,
    reloadNonce: 0,
  };
}

function tabDirty(t: Tab): boolean {
  return t.content !== null && t.draft !== t.content;
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Flatten the tree to just the file paths, for the quick-open palette. */
function flattenFiles(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    if (n.type === 'file') acc.push(n.path);
    else if (n.children) flattenFiles(n.children, acc);
  }
  return acc;
}

function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

/** Resolve a relative path against a directory, collapsing `.` and `..`. */
function joinPath(dir: string, rel: string): string {
  const out: string[] = [];
  for (const seg of (dir ? dir.split('/') : []).concat(rel.split('/'))) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/** True for URLs that already point somewhere (scheme or protocol-relative). */
function isExternalUrl(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//');
}

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
  // The active workspace's file source, set by whoever opened it. REST sources
  // can be rebuilt synchronously on restore; FSA ones arrive via the picker.
  const [source, setSource] = useState<FileSource | null>(() =>
    workspace ? createRestSource(workspace.root) : null,
  );

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Open files as tabs, plus which one is active.
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  const [mode, setMode] = useState<ViewMode>('read');

  // Appearance (already applied to the DOM at bootstrap; mirror it in state).
  const [theme, setTheme] = useState<ThemeId>(() => getTheme());
  const [fonts, setFonts] = useState<Fonts>(() => getFonts());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Sidebar: a persisted pref (manual collapse + auto-hide) plus a transient
  // `peek` for the hover-reveal used in auto-hide mode.
  const [sidebar, setSidebarState] = useState<SidebarPref>(() => getSidebar());
  const [lineNumbers, setLineNumbersState] = useState<boolean>(() => getLineNumbers());
  const [peek, setPeek] = useState(false);
  const sidebarVisible = sidebar.autoHide ? peek : !sidebar.collapsed;

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;
  const anyDirty = tabs.some(tabDirty);

  const updateTab = useCallback((path: string, patch: Partial<Tab>) => {
    setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, ...patch } : t)));
  }, []);

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
  const changeLineNumbers = useCallback((on: boolean) => {
    setLineNumbersState(on);
    persistLineNumbers(on);
  }, []);
  const toggleSidebar = useCallback(() => {
    if (sidebar.autoHide) setPeek((p) => !p);
    else changeSidebar({ ...sidebar, collapsed: !sidebar.collapsed });
  }, [sidebar, changeSidebar]);

  // Hover-intent for auto-hide: reveal instantly, but wait a grace period before
  // hiding so a brief stray movement off the panel doesn't snap it shut. Moving
  // back in cancels the pending hide.
  const hideTimer = useRef<number | null>(null);
  const cancelHide = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  const revealSidebar = useCallback(() => {
    cancelHide();
    setPeek(true);
  }, [cancelHide]);
  const scheduleHide = useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      setPeek(false);
      hideTimer.current = null;
    }, 600);
  }, [cancelHide]);
  // Clear any pending timer on unmount.
  useEffect(() => cancelHide, [cancelHide]);

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

  // Warn on tab/window close while any open file has unsaved changes.
  useEffect(() => {
    if (!anyDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [anyDirty]);

  const switchWorkspace = useCallback(
    (ws: Workspace | null, src: FileSource | null = null) => {
      if (anyDirty && !window.confirm('You have unsaved changes. Discard them?')) return;
      setTabs([]);
      setActivePath(null);
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
    [anyDirty],
  );

  // Fetch a tab's content from the source.
  const loadTab = useCallback(
    (path: string) => {
      if (!source) return;
      updateTab(path, { loading: true, error: null });
      source
        .file(path)
        .then((res) =>
          updateTab(path, {
            content: res.content,
            hash: res.hash,
            draft: res.content,
            loading: false,
            error: null,
          }),
        )
        .catch((err: unknown) =>
          updateTab(path, {
            loading: false,
            error: err instanceof ApiRequestError ? err.message : 'failed to open file',
          }),
        );
    },
    [source, updateTab],
  );

  // Open a file: focus its tab if already open, otherwise add one and load it.
  const openFile = useCallback(
    (path: string) => {
      if (!source) return;
      setPeek(false); // collapse the auto-hide overlay once a file is chosen
      setActivePath(path);
      if (!tabs.some((t) => t.path === path)) {
        setTabs((ts) => (ts.some((t) => t.path === path) ? ts : [...ts, newTab(path)]));
        loadTab(path);
      }
    },
    [source, tabs, loadTab],
  );

  const activateTab = useCallback((path: string) => setActivePath(path), []);

  // Remove a tab without prompting (caller decides), moving focus to a neighbor.
  const dropTab = useCallback(
    (path: string) => {
      const idx = tabs.findIndex((t) => t.path === path);
      if (idx === -1) return;
      const next = tabs.filter((t) => t.path !== path);
      setTabs(next);
      if (activePath === path) {
        setActivePath(next.length ? next[Math.min(idx, next.length - 1)]!.path : null);
      }
    },
    [tabs, activePath],
  );

  const closeTab = useCallback(
    (path: string) => {
      const tab = tabs.find((t) => t.path === path);
      if (tab && tabDirty(tab) && !window.confirm('Close without saving? Unsaved changes will be lost.')) {
        return;
      }
      dropTab(path);
    },
    [tabs, dropTab],
  );

  const save = useCallback(async () => {
    if (!source || !activeTab || activeTab.content === null || activeTab.saving) return;
    if (activeTab.draft === activeTab.content) return; // nothing to save
    const { path, draft: text, hash } = activeTab;
    updateTab(path, { saving: true, saveError: null, conflict: false });
    try {
      const res = await source.save(path, text, hash ?? '');
      updateTab(path, { content: text, hash: res.hash, saving: false });
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'CONFLICT') {
        updateTab(path, { conflict: true, saving: false });
      } else {
        updateTab(path, {
          saveError: err instanceof ApiRequestError ? err.message : 'save failed',
          saving: false,
        });
      }
    }
  }, [source, activeTab, updateTab]);

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

  // Ctrl/Cmd-P opens the quick-open palette (overriding the browser print dialog).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Conflict resolution: discard local edits and re-read from disk.
  const discardAndReload = useCallback(async () => {
    if (!source || !activeTab) return;
    const { path, reloadNonce } = activeTab;
    try {
      const fresh = await source.file(path);
      updateTab(path, {
        content: fresh.content,
        hash: fresh.hash,
        draft: fresh.content,
        conflict: false,
        saveError: null,
        reloadNonce: reloadNonce + 1,
      });
    } catch (err) {
      updateTab(path, { saveError: err instanceof ApiRequestError ? err.message : 'reload failed' });
    }
  }, [source, activeTab, updateTab]);

  // Conflict resolution: keep local edits and overwrite, re-reading only to get
  // the current hash so the second save passes the check.
  const overwrite = useCallback(async () => {
    if (!source || !activeTab) return;
    const { path, draft: text } = activeTab;
    updateTab(path, { saving: true });
    try {
      const fresh = await source.file(path);
      const res = await source.save(path, text, fresh.hash);
      updateTab(path, {
        content: text,
        hash: res.hash,
        conflict: false,
        saveError: null,
        saving: false,
      });
    } catch (err) {
      updateTab(path, {
        saveError: err instanceof ApiRequestError ? err.message : 'overwrite failed',
        saving: false,
      });
    }
  }, [source, activeTab, updateTab]);

  const setActiveDraft = useCallback(
    (next: string) => {
      if (activePath) updateTab(activePath, { draft: next });
    },
    [activePath, updateTab],
  );

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
      const base = baseName(path);
      const input = window.prompt('Rename file to:', base);
      if (input === null) return;
      const newName = ensureTextExt(input.trim());
      if (!newName || newName === base) return;
      const slash = path.lastIndexOf('/');
      const to = slash >= 0 ? `${path.slice(0, slash)}/${newName}` : newName;
      setActionError(null);
      try {
        await source.move(path, to);
        // Keep an open tab pointing at the renamed file.
        setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, path: to } : t)));
        setActivePath((cur) => (cur === path ? to : cur));
        await loadTree();
      } catch (err) {
        setActionError(err instanceof ApiRequestError ? err.message : 'could not rename file');
      }
    },
    [source, loadTree],
  );

  const deleteFile = useCallback(
    async (path: string) => {
      if (!source) return;
      if (!window.confirm(`Delete "${path}"?\n\nThis cannot be undone.`)) return;
      setActionError(null);
      try {
        await source.remove(path);
        dropTab(path);
        await loadTree();
      } catch (err) {
        setActionError(err instanceof ApiRequestError ? err.message : 'could not delete file');
      }
    },
    [source, dropTab, loadTree],
  );

  const docKey = activeTab
    ? `${workspace?.root ?? ''}::${activeTab.path}#${activeTab.reloadNonce}`
    : '';

  // Resolve a Markdown image src (relative to the open file's folder) to a URL
  // the browser can load via the active source. External URLs pass through.
  const activeDir = activeTab ? dirName(activeTab.path) : '';
  const resolveImage = useCallback(
    (src: string): Promise<string> => {
      if (!source || isExternalUrl(src)) return Promise.resolve(src);
      return source.assetUrl(joinPath(activeDir, src));
    },
    [source, activeDir],
  );

  // Follow an internal link from the Read view: resolve relative to the open
  // file, falling back to a workspace-wide basename match (wiki-style), then
  // open it in a tab.
  const navigateLink = useCallback(
    (href: string) => {
      if (!source) return;
      const clean = decodeURIComponent(href.split('#')[0]?.split('?')[0] ?? '');
      if (!clean) return;
      const joined = joinPath(activeDir, clean);
      const files = flattenFiles(tree);
      const wanted = (clean.split('/').pop() ?? clean).toLowerCase();
      const target =
        files.find((f) => f === joined) ??
        files.find((f) => (f.split('/').pop() ?? '').toLowerCase() === wanted) ??
        joined;
      openFile(target);
    },
    [source, activeDir, tree, openFile],
  );

  // Jump to a heading from the outline: ensure Read mode, then scroll to its id
  // (rehype-slug puts matching ids on the rendered headings).
  const jumpToHeading = useCallback((slug: string) => {
    setMode('read');
    window.setTimeout(() => {
      document.getElementById(slug)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }, []);

  const settingsButton = (
    <button
      className="btn icon-btn"
      title="Appearance"
      aria-label="Appearance settings"
      aria-haspopup="dialog"
      aria-expanded={settingsOpen}
      onClick={() => setSettingsOpen((o) => !o)}
    >
      ⚙
    </button>
  );
  const settingsModal = settingsOpen && (
    <SettingsPanel
      theme={theme}
      fonts={fonts}
      sidebar={sidebar}
      lineNumbers={lineNumbers}
      onTheme={changeTheme}
      onFonts={changeFonts}
      onSidebar={changeSidebar}
      onLineNumbers={changeLineNumbers}
      onClose={() => setSettingsOpen(false)}
    />
  );

  if (!workspace) {
    return (
      <div className="picker-shell">
        <div className="settings-corner">{settingsButton}</div>
        <WorkspacePicker onOpen={(ws, src) => switchWorkspace(ws, src)} />
        {settingsModal}
      </div>
    );
  }

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
        {settingsButton}
      </header>

      <div
        className={`body${sidebar.autoHide ? ' body-autohide' : ''}${
          sidebarVisible ? '' : ' sidebar-hidden'
        }`}
      >
        {sidebar.autoHide && !sidebarVisible && (
          <div
            className="sidebar-reveal"
            onMouseEnter={revealSidebar}
            aria-hidden="true"
          />
        )}
        <aside
          className="sidebar"
          onMouseEnter={() => {
            if (sidebar.autoHide) cancelHide();
          }}
          onMouseLeave={() => {
            if (sidebar.autoHide) scheduleHide();
          }}
        >
          <div className="sidebar-head">
            <span className="sidebar-head-label">Files</span>
            <button
              className="tree-action"
              title={sidebar.autoHide ? 'Pin sidebar (turn off auto-hide)' : 'Auto-hide sidebar'}
              aria-label="Toggle sidebar auto-hide"
              aria-pressed={sidebar.autoHide}
              onClick={() => changeSidebar({ ...sidebar, autoHide: !sidebar.autoHide })}
            >
              📌
            </button>
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
              activePath={activePath}
              onOpenFile={openFile}
              onNewFile={(dir) => void newFile(dir)}
              onRename={(path) => void renameFile(path)}
              onDelete={(path) => void deleteFile(path)}
            />
          )}
          {activeTab && activeTab.content !== null && (
            <Outline content={activeTab.draft} onJump={jumpToHeading} />
          )}
        </aside>

        <main className="content">
          {tabs.length > 0 && (
            <div className="tabbar" role="tablist">
              {tabs.map((t) => (
                <div
                  key={t.path}
                  className={`tab${t.path === activePath ? ' tab-active' : ''}`}
                  role="tab"
                  aria-selected={t.path === activePath}
                  title={t.path}
                  onClick={() => activateTab(t.path)}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault();
                      closeTab(t.path);
                    }
                  }}
                >
                  <span className="tab-name">{baseName(t.path)}</span>
                  {tabDirty(t) && (
                    <span className="dirty-dot" aria-label="Unsaved changes">
                      ●
                    </span>
                  )}
                  <button
                    className="tab-close"
                    title="Close"
                    aria-label={`Close ${baseName(t.path)}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(t.path);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeTab && activeTab.content !== null && !activeTab.error && (
            <div className="file-bar">
              <span className="file-bar-name" title={activeTab.path}>
                {activeTab.path}
                {tabDirty(activeTab) && (
                  <span className="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes">
                    ●
                  </span>
                )}
              </span>
              <ModeToggle mode={mode} onChange={setMode} />
              <button
                className="btn btn-accent"
                onClick={() => void save()}
                disabled={!tabDirty(activeTab) || activeTab.saving}
              >
                {activeTab.saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}

          {activeTab && activeTab.conflict && (
            <div className="banner banner-warn">
              <span>
                This file changed on disk since you opened it. Saving now would clobber
                that change.
              </span>
              <span className="banner-actions">
                <button className="btn" onClick={() => void discardAndReload()}>
                  Reload from disk
                </button>
                <button className="btn" onClick={() => void overwrite()} disabled={activeTab.saving}>
                  Overwrite anyway
                </button>
              </span>
            </div>
          )}
          {activeTab && activeTab.saveError && (
            <div className="banner banner-error">{activeTab.saveError}</div>
          )}

          <div className="view">
            {!activeTab && <div className="placeholder">Select a file to read.</div>}
            {activeTab && activeTab.loading && (
              <div className="placeholder">Loading {activeTab.path}…</div>
            )}
            {activeTab && activeTab.error && (
              <div className="placeholder error">{activeTab.error}</div>
            )}
            {activeTab && activeTab.content !== null && !activeTab.loading && !activeTab.error && (
              <Suspense fallback={<div className="placeholder">Loading…</div>}>
                {mode === 'read' && (
                  <ReadView
                    content={activeTab.draft}
                    resolveImage={resolveImage}
                    onNavigate={navigateLink}
                  />
                )}
                {mode === 'source' && (
                  <SourceView content={activeTab.draft} lineNumbers={lineNumbers} />
                )}
                {mode === 'edit' && (
                  <Editor
                    value={activeTab.draft}
                    docKey={docKey}
                    onChange={setActiveDraft}
                    onSave={() => void save()}
                    lineNumbers={lineNumbers}
                  />
                )}
                {mode === 'split' && (
                  <div className="split">
                    <div className="split-pane split-editor">
                      <Editor
                        value={activeTab.draft}
                        docKey={docKey}
                        onChange={setActiveDraft}
                        onSave={() => void save()}
                        lineNumbers={lineNumbers}
                      />
                    </div>
                    <div className="split-pane split-preview">
                      <ReadView
                        content={activeTab.draft}
                        resolveImage={resolveImage}
                        onNavigate={navigateLink}
                      />
                    </div>
                  </div>
                )}
              </Suspense>
            )}
          </div>
        </main>
      </div>

      {settingsModal}
      {paletteOpen && (
        <CommandPalette
          files={flattenFiles(tree)}
          onOpen={(p) => {
            openFile(p);
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}
