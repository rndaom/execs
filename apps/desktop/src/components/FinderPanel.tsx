import { MagnifyingGlass } from "@phosphor-icons/react";
import type { Tf2Install } from "../lib/bridge";
import { formatInstallLabel } from "../lib/finder-ui";
import { OnboardingFrame } from "./OnboardingFrame";
import { OperationError } from "./ui/OperationError";

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
}) {
  return (
    <OnboardingFrame
      eyebrow="Find TF2"
      icon={<MagnifyingGlass aria-hidden="true" size={13} weight="bold" />}
      title="Find your Team Fortress 2 install"
      lede="Choose the folder your profiles will use."
      width="wide"
      steps={[
        { label: "Find TF2", state: selected ? "complete" : "current" },
        { label: "Confirm folder", state: selected ? "current" : "upcoming" },
        { label: "Set up profile", state: "upcoming" },
      ]}
    >
      <div className="surface px-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge py-4">
          <h2 className="t-section">TF2 location</h2>
          <p className="t-meta">Nothing is written until you confirm.</p>
        </div>
        {scanning ? (
          <p role="status" className="t-meta py-5">
            Scanning Steam libraries…
          </p>
        ) : installs.length === 0 ? (
          <p className="t-meta py-5">No install found. Use Browse to choose the TF2 folder.</p>
        ) : (
          <ul className="flex flex-col">
            {installs.map((install) => {
              const active = install.path === selected;
              return (
                <li key={install.path} className="border-b border-edge last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onSelect(install.path)}
                    disabled={busy}
                    aria-pressed={active}
                    data-selected={active ? "true" : "false"}
                    className="flex min-h-11 w-full items-start gap-3 py-4 text-left transition-colors duration-150 hover:bg-panel-raised disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
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
      </div>

      <OperationError message={error} onDismiss={onDismissError} className="mt-4" />
    </OnboardingFrame>
  );
}
