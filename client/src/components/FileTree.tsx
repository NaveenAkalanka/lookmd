/**
 * Recursive file-tree sidebar. Directories show a chevron + folder icon and
 * expand/collapse; files show a document icon and open on click. Nested levels
 * are indented with a guide line. Each row reveals actions on hover: folders get
 * "new file here", files get rename and delete. Paths are workspace-relative
 * POSIX strings, matching the tree API. The mutations (with confirms) live in
 * the parent.
 */

import { useState } from 'react';
import type { TreeNode } from '@lookmd/shared';
import { Icon } from './Icon';
import { CreateMenu } from './CreateMenu';
import {
  PencilEdit02Icon,
  Delete02Icon,
  ArrowRight01Icon,
  Folder01Icon,
  FolderOpenIcon,
  File01Icon,
  Txt01Icon,
} from '@hugeicons/core-free-icons';

/** Pick a file icon by extension: a "TXT" badge for plain text, a document for
 *  Markdown (the only other type the tree surfaces). */
function fileIcon(name: string) {
  return /\.(txt|text)$/i.test(name) ? Txt01Icon : File01Icon;
}

interface Actions {
  onOpenFile: (path: string) => void;
  onNewFile: (dir: string, ext: 'md' | 'txt') => void;
  onNewFolder: (dir: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
  /** Right-click a row (node) or the empty area (null) to open a context menu. */
  onContextMenu: (e: React.MouseEvent, node: TreeNode | null) => void;
}

interface Props extends Actions {
  tree: TreeNode[];
  activePath: string | null;
}

export function FileTree({ tree, activePath, ...actions }: Props) {
  if (tree.length === 0) {
    return (
      <p
        className="muted sidebar-empty"
        onContextMenu={(e) => actions.onContextMenu(e, null)}
      >
        No Markdown files yet. Use + to add one.
      </p>
    );
  }
  return (
    <ul className="tree" onContextMenu={(e) => actions.onContextMenu(e, null)}>
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} depth={0} activePath={activePath} {...actions} />
      ))}
    </ul>
  );
}

interface ItemProps extends Actions {
  node: TreeNode;
  depth: number;
  activePath: string | null;
}

function TreeItem({ node, depth, activePath, ...actions }: ItemProps) {
  const { onOpenFile, onNewFile, onNewFolder, onRename, onDelete, onContextMenu } = actions;
  const [open, setOpen] = useState(depth === 0);

  // Row right-click opens the node's menu (and not the root's).
  const rowMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu(e, node);
  };

  // Stop a row's action button from also triggering the row's open/select.
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  if (node.type === 'dir') {
    return (
      <li>
        <div className="tree-row-wrap" onContextMenu={rowMenu}>
          <button className="tree-row tree-dir" onClick={() => setOpen((v) => !v)}>
            <Icon icon={ArrowRight01Icon} size={14} className={`tree-chevron${open ? ' tree-chevron-open' : ''}`} />
            <Icon icon={open ? FolderOpenIcon : Folder01Icon} size={16} className="tree-icon" />
            <span className="tree-label">{node.name}</span>
          </button>
          <span className="tree-actions">
            <CreateMenu
              dir={node.path}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              label={`New in ${node.name}/`}
              size={15}
            />
          </span>
        </div>
        {open && node.children && node.children.length > 0 && (
          <ul className="tree tree-nested">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                {...actions}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const isActive = node.path === activePath;
  return (
    <li>
      <div className="tree-row-wrap" onContextMenu={rowMenu}>
        <button
          className={`tree-row tree-file${isActive ? ' tree-file-active' : ''}`}
          onClick={() => onOpenFile(node.path)}
        >
          <Icon icon={fileIcon(node.name)} size={15} className="tree-icon" />
          <span className="tree-label">{node.name}</span>
        </button>
        <span className="tree-actions">
          <button
            className="tree-action"
            title="Rename"
            aria-label={`Rename ${node.name}`}
            onClick={act(() => onRename(node.path))}
          >
            <Icon icon={PencilEdit02Icon} size={15} />
          </button>
          <button
            className="tree-action tree-action-danger"
            title="Delete"
            aria-label={`Delete ${node.name}`}
            onClick={act(() => onDelete(node.path))}
          >
            <Icon icon={Delete02Icon} size={15} />
          </button>
        </span>
      </div>
    </li>
  );
}
