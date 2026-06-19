/**
 * Recursive file-tree sidebar. Directories expand/collapse; files open on click.
 * Paths are workspace-relative POSIX strings, matching the tree API.
 */

import { useState } from 'react';
import type { TreeNode } from '@lookmd/shared';

interface Props {
  tree: TreeNode[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
}

export function FileTree({ tree, activePath, onOpenFile }: Props) {
  if (tree.length === 0) {
    return <p className="muted sidebar-empty">No Markdown files in this workspace.</p>;
  }
  return (
    <ul className="tree">
      {tree.map((node) => (
        <TreeItem key={node.path} node={node} depth={0} activePath={activePath} onOpenFile={onOpenFile} />
      ))}
    </ul>
  );
}

interface ItemProps {
  node: TreeNode;
  depth: number;
  activePath: string | null;
  onOpenFile: (path: string) => void;
}

function TreeItem({ node, depth, activePath, onOpenFile }: ItemProps) {
  const [open, setOpen] = useState(depth === 0);
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (node.type === 'dir') {
    return (
      <li>
        <button className="tree-row tree-dir" style={pad} onClick={() => setOpen((v) => !v)}>
          <span className="tree-twisty">{open ? '▾' : '▸'}</span>
          <span className="tree-label">{node.name}</span>
        </button>
        {open && node.children && node.children.length > 0 && (
          <ul className="tree">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onOpenFile={onOpenFile}
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
      <button
        className={`tree-row tree-file${isActive ? ' tree-file-active' : ''}`}
        style={pad}
        onClick={() => onOpenFile(node.path)}
      >
        <span className="tree-label">{node.name}</span>
      </button>
    </li>
  );
}
