import type { ReactNode } from "react";

/**
 * The sticky bar a pane shows while it holds changes that are not in TF2 yet
 * (the panes that write packs rather than autosave): the orange change dot,
 * one line saying what is waiting, and the action that applies it. Discard
 * and other secondary actions sit before it. A sticky bar keeps its place in
 * normal flow, so no second copy of its height is needed.
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
      <p className="apply-bar-status min-w-0" aria-live="polite">
        {dirty ? <span aria-hidden="true" className="apply-bar-dot" /> : null}
        <span className="min-w-0">{status}</span>
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
