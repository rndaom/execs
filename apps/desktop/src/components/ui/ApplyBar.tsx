import type { ReactNode } from "react";

/**
 * The sticky "status text + primary action" footer every editing pane ends
 * with. Disabled while the profile is locked or nothing changed, and it renders
 * its own bottom spacer so the last content row is never hidden behind it.
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
    <>
      <div className="sticky bottom-0 z-10 mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-edge bg-bg/95 py-3 backdrop-blur">
        <p className="t-meta min-w-0" aria-live="polite">
          {status}
        </p>
        <div className="flex shrink-0 items-center gap-2">
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
      {/* The bar is sticky, so the scroll container needs the height back. */}
      <div aria-hidden="true" className="h-4" />
    </>
  );
}
