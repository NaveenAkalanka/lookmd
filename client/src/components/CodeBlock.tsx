/**
 * Rich fenced-code block for the Read view: a header bar carrying the language
 * badge and a copy button, plus a line-number gutter. It wraps the already-
 * highlighted <code> that react-markdown + rehype-highlight produce — we reuse
 * those colored nodes verbatim and only add chrome around them, so the syntax
 * coloring (the shared --syntax-* tokens) is untouched.
 *
 * The gutter is a sibling of the scrolling <pre>, not inside it, so horizontal
 * scroll never drags the numbers; identical font + line-height keep rows aligned
 * (the Read pre never wraps).
 */

import { Children, isValidElement, useState, type ReactNode, type ReactElement } from 'react';
import { Icon } from './Icon';
import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons';

/** Recursively collect the plain text of rendered (highlighted) nodes. */
function textOf(node: ReactNode): string {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

interface Props {
  children?: ReactNode;
}

export function CodeBlock({ children }: Props) {
  const [copied, setCopied] = useState(false);

  // react-markdown hands the <pre> override its single <code> child element.
  const codeEl = Children.toArray(children).find(isValidElement) as
    | ReactElement<{ className?: string; children?: ReactNode }>
    | undefined;

  if (!codeEl) return <pre>{children}</pre>;

  const className = codeEl.props.className ?? '';
  const lang = /language-([\w+#.-]+)/.exec(className)?.[1] ?? '';
  const raw = textOf(codeEl.props.children).replace(/\n$/, '');
  const lineCount = Math.max(1, raw.split('\n').length);

  const onCopy = () => {
    void navigator.clipboard?.writeText(raw).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="code-block" data-lang={lang || undefined}>
      <div className="code-block-head">
        <span className="code-lang">{lang || 'text'}</span>
        <button
          className={`code-copy${copied ? ' is-copied' : ''}`}
          onClick={onCopy}
          aria-label="Copy code"
          title="Copy code"
        >
          <Icon icon={copied ? Tick02Icon : Copy01Icon} size={13} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="code-block-body">
        <span className="code-gutter" aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i}>{i + 1}</span>
          ))}
        </span>
        <pre>
          <code className={className}>{codeEl.props.children}</code>
        </pre>
      </div>
    </div>
  );
}
