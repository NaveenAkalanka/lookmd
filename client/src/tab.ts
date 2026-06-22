/**
 * One open file, shared by the app shell and the file panes. `content`/`hash`
 * are the last-saved snapshot (null until the initial load resolves); `draft` is
 * the live buffer shown in every mode. Lives in its own module so both `App` and
 * `FilePane` can import it without a circular dependency.
 */

export interface Tab {
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

export function newTab(path: string): Tab {
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

export function tabDirty(t: Tab): boolean {
  return t.content !== null && t.draft !== t.content;
}
