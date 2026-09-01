import { ArrowSquareOut } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import presetHigh from "./assets/presets/high.webp";
import presetLow from "./assets/presets/low.webp";
import presetMedium from "./assets/presets/medium.webp";
import presetMediumHigh from "./assets/presets/medium_high.webp";
import presetMediumLow from "./assets/presets/medium_low.webp";
import presetUltra from "./assets/presets/ultra.webp";
import presetVeryLow from "./assets/presets/very_low.webp";
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
} from "./lib/comfig-catalog";
import {
  hasBaseVpk,
  hasComfigCustom,
  type PreviewComfigState,
  resolveComfigState,
  setModuleLevel,
} from "./lib/comfig-ui";
import { shouldReseedDraft } from "./lib/files-ui";
import { COMFIG_PRESETS, OFFICIAL_ADDONS } from "./lib/first-run-ui";
import { canWriteSettings } from "./lib/settings-ui";

const PRESET_DETAILS: Record<ComfigPreset, { description: string; balance: string }> = {
  ultra: {
    description: "Maximum fidelity with the highest system requirements.",
    balance: "Fidelity",
  },
  high: {
    description: "High visual quality for modern systems.",
    balance: "Quality",
  },
  medium_high: {
    description: "Sharper visuals without the full performance cost.",
    balance: "Balanced +",
  },
  medium: {
    description: "A balanced mix of visual quality and performance.",
    balance: "Balanced",
  },
  medium_low: {
    description: "Performance-first settings with readable detail.",
    balance: "Performance +",
  },
  low: {
    description: "Maximum performance with reduced visual effects.",
    balance: "Performance",
  },
  very_low: {
    description: "Minimum visual cost for the highest frame rate.",
    balance: "Maximum FPS",
  },
  none: {
    description: "Skip preset tuning and configure modules yourself.",
    balance: "Manual",
  },
};

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

const ADDON_DETAILS: Record<OfficialAddon, string> = {
  "no-footsteps": "Remove player footstep sounds.",
  "no-pyroland": "Disable Pyroland visual effects.",
  "no-soundscapes": "Remove ambient map soundscapes.",
  "no-tutorial": "Skip tutorial hints and prompts.",
  lowmem: "Reduce memory use on limited systems.",
  "null-canceling-movement": "Keep opposite movement keys responsive.",
  "flat-mouse": "Use direct, unaccelerated mouse input.",
  "transparent-viewmodels": "Make weapon viewmodels transparent.",
};

const DEFAULT_VISIBLE_MODULES = 12;
const FEATURED_PRESETS = new Set<ComfigPreset>(["ultra", "high", "medium", "low"]);

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
    <article className="min-w-0 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <p id={labelId} className="text-[13px] font-medium text-ink">
          {module.label}
        </p>
        <p className="shrink-0 text-[11px] text-ink-faint">
          {value ? readableLevel(value) : "Preset default"}
        </p>
      </div>

      {/* Compatibility control for tests and automation. The visible segmented
          buttons below are the primary accessible interaction. */}
      <select
        data-testid={`comfig-module-${module.id}`}
        value={value}
        disabled={locked}
        onChange={(event) => onChange(event.target.value)}
        aria-hidden="true"
        tabIndex={-1}
        className="sr-only"
      >
        <option value="">Preset default</option>
        {module.levels.map((level) => (
          <option key={level} value={level}>
            {level}
          </option>
        ))}
      </select>

      <fieldset className="mt-2 flex min-w-0 flex-wrap gap-0.5 rounded-lg bg-bg p-0.5">
        <legend className="sr-only">{module.label} options</legend>
        {options.map((option) => {
          const selected = option === value;
          // Only real overrides glow — a page of preset defaults stays calm.
          const selectedClass =
            option === ""
              ? "bg-panel-raised font-medium text-ink"
              : "bg-brand font-medium text-on-brand";
          return (
            <button
              key={option || "preset-default"}
              type="button"
              aria-pressed={selected}
              disabled={locked}
              onClick={() => onChange(option)}
              className={`min-w-fit flex-1 rounded-md px-2 py-1.5 text-[11px] leading-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-40 ${
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
  running,
  busy,
  detail,
  preview = false,
  previewState,
  onApplyPreset,
  onApplyModules,
  onToggleAddon,
  onUpdatePackages,
  onImportCustom,
}: {
  running: boolean;
  busy: boolean;
  detail: ProfileDetail | null;
  preview?: boolean;
  previewState?: PreviewComfigState;
  onApplyPreset: (preset: ComfigPreset) => void;
  onApplyModules: (modules: Record<string, string>) => void;
  onToggleAddon: (id: OfficialAddon) => void;
  onUpdatePackages: () => void;
  onImportCustom: () => void;
}) {
  const incoming = useMemo(
    () => resolveComfigState(preview, previewState, detail),
    [preview, previewState, detail],
  );
  const [draft, setDraft] = useState<PreviewComfigState>(incoming);
  const [activeGroupId, setActiveGroupId] = useState<ComfigModuleGroupId>("graphics");
  const [moduleSearch, setModuleSearch] = useState("");
  const [showAllModules, setShowAllModules] = useState(false);
  const [showAllPresets, setShowAllPresets] = useState(false);

  const lastSeededRef = useRef<string | null>(null);

  // `incoming` is a fresh object on every reload, so reseeding on identity
  // discards the control the user just clicked. This pane is instant-apply and
  // holds no user-typed draft, so the guard is purely "did the bytes change".
  useEffect(() => {
    const next = JSON.stringify(incoming);
    if (!shouldReseedDraft(lastSeededRef.current, next, false)) {
      return;
    }
    lastSeededRef.current = next;
    setDraft(incoming);
  }, [incoming]);

  const locked = !canWriteSettings(running, busy);
  const paths = detail?.files.map((file) => file.path) ?? [];
  const packagesInstalled = preview ? true : hasBaseVpk(paths);
  const customImported = preview ? false : hasComfigCustom(paths);
  const presetListExpanded = showAllPresets || !FEATURED_PRESETS.has(draft.preset);
  const visiblePresets = presetListExpanded
    ? COMFIG_PRESETS
    : COMFIG_PRESETS.filter((item) => FEATURED_PRESETS.has(item.id));
  const selectedPresetLabel =
    COMFIG_PRESETS.find((item) => item.id === draft.preset)?.label ?? draft.preset;
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

  const statusLabel = running
    ? "Read-only while TF2 is running"
    : busy
      ? "Saving changes…"
      : !preview && detail === null
        ? "Loading active profile…"
        : !packagesInstalled
          ? "Packages not installed"
          : null;

  return (
    <section data-testid="settings-comfig" className="min-w-0 text-left">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Comfig</h1>
          <p className="text-xs text-ink-muted">
            Powered by{" "}
            <button
              type="button"
              onClick={() => void openExternal("https://comfig.app")}
              className="font-medium text-brand underline decoration-brand/40 underline-offset-4 hover:text-brand-hover"
            >
              mastercomfig
            </button>
          </p>
        </div>

        {statusLabel ? (
          <div
            aria-live="polite"
            className={`w-fit rounded-pill border px-3 py-1 text-xs ${
              running
                ? "border-q-strange/50 text-q-strange"
                : busy
                  ? "border-brand/50 text-brand"
                  : "border-edge-strong text-ink-muted"
            }`}
          >
            {statusLabel}
          </div>
        ) : null}
      </header>

      <div className="mt-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Choose a preset</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Your preset supplies the default for every module.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {FEATURED_PRESETS.has(draft.preset) ? (
              <button
                type="button"
                onClick={() => setShowAllPresets((current) => !current)}
                className="rounded-lg border border-edge-strong px-3 py-1.5 text-xs text-ink-muted hover:bg-panel-raised hover:text-ink"
              >
                {showAllPresets ? "Show core presets" : "Show all presets"}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="comfig-preset-guide"
              onClick={() => void openEmbeddedPage("comfig-docs")}
              className="flex items-center gap-1.5 rounded-lg border border-edge-strong px-3 py-1.5 text-xs text-ink-muted hover:bg-panel-raised hover:text-ink"
            >
              Preset guide
              <ArrowSquareOut size={12} />
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          <div
            data-testid="comfig-preset"
            className={`grid content-start gap-2 sm:grid-cols-2 ${presetListExpanded ? "" : ""}`}
          >
            {visiblePresets.map((item) => {
              const selected = draft.preset === item.id;
              const details = PRESET_DETAILS[item.id];
              return (
                <label key={item.id} className="group relative min-w-0 cursor-pointer">
                  <input
                    type="radio"
                    name="comfig-preset"
                    value={item.id}
                    checked={selected}
                    disabled={locked}
                    onChange={() => {
                      setDraft({ ...draft, preset: item.id });
                      onApplyPreset(item.id);
                    }}
                    className="peer sr-only"
                  />
                  <span className="flex h-full min-h-[5.5rem] flex-col rounded-xl border border-edge bg-panel/60 p-3.5 transition-colors hover:border-edge-strong peer-checked:border-brand/70 peer-checked:bg-brand/5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-disabled:cursor-not-allowed peer-disabled:opacity-40">
                    <span className="flex items-start justify-between gap-3">
                      <span
                        className={`text-sm font-semibold leading-none ${selected ? "text-brand" : "text-ink"}`}
                      >
                        {item.label}
                      </span>
                      <span
                        className={`badge ${
                          selected
                            ? "bg-brand text-on-brand"
                            : "border border-edge-strong text-ink-faint"
                        }`}
                      >
                        {selected ? "Selected" : details.balance}
                      </span>
                    </span>
                    <span className="mt-2 text-xs leading-5 text-ink-muted">
                      {details.description}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>

          {presetImage ? (
            <figure className="surface relative self-start">
              <img
                src={presetImage}
                alt={`Actual in-game screenshot of the ${selectedPresetLabel} preset on koth_sawmill`}
                className="aspect-video w-full object-cover"
              />
              <figcaption className="absolute right-2.5 bottom-2.5 rounded-md bg-bg/85 px-2.5 py-1 text-[11px] text-ink backdrop-blur-sm">
                {selectedPresetLabel} · in-game screenshot
              </figcaption>
            </figure>
          ) : (
            <div className="surface grid min-h-40 place-items-center self-start p-6 text-center text-xs text-ink-muted">
              Custom preset — modules below decide every setting.
            </div>
          )}
        </div>
      </div>

      <section className="section" aria-labelledby="comfig-modules-heading">
        <div className="flex flex-col gap-3 border-b border-edge sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="comfig-modules-heading" className="text-sm font-semibold text-ink">
              Fine-tune modules
            </h2>
            <div className="mt-2 flex flex-wrap" role="tablist" aria-label="Module categories">
              {COMFIG_MODULE_GROUPS.map((group, groupIndex) => {
                const active = group.id === activeGroupId;
                return (
                  <button
                    key={group.id}
                    id={`comfig-module-tab-${group.id}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls="comfig-module-panel"
                    tabIndex={active ? 0 : -1}
                    onClick={() => {
                      setActiveGroupId(group.id);
                      setModuleSearch("");
                      setShowAllModules(false);
                    }}
                    onKeyDown={(event) => {
                      let nextIndex: number | null = null;
                      if (event.key === "ArrowRight") {
                        nextIndex = (groupIndex + 1) % COMFIG_MODULE_GROUPS.length;
                      } else if (event.key === "ArrowLeft") {
                        nextIndex =
                          (groupIndex - 1 + COMFIG_MODULE_GROUPS.length) %
                          COMFIG_MODULE_GROUPS.length;
                      } else if (event.key === "Home") {
                        nextIndex = 0;
                      } else if (event.key === "End") {
                        nextIndex = COMFIG_MODULE_GROUPS.length - 1;
                      }
                      if (nextIndex === null) {
                        return;
                      }
                      event.preventDefault();
                      const nextGroup = COMFIG_MODULE_GROUPS[nextIndex];
                      setActiveGroupId(nextGroup.id);
                      setModuleSearch("");
                      setShowAllModules(false);
                      requestAnimationFrame(() => {
                        document.getElementById(`comfig-module-tab-${nextGroup.id}`)?.focus();
                      });
                    }}
                    className={`border-b-2 px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                      active
                        ? "border-brand text-brand"
                        : "border-transparent text-ink-muted hover:text-ink"
                    }`}
                  >
                    {group.label}
                    <span className="ml-1.5 text-[10px] text-ink-faint">
                      {group.modules.length}
                    </span>
                  </button>
                );
              })}
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
              className="field w-full px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
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
                <div key={module.id} className="border-b border-edge/60">
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
              <p className="text-sm text-ink">
                No matching {activeGroup.label.toLowerCase()} modules.
              </p>
              <button
                type="button"
                onClick={() => setModuleSearch("")}
                className="mt-2 text-xs text-brand hover:text-brand-hover"
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
            className="mt-3 w-full rounded-lg py-2.5 text-xs text-ink-muted hover:bg-panel hover:text-ink"
          >
            Show {hiddenModuleCount} more {activeGroup.label.toLowerCase()} modules
          </button>
        ) : showAllModules &&
          !normalizedSearch &&
          matchingModules.length > DEFAULT_VISIBLE_MODULES ? (
          <button
            type="button"
            onClick={() => setShowAllModules(false)}
            className="mt-3 w-full rounded-lg py-2.5 text-xs text-ink-muted hover:bg-panel hover:text-ink"
          >
            Show fewer modules
          </button>
        ) : null}
      </section>

      <section className="section" aria-labelledby="comfig-addons-heading">
        <div>
          <h2 id="comfig-addons-heading" className="text-sm font-semibold text-ink">
            Official addons
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Optional mastercomfig packages. Each addon can be removed again at any time.
          </p>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {OFFICIAL_ADDONS.map((item) => {
            const selected = draft.addons.includes(item.id);
            return (
              <label key={item.id} className="group relative cursor-pointer">
                <input
                  type="checkbox"
                  data-testid={`comfig-addon-${item.id}`}
                  checked={selected}
                  disabled={locked}
                  onChange={() => {
                    const addons = selected
                      ? draft.addons.filter((addon) => addon !== item.id)
                      : [...draft.addons, item.id];
                    setDraft({ ...draft, addons });
                    onToggleAddon(item.id);
                  }}
                  className="peer sr-only"
                />
                <span className="flex min-h-[5.25rem] flex-col rounded-xl border border-edge bg-panel/60 p-3 transition-colors hover:border-edge-strong peer-checked:border-brand/70 peer-checked:bg-brand/5 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-disabled:cursor-not-allowed peer-disabled:opacity-40">
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">{item.label}</span>
                    <span
                      className={`badge shrink-0 ${
                        selected ? "bg-brand text-on-brand" : "border border-edge text-ink-faint"
                      }`}
                    >
                      {selected ? "On" : "Off"}
                    </span>
                  </span>
                  <span className="mt-1.5 text-[11px] leading-4 text-ink-muted">
                    {ADDON_DETAILS[item.id]}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="section" aria-label="Comfig packages">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Packages and extras</h2>
            <p className="mt-0.5 text-xs leading-5 text-ink-muted">
              {busy
                ? "Saving your latest comfig change."
                : !packagesInstalled
                  ? "No official packages are installed yet. Fetch the latest release from GitHub."
                  : "Changes save as you make them. Extras opens the full mastercomfig customizer in-app."}
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

      <p className="mt-6 text-xs leading-5 text-ink-faint">
        Uses official mastercomfig packages; preset screenshots from mastercomfig (MIT). execs is
        not affiliated with mastercomfig or{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://comfig.app")}
          className="text-brand underline decoration-brand/40 underline-offset-2"
        >
          comfig.app
        </button>
        . Support the project through its{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://docs.comfig.app/latest/support_me/")}
          className="text-brand underline decoration-brand/40 underline-offset-2"
        >
          donate page
        </button>
        .
      </p>
    </section>
  );
}
