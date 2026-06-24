/**
 * Floating toolbar for the annotation overlay: tool picker, colour swatches, a
 * stroke-width stepper, undo / clear, the "keep" (pin) toggle, and a close
 * button. Pure presentation — all state lives in the parent (FilePane via the
 * useAnnotations hook). Colours/fonts come from tokens, matching the zoom and
 * segmented controls.
 */

import { Icon } from './Icon';
import {
  Cursor01Icon,
  BrushIcon,
  HighlighterIcon,
  ArrowUpRight01Icon,
  Remove01Icon,
  SquareIcon,
  TextFontIcon,
  Eraser01Icon,
  ArrowTurnBackwardIcon,
  ArrowTurnForwardIcon,
  Delete01Icon,
  Delete02Icon,
  PinIcon,
  Cancel01Icon,
  MinusSignIcon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons';
import { ANNOT_PALETTE, colorVar, type ToolId, type AnnotColor } from '../annotations';

interface Props {
  tool: ToolId;
  color: AnnotColor;
  width: number;
  pinned: boolean;
  /** A mark is selected — colour/width edit it in place. */
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTool: (t: ToolId) => void;
  onColor: (c: AnnotColor) => void;
  onWidth: (w: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onDeleteSelected: () => void;
  onPinned: (on: boolean) => void;
  onClose: () => void;
}

const TOOLS: { id: ToolId; icon: typeof BrushIcon; label: string }[] = [
  { id: 'select', icon: Cursor01Icon, label: 'Select / edit (double-click text to retype)' },
  { id: 'pen', icon: BrushIcon, label: 'Pen' },
  { id: 'highlighter', icon: HighlighterIcon, label: 'Highlighter' },
  { id: 'arrow', icon: ArrowUpRight01Icon, label: 'Arrow' },
  { id: 'line', icon: Remove01Icon, label: 'Line' },
  { id: 'box', icon: SquareIcon, label: 'Box' },
  { id: 'text', icon: TextFontIcon, label: 'Text note' },
  { id: 'eraser', icon: Eraser01Icon, label: 'Eraser' },
];

export const WIDTH_MIN = 1;
export const WIDTH_MAX = 12;

export function AnnotationToolbar({
  tool,
  color,
  width,
  pinned,
  hasSelection,
  canUndo,
  canRedo,
  onTool,
  onColor,
  onWidth,
  onUndo,
  onRedo,
  onClear,
  onDeleteSelected,
  onPinned,
  onClose,
}: Props) {
  return (
    <div
      className={`annotate-toolbar${hasSelection ? ' annotate-toolbar-editing' : ''}`}
      role="toolbar"
      aria-label="Annotation tools"
    >
      <div className="annot-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`annot-tool${tool === t.id ? ' annot-tool-active' : ''}`}
            title={t.label}
            aria-label={t.label}
            aria-pressed={tool === t.id}
            onClick={() => onTool(t.id)}
          >
            <Icon icon={t.icon} size={16} />
          </button>
        ))}
      </div>

      <div className="annot-sep" />

      {hasSelection && (
        <>
          <span className="annot-editing" title="Editing the selected mark — drag it to move">edit</span>
          <button
            className="annot-tool annot-tool-danger"
            title="Delete selected (Del)"
            aria-label="Delete selected mark"
            onClick={onDeleteSelected}
          >
            <Icon icon={Delete01Icon} size={16} />
          </button>
        </>
      )}

      <div className="annot-group">
        {ANNOT_PALETTE.map((c) => (
          <button
            key={c}
            className={`annot-swatch${color === c ? ' annot-swatch-active' : ''}`}
            style={{ background: colorVar(c) }}
            title={c}
            aria-label={`Colour ${c}`}
            aria-pressed={color === c}
            onClick={() => onColor(c)}
          />
        ))}
      </div>

      <div className="annot-sep" />

      <div className="annot-group" title="Stroke width">
        <button
          className="annot-tool"
          aria-label="Thinner"
          disabled={width <= WIDTH_MIN}
          onClick={() => onWidth(Math.max(WIDTH_MIN, width - 1))}
        >
          <Icon icon={MinusSignIcon} size={14} />
        </button>
        <span className="annot-width" aria-label={`Width ${width}`}>{width}</span>
        <button
          className="annot-tool"
          aria-label="Thicker"
          disabled={width >= WIDTH_MAX}
          onClick={() => onWidth(Math.min(WIDTH_MAX, width + 1))}
        >
          <Icon icon={PlusSignIcon} size={14} />
        </button>
      </div>

      <div className="annot-sep" />

      <div className="annot-group">
        <button
          className="annot-tool"
          title="Undo (Ctrl/Cmd-Z)"
          aria-label="Undo"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Icon icon={ArrowTurnBackwardIcon} size={16} />
        </button>
        <button
          className="annot-tool"
          title="Redo (Ctrl/Cmd-Shift-Z)"
          aria-label="Redo"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <Icon icon={ArrowTurnForwardIcon} size={16} />
        </button>
        <button className="annot-tool" title="Clear all marks" aria-label="Clear all" onClick={onClear}>
          <Icon icon={Delete02Icon} size={16} />
        </button>
        <button
          className={`annot-tool${pinned ? ' annot-tool-active' : ''}`}
          title={pinned ? 'Kept — saved in this browser (click to stop keeping)' : 'Keep marks for this file (save locally)'}
          aria-label="Keep marks"
          aria-pressed={pinned}
          onClick={() => onPinned(!pinned)}
        >
          <Icon icon={PinIcon} size={16} />
        </button>
      </div>

      <div className="annot-sep" />

      <button className="annot-tool" title="Close annotation mode" aria-label="Close annotations" onClick={onClose}>
        <Icon icon={Cancel01Icon} size={16} />
      </button>
    </div>
  );
}
