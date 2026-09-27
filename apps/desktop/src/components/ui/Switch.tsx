/**
 * The one toggle pill: every on/off in the product renders through it, so the
 * knob geometry and the disabled treatment cannot drift apart.
 */
export function Switch({
  checked,
  disabled = false,
  label,
  testId,
  describedBy,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  /** Accessible name; visually hidden because the row already shows a label. */
  label: string;
  testId?: string;
  describedBy?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-testid={testId}
      aria-checked={checked}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="switch"
    >
      <span aria-hidden="true" className="switch-thumb" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** A labelled row wrapping a `Switch` — the shape every settings toggle uses. */
export function SwitchRow({
  id,
  label,
  description,
  note,
  checked,
  disabled = false,
  testId,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  note?: string;
  checked: boolean;
  disabled?: boolean;
  testId?: string;
  onChange: (next: boolean) => void;
}) {
  const noteId = note ? `${id}-note` : undefined;
  return (
    <div className="min-h-11 border-b border-edge py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="t-row block">{label}</span>
          {description ? <span className="t-meta mt-0.5 block">{description}</span> : null}
        </span>
        <Switch
          checked={checked}
          disabled={disabled}
          label={label}
          testId={testId}
          describedBy={noteId}
          onChange={onChange}
        />
      </div>
      {note ? (
        <p id={noteId} className="mt-2 text-[12px] leading-5 text-ink-faint">
          {note}
        </p>
      ) : null}
    </div>
  );
}
