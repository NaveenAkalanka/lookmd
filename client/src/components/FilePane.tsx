/**
 * One editor/viewer pane: a file-bar (name or file switcher + Read/Source/Split
 * toggle + the Edit toggle + Save), the editing toolbar while Edit is on, the
 * conflict/save banners, and the file body in the chosen mode.
 *
 * Edit is a toggle on top of the view, not a view of its own: Source + Edit is
 * the raw editor, Split + Edit puts the raw editor beside the rendered preview,
 * and Read + Edit is the live preview (rendered, raw only on the cursor's
 * lines). All three share one editor slot, so switching views while editing
 * keeps the same editor (cursor, undo history) mounted. The app shell renders one pane normally and two when split, each bound
 * to its own tab, so two files can be viewed/edited side by side or stacked.
 *
 * The heavy rendering/highlighting stacks (react-markdown, highlight.js,
 * CodeMirror) live here behind React.lazy, loaded only once a file is open.
 */

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { isMarkdownPath } from '@lookmd/shared';
import { Icon } from './Icon';
import {
  Cancel01Icon,
  HighlighterIcon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons';
import { EditToolbar } from './EditToolbar';
import { ModeToggle, type ViewMode } from './ModeToggle';
import { AnnotationLayer } from './AnnotationLayer';
import { AnnotationToolbar } from './AnnotationToolbar';
import { useAnnotations } from '../useAnnotations';
import {
  fileKey,
  textSizeFromWidth,
  widthFromTextSize,
  type ToolId,
  type AnnotColor,
} from '../annotations';
import type { ZoomSlot } from '../settings';
import { ZoomPill } from './ZoomPill';
import { Divider } from './Divider';
import { type Tab, tabDirty } from '../tab';
import type { EditorApi } from '../editorApi';

const MARKDOWN_MODES: ViewMode[] = ['read', 'source', 'split'];
const TEXT_MODES: ViewMode[] = ['source'];

const ReadView = lazy(() => import('./ReadView').then((m) => ({ default: m.ReadView })));
const SourceView = lazy(() => import('./SourceView').then((m) => ({ default: m.SourceView })));
const Editor = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })));

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

interface Props {
  tab: Tab;
  mode: ViewMode;
  onMode: (m: ViewMode) => void;
  /** Edit toggle: makes the current view editable. */
  editing: boolean;
  onEditing: (on: boolean) => void;
  /** Whether this file can be saved at all (false in a read-only build). */
  canWrite: boolean;
  lineNumbers: boolean;
  /** This pane's zoom level for each view side (Read, Source, Split's two sides). */
  zoom: Record<ZoomSlot, number>;
  onZoom: (slot: ZoomSlot, action: 'in' | 'out' | 'reset') => void;
  /** The side the pointer is over / last clicked, for Ctrl/Cmd +/-/0. */
  onZoomTarget: (slot: ZoomSlot) => void;
  /** Split's editor | preview divider (share of the editor side). */
  splitRatio: number;
  onSplitRatio: (ratio: number, commit: boolean) => void;
  /** This pane's share when two file panes are open (flex-basis), if any. */
  basis?: number;
  /** Identity of the active workspace, for keying this file's annotations. */
  workspaceKey: string;
  docKey: string;
  resolveImage: (src: string) => Promise<string>;
  onNavigate: (href: string) => void;
  onChangeDraft: (next: string) => void;
  onSave: () => void;
  onDiscardReload: () => void;
  onOverwrite: () => void;
  /** Marks the pane that keyboard Save targets; only meaningful when split. */
  focused?: boolean;
  onFocusPane?: () => void;
  /** Extra controls (e.g. split toggle) shown in the file-bar. */
  controls?: ReactNode;
  /** Secondary pane: a switcher over the open tabs + a close button. */
  openPaths?: string[];
  onPick?: (path: string) => void;
  onClose?: () => void;
  /** Wire the editor's command API (for the Edit menu) and line reveal. */
  onEditorFocusApi?: (api: EditorApi) => void;
  onEditorReleaseApi?: (api: EditorApi) => void;
  reveal?: { line: number; nonce: number };
}

export function FilePane({
  tab,
  mode,
  onMode,
  editing,
  onEditing,
  canWrite,
  lineNumbers,
  zoom,
  onZoom,
  onZoomTarget,
  splitRatio,
  onSplitRatio,
  basis,
  workspaceKey,
  docKey,
  resolveImage,
  onNavigate,
  onChangeDraft,
  onSave,
  onDiscardReload,
  onOverwrite,
  focused,
  onFocusPane,
  controls,
  openPaths,
  onPick,
  onClose,
  onEditorFocusApi,
  onEditorReleaseApi,
  reveal,
}: Props) {
  const dirty = tabDirty(tab);
  const available = isMarkdownPath(tab.path) ? MARKDOWN_MODES : TEXT_MODES;

  // --- Annotation overlay (per-pane). Never touches the file. ---
  const [annotateOn, setAnnotateOn] = useState(false);
  const [tool, setTool] = useState<ToolId>('pen');
  const [color, setColor] = useState<AnnotColor>('red');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const annot = useAnnotations(fileKey(workspaceKey, tab.path));

  const viewRef = useRef<HTMLDivElement | null>(null);
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null);
  // The mounted editor's command API, for this pane's toolbar.
  const [paneApi, setPaneApi] = useState<EditorApi | null>(null);

  // What renders: with Edit on every view has the editor; in Read it is the
  // live preview (same editor slot, live look).
  const editOn = editing && canWrite;
  const shown: ViewMode = mode;
  const editorShown = editOn;
  const live = editOn && mode === 'read';
  // Read view without the editor: the react-markdown page.
  const readPage = shown === 'read' && !live;
  // The editor slot's zoom side.
  const editorSlot: ZoomSlot = live ? 'read' : shown === 'split' ? 'splitEditor' : 'source';
  const editorSlotLabel = live ? 'Read' : shown === 'split' ? 'Editor' : 'Source';

  // The overlay is offered on the single-column views (not a split).
  const annotatable = shown === 'read' || shown === 'source';
  const overlayOn = annotateOn && annotatable;

  // Switching tool away from Select, changing file, or closing the overlay drops
  // any selection.
  const handleTool = (t: ToolId) => {
    setTool(t);
    if (t !== 'select') setSelectedId(null);
  };
  useEffect(() => setSelectedId(null), [tab.path, overlayOn]);

  // Selecting a mark mirrors its colour/size into the toolbar so the controls
  // read back its current values and then edit it in place.
  const selectMark = (id: string | null) => {
    setSelectedId(id);
    if (!id) return;
    const m = annot.marks.find((mk) => mk.id === id);
    if (!m) return;
    setColor(m.color);
    if (m.tool === 'text') setStrokeWidth(widthFromTextSize(m.size));
    else if ('width' in m) setStrokeWidth(m.width);
  };

  // Colour / width controls set the default for new marks AND edit the selection.
  const handleColor = (c: AnnotColor) => {
    setColor(c);
    if (selectedId) annot.updateMark(selectedId, { color: c });
  };
  const handleWidth = (w: number) => {
    setStrokeWidth(w);
    if (!selectedId) return;
    const m = annot.marks.find((mk) => mk.id === selectedId);
    if (m?.tool === 'text') annot.updateMark(selectedId, { size: textSizeFromWidth(w) });
    else if (m) annot.updateMark(selectedId, { width: w });
  };

  // Delete the selected mark (toolbar button + Delete/Backspace key).
  const eraseSelected = annot.eraseMark;
  const deleteSelected = () => {
    if (selectedId) {
      eraseSelected(selectedId);
      setSelectedId(null);
    }
  };

  // Delete / Backspace removes the selected mark; Escape deselects. Ignored while
  // typing in the text-note input.
  useEffect(() => {
    if (!overlayOn || !selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        eraseSelected(selectedId);
        setSelectedId(null);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOn, selectedId, eraseSelected]);

  // Ctrl/Cmd-Z undo, Ctrl/Cmd-Shift-Z (or Ctrl/Cmd-Y) redo — only while the
  // overlay is on, so they don't shadow the editor's own history otherwise.
  const { undo: annotUndo, redo: annotRedo } = annot;
  useEffect(() => {
    if (!overlayOn) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        annotUndo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        annotRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overlayOn, annotUndo, annotRedo]);

  // Locate the element that actually scrolls for the current mode, so the overlay
  // can anchor marks to the content. CodeMirror's scroller mounts async, so retry.
  useEffect(() => {
    if (!overlayOn) {
      setScrollHost(null);
      return;
    }
    let raf = 0;
    let tries = 0;
    const find = () => {
      const view = viewRef.current;
      if (!view) return;
      // The editor (any view with Edit on, live preview included) scrolls in
      // .cm-scroller; the Read page scrolls the view; read-only Source its wrap.
      const host: HTMLElement | null = editorShown
        ? view.querySelector('.cm-scroller')
        : shown !== 'source'
          ? view
          : (view.querySelector('.source-wrap') ?? view.querySelector('.split-scroll'));
      if (host) setScrollHost(host);
      else if (tries++ < 60) raf = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [overlayOn, shown, editorShown, tab.path, tab.loading]);

  // Entering annotate mode in the editor: drop keyboard focus so typing is locked
  // (the overlay already blocks the mouse). Editing resumes when toggled off.
  useEffect(() => {
    if (overlayOn && editorShown) {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, [overlayOn, editorShown]);

  const toggleAnnotate = () => setAnnotateOn((on) => !on);

  return (
    <section
      className={`pane${focused ? ' pane-focused' : ''}`}
      style={basis !== undefined ? { flex: `0 0 ${basis * 100}%` } : undefined}
      onMouseDownCapture={onFocusPane}
    >
      <div className="file-bar">
        {openPaths ? (
          <select
            className="pane-switch"
            value={tab.path}
            title={tab.path}
            onChange={(e) => onPick?.(e.target.value)}
          >
            {openPaths.map((p) => (
              <option key={p} value={p}>
                {baseName(p)}
              </option>
            ))}
          </select>
        ) : (
          <span className="file-bar-name" title={tab.path}>
            {tab.path}
            {dirty && (
              <span className="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes">
                ●
              </span>
            )}
          </span>
        )}
        <ModeToggle mode={mode} onChange={onMode} available={available} />
        {canWrite && (
          <button
            className={`btn edit-toggle${editOn ? ' edit-toggle-on' : ''}`}
            title={editOn ? 'Stop editing (Ctrl/Cmd-E)' : 'Edit this file (Ctrl/Cmd-E)'}
            aria-pressed={editOn}
            onClick={() => onEditing(!editOn)}
          >
            <Icon icon={PencilEdit02Icon} size={15} />
            <span className="btn-label">Edit</span>
          </button>
        )}
        {annotatable && (
          <button
            className={`btn icon-btn${annotateOn ? ' icon-btn-active' : ''}`}
            title="Annotate — draw temporary marks over this file"
            aria-label="Toggle annotation overlay"
            aria-pressed={annotateOn}
            onClick={toggleAnnotate}
          >
            <Icon icon={HighlighterIcon} size={15} />
          </button>
        )}
        {canWrite && (
          <button className="btn btn-accent" onClick={onSave} disabled={!dirty || tab.saving}>
            {tab.saving ? 'Saving…' : 'Save'}
          </button>
        )}
        {controls}
        {onClose && (
          <button
            className="btn icon-btn"
            title="Close split"
            aria-label="Close split pane"
            onClick={onClose}
          >
            <Icon icon={Cancel01Icon} size={15} />
          </button>
        )}
      </div>

      {editorShown && <EditToolbar api={paneApi} />}

      {tab.conflict && (
        <div className="banner banner-warn">
          <span>
            This file changed on disk since you opened it. Saving now would clobber that change.
          </span>
          <span className="banner-actions">
            <button className="btn" onClick={onDiscardReload}>
              Reload from disk
            </button>
            <button className="btn" onClick={onOverwrite} disabled={tab.saving}>
              Overwrite anyway
            </button>
          </span>
        </div>
      )}
      {tab.saveError && <div className="banner banner-error">{tab.saveError}</div>}

      <div
        className={`pane-body${readPage ? ' zoom-host' : ''}${overlayOn ? ' annotate-active' : ''}${overlayOn && editorShown ? ' annotate-locked' : ''}`}
        onPointerEnter={readPage ? () => onZoomTarget('read') : undefined}
        onPointerDownCapture={readPage ? () => onZoomTarget('read') : undefined}
      >
      <div
        className="view"
        ref={viewRef}
        style={readPage ? ({ '--zoom': zoom.read } as React.CSSProperties) : undefined}
      >
        {tab.loading && <div className="placeholder">Loading {tab.path}…</div>}
        {tab.error && <div className="placeholder error">{tab.error}</div>}
        {tab.content !== null && !tab.loading && !tab.error && (
          <Suspense fallback={<div className="placeholder">Loading…</div>}>
            {readPage && (
              <ReadView content={tab.draft} resolveImage={resolveImage} onNavigate={onNavigate} />
            )}
            {!readPage && (
              <div className={`split${shown === 'split' ? '' : ' split-single'}`}>
                {/* Always the first child, so the editor stays mounted when the
                    preview column comes and goes. */}
                <div
                  className="split-pane split-editor zoom-host"
                  style={{
                    '--zoom': zoom[editorSlot],
                    ...(shown === 'split' ? { flex: `0 0 ${splitRatio * 100}%` } : {}),
                  } as React.CSSProperties}
                  onPointerEnter={() => onZoomTarget(editorSlot)}
                  onPointerDownCapture={() => onZoomTarget(editorSlot)}
                >
                  <div className="split-scroll">
                    {editorShown ? (
                      <Editor
                        value={tab.draft}
                        docKey={docKey}
                        onChange={onChangeDraft}
                        onSave={onSave}
                        lineNumbers={lineNumbers}
                        onFocusApi={onEditorFocusApi}
                        onReleaseApi={onEditorReleaseApi}
                        reveal={reveal}
                        onApi={setPaneApi}
                        variant={live ? 'live' : 'source'}
                        resolveImage={resolveImage}
                        onNavigate={onNavigate}
                      />
                    ) : (
                      <SourceView content={tab.draft} lineNumbers={lineNumbers} />
                    )}
                  </div>
                  <ZoomPill
                    zoom={zoom[editorSlot]}
                    label={editorSlotLabel}
                    onIn={() => onZoom(editorSlot, 'in')}
                    onOut={() => onZoom(editorSlot, 'out')}
                    onReset={() => onZoom(editorSlot, 'reset')}
                  />
                </div>
                {shown === 'split' && (
                  <Divider
                    ratio={splitRatio}
                    label="Resize editor and preview"
                    onChange={(r) => onSplitRatio(r, false)}
                    onCommit={(r) => onSplitRatio(r, true)}
                  />
                )}
                {shown === 'split' && (
                  <div
                    className="split-pane split-preview zoom-host"
                    style={{ '--zoom': zoom.splitPreview } as React.CSSProperties}
                    onPointerEnter={() => onZoomTarget('splitPreview')}
                    onPointerDownCapture={() => onZoomTarget('splitPreview')}
                  >
                    <div className="split-scroll">
                      <ReadView content={tab.draft} resolveImage={resolveImage} onNavigate={onNavigate} />
                    </div>
                    <ZoomPill
                      zoom={zoom.splitPreview}
                      label="Preview"
                      onIn={() => onZoom('splitPreview', 'in')}
                      onOut={() => onZoom('splitPreview', 'out')}
                      onReset={() => onZoom('splitPreview', 'reset')}
                    />
                  </div>
                )}
              </div>
            )}
          </Suspense>
        )}
      </div>
        {readPage && tab.content !== null && !tab.loading && !tab.error && (
          <ZoomPill
            zoom={zoom.read}
            label="Read"
            onIn={() => onZoom('read', 'in')}
            onOut={() => onZoom('read', 'out')}
            onReset={() => onZoom('read', 'reset')}
          />
        )}

        {overlayOn && (
          <>
            <AnnotationToolbar
              tool={tool}
              color={color}
              width={strokeWidth}
              pinned={annot.pinned}
              hasSelection={selectedId !== null}
              canUndo={annot.canUndo}
              canRedo={annot.canRedo}
              onTool={handleTool}
              onColor={handleColor}
              onWidth={handleWidth}
              onUndo={annot.undo}
              onRedo={annot.redo}
              onClear={annot.clear}
              onDeleteSelected={deleteSelected}
              onPinned={annot.setPinned}
              onClose={() => setAnnotateOn(false)}
            />
            <AnnotationLayer
              marks={annot.marks}
              tool={tool}
              color={color}
              width={strokeWidth}
              selectedId={selectedId}
              scrollHost={scrollHost}
              onCommit={annot.addMark}
              onErase={annot.eraseMark}
              onSelect={selectMark}
              onUpdate={annot.updateMark}
            />
            {editorShown && (
              <span className="annotate-pill">Editing locked while annotating</span>
            )}
          </>
        )}
      </div>
    </section>
  );
}
