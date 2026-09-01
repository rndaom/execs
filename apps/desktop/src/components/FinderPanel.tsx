import { MagnifyingGlass } from "@phosphor-icons/react";
import type { Tf2Install } from "../lib/bridge";
import { formatInstallLabel } from "../lib/finder-ui";
import { Alert } from "./ui/Alert";

/**
 * Find TF2. Flat rows separated by hairlines — the install list is a list, not
 * a card (AGENTS.md, Design decisions) — behind the same wordmark/eyebrow frame
 * the first-run screens use.
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
    <section className="flex w-full flex-col items-center text-center">
      <p className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-ink">
        <span aria-hidden="true" className="size-2.5 rounded-sm bg-brand" />
        execs
      </p>
      <div className="eyebrow mt-6 flex items-center gap-2">
        <MagnifyingGlass aria-hidden="true" size={15} weight="bold" />
        <span>Find TF2</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">
        Confirm your Team Fortress 2 install
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-ink-muted">
        Scan Steam libraries and confirm this is Team Fortress 2 before any write. Profiles will be
        tied to this folder.
      </p>

      <div className="section w-full text-left">
        {scanning ? (
          <p className="text-sm text-ink-muted">Scanning Steam libraries…</p>
        ) : installs.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No Team Fortress 2 install found. Use Browse to pick the Team Fortress 2 folder.
          </p>
        ) : (
          <ul className="flex flex-col">
            {installs.map((install) => {
              const active = install.path === selected;
              return (
                <li key={install.path} className="border-b border-edge/60 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onSelect(install.path)}
                    data-selected={active ? "true" : "false"}
                    className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-panel/50"
                  >
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${
                        active ? "bg-brand" : "bg-edge-strong"
                      }`}
                    />
                    <span className="min-w-0">
                      <span
                        className={`block text-sm font-medium ${active ? "text-brand" : "text-ink"}`}
                      >
                        {formatInstallLabel(install.path)}
                      </span>
                      <span className="mt-1 block break-all font-mono text-xs text-ink-faint">
                        {install.path}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error ? (
        <Alert tone="error" className="mt-4 w-full text-left">
          {error}
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={onBrowse} disabled={busy} className="btn btn-ghost">
          Browse
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className="btn btn-primary"
        >
          Confirm
        </button>
      </div>
    </section>
  );
}
