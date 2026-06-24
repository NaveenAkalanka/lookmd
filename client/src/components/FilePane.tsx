/**
 * One editor/viewer pane: a file-bar (name or file switcher + Read/Source/Edit
 * toggle + Save), the conflict/save banners, and the file body in the chosen
 * mode. The app shell renders one pane normally and two when split, each bound
 * to its own tab, so two files can be viewed/edited side by side or stacked.
 *
 * The heavy rendering/highlighting stacks (react-markdown, highlight.js,
 * CodeMirror) live here behind React.lazy, loaded only once a file is open.
 */

import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { isMarkdownPath } from '@lookmd/shared';
import { Icon } from './Icon';
import { Cancel01Icon, MinusSignIcon, PlusSignIcon, Edit02Icon } from '@hugeicons/core-free-icons';
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
import { ZOOM_MIN, ZOOM_MAX } from '../settings';
import { type Tab, tabDirty } from '../tab';
import type { EditorApi } from '../editorApi';

const MARKDOWN_MODES: ViewMode[] = ['read', 'source', 'edit', 'split'];
const TEXT_MODES: ViewMode[] = ['source', 'edit'];

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
  lineNumbers: boolean;
  /** Content zoom multiplier and its steppers (global; same value in every pane). */
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
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
  lineNumbers,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomReset,
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

  // The overlay is offered on Read/Source/Edit (not the split combo view).
  const annotatable = mode === 'read' || mode === 'source' || mode === 'edit';
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
      const host: HTMLElement | null =
        mode === 'source'
          ? view.querySelector('.source-wrap')
          : mode === 'edit'
            ? view.querySelector('.cm-scroller')
            : view;
      if (host) setScrollHost(host);
      else if (tries++ < 60) raf = requestAnimationFrame(find);
    };
    find();
    return () => cancelAnimationFrame(raf);
  }, [overlayOn, mode, tab.path, tab.loading]);

  // Entering annotate mode in the editor: drop keyboard focus so typing is locked
  // (the overlay already blocks the mouse). Editing resumes when toggled off.
  useEffect(() => {
    if (overlayOn && mode === 'edit') {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }, [overlayOn, mode]);

  const toggleAnnotate = () => setAnnotateOn((on) => !on);

  return (
    <section
      className={`pane${focused ? ' pane-focused' : ''}`}
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
        <div className="zoom-control" role="group" aria-label="Zoom">
          <button
            onClick={onZoomOut}
            disabled={zoom <= ZOOM_MIN}
            title="Zoom out (Ctrl/Cmd -)"
            aria-label="Zoom out"
          >
            <Icon icon={MinusSignIcon} size={14} />
          </button>
          <button
            className="zoom-level"
            onClick={onZoomReset}
            title="Reset zoom (Ctrl/Cmd 0)"
            aria-label={`Zoom ${Math.round(zoom * 100)} percent, click to reset`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            onClick={onZoomIn}
            disabled={zoom >= ZOOM_MAX}
            title="Zoom in (Ctrl/Cmd +)"
            aria-label="Zoom in"
          >
            <Icon icon={PlusSignIcon} size={14} />
          </button>
        </div>
        {annotatable && (
          <button
            className={`btn icon-btn${annotateOn ? ' icon-btn-active' : ''}`}
            title="Annotate — draw temporary marks over this file"
            aria-label="Toggle annotation overlay"
            aria-pressed={annotateOn}
            onClick={toggleAnnotate}
          >
            <Icon icon={Edit02Icon} size={15} />
          </button>
        )}
        <button className="btn btn-accent" onClick={onSave} disabled={!dirty || tab.saving}>
          {tab.saving ? 'Saving…' : 'Save'}
        </button>
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

      <div className={`pane-body${overlayOn ? ' annotate-active' : ''}${overlayOn && mode === 'edit' ? ' annotate-locked' : ''}`}>
      <div className="view" ref={viewRef}>
        {tab.loading && <div className="placeholder">Loading {tab.path}…</div>}
        {tab.error && <div className="placeholder error">{tab.error}</div>}
        {tab.content !== null && !tab.loading && !tab.error && (
          <Suspense fallback={<div className="placeholder">Loading…</div>}>
            {mode === 'read' && (
              <ReadView content={tab.draft} resolveImage={resolveImage} onNavigate={onNavigate} />
            )}
            {mode === 'source' && <SourceView content={tab.draft} lineNumbers={lineNumbers} />}
            {mode === 'edit' && (
              <Editor
                value={tab.draft}
                docKey={docKey}
                onChange={onChangeDraft}
                onSave={onSave}
                lineNumbers={lineNumbers}
                onFocusApi={onEditorFocusApi}
                onReleaseApi={onEditorReleaseApi}
                reveal={reveal}
              />
            )}
            {mode === 'split' && (
              <div className="split">
                <div className="split-pane split-editor">
                  <Editor
                    value={tab.draft}
                    docKey={docKey}
                    onChange={onChangeDraft}
                    onSave={onSave}
                    lineNumbers={lineNumbers}
                    onFocusApi={onEditorFocusApi}
                    onReleaseApi={onEditorReleaseApi}
                    reveal={reveal}
                  />
                </div>
                <div className="split-pane split-preview">
                  <ReadView content={tab.draft} resolveImage={resolveImage} onNavigate={onNavigate} />
                </div>
              </div>
            )}
          </Suspense>
        )}
      </div>

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
            {mode === 'edit' && (
              <span className="annotate-pill">Editing locked while annotating</span>
            )}
          </>
        )}
      </div>
    </section>
  );
}
