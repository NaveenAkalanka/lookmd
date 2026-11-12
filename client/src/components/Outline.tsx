/**
 * Outline panel: the active file's headings, indented by level. Clicking one
 * jumps to that heading — by slug in the Read page (ids from rehype-slug, same
 * github-slugger algorithm) or by line in the live editor.
 */

import { useMemo } from 'react';
import { extractHeadings } from '../markdown/headings';

interface Props {
  /** The active file's text, or null when no file (or a non-Markdown file) is open. */
  content: string | null;
  onJump: (slug: string, line: number) => void;
}

export function Outline({ content, onJump }: Props) {
  const headings = useMemo(() => (content === null ? [] : extractHeadings(content)), [content]);
  if (content === null) {
    return <p className="muted sidebar-empty">Open a Markdown file to see its outline.</p>;
  }
  if (headings.length === 0) {
    return <p className="muted sidebar-empty">No headings in this file.</p>;
  }
  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <nav className="outline" aria-label="Outline">
      <ul className="outline-list">
        {headings.map((h, i) => (
          <li key={`${h.slug}-${i}`}>
            <button
              className="outline-item"
              style={{ paddingInlineStart: `${10 + (h.level - minLevel) * 12}px` }}
              title={h.text}
              onClick={() => onJump(h.slug, h.line)}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
