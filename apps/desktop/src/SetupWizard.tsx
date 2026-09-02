import { SlidersHorizontal } from "@phosphor-icons/react";
import { useState } from "react";
import { OnboardingFrame } from "./components/OnboardingFrame";
import { Alert } from "./components/ui/Alert";
import { OptionTile } from "./components/ui/OptionTile";
import { PaneSection } from "./components/ui/PaneSection";
import { useAppStatus } from "./hooks/useAppStatus";
import { openExternal, type StartFrom, type WizardSpec } from "./lib/bridge";
import { presetListExpanded, visibleComfigPresets } from "./lib/comfig-catalog";
import { OFFICIAL_ADDON_DETAILS } from "./lib/comfig-ui";
import {
  type ComfigPresetId,
  canApplyWizard,
  OFFICIAL_ADDONS,
  type OfficialAddonId,
  START_FROM_OPTIONS,
  wizardApplyCopy,
} from "./lib/first-run-ui";

export function SetupWizard({
  title,
  draftName,
  preset,
  addons,
  creating = false,
  startFrom = null,
  onDraftName,
  onPreset,
  onToggleAddon,
  onStartFrom,
  onApply,
  onCancel,
}: {
  title: string;
  draftName: string;
  preset: ComfigPresetId;
  addons: OfficialAddonId[];
  creating?: boolean;
  /** `null` on first run: there is no active profile to start from. */
  startFrom?: StartFrom | null;
  onDraftName: (name: string) => void;
  onPreset: (preset: ComfigPresetId) => void;
  onToggleAddon: (id: OfficialAddonId) => void;
  onStartFrom?: (next: StartFrom) => void;
  onApply: () => void;
  onCancel?: () => void;
}) {
  const { running, busy, error } = useAppStatus();
  const [showAllPresets, setShowAllPresets] = useState(false);
  const canApply = canApplyWizard(draftName, running, busy);
  const presets = visibleComfigPresets(preset, showAllPresets);
  const expanded = presetListExpanded(preset, showAllPresets);
  // A preset outside the featured four forces the list open, so there is
  // nothing to collapse back to.
  const canCollapsePresets = !presetListExpanded(preset, false);

  return (
    <OnboardingFrame
      eyebrow={title}
      icon={<SlidersHorizontal aria-hidden="true" size={13} weight="bold" />}
      title="Build your TF2 profile"
      lede="Name it and pick a preset. Everything else already has a sensible default."
      width="wide"
      footer={
        <div className="flex flex-col-reverse gap-3 border-t border-edge pt-6 sm:flex-row sm:items-center sm:justify-between">
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
            <p className="t-meta">
              {running
                ? "TF2 is running — setup stays read-only."
                : "No game files change until you apply."}
            </p>
          )}
          <button
            type="submit"
            form="setup-wizard"
            data-testid="wizard-apply"
            disabled={!canApply}
            className="btn btn-primary w-full sm:w-auto"
          >
            {wizardApplyCopy(running, creating)}
          </button>
        </div>
      }
    >
      <form
        id="setup-wizard"
        data-testid="setup-wizard"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <label htmlFor="wizard-name" className="t-row block">
          Profile name
        </label>
        <p className="t-meta mt-1">This name appears in your profile switcher.</p>
        <input
          id="wizard-name"
          data-testid="wizard-name"
          value={draftName}
          onChange={(event) => onDraftName(event.target.value)}
          placeholder="My TF2 setup"
          disabled={busy}
          autoComplete="off"
          className="field mt-3 w-full px-4 py-3 text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />

        {startFrom && onStartFrom ? (
          <PaneSection
            id="wizard-start-from"
            title="Start from"
            description="Where your in-game options come from. Everything below is set by this wizard."
          >
            <div data-testid="wizard-start-from" className="mt-4 grid gap-3 sm:grid-cols-2">
              {START_FROM_OPTIONS.map((option) => (
                <OptionTile
                  key={option.id}
                  id={`wizard-start-from-${option.id}`}
                  name="wizard-start-from"
                  value={option.id}
                  title={option.label}
                  description={option.description}
                  selected={startFrom === option.id}
                  disabled={busy}
                  onSelect={() => onStartFrom(option.id)}
                />
              ))}
            </div>
          </PaneSection>
        ) : null}

        <PaneSection
          id="wizard-preset"
          title="Choose a preset"
          description="Your preset supplies the default for every module. You can fine-tune later."
          meta={
            canCollapsePresets ? (
              <button
                type="button"
                data-testid="wizard-show-all-presets"
                onClick={() => setShowAllPresets((current) => !current)}
                disabled={busy}
                className="btn btn-ghost"
              >
                {expanded ? "Show core presets" : "Show all presets"}
              </button>
            ) : null
          }
        >
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {presets.map((item) => (
              <OptionTile
                key={item.id}
                id={`comfig-preset-${item.id}`}
                name="comfig-preset"
                value={item.id}
                title={item.label}
                description={item.description}
                selected={preset === item.id}
                disabled={busy}
                meta={
                  <span className="grid grid-cols-2 gap-2 border-t border-edge pt-3 text-[12px]">
                    <span>
                      <span className="block text-ink-faint">Performance</span>
                      <span className="mt-0.5 block text-ink-muted">{item.performance}</span>
                    </span>
                    <span>
                      <span className="block text-ink-faint">Fidelity</span>
                      <span className="mt-0.5 block text-ink-muted">{item.fidelity}</span>
                    </span>
                  </span>
                }
                onSelect={() => onPreset(item.id)}
              />
            ))}
          </div>
        </PaneSection>

        <PaneSection
          id="wizard-addons"
          title="Official addons"
          description="Optional packages maintained alongside mastercomfig. All off by default."
          meta={<span className="tnum">{addons.length} selected</span>}
        >
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {OFFICIAL_ADDONS.map((item) => (
              <OptionTile
                key={item.id}
                id={`wizard-addon-input-${item.id}`}
                type="checkbox"
                testId={`wizard-addon-${item.id}`}
                title={item.label}
                description={OFFICIAL_ADDON_DETAILS[item.id]}
                selected={addons.includes(item.id)}
                disabled={busy}
                onSelect={() => onToggleAddon(item.id)}
              />
            ))}
          </div>
        </PaneSection>

        <p className="t-meta mt-12 text-ink-faint">
          Uses official mastercomfig packages. execs is not affiliated with{" "}
          <button
            type="button"
            onClick={() => void openExternal("https://comfig.app")}
            className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
          >
            comfig.app
          </button>
          .
        </p>

        {error ? (
          <Alert tone="error" className="mt-6">
            {error}
          </Alert>
        ) : null}
      </form>
    </OnboardingFrame>
  );
}

export function wizardSpec(
  name: string,
  preset: ComfigPresetId,
  addons: OfficialAddonId[],
): WizardSpec {
  return { name: name.trim(), preset, addons };
}
