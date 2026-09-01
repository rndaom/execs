import { Check, Plus, SlidersHorizontal } from "@phosphor-icons/react";
import { Alert } from "./components/ui/Alert";
import { PaneSection } from "./components/ui/PaneSection";
import { useAppStatus } from "./hooks/useAppStatus";
import type { WizardSpec } from "./lib/bridge";
import {
  COMFIG_PRESETS,
  type ComfigPresetId,
  canApplyWizard,
  OFFICIAL_ADDONS,
  type OfficialAddonId,
  wizardApplyCopy,
} from "./lib/first-run-ui";

const PRESET_DETAILS: Record<
  ComfigPresetId,
  { summary: string; performance: string; fidelity: string }
> = {
  ultra: {
    summary: "Maximum visual fidelity for powerful systems.",
    performance: "Lowest",
    fidelity: "Maximum",
  },
  high: {
    summary: "Rich effects and detail with lighter overhead.",
    performance: "Moderate",
    fidelity: "High",
  },
  medium_high: {
    summary: "High-quality visuals with sensible tuning.",
    performance: "Good",
    fidelity: "High",
  },
  medium: {
    summary: "A balanced mix of clear visuals and speed.",
    performance: "Great",
    fidelity: "Balanced",
  },
  medium_low: {
    summary: "More frames without a bare-bones look.",
    performance: "High",
    fidelity: "Moderate",
  },
  low: {
    summary: "Performance-first settings for older hardware.",
    performance: "Very high",
    fidelity: "Low",
  },
  very_low: {
    summary: "Minimum overhead for the most consistent frames.",
    performance: "Maximum",
    fidelity: "Minimal",
  },
  none: {
    summary: "Create the profile without preset tuning.",
    performance: "Stock",
    fidelity: "Stock",
  },
};

const ADDON_DETAILS: Record<OfficialAddonId, string> = {
  "no-footsteps": "Disable footstep sound effects.",
  "no-pyroland": "Reduce Pyroland visual overrides.",
  "no-soundscapes": "Disable ambient map soundscapes.",
  "no-tutorial": "Remove tutorial prompts and coaching.",
  lowmem: "Lower memory use on constrained systems.",
  "null-canceling-movement": "Resolve opposing movement inputs cleanly.",
  "flat-mouse": "Use direct, unaccelerated mouse input.",
  "transparent-viewmodels": "Make first-person viewmodels translucent.",
};

export function SetupWizard({
  title,
  draftName,
  preset,
  addons,
  creating = false,
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
  creating?: boolean;
  onDraftName: (name: string) => void;
  onPreset: (preset: ComfigPresetId) => void;
  onToggleAddon: (id: OfficialAddonId) => void;
  onApply: () => void;
  onCancel?: () => void;
}) {
  const { running, busy, error } = useAppStatus();
  const canApply = canApplyWizard(draftName, running, busy);

  return (
    <section className="flex w-full max-w-6xl flex-col items-center py-2 text-center sm:py-4">
      <p className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-ink">
        <span aria-hidden="true" className="size-2.5 rounded-sm bg-brand" />
        execs
      </p>
      <div className="eyebrow mt-6 flex items-center gap-2">
        <SlidersHorizontal aria-hidden="true" size={15} weight="bold" />
        <span>{title}</span>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        Build your TF2 profile
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-muted">
        Give it a name, choose the visual-performance balance you want, and add only the official
        extras you need.
      </p>

      <form
        data-testid="setup-wizard"
        className="surface mt-7 w-full text-left shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <div className="space-y-4 p-5 sm:p-7">
          <PaneSection
            id="wizard-details"
            first
            title="Profile details"
            description="This name appears in your profile switcher."
            meta="Required"
          >
            <label className="sr-only" htmlFor="wizard-name">
              Profile name
            </label>
            <input
              id="wizard-name"
              data-testid="wizard-name"
              value={draftName}
              onChange={(event) => onDraftName(event.target.value)}
              placeholder="My TF2 setup"
              disabled={busy}
              autoComplete="off"
              className="field mt-3 w-full px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </PaneSection>

          <PaneSection
            id="wizard-preset"
            title="Choose a preset"
            description="You can fine-tune every module later from the Comfig page."
            meta="Powered by mastercomfig"
          >
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {COMFIG_PRESETS.map((item) => {
                const selected = preset === item.id;
                const detail = PRESET_DETAILS[item.id];
                return (
                  <div key={item.id} className="relative min-w-0">
                    <input
                      id={`comfig-preset-${item.id}`}
                      type="radio"
                      name="comfig-preset"
                      value={item.id}
                      checked={selected}
                      onChange={() => onPreset(item.id)}
                      disabled={busy}
                      className="peer sr-only"
                    />
                    <label
                      htmlFor={`comfig-preset-${item.id}`}
                      className={`flex min-h-40 cursor-pointer flex-col rounded-xl border p-4 transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand/70 ${
                        selected
                          ? "border-brand bg-brand/10"
                          : "border-edge bg-bg/45 hover:border-ink-faint hover:bg-panel-raised/35"
                      } ${busy ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span
                          className={`text-base font-semibold leading-none ${
                            selected ? "text-brand" : "text-ink"
                          }`}
                        >
                          {item.label}
                        </span>
                        {selected ? (
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-pill bg-brand text-on-brand">
                            <Check aria-hidden="true" size={15} weight="bold" />
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-3 text-xs leading-5 text-ink-muted">
                        {detail.summary}
                      </span>
                      <span className="mt-auto grid grid-cols-2 gap-2 border-t border-edge/70 pt-3 text-[11px]">
                        <span>
                          <span className="block text-ink-faint">Performance</span>
                          <span className="mt-0.5 block text-ink">{detail.performance}</span>
                        </span>
                        <span>
                          <span className="block text-ink-faint">Fidelity</span>
                          <span className="mt-0.5 block text-ink">{detail.fidelity}</span>
                        </span>
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          </PaneSection>

          <PaneSection
            id="wizard-addons"
            title="Official addons"
            description="Optional packages maintained alongside mastercomfig."
            meta={`${addons.length} selected`}
          >
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {OFFICIAL_ADDONS.map((item) => {
                const selected = addons.includes(item.id);
                return (
                  <div key={item.id} className="relative min-w-0">
                    <input
                      id={`wizard-addon-input-${item.id}`}
                      type="checkbox"
                      data-testid={`wizard-addon-${item.id}`}
                      checked={selected}
                      onChange={() => onToggleAddon(item.id)}
                      disabled={busy}
                      className="peer sr-only"
                    />
                    <label
                      htmlFor={`wizard-addon-input-${item.id}`}
                      className={`flex min-h-28 cursor-pointer items-start justify-between gap-3 rounded-xl border p-4 transition-colors peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand/70 ${
                        selected
                          ? "border-brand/80 bg-brand/10"
                          : "border-edge bg-bg/45 hover:border-ink-faint hover:bg-panel-raised/35"
                      } ${busy ? "cursor-not-allowed opacity-50" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-ink">{item.label}</span>
                        <span className="mt-1.5 block text-xs leading-5 text-ink-muted">
                          {ADDON_DETAILS[item.id]}
                        </span>
                      </span>
                      <span
                        className={`flex size-7 shrink-0 items-center justify-center rounded-pill border ${
                          selected
                            ? "border-brand bg-brand text-on-brand"
                            : "border-edge bg-bg text-ink-muted"
                        }`}
                      >
                        {selected ? (
                          <Check aria-hidden="true" size={15} weight="bold" />
                        ) : (
                          <Plus aria-hidden="true" size={15} weight="bold" />
                        )}
                        <span className="sr-only">{selected ? "Selected" : "Not selected"}</span>
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          </PaneSection>

          <p className="mt-8 text-xs leading-5 text-ink-muted">
            Uses official mastercomfig packages. execs is not affiliated with{" "}
            <a
              href="https://comfig.app"
              target="_blank"
              rel="noreferrer"
              className="text-brand underline decoration-brand/40 underline-offset-2 hover:text-brand-hover"
            >
              comfig.app
            </a>
            .
          </p>

          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>

        <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-3 border-t border-edge bg-panel/95 px-5 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-7">
          <div>
            {onCancel ? (
              <button
                type="button"
                data-testid="wizard-cancel"
                disabled={busy}
                onClick={onCancel}
                className="btn btn-ghost w-full sm:w-auto"
              >
                Cancel
              </button>
            ) : (
              <p className={`text-xs ${running ? "text-team-red" : "text-ink-muted"}`}>
                {running
                  ? "TF2 is running — setup stays read-only."
                  : "No game files are changed until you apply."}
              </p>
            )}
          </div>
          <button
            type="submit"
            data-testid="wizard-apply"
            disabled={!canApply}
            className="btn btn-primary w-full px-6 py-2.5 sm:w-auto"
          >
            {wizardApplyCopy(running, creating)}
          </button>
        </div>
      </form>
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
