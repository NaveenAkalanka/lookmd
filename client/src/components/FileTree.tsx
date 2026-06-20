/**
 * Recursive file-tree sidebar. Directories expand/collapse; files open on click.
 * Each row reveals actions on hover: folders get "new file here", files get
 * rename and delete. Paths are workspace-relative POSIX strings, matching the
 * tree API. The actual mutations (with their confirms) live in the parent.
 */

import { useState } from 'react';
import type { TreeNode } from '@lookmd/shared';

interface Actions {
  onOpenFile: (path: string) => void;
  onNewFile: (dir: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
}

interface Props extends Actions {
  tree: TreeNode[];
  activePath: string | null;
}

export function FileTree({ tree, activePath, ...actions }: Props) {
  if (tree.length === 0) {
    return <p className="muted sidebar-empty">No Markdown files yet. Use ＋ to add one.</p>;
  }
  return (
    <ul className="tree">
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
  const { onOpenFile, onNewFile, onRename, onDelete } = actions;
  const [open, setOpen] = useState(depth === 0);
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  // Stop a row's action button from also triggering the row's open/select.
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  if (node.type === 'dir') {
    return (
      <li>
        <div className="tree-row-wrap">
          <button className="tree-row tree-dir" style={pad} onClick={() => setOpen((v) => !v)}>
            <span className="tree-twisty">{open ? '▾' : '▸'}</span>
            <span className="tree-label">{node.name}</span>
          </button>
          <span className="tree-actions">
            <button
              className="tree-action"
              title={`New file in ${node.name}/`}
              aria-label={`New file in ${node.name}`}
              onClick={act(() => onNewFile(node.path))}
            >
              ＋
            </button>
          </span>
        </div>
        {open && node.children && node.children.length > 0 && (
          <ul className="tree">
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
      <div className="tree-row-wrap">
        <button
          className={`tree-row tree-file${isActive ? ' tree-file-active' : ''}`}
          style={pad}
          onClick={() => onOpenFile(node.path)}
        >
          <span className="tree-label">{node.name}</span>
        </button>
        <span className="tree-actions">
          <button
            className="tree-action"
            title="Rename"
            aria-label={`Rename ${node.name}`}
            onClick={act(() => onRename(node.path))}
          >
            ✎
          </button>
          <button
            className="tree-action tree-action-danger"
            title="Delete"
            aria-label={`Delete ${node.name}`}
            onClick={act(() => onDelete(node.path))}
          >
            🗑
          </button>
        </span>
      </div>
    </li>
  );
}
