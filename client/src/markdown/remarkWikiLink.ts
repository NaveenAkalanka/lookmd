/**
 * A small remark plugin that turns `[[Note]]` / `[[path/Note|alias]]` wiki-style
 * references into ordinary Markdown links. The target gets a `.md` extension if
 * it has none; the alias (after `|`) becomes the link text. The Read view's link
 * handler then resolves and opens them like any other internal link.
 */

import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, Link, PhrasingContent } from 'mdast';

const WIKILINK = /\[\[([^\]]+)\]\]/g;

export function remarkWikiLink() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (parent == null || index == null) return;
      const value = node.value;
      WIKILINK.lastIndex = 0;
      if (!WIKILINK.test(value)) return;

      WIKILINK.lastIndex = 0;
      const children: PhrasingContent[] = [];
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKILINK.exec(value)) !== null) {
        const inner = m[1];
        if (inner === undefined) continue;
        if (m.index > last) {
          children.push({ type: 'text', value: value.slice(last, m.index) });
        }
        const parts = inner.split('|');
        const target = (parts[0] ?? '').trim();
        const label = (parts[1] ?? parts[0] ?? '').trim();
        const url = /\.[a-z0-9]+$/i.test(target) ? target : `${target}.md`;
        const link: Link = {
          type: 'link',
          url,
          children: [{ type: 'text', value: label }],
        };
        children.push(link);
        last = WIKILINK.lastIndex;
      }
      if (last < value.length) {
        children.push({ type: 'text', value: value.slice(last) });
      }
      parent.children.splice(index, 1, ...children);
      return [SKIP, index + children.length];
    });
  };
}
