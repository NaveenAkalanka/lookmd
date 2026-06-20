/**
 * The Read / Source / Edit segmented control. Pure presentation: it reports the
 * chosen mode upward and reflects the active one. Layout DNA, not theme — its
 * colors still come from tokens.
 */

export type ViewMode = 'read' | 'source' | 'edit';

const MODES: { id: ViewMode; label: string }[] = [
  { id: 'read', label: 'Read' },
  { id: 'source', label: 'Source' },
  { id: 'edit', label: 'Edit' },
];

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  disabled?: boolean;
}

export function ModeToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className="segmented" role="tablist" aria-label="View mode">
      {MODES.map((m) => (
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
