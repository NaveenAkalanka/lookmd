/** Shared URL rule for the Read view and the live preview (no dependencies). */

/** A scheme (`https:`, `mailto:`) or a protocol-relative `//host`. */
export function isExternalUrl(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//');
}
