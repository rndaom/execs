import { ArrowSquareOut } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import presetHigh from "./assets/presets/high.webp";
import presetLow from "./assets/presets/low.webp";
import presetMedium from "./assets/presets/medium.webp";
import presetMediumHigh from "./assets/presets/medium_high.webp";
import presetMediumLow from "./assets/presets/medium_low.webp";
import presetUltra from "./assets/presets/ultra.webp";
import presetVeryLow from "./assets/presets/very_low.webp";
import { ClassTabs } from "./components/ui/ClassTabs";
import { Disclosure } from "./components/ui/Disclosure";
import { OptionTile } from "./components/ui/OptionTile";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { useAppStatus } from "./hooks/useAppStatus";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import {
  type ComfigPreset,
  type OfficialAddon,
  openEmbeddedPage,
  openExternal,
  type ProfileDetail,
} from "./lib/bridge";
import {
  COMFIG_MODULE_GROUPS,
  type ComfigModule,
  type ComfigModuleGroupId,
  comfigPresetLabel,
  FEATURED_PRESETS,
  presetListExpanded,
  visibleComfigPresets,
} from "./lib/comfig-catalog";
import {
  type ComfigUiState,
  hasBaseVpk,
  hasComfigCustom,
  OFFICIAL_ADDON_DETAILS,
  setModuleLevel,
} from "./lib/comfig-ui";
import { OFFICIAL_ADDONS } from "./lib/first-run-ui";
import { canWriteSettings } from "./lib/settings-ui";

/** Real in-game screenshots per preset (koth_sawmill, staged identically),
 * from the mastercomfig comfig-app repo (MIT). */
const PRESET_IMAGES: Record<Exclude<ComfigPreset, "none">, string> = {
  ultra: presetUltra,
  high: presetHigh,
  medium_high: presetMediumHigh,
  medium: presetMedium,
  medium_low: presetMediumLow,
  low: presetLow,
  very_low: presetVeryLow,
};

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
              {option ? readableLevel(option) : "Default"}
            </button>
          );
        })}
      </fieldset>
    </article>
  );
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
  onApplyPreset: (preset: ComfigPreset) => void;
  onApplyModules: (modules: Record<string, string>) => void;
  onToggleAddon: (id: OfficialAddon) => void;
  onUpdatePackages: () => void;
  onImportCustom: () => void;
}) {
  const { running, busy } = useAppStatus();
  const incoming = useMemo(
    () => ({ preset: state.preset, modules: state.modules, addons: state.addons }),
    [state],
  );
  // This pane is instant-apply and holds no user-typed draft, so the shared
  // seed guard only has to answer "did the incoming bytes change" — plus the
  // profile key, so a switch never leaves the previous preset on screen.
  const [draft, setDraft] = useSeededDraft(
    incoming,
    (value) => JSON.stringify(value),
    draftRecordKey(detail?.id ?? null),
  );
  const [activeGroupId, setActiveGroupId] = useState<ComfigModuleGroupId>("graphics");
  const [moduleSearch, setModuleSearch] = useState("");
  const [showAllModules, setShowAllModules] = useState(false);
  const [showAllPresets, setShowAllPresets] = useState(false);

  const locked = !canWriteSettings(running, busy);
  const paths = detail?.files.map((file) => file.path) ?? [];
  const packagesInstalled = hasBaseVpk(paths);
  const customImported = hasComfigCustom(paths);
  const presetsExpanded = presetListExpanded(draft.preset, showAllPresets);
  const visiblePresets = visibleComfigPresets(draft.preset, showAllPresets);
  const selectedPresetLabel = comfigPresetLabel(draft.preset);
  const presetImage = draft.preset === "none" ? null : PRESET_IMAGES[draft.preset];
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
    const modules = setModuleLevel(draft.modules, id, value);
    setDraft({ ...draft, modules });
    onApplyModules(modules);
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
        lede={
          <>
            Performance, visuals and networking, powered by{" "}
            <button
              type="button"
              onClick={() => void openExternal("https://comfig.app")}
              className="text-ink underline decoration-edge-strong underline-offset-4 hover:text-ink"
            >
              mastercomfig
            </button>
            .
          </>
        }
        actions={
          statusProblem ? (
            <p aria-live="polite" className="badge">
              {statusProblem}
            </p>
          ) : null
        }
      />

      {/* Lead with the one decision: the preset. The screenshot stays a fixed
          360px preview beside it and never becomes a full-width banner. */}
      <div className="hero-row">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <h2 className="t-section">Preset</h2>
              <p className="t-meta mt-1">Sets the default for every module.</p>
            </div>
          </div>

          <div data-testid="comfig-preset" className="mt-4 grid gap-3 sm:grid-cols-2">
            {visiblePresets.map((item) => (
              <OptionTile
                key={item.id}
                id={`comfig-preset-${item.id}`}
                name="comfig-preset"
                value={item.id}
                title={item.label}
                description={item.description}
                selected={draft.preset === item.id}
                disabled={locked}
                onSelect={() => {
                  setDraft({ ...draft, preset: item.id });
                  onApplyPreset(item.id);
                }}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {FEATURED_PRESETS.has(draft.preset) ? (
              <button
                type="button"
                onClick={() => setShowAllPresets((current) => !current)}
                className="btn btn-ghost"
              >
                {presetsExpanded ? "Show core presets" : "Show all presets"}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="comfig-preset-guide"
              onClick={() => void openEmbeddedPage("comfig-docs")}
              className="btn btn-ghost"
            >
              Preset guide
              <ArrowSquareOut size={13} />
            </button>
          </div>
        </div>

        {presetImage ? (
          <figure className="surface hero-preview relative m-0 self-start">
            <img
              src={presetImage}
              alt={`In-game screenshot of the ${selectedPresetLabel} preset on koth_sawmill`}
              className="aspect-video w-full object-cover"
            />
            <figcaption className="t-meta absolute right-2.5 bottom-2.5 rounded-md bg-bg/85 px-2.5 py-1 text-[12px] text-ink backdrop-blur-sm">
              {selectedPresetLabel}
            </figcaption>
          </figure>
        ) : (
          <div className="surface hero-preview grid aspect-video place-items-center self-start p-6 text-center">
            <p className="t-meta">Custom preset — modules decide every setting.</p>
          </div>
        )}
      </div>

      <section className="section" aria-labelledby="comfig-modules-heading">
        <Disclosure
          profileId={detail?.id ?? null}
          storageKey="comfig-modules"
          summary="Fine-tune modules"
          testId="comfig-modules"
        >
          <div className="mt-2 flex flex-col gap-3 border-b border-edge sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="comfig-modules-heading" className="sr-only">
                Fine-tune modules
              </h2>
              <div>
                <ClassTabs
                  tabs={COMFIG_MODULE_GROUPS.map((group) => ({
                    id: group.id,
                    label: group.label,
                    meta: group.modules.length,
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
              </div>
            </div>

            <label className="mb-2 block w-full sm:w-64">
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
              <div className="grid md:grid-cols-2 md:gap-x-8">
                {displayedModules.map((module) => (
                  <div key={module.id} className="border-b border-edge">
                    <ModuleControl
                      module={module}
                      value={draft.modules[module.id] ?? ""}
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
      </section>

      <PaneSection
        id="comfig-addons"
        title="Official addons"
        meta={<span className="tnum">{draft.addons.length} selected</span>}
      >
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {OFFICIAL_ADDONS.map((item) => {
            const selected = draft.addons.includes(item.id);
            return (
              <OptionTile
                key={item.id}
                id={`comfig-addon-input-${item.id}`}
                type="checkbox"
                testId={`comfig-addon-${item.id}`}
                title={item.label}
                description={OFFICIAL_ADDON_DETAILS[item.id]}
                selected={selected}
                disabled={locked}
                onSelect={() => {
                  const addons = selected
                    ? draft.addons.filter((addon) => addon !== item.id)
                    : [...draft.addons, item.id];
                  setDraft({ ...draft, addons });
                  onToggleAddon(item.id);
                }}
              />
            );
          })}
        </div>
      </PaneSection>

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

          <div className="flex flex-wrap items-center gap-2">
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

      <p className="t-meta mt-12 text-ink-faint">
        Uses official mastercomfig packages; preset screenshots from mastercomfig (MIT). execs is
        not affiliated with mastercomfig or{" "}
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
