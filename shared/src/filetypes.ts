/**
 * File-type groups — the single source of truth shared by server and client.
 *
 * Every extension here is plain text, safe to read and edit through the same
 * pipeline as Markdown (no binaries, nothing executed). The server serves any
 * extension in any group; the groups exist so the client can offer a per-
 * category "show this file type" toggle. Markdown is always on.
 *
 * Keep this list extension-based only (matching the rest of the path rules);
 * extension-less files like `Dockerfile`/`Makefile` are intentionally excluded.
 */

export interface FileTypeGroup {
  id: string;
  label: string;
  /** Lowercase extensions, each including the leading dot. */
  extensions: string[];
  /** Markdown is always shown and cannot be disabled. */
  always?: boolean;
}

export const FILE_TYPE_GROUPS: readonly FileTypeGroup[] = [
  {
    id: 'markdown',
    label: 'Markdown',
    extensions: ['.md', '.markdown', '.mdown', '.mkd'],
    always: true,
  },
  {
    id: 'text',
    label: 'Plain text',
    extensions: ['.txt', '.text', '.log', '.rst', '.adoc'],
  },
  {
    id: 'data',
    label: 'Data & config',
    extensions: [
      '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini',
      '.env', '.csv', '.tsv', '.xml', '.properties',
    ],
  },
  {
    id: 'web',
    label: 'Web',
    extensions: ['.html', '.htm', '.css', '.scss', '.sass', '.less'],
  },
  {
    id: 'code',
    label: 'Code',
    extensions: [
      '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.go',
      '.rs', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.swift',
      '.kt', '.lua', '.r', '.sql',
    ],
  },
  {
    id: 'shell',
    label: 'Shell & scripts',
    extensions: ['.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd'],
  },
];

/** Group ids whose files are shown by default (markdown + plain text only). */
export const DEFAULT_FILE_TYPE_IDS: readonly string[] = ['markdown', 'text'];

/** The markdown extensions — the only types the Read renderer is meant for. */
export const MARKDOWN_EXTENSIONS: readonly string[] =
  FILE_TYPE_GROUPS.find((g) => g.id === 'markdown')!.extensions;

/** Every extension across all groups — the server's full plain-text allowlist. */
export const ALL_TEXT_EXTENSIONS: readonly string[] = FILE_TYPE_GROUPS.flatMap(
  (g) => g.extensions,
);

/** Lowercase extension (with dot) of a file name, or '' if it has none. */
export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

/** True when a path is one of the Markdown extensions. */
export function isMarkdownPath(name: string): boolean {
  return (MARKDOWN_EXTENSIONS as string[]).includes(extensionOf(name));
}
