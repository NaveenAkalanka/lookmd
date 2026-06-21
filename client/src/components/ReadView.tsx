/**
 * Read mode: client-side Markdown render. react-markdown does not emit raw HTML
 * by default, so untrusted file content can't inject markup. GFM adds tables,
 * task lists, strikethrough, and autolinks. rehype-highlight attaches semantic
 * highlight.js classes to fenced code blocks; their colors come from the shared
 * --syntax-* tokens in CSS (no highlight.js theme is imported).
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface Props {
  content: string;
}

export function ReadView({ content }: Props) {
  return (
    <article className="read">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {content}
      </ReactMarkdown>
    </article>
  );
}
