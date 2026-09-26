import { ArrowClockwise, MagnifyingGlass } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClassTabs } from "./components/ui/ClassTabs";
import { Modal } from "./components/ui/Modal";
import { Segmented } from "./components/ui/Segmented";
import { Loading, Spinner } from "./components/ui/Spinner";
import type {
  ViewmodelBuildRecipe,
  ViewmodelBuildRequest,
  ViewmodelSourceCatalog,
} from "./lib/bridge";
import {
  cachedViewmodelCatalog,
  loadViewmodelCatalog,
  subscribeViewmodelCatalog,
  viewmodelCatalogIsFresh,
} from "./lib/viewmodel-catalog-cache";
import {
  conflictingViewmodelGroupIds,
  selectedViewmodelChoices,
  VIEWMODEL_PRESET_LABELS,
  type ViewmodelDraftChoices,
  type ViewmodelHideMode,
  type ViewmodelPreset,
  type ViewmodelRow,
  viewmodelCatalogRevision,
  viewmodelChoiceChanges,
  viewmodelClasses,
  viewmodelClassLabel,
  viewmodelDraftBuildRequest,
  viewmodelPresetChoices,
  viewmodelRowItemNames,
  viewmodelRowLabel,
  viewmodelRowsForClass,
  viewmodelSectionsForClass,
} from "./lib/viewmodel-ui";

type CatalogState = {
  catalog: ViewmodelSourceCatalog | null;
  phase: "idle" | "loading" | "checking" | "ready" | "stale";
  error: string | null;
  changed: boolean;
};

const INITIAL_CATALOG: CatalogState = {
  catalog: null,
  phase: "idle",
  error: null,
  changed: false,
};

const MODE_OPTIONS: { id: "shown" | ViewmodelHideMode; label: string; title: string }[] = [
  { id: "shown", label: "Shown", title: "Keep the normal viewmodel" },
  { id: "full", label: "Hidden", title: "Hide the hands and weapon" },
  { id: "weapon", label: "Hands only", title: "Hide the weapon and keep the hands" },
];

const PRESET_OPTIONS: { id: ViewmodelPreset; label: string }[] = (
  ["show-all", "hide-all", "keep-melee"] as const
).map((id) => ({ id, label: VIEWMODEL_PRESET_LABELS[id] }));

const HIDE_OPTIONS = MODE_OPTIONS.filter(
  (option): option is { id: ViewmodelHideMode; label: string; title: string } =>
    option.id !== "shown",
);

function choiceLabel(mode: ViewmodelHideMode | "shown"): string {
  return MODE_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

/** Per-class viewmodel choices built from the player's installed TF2 files. */
export function ViewmodelBuilder({
  active,
  profilePreload,
  savedRecipe,
  locked = false,
  loadCatalog,
  onBuild,
}: {
  active: boolean;
  loadCatalog: () => Promise<ViewmodelSourceCatalog>;
  profilePreload: boolean | null;
  /** The saved locally built recipe, used to show its choices when the sources still match. */
  savedRecipe?: ViewmodelBuildRecipe;
  locked?: boolean;
  onBuild: (request: ViewmodelBuildRequest) => Promise<boolean>;
}) {
  // The app reads the catalog in the background at startup, so the pane can open ready.
  const [state, setState] = useState<CatalogState>(() => {
    const catalog = cachedViewmodelCatalog();
    return catalog ? { ...INITIAL_CATALOG, catalog, phase: "ready" } : INITIAL_CATALOG;
  });
  const mounted = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const inFlight = useRef(false);
  const refreshQueued = useRef(false);
  const attempted = useRef(false);
  const wasPresent = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const loadRef = useRef(loadCatalog);
  loadRef.current = loadCatalog;

  useEffect(() => {
    mounted.current = true;
    // The startup read can finish after this pane mounts; show it without another read.
    const stop = subscribeViewmodelCatalog((catalog) =>
      setState((current) =>
        current.catalog ? current : { catalog, phase: "ready", error: null, changed: false },
      ),
    );
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);

  const refreshCatalog = useCallback((options?: { ifStale?: boolean }) => {
    if (
      !mounted.current ||
      !activeRef.current ||
      document.visibilityState === "hidden" ||
      !document.hasFocus()
    )
      return;
    if (inFlight.current) {
      refreshQueued.current = true;
      return;
    }
    attempted.current = true;
    // Opening the pane trusts a recent read; the refresh button always rereads.
    if (options?.ifStale && viewmodelCatalogIsFresh()) {
      const catalog = cachedViewmodelCatalog();
      if (catalog) {
        setState((current) =>
          current.catalog === catalog && current.phase === "ready"
            ? current
            : {
                catalog,
                phase: "ready",
                error: null,
                changed:
                  current.changed ||
                  (current.catalog !== null &&
                    viewmodelCatalogRevision(current.catalog) !==
                      viewmodelCatalogRevision(catalog)),
              },
        );
        return;
      }
    }
    inFlight.current = true;
    setState((current) => ({
      ...current,
      phase: current.catalog ? "checking" : "loading",
      error: null,
    }));
    void loadViewmodelCatalog(loadRef.current)
      .then((catalog) => {
        if (!mounted.current) return;
        setState((current) => ({
          catalog,
          phase: "ready",
          error: null,
          changed:
            current.changed ||
            (current.catalog !== null &&
              viewmodelCatalogRevision(current.catalog) !== viewmodelCatalogRevision(catalog)),
        }));
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        setState((current) => ({
          ...current,
          phase: "stale",
          error: error instanceof Error ? error.message : "Could not read your TF2 files.",
        }));
      })
      .finally(() => {
        inFlight.current = false;
        if (refreshQueued.current) {
          refreshQueued.current = false;
          refreshRef.current();
        }
      });
  }, []);
  refreshRef.current = () => refreshCatalog();

  useEffect(() => {
    if (!active) {
      // A mounted but hidden pane must recheck its catalog when opened again.
      wasPresent.current = false;
      return;
    }
    const observePresence = () => {
      const present = document.visibilityState !== "hidden" && document.hasFocus();
      if (present && (!attempted.current || !wasPresent.current)) {
        refreshCatalog({ ifStale: true });
      }
      wasPresent.current = present;
    };
    observePresence();
    window.addEventListener("focus", observePresence);
    window.addEventListener("blur", observePresence);
    document.addEventListener("visibilitychange", observePresence);
    return () => {
      window.removeEventListener("focus", observePresence);
      window.removeEventListener("blur", observePresence);
      document.removeEventListener("visibilitychange", observePresence);
    };
  }, [active, refreshCatalog]);

  const catalog = state.catalog;
  // A background recheck keeps the current choices usable until it finishes.
  const editable =
    active && catalog !== null && (state.phase === "ready" || state.phase === "checking");
  const busy = state.phase === "loading" || state.phase === "checking";
  return (
    <section data-testid="viewmodel-builder" className="mb-8">
      {state.phase === "idle" || state.phase === "loading" ? (
        <p role="status" data-testid="viewmodel-catalog-status" className="t-meta">
          <Loading>Reading your TF2 files…</Loading>
        </p>
      ) : null}
      {state.error ? (
        <div
          role="alert"
          data-testid="viewmodel-catalog-error"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 text-warn"
        >
          <p className="t-meta text-warn">{state.error}</p>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => refreshCatalog()}
          >
            Try again
          </button>
        </div>
      ) : null}
      {state.changed ? (
        <p role="note" data-testid="viewmodel-catalog-changed" className="t-meta mb-4 text-warn">
          TF2 was updated, so your unsaved choices were cleared.
        </p>
      ) : null}

      {catalog ? (
        <ViewmodelCatalogChoices
          key={viewmodelCatalogRevision(catalog)}
          catalog={catalog}
          editable={editable}
          active={active}
          busy={busy}
          profilePreload={profilePreload}
          savedRecipe={savedRecipe}
          locked={locked}
          onBuild={onBuild}
          onRefresh={() => refreshCatalog()}
        />
      ) : null}
    </section>
  );
}

function savedChoices(
  catalog: ViewmodelSourceCatalog,
  recipe: ViewmodelBuildRecipe | undefined,
): ViewmodelDraftChoices {
  if (!recipe || recipe.catalog.catalogSha256 !== catalog.catalog.catalogSha256) return {};
  const known = new Set(catalog.groups.map((group) => group.id));
  return Object.fromEntries(
    recipe.choices
      .filter((choice) => known.has(choice.groupId))
      .map((choice) => [choice.groupId, choice.mode]),
  );
}

function sameChoices(left: ViewmodelDraftChoices, right: ViewmodelDraftChoices): boolean {
  const leftKeys = Object.keys(left);
  return (
    leftKeys.length === Object.keys(right).length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

function ViewmodelCatalogChoices({
  catalog,
  editable,
  active,
  busy,
  profilePreload,
  savedRecipe,
  locked,
  onBuild,
  onRefresh,
}: {
  catalog: ViewmodelSourceCatalog;
  editable: boolean;
  active: boolean;
  busy: boolean;
  profilePreload: boolean | null;
  savedRecipe?: ViewmodelBuildRecipe;
  locked: boolean;
  onBuild: (request: ViewmodelBuildRequest) => Promise<boolean>;
  onRefresh: () => void;
}) {
  const classes = viewmodelClasses(catalog);
  const [selectedClass, setSelectedClass] = useState(classes[0] ?? "");
  const [query, setQuery] = useState("");
  const [saved] = useState(() => savedChoices(catalog, savedRecipe));
  const [choices, setChoices] = useState<ViewmodelDraftChoices>(saved);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [preset, setPreset] = useState<ViewmodelPreset>("keep-melee");
  const [presetMode, setPresetMode] = useState<ViewmodelHideMode>("full");
  // The draft before the last whole-profile change, until another edit.
  const [undo, setUndo] = useState<ViewmodelDraftChoices | null>(null);
  const [building, setBuilding] = useState(false);
  const sections = viewmodelSectionsForClass(catalog, selectedClass, query);
  const reviewRequest =
    profilePreload === null ? null : viewmodelDraftBuildRequest(catalog, choices, profilePreload);
  const selected = reviewRequest?.choices ?? selectedViewmodelChoices(choices);
  const conflicts = conflictingViewmodelGroupIds(catalog, choices);
  const changed = !sameChoices(choices, saved);
  const canBuild =
    editable &&
    !locked &&
    !building &&
    reviewRequest !== null &&
    selected.length > 0 &&
    conflicts.size === 0;

  useEffect(() => {
    if (!active || !editable) {
      setReviewOpen(false);
      setPresetOpen(false);
    }
  }, [active, editable]);

  const proposed = presetOpen ? viewmodelPresetChoices(catalog, preset, presetMode) : null;
  const proposedChanges = proposed ? viewmodelChoiceChanges(catalog, choices, proposed) : [];
  const proposedConflicts = proposed ? conflictingViewmodelGroupIds(catalog, proposed).size : 0;

  function applyPreset() {
    if (!proposed || proposedChanges.length === 0) return;
    setUndo(choices);
    setChoices(proposed);
    setPresetOpen(false);
  }

  // One row can cover a weapon and its reskins; every group in it follows the choice.
  function choose(row: ViewmodelRow, mode: ViewmodelHideMode | "shown") {
    setUndo(null);
    setChoices((current) => {
      const next = { ...current };
      for (const group of row.groups) {
        if (mode === "shown") delete next[group.id];
        else next[group.id] = mode;
      }
      return next;
    });
  }

  async function build() {
    if (!reviewRequest || !canBuild) return;
    setBuilding(true);
    try {
      if (await onBuild(reviewRequest)) setReviewOpen(false);
    } finally {
      setBuilding(false);
    }
  }

  const rowChoice = (row: ViewmodelRow): ViewmodelHideMode | "shown" =>
    choices[row.groups[0].id] ?? "shown";
  const rowsByClass = new Map(classes.map((name) => [name, viewmodelRowsForClass(catalog, name)]));
  // Review in the same class and loadout order as the list.
  const reviewRows = classes.flatMap((name) =>
    (rowsByClass.get(name) ?? []).filter((row) => rowChoice(row) !== "shown"),
  );
  const hiddenIn = (className: string) =>
    (rowsByClass.get(className) ?? []).filter((row) => rowChoice(row) !== "shown").length;

  return (
    <div>
      {classes.length ? (
        <ClassTabs
          tabs={classes.map((name) => ({
            id: name,
            label: viewmodelClassLabel(name),
            meta: hiddenIn(name) || undefined,
          }))}
          selected={selectedClass}
          label="Viewmodel class"
          idPrefix="viewmodel-class"
          panelId="viewmodel-class-panel"
          onSelect={setSelectedClass}
        />
      ) : (
        <p className="t-meta">No weapons were found in this TF2 install.</p>
      )}
      {classes.length ? (
        <div
          id="viewmodel-class-panel"
          role="tabpanel"
          aria-labelledby={`viewmodel-class-${selectedClass}`}
        >
          <div className="mt-4 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <MagnifyingGlass
                size={14}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
              />
              <input
                id="viewmodel-group-search"
                data-testid="viewmodel-group-search"
                type="search"
                aria-label={`Search ${viewmodelClassLabel(selectedClass)} weapons`}
                className="input w-full pl-8"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${viewmodelClassLabel(selectedClass)} weapons`}
              />
            </div>
            <button
              type="button"
              data-testid="viewmodel-catalog-refresh"
              className="btn btn-ghost"
              title="Reread your TF2 files"
              aria-label="Reread your TF2 files"
              disabled={!active || busy}
              aria-busy={busy || undefined}
              onClick={onRefresh}
            >
              {busy ? <Spinner size={15} /> : <ArrowClockwise size={15} />}
            </button>
            <button
              type="button"
              data-testid="viewmodel-presets"
              className="btn btn-ghost whitespace-nowrap"
              disabled={!editable}
              onClick={() => setPresetOpen(true)}
            >
              Every class…
            </button>
            <p className="t-meta ml-2 whitespace-nowrap" data-testid="viewmodel-choice-summary">
              {reviewRows.length
                ? `${reviewRows.length} hidden${changed ? " · not built yet" : ""}`
                : "Everything shown"}
            </p>
            {undo ? (
              <button
                type="button"
                data-testid="viewmodel-preset-undo"
                className="btn btn-quiet whitespace-nowrap"
                disabled={!editable}
                onClick={() => {
                  setChoices(undo);
                  setUndo(null);
                }}
              >
                Undo
              </button>
            ) : null}
            <button
              type="button"
              data-testid="viewmodel-review-build"
              className="btn btn-primary whitespace-nowrap"
              disabled={!editable || reviewRequest === null || selected.length === 0}
              onClick={() => setReviewOpen(true)}
            >
              Review and build
            </button>
          </div>

          {sections.length ? (
            sections.map((section) => (
              <div
                key={section.id}
                className="mt-6"
                data-testid={`viewmodel-section-${section.id}`}
              >
                <h3 className="eyebrow mb-1">{section.label}</h3>
                {section.rows.map((row) => {
                  const others = viewmodelRowItemNames(row).slice(1);
                  const label = viewmodelRowLabel(row);
                  const group = row.groups[0];
                  return (
                    <div
                      key={row.id}
                      data-testid="viewmodel-group"
                      data-group-id={row.id}
                      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-edge py-2.5 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="t-row">{label}</p>
                        {others.length ? (
                          <p className="t-meta truncate" title={others.join(", ")}>
                            Also {others.slice(0, 3).join(", ")}
                            {others.length > 3 ? ` and ${others.length - 3} more` : ""}
                          </p>
                        ) : null}
                        {row.groups.some((member) => conflicts.has(member.id)) ? (
                          <p className="t-meta text-warn">
                            Shares animations with another choice set differently.
                          </p>
                        ) : null}
                      </div>
                      <Segmented<"shown" | ViewmodelHideMode>
                        label={`${viewmodelClassLabel(group.class)} ${label}`}
                        size="sm"
                        neutralValue="shown"
                        options={MODE_OPTIONS}
                        value={rowChoice(row)}
                        disabled={!editable}
                        testIdPrefix={`viewmodel-choice-${row.id}`}
                        onChange={(mode) => choose(row, mode)}
                      />
                    </div>
                  );
                })}
              </div>
            ))
          ) : (
            <p className="t-meta mt-6">No {viewmodelClassLabel(selectedClass)} weapons match.</p>
          )}
        </div>
      ) : null}

      <Modal
        open={presetOpen && active && editable}
        title="Change every class"
        testId="viewmodel-preset-review"
        className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
        onClose={() => setPresetOpen(false)}
      >
        <div className="mt-4 grid gap-3">
          <Segmented<ViewmodelPreset>
            label="Whole-profile choice"
            options={PRESET_OPTIONS}
            value={preset}
            testIdPrefix="viewmodel-preset"
            onChange={setPreset}
          />
          {preset === "show-all" ? null : (
            <Segmented<ViewmodelHideMode>
              label="Hide as"
              size="sm"
              options={HIDE_OPTIONS}
              value={presetMode}
              testIdPrefix="viewmodel-preset-mode"
              onChange={setPresetMode}
            />
          )}
        </div>
        <p className="t-meta mt-4" data-testid="viewmodel-preset-count">
          {proposedChanges.length === 0
            ? "Nothing changes."
            : `${proposedChanges.length} ${proposedChanges.length === 1 ? "choice changes" : "choices change"}:`}
        </p>
        {proposedChanges.length ? (
          <ul
            className="mt-2 grid max-h-64 gap-1.5 overflow-y-auto"
            data-testid="viewmodel-preset-changes"
          >
            {proposedChanges.map((change) => (
              <li key={change.row.id} className="flex justify-between gap-3 t-meta">
                <span className="text-ink">
                  {viewmodelClassLabel(change.row.groups[0].class)} ·{" "}
                  {viewmodelRowLabel(change.row)}
                </span>
                <span className="whitespace-nowrap">
                  {choiceLabel(change.from)} → {choiceLabel(change.to)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {proposedConflicts ? (
          <p role="alert" className="t-meta mt-3 text-warn">
            Some weapons share animations with a melee weapon. Make them match before building.
          </p>
        ) : null}
        <p className="t-meta mt-3">
          Only your first-person view changes. Nothing is written until you build the pack.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setPresetOpen(false)}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="viewmodel-preset-apply"
            disabled={proposedChanges.length === 0}
            className="btn btn-primary"
            onClick={applyPreset}
          >
            Apply to draft
          </button>
        </div>
      </Modal>

      <Modal
        open={reviewOpen && active && editable}
        title="Build viewmodels"
        testId="viewmodel-build-review"
        className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
        onClose={() => {
          if (!building) setReviewOpen(false);
        }}
      >
        <ul className="mt-4 grid max-h-64 gap-1.5 overflow-y-auto">
          {reviewRows.map((row) => (
            <li key={row.id} className="flex justify-between gap-3 t-meta">
              <span className="text-ink">
                {viewmodelClassLabel(row.groups[0].class)} · {viewmodelRowLabel(row)}
              </span>
              <span>{rowChoice(row) === "full" ? "Hidden" : "Hands only"}</span>
            </li>
          ))}
        </ul>
        {conflicts.size ? (
          <p role="alert" className="t-meta mt-3 text-warn">
            Some choices share animations but are set differently. Make them match to build.
          </p>
        ) : null}
        <p role="status" data-testid="viewmodel-build-progress" className="t-meta mt-3">
          {building ? (
            <Loading>Building from your TF2 files…</Loading>
          ) : locked ? (
            "Close TF2 before building."
          ) : (
            "Replaces this profile's viewmodel pack with one built from your TF2 files."
          )}
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={building}
            onClick={() => setReviewOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="viewmodel-build"
            disabled={!canBuild}
            className="btn btn-primary"
            onClick={() => void build()}
          >
            {building ? <Loading>Building…</Loading> : "Build pack"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
