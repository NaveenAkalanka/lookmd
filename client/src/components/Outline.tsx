/**
 * Outline panel: the active file's headings, indented by level. Clicking one
 * jumps to that heading in the Read view. Slugs are generated with the same
 * github-slugger algorithm rehype-slug uses, so the ids line up.
 */

import { useMemo } from 'react';
import GithubSlugger from 'github-slugger';

interface Heading {
  level: number;
  text: string;
  slug: string;
}

function extractHeadings(md: string): Heading[] {
  const slugger = new GithubSlugger();
  const out: Heading[] = [];
  let inFence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = (m[2] ?? '').replace(/[`*_]/g, '').trim();
    if (!text) continue;
    out.push({ level: (m[1] ?? '').length, text, slug: slugger.slug(text) });
  }
  return out;
}

interface Props {
  content: string;
  onJump: (slug: string) => void;
}

export function Outline({ content, onJump }: Props) {
  const headings = useMemo(() => extractHeadings(content), [content]);
  if (headings.length === 0) return null;
  const minLevel = Math.min(...headings.map((h) => h.level));

  return (
    <nav className="outline" aria-label="Outline">
      <div className="outline-head">Outline</div>
      <ul className="outline-list">
        {headings.map((h, i) => (
          <li key={`${h.slug}-${i}`}>
            <button
              className="outline-item"
              style={{ paddingInlineStart: `${10 + (h.level - minLevel) * 12}px` }}
              title={h.text}
              onClick={() => onJump(h.slug)}
            >
              {h.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
