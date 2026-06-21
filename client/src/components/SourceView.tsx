/**
 * Source mode: the raw Markdown, read-only, in the mono font — the bytes as they
 * are on disk (or the unsaved draft). Nothing is rendered; the text is only
 * *highlighted* as Markdown via lowlight (highlight.js), reusing the same
 * .hljs-* classes and --syntax-* tokens as Read mode so all three modes match.
 */

import { useMemo } from 'react';
import { common, createLowlight } from 'lowlight';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

const lowlight = createLowlight(common);

interface Props {
  content: string;
}

export function SourceView({ content }: Props) {
  const rendered = useMemo(() => {
    const tree = lowlight.highlight('markdown', content);
    return toJsxRuntime(tree, { Fragment, jsx, jsxs });
  }, [content]);

  return (
    <pre className="source">
      <code className="hljs language-markdown">{rendered}</code>
    </pre>
  );
}
