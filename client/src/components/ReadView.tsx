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
import rehypeSlug from 'rehype-slug';
import { remarkWikiLink } from '../markdown/remarkWikiLink';
import { CodeBlock } from './CodeBlock';
import { Icon } from './Icon';
import { ImageNotFound01Icon } from '@hugeicons/core-free-icons';

interface Props {
  content: string;
  resolveImage?: (src: string) => Promise<string>;
  /** Open an internal link (workspace-relative href) — e.g. another .md file. */
  onNavigate?: (href: string) => void;
}

const remarkPlugins = [remarkGfm, remarkWikiLink];
const rehypePlugins = [rehypeSlug, rehypeHighlight];

function isExternalUrl(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//');
}

export function ReadView({ content, resolveImage, onNavigate }: Props) {
  const components = useMemo<Components>(() => {
    return {
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      img: ({ src, alt }) =>
        resolveImage ? (
          <MarkdownImage src={typeof src === 'string' ? src : ''} alt={alt} resolve={resolveImage} />
        ) : (
          <img src={typeof src === 'string' ? src : ''} alt={alt ?? ''} />
        ),
      a: ({ href, children }) => {
        const url = typeof href === 'string' ? href : '';
        const external = isExternalUrl(url);
        const anchor = url.startsWith('#');
        const internal = !!url && !external && !anchor;
        return (
          <a
            href={url || undefined}
            className={internal ? 'internal-link' : undefined}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
            onClick={(e) => {
              if (!internal) return;
              e.preventDefault();
              onNavigate?.(url);
            }}
          >
            {children}
          </a>
        );
      },
    };
  }, [resolveImage, onNavigate]);

  return (
    <article className="read">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
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

  if (failed)
    return (
      <span className="img-missing">
        <Icon icon={ImageNotFound01Icon} size={16} /> {alt || src}
      </span>
    );
  if (url === null) return <span className="img-loading" aria-busy="true" />;
  return <img src={url} alt={alt ?? ''} />;
}
