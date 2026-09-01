/**
 * The one toggle pill. Replaces three independent implementations (the
 * former inherit-binds button switch, the Gameplay peer-checked checkbox and
 * the wizard tile) so the knob geometry and disabled treatment cannot drift.
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
      className={`relative h-6 w-11 shrink-0 rounded-pill border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "border-brand bg-brand" : "border-edge-strong bg-bg"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 size-4 rounded-full transition-all ${
          checked ? "left-[22px] bg-on-brand" : "left-1 bg-ink-muted"
        }`}
      />
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
    <div className="border-b border-edge/60 py-3.5">
      <div className="flex items-start justify-between gap-4">
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-ink">{label}</span>
          {description ? (
            <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{description}</span>
          ) : null}
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
        <p id={noteId} className="mt-2 text-[11px] leading-4 text-ink-faint">
          {note}
        </p>
      ) : null}
    </div>
  );
}
