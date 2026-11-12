/**
 * The Outline's headings: ATX headings outside fenced code, with the slug
 * rehype-slug gives the rendered heading (github-slugger, same dedupe) and the
 * 1-based line, so the outline can jump in the Read page (by id) or in the live
 * editor (by line).
 */

import GithubSlugger from 'github-slugger';

export interface Heading {
  level: number;
  text: string;
  slug: string;
  /** 1-based line number in the file. */
  line: number;
}

export function extractHeadings(md: string): Heading[] {
  const slugger = new GithubSlugger();
  const out: Heading[] = [];
  let inFence = false;
  md.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) return;
    const text = (m[2] ?? '').replace(/[`*_]/g, '').trim();
    if (!text) return;
    out.push({ level: (m[1] ?? '').length, text, slug: slugger.slug(text), line: i + 1 });
  });
  return out;
}
