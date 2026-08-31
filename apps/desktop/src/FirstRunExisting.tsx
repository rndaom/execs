import {
  ArrowLeft,
  CheckCircle,
  FolderOpen,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";

export function FirstRunExisting({
  path,
  draftName,
  reasons,
  running,
  busy,
  error,
  onDraftName,
  onSave,
  onChange,
}: {
  path: string;
  draftName: string;
  reasons: string[];
  running: boolean;
  busy: boolean;
  error: string | null;
  onDraftName: (name: string) => void;
  onSave: () => void;
  onChange: () => void;
}) {
  const canSave = !running && !busy && draftName.trim().length > 0;

  return (
    <section className="flex w-full max-w-4xl flex-col items-center py-2 text-center sm:py-4">
      <p className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-ink">
        <span aria-hidden="true" className="size-2.5 rounded-sm bg-brand" />
        execs
      </p>
      <div className="mt-6 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-faint">
        <ShieldCheck aria-hidden="true" size={17} weight="bold" />
        <span>Existing setup found</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Keep what you already built
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
        This TF2 install already contains customization. Save a complete snapshot before execs
        changes anything.
      </p>

      <div
        data-testid="first-run-existing"
        className="mt-7 w-full overflow-hidden surface text-left shadow-xl"
      >
        <div className="space-y-6 p-5 sm:p-7">
          <section aria-labelledby="detected-install-heading">
            <div className="flex items-start gap-3 rounded-xl border border-edge bg-bg/55 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-edge bg-panel-raised text-brand">
                <FolderOpen aria-hidden="true" size={20} weight="duotone" />
              </span>
              <div className="min-w-0">
                <h2 id="detected-install-heading" className="text-sm font-medium text-ink">
                  Confirmed TF2 install
                </h2>
                <p className="mt-1 break-all font-mono text-xs leading-5 text-ink-muted">{path}</p>
              </div>
            </div>
          </section>

          {reasons.length > 0 ? (
            <section aria-labelledby="customization-heading">
              <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-end">
                <div>
                  <h2 id="customization-heading" className="text-base font-semibold text-ink">
                    Customization detected
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-ink-muted">
                    These files will be preserved inside the new profile snapshot.
                  </p>
                </div>
                <p className="text-xs text-ink-faint">
                  {reasons.length} {reasons.length === 1 ? "item" : "items"}
                </p>
              </div>
              <ul data-testid="first-run-reasons" className="mt-3 grid gap-2 sm:grid-cols-2">
                {reasons.map((reason) => (
                  <li
                    key={reason}
                    className="flex items-start gap-2 border-b border-edge/60 px-1 py-2.5 text-xs leading-5 text-ink-muted"
                  >
                    <CheckCircle
                      aria-hidden="true"
                      className="mt-0.5 shrink-0 text-brand"
                      size={16}
                      weight="fill"
                    />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section
            className="rounded-xl border border-brand/35 bg-brand/8 p-4"
            aria-label="Safe snapshot"
          >
            <div className="flex items-start gap-3">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-brand"
                size={22}
                weight="duotone"
              />
              <div>
                <h2 className="text-sm font-medium text-ink">Safe first snapshot</h2>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  Saving copies the current file-safe setup into your profile library. It does not
                  remove or replace the live files in this step.
                </p>
              </div>
            </div>
          </section>

          {running ? (
            <div className="flex items-start gap-3 rounded-xl border border-team-red/50 bg-team-red/10 p-4">
              <WarningCircle
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-team-red"
                size={20}
                weight="fill"
              />
              <div>
                <p className="text-sm font-medium text-ink">TF2 is currently running</p>
                <p className="mt-1 text-xs leading-5 text-ink-muted">
                  This install remains read-only. Close the game to name and save the profile.
                </p>
              </div>
            </div>
          ) : (
            <form
              id="first-run-save-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSave();
              }}
            >
              <label
                className="block text-sm font-medium text-ink"
                htmlFor="first-run-profile-name"
              >
                Profile name
              </label>
              <p className="mt-1 text-xs leading-5 text-ink-muted">
                Choose a name you will recognize when switching setups later.
              </p>
              <input
                id="first-run-profile-name"
                value={draftName}
                onChange={(event) => onDraftName(event.target.value)}
                placeholder="My current setup"
                disabled={busy}
                autoComplete="off"
                className="field mt-3 w-full px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </form>
          )}

          {error ? (
            <p
              role="alert"
              className="rounded-xl border border-team-red/50 bg-team-red/10 px-4 py-3 text-sm text-ink"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-edge bg-panel/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <button type="button" onClick={onChange} className="btn btn-ghost w-full sm:w-auto">
            <ArrowLeft aria-hidden="true" size={16} weight="bold" />
            Change installation
          </button>
          {!running ? (
            <button
              type="submit"
              form="first-run-save-form"
              disabled={!canSave}
              className="btn btn-primary w-full px-6 py-2.5 sm:w-auto"
            >
              Save current as…
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
