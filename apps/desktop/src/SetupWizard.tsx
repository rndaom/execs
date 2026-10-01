import { OnboardingFrame } from "./components/OnboardingFrame";
import { OperationError } from "./components/ui/OperationError";
import { OptionTile } from "./components/ui/OptionTile";
import { PaneSection } from "./components/ui/PaneSection";
import { SwitchRow } from "./components/ui/Switch";
import { useToast } from "./components/ui/Toast";
import { useAppStatus } from "./hooks/useAppStatus";
import { openExternal, type StartFrom, type WizardSpec } from "./lib/bridge";
import { COMFIG_PRESETS } from "./lib/comfig-catalog";
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
  onCreateOnly,
  onCancel,
}: {
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
  /** Create without switching; offered only when creating another profile. */
  onCreateOnly?: () => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { running, busy, error, dismissError } = useAppStatus();
  const toast = useToast();
  const canApply = canApplyWizard(draftName, running, busy);

  return (
    <OnboardingFrame
      title="Build your TF2 profile"
      width="wide"
      compact
      steps={
        creating
          ? undefined
          : [
              { label: "Find TF2", state: "complete" },
              { label: "Confirm folder", state: "complete" },
              { label: "Create profile", state: "current" },
            ]
      }
    >
      <form
        id="setup-wizard"
        data-testid="setup-wizard"
        onSubmit={(event) => {
          event.preventDefault();
          if (canApply) onApply();
        }}
      >
        <div className="surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="wizard-name" className="t-row shrink-0 sm:w-[120px]">
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
              className="input min-w-[200px] flex-1"
            />
            <div className="pane-actions">
              {onCancel ? (
                <button
                  type="button"
                  data-testid="wizard-cancel"
                  disabled={busy}
                  onClick={onCancel}
                  className="btn btn-ghost"
                >
                  Cancel
                </button>
              ) : null}
              {creating && onCreateOnly ? (
                <button
                  type="button"
                  data-testid="wizard-create-only"
                  disabled={!canApply}
                  onClick={() => {
                    const name = draftName.trim();
                    toast.startSave("wizard:create", "Creating profile…");
                    void onCreateOnly().then((created) =>
                      created
                        ? toast.finishSave(`${name} created`, "wizard:create")
                        : toast.cancelSave("wizard:create"),
                    );
                  }}
                  className="btn btn-ghost"
                >
                  Create
                </button>
              ) : null}
              <button
                type="submit"
                data-testid="wizard-apply"
                disabled={!canApply}
                className="btn btn-primary"
              >
                {wizardApplyCopy(running, creating)}
              </button>
            </div>
          </div>
        </div>

        <OperationError message={error} onDismiss={dismissError} className="mt-4" />

        <div className="section pane-workspace">
          <div>
            {startFrom && onStartFrom ? (
              <PaneSection id="wizard-start-from" title="Start from" first>
                <div data-testid="wizard-start-from" className="mt-4 grid gap-3 sm:grid-cols-2">
                  {START_FROM_OPTIONS.map((option) => (
                    <OptionTile
                      key={option.id}
                      id={`wizard-start-from-${option.id}`}
                      name="wizard-start-from"
                      value={option.id}
                      title={option.label}
                      selected={startFrom === option.id}
                      disabled={busy}
                      onSelect={() => onStartFrom(option.id)}
                    />
                  ))}
                </div>
              </PaneSection>
            ) : null}

            <PaneSection id="wizard-preset" title="Preset" first={!(startFrom && onStartFrom)}>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {COMFIG_PRESETS.map((item) => (
                  <OptionTile
                    key={item.id}
                    id={`comfig-preset-${item.id}`}
                    name="comfig-preset"
                    value={item.id}
                    title={item.label}
                    selected={preset === item.id}
                    disabled={busy}
                    onSelect={() => onPreset(item.id)}
                  />
                ))}
              </div>
            </PaneSection>
          </div>

          <PaneSection
            id="wizard-addons"
            title="Official addons"
            meta={<span className="tnum">{addons.length} selected</span>}
            first
          >
            <div className="mt-1">
              {OFFICIAL_ADDONS.map((item) => (
                <SwitchRow
                  key={item.id}
                  id={`wizard-addon-input-${item.id}`}
                  testId={`wizard-addon-${item.id}`}
                  label={item.label}
                  description={OFFICIAL_ADDON_DETAILS[item.id]}
                  checked={addons.includes(item.id)}
                  disabled={busy}
                  onChange={() => onToggleAddon(item.id)}
                />
              ))}
            </div>
          </PaneSection>
        </div>

        <p className="t-meta mt-6 border-t border-edge pt-4 text-ink-faint">
          Packages by{" "}
          <button
            type="button"
            onClick={() => void openExternal("https://comfig.app")}
            className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
          >
            mastercomfig
          </button>
          , not affiliated with execs
        </p>
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
