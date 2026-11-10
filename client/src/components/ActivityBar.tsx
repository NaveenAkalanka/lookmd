/**
 * Activity bar: the narrow icon strip on the far left, VS Code-style. Each top
 * icon selects a sidebar view; clicking the view that is already showing
 * collapses the sidebar (the parent decides, via `onSelect`). An optional
 * bottom slot holds extra actions (Settings on desktop).
 */

import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { Files01Icon, LeftToRightListBulletIcon, Search01Icon } from '@hugeicons/core-free-icons';
import type { SidebarView } from '../settings';

const VIEWS: { id: SidebarView; label: string; shortcut: string; icon: typeof Files01Icon }[] = [
  { id: 'files', label: 'Files', shortcut: '', icon: Files01Icon },
  { id: 'outline', label: 'Outline', shortcut: '', icon: LeftToRightListBulletIcon },
  { id: 'search', label: 'Search', shortcut: 'Ctrl/Cmd-Shift-F', icon: Search01Icon },
];

interface Props {
  view: SidebarView;
  /** Whether the sidebar panel is currently showing. */
  open: boolean;
  onSelect: (view: SidebarView) => void;
  bottom?: ReactNode;
}

export function ActivityBar({ view, open, onSelect, bottom }: Props) {
  return (
    <nav className="activitybar" aria-label="Sidebar views">
      <div className="activitybar-group" role="tablist" aria-orientation="vertical">
        {VIEWS.map((v) => {
          const active = open && v.id === view;
          return (
            <button
              key={v.id}
              role="tab"
              className={`activitybar-item${active ? ' activitybar-item-active' : ''}`}
              aria-selected={active}
              aria-label={v.label}
              title={v.shortcut ? `${v.label} (${v.shortcut})` : v.label}
              onClick={() => onSelect(v.id)}
            >
              <Icon icon={v.icon} size={22} />
            </button>
          );
        })}
      </div>
      {bottom && <div className="activitybar-group activitybar-bottom">{bottom}</div>}
    </nav>
  );
}
