/**
 * One editor/viewer pane: a file-bar (name or file switcher + Read/Source/Edit
 * toggle + Save), the conflict/save banners, and the file body in the chosen
 * mode. The app shell renders one pane normally and two when split, each bound
 * to its own tab, so two files can be viewed/edited side by side or stacked.
 *
 * The heavy rendering/highlighting stacks (react-markdown, highlight.js,
 * CodeMirror) live here behind React.lazy, loaded only once a file is open.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { Icon } from './Icon';
import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { ModeToggle, type ViewMode } from './ModeToggle';
import { type Tab, tabDirty } from '../tab';
import type { EditorApi } from '../editorApi';

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
        <ModeToggle mode={mode} onChange={onMode} />
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

      <div className="view">
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
    </section>
  );
}
