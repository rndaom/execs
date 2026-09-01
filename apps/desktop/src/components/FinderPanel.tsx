import { MagnifyingGlass } from "@phosphor-icons/react";
import type { Tf2Install } from "../lib/bridge";
import { formatInstallLabel } from "../lib/finder-ui";
import { OnboardingFrame } from "./OnboardingFrame";
import { Alert } from "./ui/Alert";

/**
 * Find TF2. Flat rows separated by hairlines — the install list is a list, not
 * a card — inside the shared onboarding frame.
 */
export function FinderPanel({
  scanning,
  installs,
  selected,
  error,
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
      title="Confirm your Team Fortress 2 install"
      lede="Profiles are tied to this folder. Nothing is written until you confirm."
      footer={
        <div className="flex items-center justify-end gap-3 border-t border-edge pt-6">
          <button type="button" onClick={onBrowse} disabled={busy} className="btn btn-ghost">
            Browse…
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            className="btn btn-primary"
          >
            Confirm install
          </button>
        </div>
      }
    >
      {scanning ? (
        <p className="t-meta">Scanning Steam libraries…</p>
      ) : installs.length === 0 ? (
        <p className="t-meta">
          No Team Fortress 2 install found. Use Browse to pick the Team Fortress 2 folder.
        </p>
      ) : (
        <ul className="flex flex-col">
          {installs.map((install) => {
            const active = install.path === selected;
            return (
              <li key={install.path} className="border-b border-edge last:border-b-0">
                <button
                  type="button"
                  onClick={() => onSelect(install.path)}
                  data-selected={active ? "true" : "false"}
                  className="flex min-h-11 w-full items-start gap-3 py-3 text-left transition-colors duration-150 hover:bg-panel"
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

      {error ? (
        <Alert tone="error" className="mt-6">
          {error}
        </Alert>
      ) : null}
    </OnboardingFrame>
  );
}
