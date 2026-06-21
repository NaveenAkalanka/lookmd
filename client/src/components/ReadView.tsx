/**
 * Read mode: client-side Markdown render. react-markdown does not emit raw HTML
 * by default, so untrusted file content can't inject markup. GFM adds tables,
 * task lists, strikethrough, and autolinks. rehype-highlight attaches semantic
 * highlight.js classes to fenced code blocks; their colors come from the shared
 * --syntax-* tokens in CSS (no highlight.js theme is imported).
 *
 * Images are resolved through the active file source (`resolveImage`) so that
 * workspace-relative paths load — over the REST asset endpoint or a blob URL for
 * the File System Access source. External URLs pass through untouched.
 */

import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface Props {
  content: string;
  resolveImage?: (src: string) => Promise<string>;
}

export function ReadView({ content, resolveImage }: Props) {
  const components = useMemo<Components | undefined>(() => {
    if (!resolveImage) return undefined;
    return {
      img: ({ src, alt }) => (
        <MarkdownImage src={typeof src === 'string' ? src : ''} alt={alt} resolve={resolveImage} />
      ),
    };
  }, [resolveImage]);

  return (
    <article className="read">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </article>
  );
}

interface ImageProps {
  src: string;
  alt?: string;
  resolve: (src: string) => Promise<string>;
}

function MarkdownImage({ src, alt, resolve }: ImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setFailed(false);
    resolve(src)
      .then((u) => active && setUrl(u))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [src, resolve]);

  if (failed) return <span className="img-missing">🖼 {alt || src}</span>;
  if (url === null) return <span className="img-loading" aria-busy="true" />;
  return <img src={url} alt={alt ?? ''} />;
}
