import { ArrowSquareOut, MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { PresetSummary } from "./components/PresetSummary";
import { ChoiceChips } from "./components/ui/ChoiceChips";
import { ClassTabs } from "./components/ui/ClassTabs";
import { OptionTile } from "./components/ui/OptionTile";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { Segmented } from "./components/ui/Segmented";
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
  comfigUpdateAvailable,
  hasBaseVpk,
  hasComfigCustom,
  OFFICIAL_ADDON_DETAILS,
  setModuleLevel,
} from "./lib/comfig-ui";
import { OFFICIAL_ADDONS } from "./lib/first-run-ui";
import { canWriteSettings } from "./lib/settings-ui";

type ComfigView = "preset" | "modules";
type ModuleFilter = "all" | "changed" | ComfigModuleGroupId;

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
  return (
    <div className="comfig-module">
      <p className="t-row">{module.label}</p>
      {/* Only real overrides carry the accent ring, so a list of preset values stays calm. */}
      <ChoiceChips
        label={`${module.label} options`}
        testId={`comfig-module-${module.id}`}
        neutralValue=""
        value={value}
        disabled={locked}
        options={["", ...module.levels].map((option) => ({
          id: option,
          label:
            option === ""
              ? "Use preset"
              : option === "default"
                ? "Module default"
                : readableLevel(option),
        }))}
        onChange={onChange}
      />
    </div>
  );
}

function moduleMatches(module: ComfigModule, search: string): boolean {
  return (
    !search ||
    module.label.toLowerCase().includes(search) ||
    module.id.toLowerCase().includes(search) ||
    module.levels.some((level) => level.toLowerCase().includes(search))
  );
}

/**
 * The Modules view's one-line summary. Custom has no preset values to differ
 * from, so its modules are simply the ones set.
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
  onCheckRelease,
  onTryComfig,
}: {
  detail: ProfileDetail | null;
  state: ComfigUiState;
  onApplyPreset: (preset: ComfigPreset) => Promise<boolean>;
  onApplyModules: (modules: Record<string, string>) => Promise<boolean>;
  onToggleAddon: (id: OfficialAddon) => Promise<boolean>;
  onUpdatePackages: () => void;
  onImportCustom: () => void;
  onCheckRelease?: (profileId: string) => Promise<string>;
  /** Opens New profile, starting from the current setup, to try mastercomfig. */
  onTryComfig?: () => void;
}) {
  const { running, busy } = useAppStatus();
  // These are explicit writes. Keep the selected controls and preview on the
  // persisted snapshot until the host confirms it with a complete reload.
  // A failed choice remains available to select again, including after a
  // hidden-pane visit; it cannot leak into a later module/addon payload.
  const [view, setView] = useState<ComfigView>("preset");
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>("all");
  const [moduleSearch, setModuleSearch] = useState("");

  const supported = detail?.layer === "comfig" && state.supportedLoader !== false;
  const locked = !supported || !canWriteSettings(running, busy);
  const [releaseCheck, setReleaseCheck] = useState<{
    key: string;
    latest?: string;
    error?: string;
  } | null>(null);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const checkRelease = useRef(onCheckRelease);
  checkRelease.current = onCheckRelease;
  const releaseKey = JSON.stringify([
    detail?.id,
    state.release,
    detail?.files.filter((file) => /^tf\/custom\/mastercomfig-[^/]+\.vpk$/i.test(file.path)),
    checkAttempt,
  ]);
  useEffect(() => {
    if (!supported || !detail?.id || !checkRelease.current) return;
    let cancelled = false;
    const key = releaseKey;
    setReleaseCheck({ key });
    void checkRelease.current(detail.id).then(
      (latest) => {
        if (!cancelled) setReleaseCheck({ key, latest });
      },
      (error: unknown) => {
        if (!cancelled)
          setReleaseCheck({
            key,
            error: error instanceof Error ? error.message : "Could not check mastercomfig updates.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [supported, detail?.id, releaseKey]);
  const checkedRelease = releaseCheck?.key === releaseKey ? releaseCheck : null;
  const installedVersion = state.release?.version;
  const paths = detail?.files.map((file) => file.path) ?? [];
  const packagesInstalled = hasBaseVpk(paths);
  const customImported = hasComfigCustom(paths);
  const selectedPresetLabel = comfigPresetLabel(state.preset);
  const oldPresetMessage = oldComfigPresetMessage(state.preset);
  const moduleOverrideCount = Object.values(state.modules).filter(Boolean).length;
  const normalizedSearch = moduleSearch.trim().toLowerCase();
  const shownGroups = COMFIG_MODULE_GROUPS.filter(
    (group) => moduleFilter === "all" || moduleFilter === "changed" || group.id === moduleFilter,
  )
    .map((group) => ({
      ...group,
      modules: group.modules.filter(
        (module) =>
          moduleMatches(module, normalizedSearch) &&
          (moduleFilter !== "changed" || Boolean(state.modules[module.id])),
      ),
    }))
    .filter((group) => group.modules.length > 0);

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

  // A profile without mastercomfig keeps its own configs. Offer a safe way to
  // try it instead of a page of controls that cannot be used.
  if (detail && detail.layer !== "comfig") {
    return (
      <section data-testid="settings-comfig" className="min-w-0 text-left">
        <PaneHeader title="Comfig" />
        <div data-testid="comfig-vanilla-gate" className="comfig-empty">
          <h2 className="t-section">This profile doesn't use mastercomfig</h2>
          {onTryComfig ? (
            <button
              type="button"
              data-testid="comfig-try-new-profile"
              className="btn btn-primary mt-4"
              onClick={onTryComfig}
            >
              Try mastercomfig in a new profile
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  const modulesSummary = supported
    ? comfigModulesSummary(state.preset, selectedPresetLabel, moduleOverrideCount)
    : "Requires mastercomfig";

  return (
    <section data-testid="settings-comfig" className="min-w-0 text-left">
      <PaneHeader
        compact
        title="Comfig"
        actions={
          statusProblem ? (
            <p aria-live="polite" className="badge">
              {statusProblem}
            </p>
          ) : null
        }
      />

      {detail && !supported ? (
        <p data-testid="comfig-vanilla-gate" className="pane-note mb-5">
          This profile's mastercomfig files were changed outside execs, so execs leaves them as they
          are.
        </p>
      ) : null}

      <div className="pane-views">
        <ClassTabs
          tabs={[
            { id: "preset", label: "Preset and addons" },
            {
              id: "modules",
              label: "Modules",
              meta: supported && moduleOverrideCount > 0 ? moduleOverrideCount : undefined,
            },
          ]}
          selected={view}
          label="Comfig"
          idPrefix="comfig-view"
          panelId="comfig-view-panel"
          onSelect={setView}
        />
        <div className="pane-views-aside">
          <button
            type="button"
            data-testid="comfig-preset-guide"
            onClick={() => void openEmbeddedPage("comfig-docs")}
            className="btn btn-quiet"
          >
            mastercomfig guide
            <ArrowSquareOut size={13} />
          </button>
        </div>
      </div>

      <div id="comfig-view-panel" role="tabpanel" aria-labelledby={`comfig-view-${view}`}>
        <div hidden={view !== "preset"} className="pt-5">
          <section aria-labelledby="comfig-preset-heading">
            <h2 id="comfig-preset-heading" className="t-section">
              Preset
            </h2>

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
                  selected={supported && state.preset === item.id}
                  disabled={locked}
                  onSelect={() => {
                    void onApplyPreset(item.id);
                  }}
                />
              ))}
            </div>
            {supported ? <PresetSummary preset={state.preset} /> : null}
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

          <section className="section" aria-label="Comfig packages">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h2 className="t-section">Packages and extras</h2>
                <p className="t-meta mt-1">
                  {installedVersion
                    ? `mastercomfig ${installedVersion}`
                    : packagesInstalled
                      ? "mastercomfig version unknown"
                      : "No mastercomfig packages installed."}
                </p>
                {supported ? (
                  <p data-testid="comfig-release-status" className="t-meta mt-1" aria-live="polite">
                    {checkedRelease?.error
                      ? checkedRelease.error
                      : checkedRelease?.latest
                        ? installedVersion === checkedRelease.latest
                          ? "Packages are up to date."
                          : installedVersion
                            ? comfigUpdateAvailable(installedVersion, checkedRelease.latest)
                              ? `Update available: ${checkedRelease.latest}.`
                              : `Latest release: ${checkedRelease.latest}.`
                            : `Latest release: ${checkedRelease.latest}. Update packages before adding addons.`
                        : onCheckRelease
                          ? "Checking for updates…"
                          : "Updates have not been checked."}
                  </p>
                ) : null}
              </div>

              <div className="pane-actions">
                <button
                  type="button"
                  data-testid="comfig-update"
                  disabled={locked}
                  onClick={onUpdatePackages}
                  className="btn btn-primary"
                >
                  {busy ? "Working…" : "Update packages"}
                </button>
                {supported && onCheckRelease ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={
                      checkedRelease !== null && !checkedRelease.latest && !checkedRelease.error
                    }
                    onClick={() => setCheckAttempt((value) => value + 1)}
                  >
                    Check for updates
                  </button>
                ) : null}
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
            Packages by{" "}
            <button
              type="button"
              onClick={() => void openExternal("https://comfig.app")}
              className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
            >
              mastercomfig
            </button>
            , not affiliated with execs ·{" "}
            <button
              type="button"
              onClick={() => void openExternal("https://docs.comfig.app/latest/support_me/")}
              className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
            >
              Donate
            </button>
          </p>
        </div>

        <div hidden={view !== "modules"} data-testid="comfig-modules" className="pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-48 max-w-sm flex-1">
              <span className="sr-only">Search modules</span>
              <MagnifyingGlass
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted"
              />
              <input
                type="search"
                value={moduleSearch}
                onChange={(event) => setModuleSearch(event.target.value)}
                placeholder="Search modules…"
                className="field w-full py-2 pr-3 pl-9 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
              />
            </label>
            <Segmented<ModuleFilter>
              label="Show modules"
              size="sm"
              testIdPrefix="comfig-modules-filter"
              value={moduleFilter}
              options={[
                { id: "all", label: "All" },
                {
                  id: "changed",
                  label: (
                    <>
                      Changed
                      {supported && moduleOverrideCount > 0 ? (
                        <span className="tnum text-ink-faint">{moduleOverrideCount}</span>
                      ) : null}
                    </>
                  ),
                },
                ...COMFIG_MODULE_GROUPS.map((group) => ({ id: group.id, label: group.label })),
              ]}
              onChange={setModuleFilter}
            />
          </div>
          <p data-testid="comfig-modules-summary" className="t-meta tnum mt-3">
            {modulesSummary}
          </p>

          <div id="comfig-module-panel" className="mt-2">
            {shownGroups.map((group) => (
              <section
                key={group.id}
                aria-labelledby={`comfig-module-group-${group.id}`}
                className="comfig-module-group"
              >
                <h3 id={`comfig-module-group-${group.id}`} className="eyebrow">
                  {group.label}
                </h3>
                {group.modules.map((module) => (
                  <ModuleControl
                    key={module.id}
                    module={module}
                    value={state.modules[module.id] ?? ""}
                    locked={locked}
                    onChange={(value) => updateModule(module.id, value)}
                  />
                ))}
              </section>
            ))}
            {shownGroups.length === 0 ? (
              <div className="py-10 text-center">
                <p className="t-body text-ink">
                  {moduleFilter === "changed" && !normalizedSearch
                    ? "Every module follows the preset."
                    : "No matching modules."}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setModuleSearch("");
                    setModuleFilter("all");
                  }}
                  className="btn btn-ghost mt-3"
                >
                  Show all modules
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
