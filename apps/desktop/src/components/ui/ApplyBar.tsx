import type { ReactNode } from "react";

/**
 * The sticky "status text + primary action" footer every editing pane ends
 * with. Disabled while the profile is locked or nothing changed. A sticky bar
 * keeps its place in normal flow, so no second copy of its height is needed.
 */
export function ApplyBar({
  status,
  actionLabel,
  lockedLabel,
  running,
  locked,
  dirty,
  testId,
  submit = false,
  extra,
  onApply,
}: {
  status: ReactNode;
  actionLabel: string;
  /** Shown on the button while TF2 is running. */
  lockedLabel?: string;
  running: boolean;
  /** TF2 running, a write in flight, or a read-only file. */
  locked: boolean;
  dirty: boolean;
  testId?: string;
  /** True inside a `<form>` that already handles submit. */
  submit?: boolean;
  extra?: ReactNode;
  onApply?: () => void;
}) {
  return (
    <div className="apply-bar">
      <p className="t-meta min-w-0" aria-live="polite">
        {status}
      </p>
      <div className="pane-actions">
        {extra}
        <button
          type={submit ? "submit" : "button"}
          data-testid={testId}
          disabled={locked || !dirty}
          onClick={submit ? undefined : onApply}
          className="btn btn-primary"
        >
          {running && lockedLabel ? lockedLabel : actionLabel}
        </button>
      </div>
    </div>
  );
}
