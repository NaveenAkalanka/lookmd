/**
 * Quick-open palette (Ctrl/Cmd-P): a floating finder that fuzzy-matches file
 * paths and opens the chosen one in a tab. Pure UI — it reports the pick upward.
 * Closes on backdrop click, Escape, or after a selection.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Search01Icon } from '@hugeicons/core-free-icons';

interface Props {
  files: string[];
  onOpen: (path: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 50;

/** Subsequence fuzzy score: all query chars must appear in order. Higher is a
 *  better match (contiguous runs and matches in the file name score more). */
function score(path: string, query: string): number | null {
  const p = path.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  let streak = 0;
  let total = 0;
  const nameStart = p.lastIndexOf('/') + 1;
  for (let pi = 0; pi < p.length && qi < q.length; pi++) {
    if (p[pi] === q[qi]) {
      streak += 1;
      total += streak + (pi >= nameStart ? 2 : 0); // favor file-name hits
      qi += 1;
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? total : null;
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i) : '';
}

export function CommandPalette({ files, onOpen, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (query.trim() === '') return files.slice(0, MAX_RESULTS);
    return files
      .map((f) => ({ f, s: score(f, query.trim()) }))
      .filter((r): r is { f: string; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s || a.f.length - b.f.length)
      .slice(0, MAX_RESULTS)
      .map((r) => r.f);
  }, [files, query]);

  // Keep the highlighted row in range as results change.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, results.length - 1)));
  }, [results.length]);

  const choose = (path: string | undefined) => {
    if (path) onOpen(path);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Quick open"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="palette-input-row">
          <Icon icon={Search01Icon} size={18} />
          <input
            ref={inputRef}
            className="palette-input"
            placeholder="Go to file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul className="palette-list">
          {results.length === 0 && <li className="palette-empty">No matching files</li>}
          {results.map((path, i) => (
            <li key={path}>
              <button
                className={`palette-item${i === active ? ' palette-item-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(path)}
              >
                <span className="palette-item-name">{baseName(path)}</span>
                {dirName(path) && <span className="palette-item-dir">{dirName(path)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
