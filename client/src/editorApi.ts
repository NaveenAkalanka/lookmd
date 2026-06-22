/**
 * Imperative commands a mounted editor exposes so the topbar Edit menu can drive
 * the currently focused editor (undo/redo, clipboard, find/replace) without the
 * app shell importing CodeMirror. The Editor builds one of these and reports it
 * on focus; the menu calls into whichever editor last had focus.
 */
export interface EditorApi {
  undo(): void;
  redo(): void;
  cut(): void;
  copy(): void;
  paste(): void;
  /** Open the in-editor find panel (it includes replace fields). */
  find(): void;
  replace(): void;
  focus(): void;
}
