/**
 * App shell. Holds the active workspace and a set of open files as tabs. Each
 * tab carries its own draft, last-saved snapshot, and conflict/save state, so
 * switching tabs preserves edits. Per file: a Read/Source/Edit toggle over the
 * tab's draft, explicit hash-checked save, 409-conflict handling, and a
 * dirty-buffer guard. Layout is VS Code-style: header + file-tree sidebar +
 * tab strip + content pane.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TreeNode } from '@lookmd/shared';
import { ApiRequestError } from './api';
import { createRestSource } from './sources/rest';
import type { FileSource } from './sources/types';
import {
  addRecent,
  getLastWorkspace,
  setLastWorkspace,
  getSession,
  setSession,
  type Workspace,
  type Session,
} from './storage';
import { getHandle } from './sources/handles';
import { createFsaSource, hasPermission } from './sources/fsa';
import { WorkspacePicker } from './components/WorkspacePicker';
import { FileTree } from './components/FileTree';
import { CommandPalette } from './components/CommandPalette';
import { CreateMenu } from './components/CreateMenu';
import { Outline } from './components/Outline';
import { Icon } from './components/Icon';
import { Logo } from './components/Logo';
import {
  Menu01Icon,
  Settings01Icon,
  PinIcon,
  Cancel01Icon,
  RefreshIcon,
  LayoutRightIcon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
  File01Icon,
  Txt01Icon,
  Folder01Icon,
  PencilEdit02Icon,
  Delete02Icon,
  Copy01Icon,
} from '@hugeicons/core-free-icons';
import { FilePane } from './components/FilePane';
import { EditMenu } from './components/EditMenu';
import { WorkspaceSearch } from './components/WorkspaceSearch';
import { ContextMenu, type ContextMenuState, type MenuEntry } from './components/ContextMenu';
import { type Tab, newTab, tabDirty } from './tab';
import type { EditorApi } from './editorApi';
import { type ViewMode } from './components/ModeToggle';
import { SettingsPanel } from './components/SettingsPanel';
import {
  getTheme,
  getFonts,
  getSidebar,
  getSidebarWidth,
  getLineNumbers,
  setTheme as persistTheme,
  setFonts as persistFonts,
  setSidebar as persistSidebar,
  setSidebarWidth as persistSidebarWidth,
  setLineNumbers as persistLineNumbers,
  getZoom,
  setZoom as persistZoom,
  clampZoom,
  ZOOM_STEP,
  getFileTypes,
  setFileTypes as persistFileTypes,
  enabledExtensions,
  filterTreeByFileTypes,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  type ThemeId,
  type Fonts,
  type SidebarPref,
} from './settings';
import { isMarkdownPath } from '@lookmd/shared';

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

/** Read/Split only make sense for Markdown; coerce other text files to Source. */
function effectiveMode(path: string, mode: ViewMode): ViewMode {
  if (isMarkdownPath(path)) return mode;
  return mode === 'read' || mode === 'split' ? 'source' : mode;
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

function isViewMode(m: string): m is ViewMode {
  return m === 'read' || m === 'source' || m === 'edit' || m === 'split';
}

/** Append a default extension (so the name passes the text allowlist) unless the
 *  user already typed a recognized text extension. */
function ensureExt(name: string, ext: 'md' | 'txt'): string {
  if (name === '') return '';
  return /\.(md|markdown|mdown|mkd|txt|text)$/i.test(name) ? name : `${name}.${ext}`;
}

export function App() {
  // Boot snapshot, read once: a REST workspace can be restored synchronously
  // (with its saved session) so the first render already has its tabs. FSA
  // workspaces need a permission gesture, so they're restored in an effect.
  const [boot] = useState(() => {
    const last = getLastWorkspace();
    const ws = last && last.kind === 'rest' ? last : null;
    const saved = ws ? getSession() : null;
    const session = saved && ws && saved.kind === ws.kind && saved.root === ws.root ? saved : null;
    return { ws, session };
  });

  const [workspace, setWorkspace] = useState<Workspace | null>(boot.ws);
  // The active workspace's file source, set by whoever opened it.
  const [source, setSource] = useState<FileSource | null>(() =>
    boot.ws ? createRestSource(boot.ws.root) : null,
  );

  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [treeLoading, setTreeLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Open files as tabs, plus which one is active — seeded from the saved session.
  const [tabs, setTabs] = useState<Tab[]>(() =>
    boot.session ? boot.session.openPaths.map(newTab) : [],
  );
  const [activePath, setActivePath] = useState<string | null>(() => {
    if (!boot.session) return null;
    const { openPaths, activePath: a } = boot.session;
    return a && openPaths.includes(a) ? a : (openPaths[0] ?? null);
  });

  const [mode, setMode] = useState<ViewMode>(() =>
    boot.session && isViewMode(boot.session.mode) ? boot.session.mode : 'read',
  );

  // Multi-file split: an optional second pane bound to another open tab, laid
  // out beside ('row') or below ('column') the primary one, with its own mode.
  // `focusedPane` is the one keyboard Save targets.
  const [secondaryPath, setSecondaryPath] = useState<string | null>(null);
  const [secondaryMode, setSecondaryMode] = useState<ViewMode>('read');
  const [splitDir, setSplitDir] = useState<'row' | 'column'>('row');
  const [focusedPane, setFocusedPane] = useState<'primary' | 'secondary'>('primary');

  // Edit menu: the command API of the focused editor (null when none is focused),
  // the open Find/Replace-in-Files panel, and a "reveal this line" pulse for the
  // primary editor (set when opening a search result).
  const [editApi, setEditApi] = useState<EditorApi | null>(null);
  const [searchMode, setSearchMode] = useState<'find' | 'replace' | null>(null);
  const [reveal, setReveal] = useState<{ line: number; nonce: number } | undefined>(undefined);
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);

  // Appearance (already applied to the DOM at bootstrap; mirror it in state).
  const [theme, setTheme] = useState<ThemeId>(() => getTheme());
  const [fonts, setFonts] = useState<Fonts>(() => getFonts());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Sidebar: a persisted pref (manual collapse + auto-hide) plus a transient
  // `peek` for the hover-reveal used in auto-hide mode.
  const [sidebar, setSidebarState] = useState<SidebarPref>(() => getSidebar());
  const [lineNumbers, setLineNumbersState] = useState<boolean>(() => getLineNumbers());
  const [zoom, setZoomState] = useState<number>(() => getZoom());
  const [fileTypes, setFileTypesState] = useState<string[]>(() => getFileTypes());
  const [peek, setPeek] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => getSidebarWidth());

  // On narrow/touch screens the sidebar becomes a drawer overlay with its own
  // open state, ignoring the desktop pinned/auto-hide pref entirely.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)');
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const sidebarVisible = isMobile ? drawerOpen : sidebar.autoHide ? peek : !sidebar.collapsed;

  const activeTab = tabs.find((t) => t.path === activePath) ?? null;
  // A split pane only renders when its file is still open and differs is fine
  // (the same file in both panes shares one buffer).
  const secondaryTab =
    secondaryPath ? (tabs.find((t) => t.path === secondaryPath) ?? null) : null;
  const splitOn = secondaryTab !== null;
  const anyDirty = tabs.some(tabDirty);
  // Stable identity for keying per-file annotations (localStorage only).
  const workspaceKey = workspace ? `${workspace.kind}:${workspace.root}` : '';

  const updateTab = useCallback((path: string, patch: Partial<Tab>) => {
    setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, ...patch } : t)));
  }, []);

  // Fetch a tab's content from a given source (explicit so restore can load
  // before the `source` state has settled).
  const fetchInto = useCallback(
    (src: FileSource, path: string) => {
      updateTab(path, { loading: true, error: null });
      src
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
    [updateTab],
  );

  const loadTab = useCallback(
    (path: string) => {
      if (source) fetchInto(source, path);
    },
    [source, fetchInto],
  );

  // Rebuild the open tabs from a saved session.
  const restoreSession = useCallback(
    (s: Session, src: FileSource) => {
      if (s.openPaths.length === 0) return;
      setTabs(s.openPaths.map(newTab));
      setActivePath(
        s.activePath && s.openPaths.includes(s.activePath) ? s.activePath : s.openPaths[0]!,
      );
      if (isViewMode(s.mode)) setMode(s.mode);
      s.openPaths.forEach((p) => fetchInto(src, p));
    },
    [fetchInto],
  );

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
  const changeZoom = useCallback((next: number) => {
    const z = clampZoom(next);
    setZoomState(z);
    persistZoom(z);
  }, []);
  const zoomIn = useCallback(() => setZoomState((z) => {
    const n = clampZoom(z + ZOOM_STEP);
    persistZoom(n);
    return n;
  }), []);
  const zoomOut = useCallback(() => setZoomState((z) => {
    const n = clampZoom(z - ZOOM_STEP);
    persistZoom(n);
    return n;
  }), []);
  const zoomReset = useCallback(() => changeZoom(1), [changeZoom]);
  const changeFileTypes = useCallback((ids: string[]) => {
    setFileTypesState(ids);
    persistFileTypes(ids);
  }, []);

  // The tree as displayed: pruned to the file types the user has enabled. The
  // server still serves every allowed text type; this is purely what we show.
  const visibleExts = useMemo(() => enabledExtensions(fileTypes), [fileTypes]);
  const filteredTree = useMemo(
    () => filterTreeByFileTypes(tree, visibleExts),
    [tree, visibleExts],
  );
  const visibleFiles = useMemo(() => flattenFiles(filteredTree), [filteredTree]);

  const toggleSidebar = useCallback(() => {
    if (isMobile) setDrawerOpen((o) => !o);
    else if (sidebar.autoHide) setPeek((p) => !p);
    else changeSidebar({ ...sidebar, collapsed: !sidebar.collapsed });
  }, [isMobile, sidebar, changeSidebar]);

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

  // Drag the sidebar's right edge to resize it. Tracks the pointer globally so
  // the drag continues even if the cursor outruns the thin handle; the final
  // width is persisted on release.
  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    document.body.classList.add('resizing-col');
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, ev.clientX));
      setSidebarWidth(next);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.classList.remove('resizing-col');
      persistSidebarWidth(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, ev.clientX)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, []);

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

  // Live file-watching over WebSocket (REST source only; FSA is client-side).
  // Reconnects automatically with a short backoff so a server restart heals
  // itself without a page reload.
  const loadTreeRef = useRef(loadTree);
  loadTreeRef.current = loadTree;

  // Stable ref so the WS handler always sees fresh tabs + source.
  const wsChangeHandlerRef = useRef<(path: string) => void>(() => undefined);
  wsChangeHandlerRef.current = (changedPath: string) => {
    const t = tabs.find((tab) => tab.path === changedPath);
    if (!t || !source) return;
    if (tabDirty(t)) {
      updateTab(t.path, { conflict: true });
    } else {
      fetchInto(source, t.path);
    }
  };

  useEffect(() => {
    if (!workspace || source?.kind !== 'rest') return;

    let ws: WebSocket | null = null;
    let dead = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let delay = 1500;

    const connect = () => {
      if (dead) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws?root=${encodeURIComponent(workspace.root)}`);

      ws.onmessage = (ev) => {
        let msg: { type: string; path?: string };
        try { msg = JSON.parse(ev.data as string) as typeof msg; } catch { return; }
        if (msg.type === 'tree') void loadTreeRef.current();
        else if (msg.type === 'change' && msg.path) wsChangeHandlerRef.current(msg.path);
      };

      ws.onclose = () => {
        ws = null;
        if (dead) return;
        reconnectTimer = setTimeout(() => {
          delay = Math.min(delay * 1.5, 15000);
          connect();
        }, delay);
      };

      ws.onerror = () => ws?.close();
    };

    connect();

    return () => {
      dead = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, source?.kind]);

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

  // Load content for the tabs seeded from the saved session (REST boot path).
  // Runs once; FSA restore happens in the effect below.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (boot.ws && boot.session && source) {
      boot.session.openPaths.forEach((p) => fetchInto(source, p));
    }
    // Silent FSA restore: reopen the last local folder if permission persists.
    if (!boot.ws) {
      const last = getLastWorkspace();
      if (last && last.kind === 'fsa') {
        void (async () => {
          const rec = await getHandle(last.root);
          if (!rec || !(await hasPermission(rec.handle))) return;
          const src = createFsaSource(rec.handle);
          setWorkspace(last);
          setSource(src);
          const s = getSession();
          if (s && s.kind === last.kind && s.root === last.root) restoreSession(s, src);
        })();
      }
    }
  }, [boot, source, fetchInto, restoreSession]);

  // Persist the session whenever the open set, active tab, or mode changes.
  // Keyed off the paths string so per-keystroke draft edits don't trigger writes.
  const openPathsKey = tabs.map((t) => t.path).join('\n');
  useEffect(() => {
    if (!workspace) return;
    setSession({
      kind: workspace.kind,
      root: workspace.root,
      openPaths: openPathsKey ? openPathsKey.split('\n') : [],
      activePath,
      mode,
    });
  }, [workspace, openPathsKey, activePath, mode]);

  const switchWorkspace = useCallback(
    (ws: Workspace | null, src: FileSource | null = null) => {
      if (anyDirty && !window.confirm('You have unsaved changes. Discard them?')) return;
      setTabs([]);
      setActivePath(null);
      setMode('read');
      if (ws && src) {
        setWorkspace(ws);
        setSource(src);
        setLastWorkspace(ws);
        addRecent(ws);
        // Reopen the tabs from a previous session for this same workspace.
        const s = getSession();
        if (s && s.kind === ws.kind && s.root === ws.root) restoreSession(s, src);
      } else {
        setWorkspace(null);
        setSource(null);
      }
    },
    [anyDirty, restoreSession],
  );

  // Open a file: focus its tab if already open, otherwise add one and load it.
  const openFile = useCallback(
    (path: string) => {
      if (!source) return;
      setPeek(false); // collapse the auto-hide overlay once a file is chosen
      setDrawerOpen(false); // and close the mobile drawer
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
      // Closing the file shown in the split collapses the split.
      if (secondaryPath === path) setSecondaryPath(null);
    },
    [tabs, activePath, secondaryPath],
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

  // Save a specific open tab (so either pane can save independently).
  const savePath = useCallback(
    async (path: string) => {
      if (!source) return;
      const tab = tabs.find((t) => t.path === path);
      if (!tab || tab.content === null || tab.saving) return;
      if (tab.draft === tab.content) return; // nothing to save
      const text = tab.draft;
      updateTab(path, { saving: true, saveError: null, conflict: false });
      try {
        const res = await source.save(path, text, tab.hash ?? '');
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
    },
    [source, tabs, updateTab],
  );

  // Global Ctrl/Cmd-S saves the focused pane (and never triggers the browser's
  // own save dialog).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        const target = focusedPane === 'secondary' && secondaryPath ? secondaryPath : activePath;
        if (target) void savePath(target);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [savePath, focusedPane, secondaryPath, activePath]);

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

  // Ctrl/Cmd +/-/0 zoom the content (Read/Source/Edit), like a browser but scoped.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key;
      if (k === '=' || k === '+' || k === 'Add') {
        e.preventDefault();
        zoomIn();
      } else if (k === '-' || k === '_' || k === 'Subtract') {
        e.preventDefault();
        zoomOut();
      } else if (k === '0') {
        e.preventDefault();
        zoomReset();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomIn, zoomOut, zoomReset]);

  // Ctrl/Cmd-Shift-F / -H open workspace Find / Replace in Files.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchMode('find');
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setSearchMode('replace');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Conflict resolution: discard local edits and re-read from disk.
  const discardReloadPath = useCallback(
    async (path: string) => {
      if (!source) return;
      const tab = tabs.find((t) => t.path === path);
      if (!tab) return;
      try {
        const fresh = await source.file(path);
        updateTab(path, {
          content: fresh.content,
          hash: fresh.hash,
          draft: fresh.content,
          conflict: false,
          saveError: null,
          reloadNonce: tab.reloadNonce + 1,
        });
      } catch (err) {
        updateTab(path, { saveError: err instanceof ApiRequestError ? err.message : 'reload failed' });
      }
    },
    [source, tabs, updateTab],
  );

  // Conflict resolution: keep local edits and overwrite, re-reading only to get
  // the current hash so the second save passes the check.
  const overwritePath = useCallback(
    async (path: string) => {
      if (!source) return;
      const tab = tabs.find((t) => t.path === path);
      if (!tab) return;
      const text = tab.draft;
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
    },
    [source, tabs, updateTab],
  );

  const setDraftFor = useCallback(
    (path: string, next: string) => updateTab(path, { draft: next }),
    [updateTab],
  );

  // --- Tree actions (create / rename / delete) ---------------------------
  // The backend only operates on text files (and refuses to move/delete dirs),
  // so the UI matches: new-file lives on folders, rename/delete on files.

  const newFile = useCallback(
    async (dir: string, ext: 'md' | 'txt' = 'md') => {
      if (!source) return;
      const kind = ext === 'txt' ? 'text' : 'Markdown';
      const input = window.prompt(`New ${kind} file name${dir ? ` in ${dir}/` : ''}:`, `untitled.${ext}`);
      if (input === null) return;
      const name = ensureExt(input.trim(), ext);
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

  const newFolder = useCallback(
    async (dir: string) => {
      if (!source) return;
      const input = window.prompt(`New folder name${dir ? ` in ${dir}/` : ''}:`, 'untitled');
      if (input === null) return;
      const name = input.trim().replace(/^\/+|\/+$/g, '');
      if (!name) return;
      const path = dir ? `${dir}/${name}` : name;
      setActionError(null);
      try {
        await source.mkdir(path);
        await loadTree();
      } catch (err) {
        setActionError(err instanceof ApiRequestError ? err.message : 'could not create folder');
      }
    },
    [source, loadTree],
  );

  const renameFile = useCallback(
    async (path: string) => {
      if (!source) return;
      const base = baseName(path);
      const input = window.prompt('Rename file to:', base);
      if (input === null) return;
      const ext = /\.(txt|text)$/i.test(path) ? 'txt' : 'md';
      const newName = ensureExt(input.trim(), ext);
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

  const docKeyFor = useCallback(
    (tab: Tab) => `${workspace?.root ?? ''}::${tab.path}#${tab.reloadNonce}`,
    [workspace],
  );

  // Resolve a Markdown image src (relative to a given file's folder) to a URL
  // the browser can load via the active source. External URLs pass through.
  // Built per directory so each pane resolves against its own file.
  const makeResolveImage = useCallback(
    (dir: string) =>
      (src: string): Promise<string> => {
        if (!source || isExternalUrl(src)) return Promise.resolve(src);
        return source.assetUrl(joinPath(dir, src));
      },
    [source],
  );

  // Follow an internal link: resolve relative to the source file's folder,
  // falling back to a workspace-wide basename match (wiki-style), then open it.
  const navigateFrom = useCallback(
    (dir: string, href: string) => {
      if (!source) return;
      const clean = decodeURIComponent(href.split('#')[0]?.split('?')[0] ?? '');
      if (!clean) return;
      const joined = joinPath(dir, clean);
      const files = flattenFiles(tree);
      const wanted = (clean.split('/').pop() ?? clean).toLowerCase();
      const target =
        files.find((f) => f === joined) ??
        files.find((f) => (f.split('/').pop() ?? '').toLowerCase() === wanted) ??
        joined;
      openFile(target);
    },
    [source, tree, openFile],
  );

  // Stable per-pane resolvers (memoized on the pane's directory) so the Read
  // view doesn't re-fetch images on every render.
  const primaryDir = activeTab ? dirName(activeTab.path) : '';
  const secondaryDir = secondaryTab ? dirName(secondaryTab.path) : '';
  const primaryResolveImage = useMemo(() => makeResolveImage(primaryDir), [makeResolveImage, primaryDir]);
  const secondaryResolveImage = useMemo(() => makeResolveImage(secondaryDir), [makeResolveImage, secondaryDir]);
  const primaryNavigate = useCallback((href: string) => navigateFrom(primaryDir, href), [navigateFrom, primaryDir]);
  const secondaryNavigate = useCallback((href: string) => navigateFrom(secondaryDir, href), [navigateFrom, secondaryDir]);

  // Split controls: open the active file in a second pane, or collapse it.
  const enableSplit = useCallback(() => {
    if (!activePath) return;
    const other = tabs.find((t) => t.path !== activePath)?.path ?? activePath;
    setSecondaryPath(other);
    setFocusedPane('secondary');
  }, [activePath, tabs]);
  const closeSplit = useCallback(() => {
    setSecondaryPath(null);
    setFocusedPane('primary');
  }, []);

  // Track the focused editor for the Edit menu; drop it if that editor unmounts.
  const onEditorFocusApi = useCallback((api: EditorApi) => setEditApi(api), []);
  const onEditorReleaseApi = useCallback(
    (api: EditorApi) => setEditApi((cur) => (cur === api ? null : cur)),
    [],
  );

  // Open a Find-in-Files result: focus the file in the primary pane, switch to
  // Edit mode, and pulse the reveal so the editor scrolls to the line.
  const openFromSearch = useCallback(
    (path: string, line: number) => {
      openFile(path);
      setMode('edit');
      setReveal((r) => ({ line, nonce: (r?.nonce ?? 0) + 1 }));
    },
    [openFile],
  );

  // After a Replace-in-Files run, refresh the on-disk content of any open tab
  // that has no unsaved edits, so panes reflect the rewrite (dirty tabs are left
  // alone and will hit the normal 409 conflict guard on their next save).
  const reloadCleanTabs = useCallback(() => {
    if (!source) return;
    for (const t of tabs) {
      if (!tabDirty(t)) fetchInto(source, t.path);
    }
  }, [source, tabs, fetchInto]);

  // --- Right-click context menus -----------------------------------------

  // Open a file in the split pane without stealing focus from the primary one.
  const openToSide = useCallback(
    (path: string) => {
      if (!source) return;
      if (!tabs.some((t) => t.path === path)) {
        setTabs((ts) => (ts.some((t) => t.path === path) ? ts : [...ts, newTab(path)]));
        loadTab(path);
      }
      setSecondaryPath(path);
      setFocusedPane('secondary');
    },
    [source, tabs, loadTab],
  );

  const copyText = useCallback((text: string) => {
    void navigator.clipboard?.writeText(text);
  }, []);

  const closeOthers = useCallback(
    (keep: string) => {
      const others = tabs.filter((t) => t.path !== keep);
      if (others.some(tabDirty) && !window.confirm('Close other files? Unsaved changes will be lost.'))
        return;
      setTabs((ts) => ts.filter((t) => t.path === keep));
      setActivePath(keep);
      if (secondaryPath && secondaryPath !== keep) setSecondaryPath(null);
    },
    [tabs, secondaryPath],
  );

  const closeAll = useCallback(() => {
    if (tabs.some(tabDirty) && !window.confirm('Close all files? Unsaved changes will be lost.')) return;
    setTabs([]);
    setActivePath(null);
    setSecondaryPath(null);
  }, [tabs]);

  const showMenu = useCallback((e: React.MouseEvent, items: MenuEntry[]) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, []);

  // File-tree right-click: a node (file/folder) or the empty area (null = root).
  const fileTreeMenu = useCallback(
    (e: React.MouseEvent, node: TreeNode | null) => {
      const dir = node && node.type === 'dir' ? node.path : '';
      const createItems: MenuEntry[] = [
        { label: 'New Markdown file', icon: File01Icon, onClick: () => void newFile(dir, 'md') },
        { label: 'New text file', icon: Txt01Icon, onClick: () => void newFile(dir, 'txt') },
        { label: 'New folder', icon: Folder01Icon, onClick: () => void newFolder(dir) },
      ];
      if (!node) {
        showMenu(e, createItems);
      } else if (node.type === 'dir') {
        showMenu(e, [
          ...createItems,
          'separator',
          { label: 'Copy path', icon: Copy01Icon, onClick: () => copyText(node.path) },
        ]);
      } else {
        showMenu(e, [
          { label: 'Open', onClick: () => openFile(node.path) },
          { label: 'Open to the side', icon: LayoutRightIcon, onClick: () => openToSide(node.path) },
          'separator',
          { label: 'Rename', icon: PencilEdit02Icon, onClick: () => void renameFile(node.path) },
          { label: 'Delete', icon: Delete02Icon, danger: true, onClick: () => void deleteFile(node.path) },
          'separator',
          { label: 'Copy path', icon: Copy01Icon, onClick: () => copyText(node.path) },
        ]);
      }
    },
    [newFile, newFolder, openFile, openToSide, renameFile, deleteFile, copyText, showMenu],
  );

  // Tab right-click: close actions + open-to-side + copy path.
  const tabMenu = useCallback(
    (e: React.MouseEvent, path: string) => {
      showMenu(e, [
        { label: 'Close', onClick: () => closeTab(path) },
        { label: 'Close others', onClick: () => closeOthers(path), disabled: tabs.length <= 1 },
        { label: 'Close all', onClick: () => closeAll() },
        'separator',
        { label: 'Open to the side', icon: LayoutRightIcon, onClick: () => openToSide(path) },
        { label: 'Copy path', icon: Copy01Icon, onClick: () => copyText(path) },
      ]);
    },
    [closeTab, closeOthers, closeAll, openToSide, copyText, tabs.length, showMenu],
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
      <Icon icon={Settings01Icon} />
    </button>
  );
  const settingsModal = settingsOpen && (
    <SettingsPanel
      theme={theme}
      fonts={fonts}
      sidebar={sidebar}
      lineNumbers={lineNumbers}
      fileTypes={fileTypes}
      onTheme={changeTheme}
      onFonts={changeFonts}
      onSidebar={changeSidebar}
      onLineNumbers={changeLineNumbers}
      onFileTypes={changeFileTypes}
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
    <div
      className="app"
      style={{ '--sidebar-width': `${sidebarWidth}px`, '--zoom': zoom } as React.CSSProperties}
    >
      <header className="topbar">
        <button
          className="btn icon-btn"
          title="Toggle sidebar (Ctrl/Cmd-B)"
          aria-label="Toggle sidebar"
          aria-expanded={sidebarVisible}
          onClick={toggleSidebar}
        >
          <Icon icon={Menu01Icon} />
        </button>
        <span className="brand" title="lookmd">
          <Logo height={18} />
        </span>
        <EditMenu
          editApi={editApi}
          onFindInFiles={() => setSearchMode('find')}
          onReplaceInFiles={() => setSearchMode('replace')}
        />
        <span className="workspace-name" title={workspace.root || '/'}>
          {workspace.name}
        </span>
        <button className="btn" onClick={() => switchWorkspace(null)}>
          Change workspace
        </button>
        {settingsButton}
      </header>

      <div
        className={`body${isMobile ? ' body-mobile' : sidebar.autoHide ? ' body-autohide' : ''}${
          sidebarVisible ? '' : ' sidebar-hidden'
        }`}
      >
        {!isMobile && sidebar.autoHide && !sidebarVisible && (
          <div
            className="sidebar-reveal"
            onMouseEnter={revealSidebar}
            aria-hidden="true"
          />
        )}
        {isMobile && sidebarVisible && (
          <div
            className="sidebar-backdrop"
            onClick={() => setDrawerOpen(false)}
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
              <Icon icon={PinIcon} size={16} />
            </button>
            <button
              className="tree-action"
              title="Refresh file tree"
              aria-label="Refresh file tree"
              onClick={() => void loadTree()}
            >
              <Icon icon={RefreshIcon} size={16} />
            </button>
            <CreateMenu
              dir=""
              onNewFile={(dir, ext) => void newFile(dir, ext)}
              onNewFolder={(dir) => void newFolder(dir)}
              label="New in workspace root"
            />
          </div>
          {actionError && (
            <p className="error sidebar-empty sidebar-action-error" onClick={() => setActionError(null)}>
              {actionError} <span className="muted">(dismiss)</span>
            </p>
          )}
          {treeLoading && (
            <div aria-busy="true" aria-label="Loading files">
              <div className="sidebar-loading" style={{ width: '72%' }} />
              <div className="sidebar-loading" style={{ width: '55%' }} />
              <div className="sidebar-loading" style={{ width: '80%' }} />
              <div className="sidebar-loading" style={{ width: '45%' }} />
            </div>
          )}
          {treeError && <p className="error sidebar-empty">{treeError}</p>}
          {!treeLoading && !treeError && (
            <FileTree
              tree={filteredTree}
              activePath={activePath}
              onOpenFile={openFile}
              onNewFile={(dir, ext) => void newFile(dir, ext)}
              onNewFolder={(dir) => void newFolder(dir)}
              onContextMenu={fileTreeMenu}
              onRename={(path) => void renameFile(path)}
              onDelete={(path) => void deleteFile(path)}
            />
          )}
          {activeTab && activeTab.content !== null && (
            <Outline content={activeTab.draft} onJump={jumpToHeading} />
          )}
        </aside>

        {!isMobile && !sidebar.autoHide && sidebarVisible && (
          <div
            className="sidebar-resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            title="Drag to resize"
            onPointerDown={startResize}
          />
        )}

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
                  onContextMenu={(e) => tabMenu(e, t.path)}
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
                    <Icon icon={Cancel01Icon} size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {!activeTab && (
            <div className="view">
              <div className="placeholder">Select a file to read.</div>
            </div>
          )}

          {activeTab && (
            <div className={`panes panes-${splitDir}`}>
              <FilePane
                tab={activeTab}
                mode={effectiveMode(activeTab.path, mode)}
                onMode={setMode}
                lineNumbers={lineNumbers}
                zoom={zoom}
                onZoomIn={zoomIn}
                onZoomOut={zoomOut}
                onZoomReset={zoomReset}
                workspaceKey={workspaceKey}
                docKey={docKeyFor(activeTab)}
                resolveImage={primaryResolveImage}
                onNavigate={primaryNavigate}
                onChangeDraft={(next) => setDraftFor(activeTab.path, next)}
                onSave={() => void savePath(activeTab.path)}
                onDiscardReload={() => void discardReloadPath(activeTab.path)}
                onOverwrite={() => void overwritePath(activeTab.path)}
                focused={splitOn && focusedPane === 'primary'}
                onFocusPane={() => setFocusedPane('primary')}
                onEditorFocusApi={onEditorFocusApi}
                onEditorReleaseApi={onEditorReleaseApi}
                reveal={reveal}
                controls={
                  splitOn ? (
                    <button
                      className="btn icon-btn"
                      title={
                        splitDir === 'row'
                          ? 'Stack panes (horizontal split)'
                          : 'Side-by-side panes (vertical split)'
                      }
                      aria-label="Toggle split orientation"
                      onClick={() => setSplitDir((d) => (d === 'row' ? 'column' : 'row'))}
                    >
                      <Icon icon={splitDir === 'row' ? LayoutTwoRowIcon : LayoutTwoColumnIcon} size={16} />
                    </button>
                  ) : (
                    <button
                      className="btn icon-btn"
                      title="Split: open a second file pane"
                      aria-label="Split editor"
                      onClick={enableSplit}
                    >
                      <Icon icon={LayoutRightIcon} size={16} />
                    </button>
                  )
                }
              />
              {secondaryTab && (
                <FilePane
                  tab={secondaryTab}
                  mode={effectiveMode(secondaryTab.path, secondaryMode)}
                  onMode={setSecondaryMode}
                  lineNumbers={lineNumbers}
                  zoom={zoom}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  onZoomReset={zoomReset}
                  workspaceKey={workspaceKey}
                  docKey={docKeyFor(secondaryTab)}
                  resolveImage={secondaryResolveImage}
                  onNavigate={secondaryNavigate}
                  onChangeDraft={(next) => setDraftFor(secondaryTab.path, next)}
                  onSave={() => void savePath(secondaryTab.path)}
                  onDiscardReload={() => void discardReloadPath(secondaryTab.path)}
                  onOverwrite={() => void overwritePath(secondaryTab.path)}
                  focused={focusedPane === 'secondary'}
                  onFocusPane={() => setFocusedPane('secondary')}
                  openPaths={tabs.map((t) => t.path)}
                  onPick={(p) => setSecondaryPath(p)}
                  onClose={closeSplit}
                  onEditorFocusApi={onEditorFocusApi}
                  onEditorReleaseApi={onEditorReleaseApi}
                />
              )}
            </div>
          )}
        </main>
      </div>

      {settingsModal}
      {paletteOpen && (
        <CommandPalette
          files={visibleFiles}
          onOpen={(p) => {
            openFile(p);
            setPaletteOpen(false);
          }}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {searchMode && source && (
        <WorkspaceSearch
          files={visibleFiles}
          source={source}
          startMode={searchMode}
          onOpen={openFromSearch}
          onClose={() => setSearchMode(null)}
          onAfterReplace={reloadCleanTabs}
        />
      )}
      <ContextMenu menu={ctxMenu} onClose={() => setCtxMenu(null)} />
    </div>
  );
}
