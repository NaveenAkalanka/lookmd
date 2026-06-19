/**
 * Read mode: client-side Markdown render. react-markdown does not emit raw HTML
 * by default, so untrusted file content can't inject markup. GFM adds tables,
 * task lists, strikethrough, and autolinks.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Props {
  content: string;
}

export function ReadView({ content }: Props) {
  return (
    <article className="read">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </article>
  );
}
