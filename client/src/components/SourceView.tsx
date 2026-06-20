/**
 * Source mode: the raw Markdown, read-only, in the mono font. No rendering and
 * no editing — just the bytes as they are on disk (or the unsaved draft).
 */

interface Props {
  content: string;
}

export function SourceView({ content }: Props) {
  return <pre className="source">{content}</pre>;
}
