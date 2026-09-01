import {
  ArrowLeft,
  CheckCircle,
  FolderOpen,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { Alert } from "./components/ui/Alert";
import { PaneSection } from "./components/ui/PaneSection";
import { useAppStatus } from "./hooks/useAppStatus";

/**
 * First launch on an install that already has customization: Save current as…
 * only — no Import, no comfig install (RND-152).
 */
export function FirstRunExisting({
  path,
  draftName,
  reasons,
  onDraftName,
  onSave,
  onChange,
}: {
  path: string;
  draftName: string;
  reasons: string[];
  onDraftName: (name: string) => void;
  onSave: () => void;
  onChange: () => void;
}) {
  const { running, busy, error } = useAppStatus();
  const canSave = !running && !busy && draftName.trim().length > 0;

  return (
    <section className="flex w-full max-w-4xl flex-col items-center py-2 text-center sm:py-4">
      <p className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-ink">
        <span aria-hidden="true" className="size-2.5 rounded-sm bg-brand" />
        execs
      </p>
      <div className="eyebrow mt-6 flex items-center gap-2">
        <ShieldCheck aria-hidden="true" size={15} weight="bold" />
        <span>Existing setup found</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Keep what you already built
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
        This TF2 install already contains customization. Save a complete snapshot before execs
        changes anything.
      </p>

      <div data-testid="first-run-existing" className="mt-8 w-full text-left">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 text-brand">
            <FolderOpen aria-hidden="true" size={20} weight="duotone" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-ink">Confirmed TF2 install</h2>
            <p className="mt-1 break-all font-mono text-xs leading-5 text-ink-muted">{path}</p>
          </div>
        </div>

        {reasons.length > 0 ? (
          <PaneSection
            id="first-run-customization"
            title="Customization detected"
            description="These files will be preserved inside the new profile snapshot."
            meta={`${reasons.length} ${reasons.length === 1 ? "item" : "items"}`}
          >
            <ul data-testid="first-run-reasons" className="mt-3 grid gap-x-8 sm:grid-cols-2">
              {reasons.map((reason) => (
                <li
                  key={reason}
                  className="flex items-start gap-2 border-b border-edge/60 py-2.5 text-xs leading-5 text-ink-muted"
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
          </PaneSection>
        ) : null}

        <PaneSection
          id="first-run-safety"
          title="Safe first snapshot"
          description="Saving copies the current file-safe setup into your profile library. It does not remove or replace the live files in this step."
        />

        {running ? (
          <PaneSection
            id="first-run-locked"
            title={
              <span className="flex items-center gap-2 text-team-red">
                <WarningCircle aria-hidden="true" size={17} weight="fill" />
                TF2 is currently running
              </span>
            }
            description="This install remains read-only. Close the game to name and save the profile."
          />
        ) : (
          <PaneSection
            id="first-run-name"
            title={<label htmlFor="first-run-profile-name">Profile name</label>}
            description="Choose a name you will recognize when switching setups later."
          >
            <form
              id="first-run-save-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSave();
              }}
            >
              <input
                id="first-run-profile-name"
                value={draftName}
                onChange={(event) => onDraftName(event.target.value)}
                placeholder="My current setup"
                disabled={busy}
                autoComplete="off"
                className="field mt-3 w-full px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              />
            </form>
          </PaneSection>
        )}

        {error ? (
          <Alert tone="error" className="mt-6">
            {error}
          </Alert>
        ) : null}

        <div className="mt-8 flex flex-col-reverse gap-3 border-t border-edge pt-5 sm:flex-row sm:items-center sm:justify-between">
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
