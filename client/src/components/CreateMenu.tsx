/**
 * A small "+" button that opens a popover for creating a new Markdown file,
 * text file, or folder in a given directory. Used in the sidebar header (for the
 * workspace root) and on each folder row. Closes on selection, outside click,
 * or Escape. Pure UI — the parent performs the actual create.
 */

import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Add01Icon, File01Icon, Txt01Icon, Folder01Icon } from '@hugeicons/core-free-icons';

interface Props {
  /** Directory to create in ('' = workspace root). */
  dir: string;
  onNewFile: (dir: string, ext: 'md' | 'txt') => void;
  onNewFolder: (dir: string) => void;
  label?: string;
  size?: number;
}

export function CreateMenu({ dir, onNewFile, onNewFolder, label = 'New…', size = 16 }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    fn();
  };

  return (
    <span className="create-menu" ref={wrapRef}>
      <button
        className="tree-action"
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Icon icon={Add01Icon} size={size} />
      </button>
      {open && (
        <div className="create-pop" role="menu">
          <button className="create-pop-item" role="menuitem" onClick={pick(() => onNewFile(dir, 'md'))}>
            <Icon icon={File01Icon} size={15} /> New Markdown file
          </button>
          <button className="create-pop-item" role="menuitem" onClick={pick(() => onNewFile(dir, 'txt'))}>
            <Icon icon={Txt01Icon} size={15} /> New text file
          </button>
          <button className="create-pop-item" role="menuitem" onClick={pick(() => onNewFolder(dir))}>
            <Icon icon={Folder01Icon} size={15} /> New folder
          </button>
        </div>
      )}
    </span>
  );
}
