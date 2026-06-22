/**
 * Topbar "Edit" menu: a VS Code-style dropdown exposing the editor commands
 * (undo/redo, clipboard, find/replace) plus workspace-wide Find/Replace in
 * Files. The editor commands act on the currently focused editor (`editApi`);
 * they're disabled when no editor is focused. Closes on selection, outside
 * click, or Escape.
 */

import { useEffect, useRef, useState } from 'react';
import type { EditorApi } from '../editorApi';

interface Props {
  editApi: EditorApi | null;
  onFindInFiles: () => void;
  onReplaceInFiles: () => void;
}

interface Item {
  label: string;
  keys?: string;
  run: () => void;
  disabled?: boolean;
}

export function EditMenu({ editApi, onFindInFiles, onReplaceInFiles }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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

  const ed = !!editApi;
  // Sections of items; `null` is a separator.
  const groups: (Item | null)[] = [
    { label: 'Undo', keys: 'Ctrl+Z', run: () => editApi?.undo(), disabled: !ed },
    { label: 'Redo', keys: 'Ctrl+Y', run: () => editApi?.redo(), disabled: !ed },
    null,
    { label: 'Cut', keys: 'Ctrl+X', run: () => editApi?.cut(), disabled: !ed },
    { label: 'Copy', keys: 'Ctrl+C', run: () => editApi?.copy(), disabled: !ed },
    { label: 'Paste', keys: 'Ctrl+V', run: () => editApi?.paste(), disabled: !ed },
    null,
    { label: 'Find', keys: 'Ctrl+F', run: () => editApi?.find(), disabled: !ed },
    { label: 'Replace', keys: 'Ctrl+H', run: () => editApi?.replace(), disabled: !ed },
    null,
    { label: 'Find in Files', keys: 'Ctrl+Shift+F', run: onFindInFiles },
    { label: 'Replace in Files', keys: 'Ctrl+Shift+H', run: onReplaceInFiles },
  ];

  const choose = (item: Item) => () => {
    if (item.disabled) return;
    setOpen(false);
    item.run();
  };

  return (
    <div className="menu" ref={wrapRef}>
      <button
        className={`btn menu-trigger${open ? ' menu-trigger-open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Edit
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {groups.map((item, i) =>
            item === null ? (
              <div key={`sep-${i}`} className="menu-sep" role="separator" />
            ) : (
              <button
                key={item.label}
                className="menu-item"
                role="menuitem"
                disabled={item.disabled}
                onClick={choose(item)}
              >
                <span className="menu-item-label">{item.label}</span>
                {item.keys && <span className="menu-key">{item.keys}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
