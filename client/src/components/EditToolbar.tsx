/**
 * Editing toolbar: shown under the file bar while Edit is on. Every button runs
 * a Markdown formatting command on the pane's editor (see markdown/format.ts),
 * so it behaves the same in Source and in Read. Buttons keep the editor's focus
 * and selection (mousedown is suppressed), and pressing one again on formatted
 * text removes the formatting. On narrow screens the row scrolls sideways.
 */

import type { EditorApi } from '../editorApi';
import type { FormatId } from '../markdown/format';
import { Icon } from './Icon';
import {
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  TextBoldIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  SourceCodeIcon,
  QuoteDownIcon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  CheckListIcon,
  Link01Icon,
  Image01Icon,
  Table01Icon,
  CodeSquareIcon,
  SolidLine01Icon,
} from '@hugeicons/core-free-icons';

type Item =
  | { kind: 'cmd'; id: FormatId; label: string; keys?: string; icon: typeof TextBoldIcon }
  | { kind: 'history'; id: 'undo' | 'redo'; label: string; keys: string; icon: typeof TextBoldIcon }
  | { kind: 'heading' }
  | { kind: 'sep' };

const ITEMS: Item[] = [
  { kind: 'history', id: 'undo', label: 'Undo', keys: 'Ctrl/Cmd-Z', icon: ArrowTurnBackwardIcon },
  { kind: 'history', id: 'redo', label: 'Redo', keys: 'Ctrl/Cmd-Shift-Z', icon: ArrowTurnForwardIcon },
  { kind: 'sep' },
  { kind: 'cmd', id: 'bold', label: 'Bold', keys: 'Ctrl/Cmd-B', icon: TextBoldIcon },
  { kind: 'cmd', id: 'italic', label: 'Italic', keys: 'Ctrl/Cmd-I', icon: TextItalicIcon },
  { kind: 'cmd', id: 'strike', label: 'Strikethrough', icon: TextStrikethroughIcon },
  { kind: 'cmd', id: 'code', label: 'Inline code', icon: SourceCodeIcon },
  { kind: 'sep' },
  { kind: 'heading' },
  { kind: 'cmd', id: 'quote', label: 'Quote', icon: QuoteDownIcon },
  { kind: 'sep' },
  { kind: 'cmd', id: 'bullet', label: 'Bulleted list', icon: LeftToRightListBulletIcon },
  { kind: 'cmd', id: 'numbered', label: 'Numbered list', icon: LeftToRightListNumberIcon },
  { kind: 'cmd', id: 'task', label: 'Task list', icon: CheckListIcon },
  { kind: 'sep' },
  { kind: 'cmd', id: 'link', label: 'Link', keys: 'Ctrl/Cmd-K', icon: Link01Icon },
  { kind: 'cmd', id: 'image', label: 'Image', icon: Image01Icon },
  { kind: 'cmd', id: 'table', label: 'Table', icon: Table01Icon },
  { kind: 'cmd', id: 'codeblock', label: 'Code block', icon: CodeSquareIcon },
  { kind: 'cmd', id: 'divider', label: 'Divider', icon: SolidLine01Icon },
];

const HEADINGS: { id: FormatId; label: string }[] = [
  { id: 'paragraph', label: 'Paragraph' },
  { id: 'h1', label: 'Heading 1' },
  { id: 'h2', label: 'Heading 2' },
  { id: 'h3', label: 'Heading 3' },
];

interface Props {
  /** The pane editor's command API; null until the editor has mounted. */
  api: EditorApi | null;
}

/** Keep focus (and the selection) in the editor when a toolbar button is pressed. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function EditToolbar({ api }: Props) {
  const disabled = api === null;
  return (
    <div className="edit-toolbar" role="toolbar" aria-label="Formatting">
      {ITEMS.map((item, i) => {
        if (item.kind === 'sep') return <span key={i} className="edit-toolbar-sep" aria-hidden="true" />;
        if (item.kind === 'heading') {
          return (
            <select
              key={i}
              className="edit-toolbar-heading"
              aria-label="Text style"
              title="Text style"
              value=""
              disabled={disabled}
              onChange={(e) => {
                const id = e.target.value as FormatId;
                if (id) api?.format(id);
              }}
            >
              <option value="" disabled hidden>
                Heading
              </option>
              {HEADINGS.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          );
        }
        const title = item.keys ? `${item.label} (${item.keys})` : item.label;
        return (
          <button
            key={i}
            type="button"
            className="edit-toolbar-btn"
            title={title}
            aria-label={item.label}
            disabled={disabled}
            onMouseDown={keepFocus}
            onClick={() => {
              if (!api) return;
              if (item.kind === 'history') api[item.id]();
              else api.format(item.id);
            }}
          >
            <Icon icon={item.icon} size={17} />
          </button>
        );
      })}
    </div>
  );
}
