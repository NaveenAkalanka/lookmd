/**
 * The Read / Source / Edit segmented control. Pure presentation: it reports the
 * chosen mode upward and reflects the active one. Layout DNA, not theme — its
 * colors still come from tokens.
 */

export type ViewMode = 'read' | 'source' | 'edit' | 'split';

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'read', label: 'Read' },
  { id: 'source', label: 'Source' },
  { id: 'edit', label: 'Edit' },
  { id: 'split', label: 'Split' },
];

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  disabled?: boolean;
  /** Restrict which modes are offered. Defaults to all. */
  available?: ViewMode[];
}

export function ModeToggle({ mode, onChange, disabled, available }: Props) {
  const modes = available ? MODES.filter((m) => available.includes(m.id)) : MODES;
  return (
    <div className="segmented" role="tablist" aria-label="View mode">
      {modes.map((m) => (
        <button
          key={m.id}
          role="tab"
          aria-selected={mode === m.id}
          className={`segmented-item${mode === m.id ? ' segmented-item-active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
