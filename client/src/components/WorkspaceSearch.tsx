/**
 * Find / Replace in Files: the sidebar's Search view. It searches every text
 * file in the workspace for a query and lists the matches by file and line. With a
 * replacement it can rewrite all matches across files (hash-checked saves via
 * the active source). Clicking a result opens that file at the matching line.
 *
 * Searching reads each file through the active FileSource, so it works for both
 * the REST backend and the local-folder (FSA) source.
 */

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Search01Icon } from '@hugeicons/core-free-icons';
import { ApiRequestError } from '../api';
import type { FileSource } from '../sources/types';

interface MatchLine {
  line: number;
  text: string;
}
interface FileResult {
  path: string;
  matches: MatchLine[];
}

/** A request from outside (shortcut / Edit menu) to focus the panel, optionally
 *  with Replace showing. A new `nonce` re-applies it while already open. */
export interface SearchRequest {
  mode: 'find' | 'replace';
  nonce: number;
}

interface Props {
  files: string[];
  source: FileSource;
  request: SearchRequest | null;
  onOpen: (path: string, line: number) => void;
  /** Called after a Replace All writes to disk, so open tabs can refresh. */
  onAfterReplace?: () => void;
  /** Whether writes are possible (hides Replace in a read-only build). */
  canWrite?: boolean;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matches(text: string, q: string, caseSensitive: boolean): boolean {
  return caseSensitive ? text.includes(q) : text.toLowerCase().includes(q.toLowerCase());
}

export function WorkspaceSearch({
  files,
  source,
  request,
  onOpen,
  onAfterReplace,
  canWrite = true,
}: Props) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [results, setResults] = useState<FileResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Each outside request focuses the query box (and shows Replace if asked).
  useEffect(() => {
    if (!request) return;
    if (request.mode === 'replace' && canWrite) setShowReplace(true);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [request, canWrite]);

  const totalMatches = results?.reduce((n, r) => n + r.matches.length, 0) ?? 0;

  const runSearch = async () => {
    const q = query;
    if (q === '') {
      setResults(null);
      setStatus(null);
      return;
    }
    setBusy(true);
    setStatus(null);
    const out: FileResult[] = [];
    for (const path of files) {
      try {
        const { content } = await source.file(path);
        const lines = content.split(/\r\n|\r|\n/);
        const found: MatchLine[] = [];
        lines.forEach((text, i) => {
          if (matches(text, q, caseSensitive)) found.push({ line: i + 1, text: text.trim().slice(0, 200) });
        });
        if (found.length) out.push({ path, matches: found });
      } catch {
        /* skip files that can't be read */
      }
    }
    setResults(out);
    setBusy(false);
    setStatus(
      out.length === 0
        ? 'No matches.'
        : `${out.reduce((n, r) => n + r.matches.length, 0)} match(es) in ${out.length} file(s).`,
    );
  };

  const replaceAll = async () => {
    if (!results || query === '') return;
    if (
      !window.confirm(
        `Replace ${totalMatches} occurrence(s) across ${results.length} file(s)?\n\nThis writes to disk.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setStatus(null);
    const re = new RegExp(escapeRe(query), caseSensitive ? 'g' : 'gi');
    let changed = 0;
    let failed = 0;
    for (const r of results) {
      try {
        const { content, hash } = await source.file(r.path);
        const next = content.replace(re, () => replacement);
        if (next !== content) {
          await source.save(r.path, next, hash);
          changed += 1;
        }
      } catch (err) {
        failed += 1;
        if (!(err instanceof ApiRequestError)) throw err;
      }
    }
    setBusy(false);
    onAfterReplace?.();
    // Refresh the results first, then report: runSearch sets its own status
    // ("No matches."), which would otherwise hide the replace summary.
    await runSearch();
    setStatus(`Replaced in ${changed} file(s)${failed ? `, ${failed} failed` : ''}.`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runSearch();
    }
  };

  return (
    <div className="search-panel" aria-label="Find in files">
      <div className="search-controls">
        <div className="search-input-row">
          <Icon icon={Search01Icon} size={16} />
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search all files"
            aria-label="Search all files"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        {showReplace && (
          <input
            className="search-input search-replace"
            placeholder="Replace with"
            aria-label="Replace with"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            onKeyDown={onKeyDown}
          />
        )}
        <label className="setting-check search-case">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Match case
        </label>
        <div className="search-actions">
          <button className="btn btn-accent" onClick={() => void runSearch()} disabled={busy || query === ''}>
            {busy ? 'Working…' : 'Search'}
          </button>
          {canWrite &&
            (showReplace ? (
              <button
                className="btn"
                onClick={() => void replaceAll()}
                disabled={busy || !results || totalMatches === 0}
              >
                Replace all
              </button>
            ) : (
              <button className="btn" onClick={() => setShowReplace(true)}>
                Replace…
              </button>
            ))}
        </div>
        {status && (
          <p className="muted search-status" role="status">
            {status}
          </p>
        )}
        {!results && !status && (
          <p className="muted search-status">Press Enter to search every file in the workspace.</p>
        )}
      </div>

      <div className="search-results">
        {results?.map((r) => (
          <div key={r.path} className="search-file">
            <div className="search-file-head" title={r.path}>
              <span className="search-file-path">{r.path}</span>
              <span className="search-file-count">{r.matches.length}</span>
            </div>
            {r.matches.map((m) => (
              <button
                key={`${r.path}:${m.line}`}
                className="search-hit"
                onClick={() => onOpen(r.path, m.line)}
                title={`Open ${r.path} at line ${m.line}`}
              >
                <span className="search-hit-line">{m.line}</span>
                <span className="search-hit-text">{m.text}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
