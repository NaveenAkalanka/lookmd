/**
 * Source mode: the raw Markdown, read-only, in the mono font — the bytes as they
 * are on disk (or the unsaved draft). Nothing is rendered; the text is only
 * *highlighted* as Markdown via lowlight (highlight.js), reusing the same
 * .hljs-* classes and --syntax-* tokens as Read mode so all three modes match.
 *
 * With line numbers on, a gutter is shown alongside non-wrapping text so the
 * numbers stay aligned 1:1 with the lines.
 */

import { useMemo } from 'react';
import { common, createLowlight } from 'lowlight';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';

const lowlight = createLowlight(common);

interface Props {
  content: string;
  lineNumbers?: boolean;
}

export function SourceView({ content, lineNumbers }: Props) {
  const rendered = useMemo(() => {
    const tree = lowlight.highlight('markdown', content);
    return toJsxRuntime(tree, { Fragment, jsx, jsxs });
  }, [content]);

  const gutter = useMemo(() => {
    const lines = content.split('\n').length;
    return Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  }, [content]);

  const code = <code className="hljs language-markdown">{rendered}</code>;

  if (!lineNumbers) {
    return <pre className="source">{code}</pre>;
  }

  return (
    <div className="source-wrap">
      <pre className="source-gutter" aria-hidden="true">
        {gutter}
      </pre>
      <pre className="source source-nowrap">{code}</pre>
    </div>
  );
}
