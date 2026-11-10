/**
 * Line-ending preservation for the editor. CodeMirror stores every line break
 * as `\n`, so `doc.toString()` alone would silently turn a CRLF file into LF.
 * The editor detects the file's ending when a document loads and restores it
 * on every change, so CRLF and LF files round-trip byte-for-byte. A file that
 * mixes both is written back in its majority ending once it is edited.
 */

export type Eol = '\r\n' | '\n';

/** The line ending a file predominantly uses (LF on a tie or no breaks). */
export function detectEol(text: string): Eol {
  const crlf = text.match(/\r\n/g)?.length ?? 0;
  const lf = (text.match(/\n/g)?.length ?? 0) - crlf;
  return crlf > lf ? '\r\n' : '\n';
}

/** Turn CodeMirror's `\n`-joined document back into the file's line ending. */
export function toFileText(docText: string, eol: Eol): string {
  return eol === '\n' ? docText : docText.replace(/\n/g, '\r\n');
}
