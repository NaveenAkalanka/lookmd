/** Shared URL rule for the Read view and the live preview (no dependencies). */

/** A scheme (`https:`, `mailto:`) or a protocol-relative `//host`. */
export function isExternalUrl(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//');
}

const OPENABLE = new Set(['http', 'https', 'mailto']);

/**
 * Whether an external link may be opened: http(s), mailto, or `//host`.
 * Anything else (`javascript:`, `data:`, `vbscript:`, `file:`) is refused — the
 * Read view gets this from react-markdown's URL sanitizing; the live preview
 * reads raw document text, so it must check itself. Browsers drop ASCII
 * whitespace/control characters inside a scheme, so those are removed first.
 */
export function isOpenableExternalUrl(src: string): boolean {
  // eslint-disable-next-line no-control-regex
  const url = src.replace(/[\u0000-\u0020]/g, '');
  if (url.startsWith('//')) return true;
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url);
  return !!m && OPENABLE.has((m[1] ?? '').toLowerCase());
}
