/**
 * "Browse the server": pick a folder inside the lookmd server's BASE directory.
 *
 * Only the picker's fallback for browsers without the File System Access API
 * (Android and iOS browsers, Firefox, Safari), so they still have a way in when a
 * lookmd server is running. The server scopes every listing to BASE and
 * re-validates the chosen root on each request; this component is UX only.
 */

import { useCallback, useEffect, useState } from 'react';
import type { FolderEntry } from '@lookmd/shared';
import { api, ApiRequestError } from '../api';
import { workspaceName } from '../storage';
import { Icon } from './Icon';
import { Folder01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons';

interface Listing {
  path: string;
  parent: string | null;
  folders: FolderEntry[];
}

interface Props {
  /** Open the folder at `root` (POSIX, relative to BASE; '' is BASE itself). */
  onOpen: (root: string, name: string) => void;
}

export function ServerBrowser({ onOpen }: Props) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = useCallback((to: string) => {
    setLoading(true);
    setError(null);
    api
      .folders(to)
      .then((res) => setListing({ path: res.path, parent: res.parent, folders: res.folders }))
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not list folders.'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => browse(''), [browse]);

  if (!listing) {
    return error ? <p className="error">{error}</p> : <p className="muted">Loading folders…</p>;
  }

  return (
    <>
      <div className="picker-breadcrumb">
        <code>/{listing.path}</code>
        <button
          className="btn"
          disabled={listing.parent === null || loading}
          onClick={() => listing.parent !== null && browse(listing.parent)}
        >
          <Icon icon={ArrowUp01Icon} size={15} /> Up
        </button>
        <button
          className="btn btn-accent"
          disabled={loading}
          onClick={() => onOpen(listing.path, workspaceName(listing.path))}
        >
          Open this folder
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {!loading && listing.folders.length === 0 && (
        <p className="muted">No sub-folders here. You can open this folder.</p>
      )}

      <ul className="picker-list" aria-busy={loading}>
        {listing.folders.map((f) => (
          <li key={f.path}>
            <button className="picker-item" disabled={loading} onClick={() => browse(f.path)}>
              <span className="picker-item-name">
                <Icon icon={Folder01Icon} size={16} /> {f.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
