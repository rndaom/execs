import type { ReactNode } from "react";
import type { WizardSpec } from "./lib/bridge";
import {
  canApplyWizard,
  COMFIG_PRESETS,
  type ComfigPresetId,
  type OfficialAddonId,
  OFFICIAL_ADDONS,
  wizardApplyCopy,
} from "./lib/first-run-ui";

export function SetupWizard({
  title,
  draftName,
  preset,
  addons,
  running,
  busy,
  error,
  creating = false,
  chrome,
  onDraftName,
  onPreset,
  onToggleAddon,
  onApply,
  onCancel,
}: {
  title: string;
  draftName: string;
  preset: ComfigPresetId;
  addons: OfficialAddonId[];
  running: boolean;
  busy: boolean;
  error: string | null;
  creating?: boolean;
  chrome?: ReactNode;
  onDraftName: (name: string) => void;
  onPreset: (preset: ComfigPresetId) => void;
  onToggleAddon: (id: OfficialAddonId) => void;
  onApply: () => void;
  onCancel?: () => void;
}) {
  const canApply = canApplyWizard(draftName, running, busy);

  return (
    <section className="flex w-full flex-col items-center text-center">
      <h1 className="font-display text-6xl text-brand">execs</h1>
      <p className="mt-6 font-display text-sm tracking-wide text-ink-muted">{title}</p>
      <p className="mt-2 max-w-lg text-sm text-ink">
        Name this setup, pick a mastercomfig preset, then apply when TF2 is closed.
      </p>
      {chrome ? <div className="mt-4">{chrome}</div> : null}

      <form
        data-testid="setup-wizard"
        className="mt-8 w-full rounded-xl border border-edge bg-panel p-4 text-left"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <label className="block text-sm text-ink-muted" htmlFor="wizard-name">
          Profile name
        </label>
        <input
          id="wizard-name"
          data-testid="wizard-name"
          value={draftName}
          onChange={(event) => onDraftName(event.target.value)}
          placeholder="Name this profile"
          disabled={busy}
          className="mt-2 w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
        />

        <p className="mt-5 font-display text-sm tracking-wide text-ink-muted">Preset</p>
        <div className="mt-2 flex flex-col gap-1.5">
          {COMFIG_PRESETS.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="comfig-preset"
                value={item.id}
                checked={preset === item.id}
                onChange={() => onPreset(item.id)}
                disabled={busy}
              />
              {item.label}
            </label>
          ))}
        </div>

        <p className="mt-5 font-display text-sm tracking-wide text-ink-muted">Official addons</p>
        <div className="mt-2 flex flex-col gap-1.5">
          {OFFICIAL_ADDONS.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                data-testid={`wizard-addon-${item.id}`}
                checked={addons.includes(item.id)}
                onChange={() => onToggleAddon(item.id)}
                disabled={busy}
              />
              {item.label}
            </label>
          ))}
        </div>

        <p className="mt-5 text-xs text-ink-muted">
          Uses official mastercomfig packages. Not affiliated with{" "}
          <a
            href="https://comfig.app"
            target="_blank"
            rel="noreferrer"
            className="text-brand underline decoration-brand/40 underline-offset-2"
          >
            comfig.app
          </a>
          .
        </p>

        {error ? <p className="mt-4 text-sm text-team-red">{error}</p> : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            data-testid="wizard-apply"
            disabled={!canApply}
            className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
          >
            {wizardApplyCopy(running, creating)}
          </button>
          {onCancel ? (
            <button
              type="button"
              data-testid="wizard-cancel"
              disabled={busy}
              onClick={onCancel}
              className="rounded-pill border border-edge px-5 py-2 text-sm text-ink hover:bg-panel-raised disabled:opacity-40"
            >
              Cancel
            </button>
          ) : null}
        </div>
    </section>
  );
}

export function wizardSpec(
  name: string,
  preset: ComfigPresetId,
  addons: OfficialAddonId[],
): WizardSpec {
  return { name: name.trim(), preset, addons };
}
