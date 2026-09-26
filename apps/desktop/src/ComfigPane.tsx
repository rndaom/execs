import { ArrowSquareOut } from "@phosphor-icons/react";
import { useState } from "react";
import { ClassTabs } from "./components/ui/ClassTabs";
import { Disclosure } from "./components/ui/Disclosure";
import { OptionTile } from "./components/ui/OptionTile";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { SwitchRow } from "./components/ui/Switch";
import { useAppStatus } from "./hooks/useAppStatus";
import {
  type ComfigPreset,
  type OfficialAddon,
  openEmbeddedPage,
  openExternal,
  type ProfileDetail,
} from "./lib/bridge";
import {
  COMFIG_MODULE_GROUPS,
  COMFIG_PRESETS,
  type ComfigModule,
  type ComfigModuleGroupId,
  comfigPresetLabel,
  oldComfigPresetMessage,
} from "./lib/comfig-catalog";
import {
  type ComfigUiState,
  canUseTransparentViewmodels,
  hasBaseVpk,
  hasComfigCustom,
  OFFICIAL_ADDON_DETAILS,
  setModuleLevel,
} from "./lib/comfig-ui";
import { OFFICIAL_ADDONS } from "./lib/first-run-ui";
import { canWriteSettings } from "./lib/settings-ui";

const DEFAULT_VISIBLE_MODULES = 12;

function readableLevel(level: string): string {
  const spaced = level.replaceAll("_", " ");
  return spaced.length > 0 ? `${spaced[0].toUpperCase()}${spaced.slice(1)}` : spaced;
}

function ModuleControl({
  module,
  value,
  locked,
  onChange,
}: {
  module: ComfigModule;
  value: string;
  locked: boolean;
  onChange: (value: string) => void;
}) {
  const labelId = `comfig-module-label-${module.id}`;
  const options = ["", ...module.levels];

  return (
    <article className="min-w-0 py-3">
      <div className="flex items-start justify-between gap-3">
        <p id={labelId} className="t-row">
          {module.label}
        </p>
        <p className="shrink-0 text-[12px] text-ink-faint">
          {value ? readableLevel(value) : "Preset default"}
        </p>
      </div>

      <fieldset
        data-testid={`comfig-module-${module.id}`}
        data-value={value}
        className="mt-2 flex min-w-0 flex-wrap gap-0.5 rounded-lg bg-bg p-0.5"
      >
        <legend className="sr-only">{module.label} options</legend>
        {options.map((option) => {
          const selected = option === value;
          // Only real overrides carry the accent ring — a page of preset
          // defaults stays calm.
          const selectedClass =
            option === ""
              ? "bg-panel-raised font-medium text-ink"
              : "bg-panel-raised font-medium text-ink shadow-[inset_0_0_0_1.5px_var(--color-brand)]";
          return (
            <button
              key={option || "preset-default"}
              type="button"
              aria-pressed={selected}
              disabled={locked}
              onClick={() => onChange(option)}
              className={`min-w-fit flex-1 rounded-md px-2 py-1.5 text-[12px] leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40 ${
                selected ? selectedClass : "text-ink-muted hover:bg-panel-raised hover:text-ink"
              }`}
            >
              {option === ""
                ? "Use preset"
                : option === "default"
                  ? "Module default"
                  : readableLevel(option)}
            </button>
          );
        })}
      </fieldset>
      {module.levels.includes("default") ? (
        <p className="t-meta mt-1">
          Use preset inherits its value; Module default writes an explicit override.
        </p>
      ) : null}
    </article>
  );
}

/**
 * The fold's one-line summary. Custom has no preset values to differ from, so
 * its modules are simply the ones set.
 */
export function comfigModulesSummary(preset: string, presetLabel: string, count: number): string {
  const modules = `${count} ${count === 1 ? "module" : "modules"}`;
  if (preset === "none") return count === 0 ? "No modules set yet" : `${modules} set`;
  return count === 0
    ? `Using ${presetLabel} for every module`
    : `${modules} changed from ${presetLabel}`;
}

export function ComfigPane({
  detail,
  state,
  onApplyPreset,
  onApplyModules,
  onToggleAddon,
  onUpdatePackages,
  onImportCustom,
}: {
  detail: ProfileDetail | null;
  state: ComfigUiState;
  onApplyPreset: (preset: ComfigPreset) => Promise<boolean>;
  onApplyModules: (modules: Record<string, string>) => Promise<boolean>;
  onToggleAddon: (id: OfficialAddon) => Promise<boolean>;
  onUpdatePackages: () => void;
  onImportCustom: () => void;
}) {
  const { running, busy } = useAppStatus();
  // These are explicit writes. Keep the selected controls and preview on the
  // persisted snapshot until the host confirms it with a complete reload.
  // A failed choice remains available to select again, including after a
  // hidden-pane visit; it cannot leak into a later module/addon payload.
  const [activeGroupId, setActiveGroupId] = useState<ComfigModuleGroupId>("graphics");
  const [moduleSearch, setModuleSearch] = useState("");
  const [showAllModules, setShowAllModules] = useState(false);

  const locked = !canWriteSettings(running, busy);
  const paths = detail?.files.map((file) => file.path) ?? [];
  const packagesInstalled = hasBaseVpk(paths);
  const customImported = hasComfigCustom(paths);
  const selectedPresetLabel = comfigPresetLabel(state.preset);
  const oldPresetMessage = oldComfigPresetMessage(state.preset);
  const moduleOverrideCount = Object.values(state.modules).filter(Boolean).length;
  const activeGroup =
    COMFIG_MODULE_GROUPS.find((group) => group.id === activeGroupId) ?? COMFIG_MODULE_GROUPS[0];
  const normalizedSearch = moduleSearch.trim().toLowerCase();
  const matchingModules = activeGroup.modules.filter((module) => {
    if (!normalizedSearch) {
      return true;
    }
    return (
      module.label.toLowerCase().includes(normalizedSearch) ||
      module.id.toLowerCase().includes(normalizedSearch) ||
      module.levels.some((level) => level.toLowerCase().includes(normalizedSearch))
    );
  });
  const displayedModules =
    normalizedSearch || showAllModules
      ? matchingModules
      : matchingModules.slice(0, DEFAULT_VISIBLE_MODULES);
  const hiddenModuleCount = matchingModules.length - displayedModules.length;

  function updateModule(id: string, value: string) {
    const modules = setModuleLevel(state.modules, id, value);
    void onApplyModules(modules);
  }

  // Saving is reported in the toast, once, for every pane — the header only
  // carries the problems a save cannot fix.
  const statusProblem = running
    ? null
    : detail === null
      ? "Loading…"
      : !packagesInstalled
        ? "Packages not installed"
        : null;

  return (
    <section data-testid="settings-comfig" className="min-w-0 text-left">
      <PaneHeader
        title="Comfig"
        actions={
          statusProblem ? (
            <p aria-live="polite" className="badge">
              {statusProblem}
            </p>
          ) : null
        }
      />

      <section aria-labelledby="comfig-preset-heading">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 id="comfig-preset-heading" className="t-section">
            Preset
          </h2>
          <button
            type="button"
            data-testid="comfig-preset-guide"
            onClick={() => void openEmbeddedPage("comfig-docs")}
            className="btn btn-quiet"
          >
            Preset guide
            <ArrowSquareOut size={13} />
          </button>
        </div>

        {oldPresetMessage ? (
          <p data-testid="comfig-old-preset" className="t-meta mt-2 text-ink-muted">
            {oldPresetMessage}
          </p>
        ) : null}

        <div
          data-testid="comfig-preset"
          role="radiogroup"
          aria-labelledby="comfig-preset-heading"
          className="comfig-presets mt-3"
        >
          {COMFIG_PRESETS.map((item) => (
            <OptionTile
              key={item.id}
              id={`comfig-preset-${item.id}`}
              name="comfig-preset"
              value={item.id}
              title={item.label}
              description={item.description}
              selected={state.preset === item.id}
              disabled={locked}
              onSelect={() => {
                void onApplyPreset(item.id);
              }}
            />
          ))}
        </div>
      </section>

      <PaneSection
        id="comfig-addons"
        title="Official addons"
        meta={<span className="tnum">{state.addons.length} selected</span>}
      >
        <div className="comfig-addons mt-2">
          {OFFICIAL_ADDONS.map((item) => (
            <SwitchRow
              key={item.id}
              id={`comfig-addon-input-${item.id}`}
              testId={`comfig-addon-${item.id}`}
              label={item.label}
              description={OFFICIAL_ADDON_DETAILS[item.id]}
              checked={state.addons.includes(item.id)}
              disabled={
                locked ||
                (item.id === "transparent-viewmodels" &&
                  !canUseTransparentViewmodels(detail?.layer ?? null))
              }
              onChange={() => {
                void onToggleAddon(item.id);
              }}
            />
          ))}
        </div>
      </PaneSection>

      <Disclosure
        profileId={detail?.id ?? null}
        storageKey="comfig-modules"
        testId="comfig-modules-disclosure"
        className="section"
        summary={
          <span className="flex min-w-0 flex-1 items-center justify-between gap-4">
            <span>Fine-tune modules</span>
            <span data-testid="comfig-modules-summary" className="t-meta tnum">
              {comfigModulesSummary(state.preset, selectedPresetLabel, moduleOverrideCount)}
            </span>
          </span>
        }
      >
        <div data-testid="comfig-modules" className="mt-3">
          <ClassTabs
            tabs={COMFIG_MODULE_GROUPS.map((group) => ({
              id: group.id,
              label: group.label,
            }))}
            selected={activeGroupId}
            label="Module categories"
            idPrefix="comfig-module-tab"
            panelId="comfig-module-panel"
            onSelect={(id) => {
              setActiveGroupId(id);
              setModuleSearch("");
              setShowAllModules(false);
            }}
          />
          <label className="mt-3 block">
            <span className="sr-only">Search {activeGroup.label} modules</span>
            <input
              type="search"
              value={moduleSearch}
              onChange={(event) => {
                setModuleSearch(event.target.value);
                setShowAllModules(false);
              }}
              placeholder={`Search ${activeGroup.label.toLowerCase()}…`}
              className="field w-full px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
          </label>
        </div>

        <div
          id="comfig-module-panel"
          role="tabpanel"
          aria-labelledby={`comfig-module-tab-${activeGroup.id}`}
          className="mt-1"
        >
          {displayedModules.length > 0 ? (
            <div>
              {displayedModules.map((module) => (
                <div key={module.id} className="border-b border-edge">
                  <ModuleControl
                    module={module}
                    value={state.modules[module.id] ?? ""}
                    locked={locked}
                    onChange={(value) => updateModule(module.id, value)}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="t-body text-ink">
                No matching {activeGroup.label.toLowerCase()} modules.
              </p>
              <button
                type="button"
                onClick={() => setModuleSearch("")}
                className="btn btn-ghost mt-3"
              >
                Clear search
              </button>
            </div>
          )}
        </div>

        {hiddenModuleCount > 0 ? (
          <button
            type="button"
            onClick={() => setShowAllModules(true)}
            className="mt-3 w-full rounded-lg py-2.5 text-[13px] text-ink-muted transition-colors duration-150 hover:bg-panel hover:text-ink"
          >
            Show {hiddenModuleCount} more {activeGroup.label.toLowerCase()} modules
          </button>
        ) : showAllModules &&
          !normalizedSearch &&
          matchingModules.length > DEFAULT_VISIBLE_MODULES ? (
          <button
            type="button"
            onClick={() => setShowAllModules(false)}
            className="mt-3 w-full rounded-lg py-2.5 text-[13px] text-ink-muted transition-colors duration-150 hover:bg-panel hover:text-ink"
          >
            Show fewer modules
          </button>
        ) : null}
      </Disclosure>

      <section className="section" aria-label="Comfig packages">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="t-section">Packages and extras</h2>
            <p className="t-meta mt-1">
              {packagesInstalled
                ? "Changes save as you make them."
                : "No mastercomfig packages installed yet."}
            </p>
          </div>

          <div className="pane-actions">
            <button
              type="button"
              data-testid="comfig-update"
              disabled={running || busy}
              onClick={onUpdatePackages}
              className="btn btn-primary"
            >
              {busy ? "Working…" : packagesInstalled ? "Update packages" : "Install packages"}
            </button>
            <button
              type="button"
              data-testid="comfig-import"
              disabled={locked}
              onClick={onImportCustom}
              className="btn btn-ghost"
            >
              {customImported ? "Replace comfig-custom…" : "Import comfig-custom…"}
            </button>
            <button
              type="button"
              data-testid="comfig-extras"
              onClick={() => void openEmbeddedPage("comfig-extras")}
              className="btn btn-ghost"
            >
              Open extras
              <ArrowSquareOut size={13} />
            </button>
          </div>
        </div>
      </section>

      <p className="pane-note mt-6">
        Uses official mastercomfig packages. execs is not affiliated with mastercomfig or{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://comfig.app")}
          className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          comfig.app
        </button>
        . Support the project through its{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://docs.comfig.app/latest/support_me/")}
          className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          donate page
        </button>
        .
      </p>
    </section>
  );
}
