/**
 * Welcome / empty state. Two ways in:
 *  - open a local folder directly via the File System Access API (no server);
 *  - reopen a recent workspace (a remembered local folder, or a legacy server
 *    path).
 *
 * lookmd opens files from the viewer's own machine, so the File System Access
 * API is the way in — which means a Chromium browser (Chrome, Edge, Brave,
 * Opera). Where the API is missing we say so plainly instead of offering a
 * dead control.
 *
 * The picker builds the matching FileSource and hands it to `onOpen`, so the app
 * shell stays agnostic about where a workspace's bytes come from.
 */

import { useCallback, useState } from 'react';
import { ApiRequestError } from '../api';
import { createRestSource } from '../sources/rest';
import {
  createFsaSource,
  fsaSupported,
  pickDirectory,
  ensurePermission,
} from '../sources/fsa';
import { getHandle, putHandle, deleteHandle } from '../sources/handles';
import type { FileSource } from '../sources/types';
import {
  getRecents,
  removeRecent,
  clearRecents,
  type Workspace,
  type RecentWorkspace,
} from '../storage';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { BrandIcon } from './BrandIcon';
import { ComputerIcon, Cancel01Icon } from '@hugeicons/core-free-icons';

interface Props {
  onOpen: (ws: Workspace, source: FileSource) => void;
}

export function WorkspacePicker({ onOpen }: Props) {
  const [recents, setRecents] = useState<RecentWorkspace[]>(() => getRecents());
  const [error, setError] = useState<string | null>(null);

  // Forget one recent. For a local folder also drop its IndexedDB handle, so
  // "remove" really removes the grant, not just the label.
  const forgetRecent = useCallback(async (r: RecentWorkspace) => {
    if (r.kind === 'fsa') await deleteHandle(r.root).catch(() => undefined);
    setRecents(removeRecent(r.kind, r.root));
  }, []);

  // Forget all recents (and every remembered local-folder handle).
  const forgetAll = useCallback(async () => {
    const fsa = getRecents().filter((r) => r.kind === 'fsa');
    await Promise.all(fsa.map((r) => deleteHandle(r.root).catch(() => undefined)));
    clearRecents();
    setRecents([]);
  }, []);

  // Reopen a recent: rebuild the right source. FSA needs its handle back from
  // IndexedDB plus a (re-)granted permission, which the click gesture allows.
  const openRecent = useCallback(
    async (r: RecentWorkspace) => {
      setError(null);
      if (r.kind === 'fsa') {
        try {
          const rec = await getHandle(r.root);
          if (!rec) {
            setError('That local folder is no longer remembered — open it again above.');
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

  return (
    <div className="picker">
      <div className="picker-card">
        <div className="picker-brand">
          <BrandIcon size={48} />
          <Logo className="picker-logo" height={34} title="lookmd" />
        </div>
        <p className="picker-subtitle">
          Open a folder on this device to start reading and editing Markdown.
        </p>

        {error && <p className="error">{error}</p>}

        {fsaSupported ? (
          <section className="picker-section">
            <h2 className="picker-heading">This computer</h2>
            <button className="btn btn-accent" onClick={() => void openLocal()}>
              Open a local folder…
            </button>
            <p className="picker-hint muted">
              Opens a folder on this device directly in the browser — the files
              never leave your machine. The folder is remembered so you don't
              re-pick it each time.
            </p>
          </section>
        ) : (
          <section className="picker-section">
            <h2 className="picker-heading">Unsupported browser</h2>
            <p className="picker-hint muted">
              lookmd opens folders from your own device using the File System
              Access API, which this browser doesn't support. Please use a
              Chromium-based browser — Chrome, Edge, Brave, or Opera.
            </p>
          </section>
        )}

        {recents.length > 0 && (
          <section className="picker-section">
            <div className="picker-section-head">
              <h2 className="picker-heading">Recent</h2>
              <button className="picker-clear" onClick={() => void forgetAll()}>
                Clear all
              </button>
            </div>
            <ul className="picker-list">
              {recents.map((r) => (
                <li key={`${r.kind}:${r.root}`} className="picker-recent-row">
                  <button className="picker-item" onClick={() => void openRecent(r)}>
                    <span className="picker-item-name">
                      {r.kind === 'fsa' && <Icon icon={ComputerIcon} size={16} />}
                      {r.name}
                    </span>
                    <span className="picker-item-path">
                      {r.kind === 'fsa' ? 'local folder' : r.root || '/'}
                    </span>
                  </button>
                  <button
                    className="picker-recent-remove"
                    aria-label={`Remove ${r.name} from recent`}
                    title="Remove from recent"
                    onClick={() => void forgetRecent(r)}
                  >
                    <Icon icon={Cancel01Icon} size={15} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
