import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import type { Tf2Install } from "../lib/bridge";
import { formatInstallLabel } from "../lib/finder-ui";
import { OnboardingFrame } from "./OnboardingFrame";
import { OperationError } from "./ui/OperationError";
import { Loading } from "./ui/Spinner";

/**
 * Find TF2. Flat rows separated by hairlines — the install list is a list, not
 * a card — inside the shared onboarding frame.
 */
export function FinderPanel({
  scanning,
  installs,
  selected,
  error,
  onDismissError,
  canConfirm,
  busy,
  onSelect,
  onBrowse,
  onConfirm,
  confirmed = false,
  waitingFor = null,
  missing = null,
  onRetryMissing,
}: {
  scanning: boolean;
  installs: Tf2Install[];
  selected: string | null;
  error: string | null;
  onDismissError?: () => void;
  canConfirm: boolean;
  busy: boolean;
  onSelect: (path: string) => void;
  onBrowse: () => void;
  onConfirm: () => void;
  /** The selected install is saved; setup continues after a short beat. */
  confirmed?: boolean;
  /** The read setup is still waiting for once that beat has passed. */
  waitingFor?: string | null;
  /** The saved TF2 folder when it no longer holds TF2, such as a disconnected drive. */
  missing?: string | null;
  onRetryMissing?: () => void;
}) {
  return (
    <OnboardingFrame
      title="Find your Team Fortress 2 install"
      width="wide"
      steps={[
        { label: "Find TF2", state: selected ? "complete" : "current" },
        {
          label: "Confirm folder",
          state: confirmed ? "complete" : selected ? "current" : "upcoming",
        },
        { label: "Set up profile", state: confirmed ? "current" : "upcoming" },
      ]}
    >
      {missing && !confirmed ? (
        <div
          data-testid="finder-missing"
          className="surface mb-4 flex flex-wrap items-start justify-between gap-3 px-5 py-4"
        >
          <p className="t-body flex min-w-0 flex-1 items-start gap-2 text-ink-muted">
            <WarningCircle
              aria-hidden="true"
              size={16}
              weight="fill"
              className="mt-1 shrink-0 text-warn"
            />
            <span className="min-w-0">
              execs can't find TF2 at <span className="break-all text-ink">{missing}</span>. Connect
              the drive and retry, or choose where TF2 is now.
            </span>
          </p>
          <button type="button" onClick={onRetryMissing} disabled={busy} className="btn btn-ghost">
            Retry
          </button>
        </div>
      ) : null}
      <div className="surface px-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge py-4">
          <h2 className="t-section">TF2 location</h2>
          {confirmed ? null : <p className="t-meta">Nothing is written until you confirm.</p>}
        </div>
        {scanning ? (
          <p role="status" className="t-meta py-5">
            <Loading>Scanning Steam libraries…</Loading>
          </p>
        ) : installs.length === 0 ? (
          <p className="t-meta py-5">No install found. Use Browse to choose the TF2 folder.</p>
        ) : (
          <ul className="flex flex-col">
            {installs.map((install, index) => {
              const active = install.path === selected;
              return (
                <li
                  key={install.path}
                  className="finder-row border-b border-edge last:border-b-0"
                  style={{ animationDelay: `${120 + index * 60}ms` }}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(install.path)}
                    disabled={busy || confirmed}
                    aria-pressed={active}
                    data-selected={active ? "true" : "false"}
                    className={`flex min-h-11 w-full items-start gap-3 py-4 text-left transition-[background-color,opacity] duration-150 disabled:cursor-not-allowed ${
                      confirmed
                        ? active
                          ? ""
                          : "opacity-40"
                        : "hover:bg-panel-raised disabled:opacity-50"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      data-pop={confirmed && active ? "true" : undefined}
                      className={`brand-dot mt-1.5 size-2 shrink-0 rounded-full ${
                        active ? "bg-brand" : "bg-edge-strong"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="t-row block">{formatInstallLabel(install.path)}</span>
                      <span className="mt-0.5 block break-all text-[12.5px] text-ink-faint">
                        {install.path}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {confirmed ? (
          <div className="flex min-h-[4.25rem] flex-wrap items-center justify-between gap-3 border-t border-edge py-4">
            <p role="status" className="finder-confirmed">
              <CheckCircle size={18} weight="fill" className="text-ok" aria-hidden="true" />
              Install confirmed
            </p>
            {waitingFor ? (
              <p className="t-meta enter-fade">
                <Loading>{waitingFor}</Loading>
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-edge py-4">
            <button type="button" onClick={onBrowse} disabled={busy} className="btn btn-ghost">
              Browse…
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={!canConfirm || busy || scanning}
              className="btn btn-primary"
            >
              Confirm install
            </button>
          </div>
        )}
      </div>

      <OperationError message={error} onDismiss={onDismissError} className="mt-4" />
    </OnboardingFrame>
  );
}
