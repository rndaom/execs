import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApplyBar } from "./components/ui/ApplyBar";
import { ChoiceMatrixHead, ChoiceMatrixRow } from "./components/ui/ChoiceMatrix";
import { ClassIcon } from "./components/ui/ClassIcon";
import { ClassTabs } from "./components/ui/ClassTabs";
import { Modal } from "./components/ui/Modal";
import { Segmented } from "./components/ui/Segmented";
import { Loading } from "./components/ui/Spinner";
import { useExplicitDraft } from "./hooks/useExplicitDraft";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
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
  type ViewmodelChoice,
  type ViewmodelClassLayout,
  type ViewmodelDraftChoices,
  type ViewmodelHideMode,
  type ViewmodelPreset,
  type ViewmodelRow,
  viewmodelCatalogRevision,
  viewmodelChoiceChanges,
  viewmodelClasses,
  viewmodelClassLabel,
  viewmodelClassLayout,
  viewmodelClassSummary,
  viewmodelConflictRows,
  viewmodelDraftBuildRequest,
  viewmodelExceptions,
  viewmodelInspectChoice,
  viewmodelPresetChoices,
  viewmodelRowChoice,
  viewmodelRowItemNames,
  viewmodelRowLabel,
  viewmodelRowsForClass,
  viewmodelSlotChoice,
  viewmodelWithRows,
  viewmodelWithSlot,
} from "./lib/viewmodel-ui";

type CatalogState = {
  catalog: ViewmodelSourceCatalog | null;
  phase: "idle" | "loading" | "checking" | "ready" | "stale";
  error: string | null;
  replacement: ViewmodelSourceCatalog | null;
};

const INITIAL_CATALOG: CatalogState = {
  catalog: null,
  phase: "idle",
  error: null,
  replacement: null,
};

/** Never rebase unbuilt choices onto different installed animation sources. */
function acceptCatalog(
  current: CatalogState,
  catalog: ViewmodelSourceCatalog,
  pending: boolean,
): CatalogState {
  const changed =
    current.catalog !== null &&
    viewmodelCatalogRevision(current.catalog) !== viewmodelCatalogRevision(catalog);
  return {
    catalog: changed && pending ? current.catalog : catalog,
    phase: "ready",
    error: null,
    replacement: changed && pending ? catalog : null,
  };
}

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

/** Per-class viewmodel choices built from the player's installed TF2 files. */
export function ViewmodelBuilder({
  active,
  profileId = null,
  profilePreload,
  savedRecipe,
  locked = false,
  running = false,
  barSlot = null,
  loadCatalog,
  onBuild,
  onRemovePack,
}: {
  active: boolean;
  /** Keys the unbuilt draft to the profile. */
  profileId?: string | null;
  /** TF2 is running, so applying waits for it to close. */
  running?: boolean;
  /**
   * Where the pane keeps its apply bar: the end of the whole pane, so the bar
   * stays in view from the first section to the last.
   */
  barSlot?: HTMLElement | null;
  /** Applying "everything shown" over a built pack removes it. */
  onRemovePack?: () => void;
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
  const draftPending = useRef(false);
  const reportDraft = useCallback((pending: boolean) => {
    draftPending.current = pending;
  }, []);

  useEffect(() => {
    mounted.current = true;
    // The startup read can finish after this pane mounts; show it without another read.
    const stop = subscribeViewmodelCatalog((catalog) =>
      setState((current) =>
        current.catalog ? current : { catalog, phase: "ready", error: null, replacement: null },
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
            : acceptCatalog(current, catalog, draftPending.current),
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
        setState((current) => acceptCatalog(current, catalog, draftPending.current));
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
    active &&
    catalog !== null &&
    state.replacement === null &&
    (state.phase === "ready" || state.phase === "checking");
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
      {state.replacement ? (
        <div role="note" data-testid="viewmodel-catalog-changed" className="pane-note mb-4">
          <p>
            TF2's files changed, so these choices can't be built. Discard them to load the new
            weapons.
          </p>
          <button
            type="button"
            data-testid="viewmodel-discard-reload"
            className="btn btn-ghost mt-3"
            disabled={locked || busy}
            onClick={() => {
              draftPending.current = false;
              setState((current) =>
                current.replacement ? acceptCatalog(current, current.replacement, false) : current,
              );
            }}
          >
            Discard choices and reload
          </button>
        </div>
      ) : null}

      {catalog ? (
        <ViewmodelCatalogChoices
          key={viewmodelCatalogRevision(catalog)}
          catalog={catalog}
          profileId={profileId}
          editable={editable}
          active={active}
          profilePreload={profilePreload}
          savedRecipe={savedRecipe}
          locked={locked}
          running={running}
          barSlot={barSlot}
          onBuild={onBuild}
          onRemovePack={onRemovePack}
          onPendingChange={reportDraft}
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

function serializeChoices(choices: ViewmodelDraftChoices): string {
  return JSON.stringify(selectedViewmodelChoices(choices));
}

function ViewmodelCatalogChoices({
  catalog,
  profileId,
  editable,
  active,
  profilePreload,
  savedRecipe,
  locked,
  running,
  barSlot,
  onBuild,
  onRemovePack,
  onPendingChange,
}: {
  catalog: ViewmodelSourceCatalog;
  profileId: string | null;
  editable: boolean;
  active: boolean;
  profilePreload: boolean | null;
  savedRecipe?: ViewmodelBuildRecipe;
  locked: boolean;
  running: boolean;
  barSlot: HTMLElement | null;
  onBuild: (request: ViewmodelBuildRequest) => Promise<boolean>;
  onRemovePack?: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const classes = viewmodelClasses(catalog);
  const [selectedClass, setSelectedClass] = useState(classes[0] ?? "");
  const incoming = savedChoices(catalog, savedRecipe);
  const incomingKey = serializeChoices(incoming);
  const [baseline, setBaseline] = useState(() => ({ key: incomingKey, choices: incoming }));
  let saved = baseline.choices;
  if (baseline.key !== incomingKey) {
    saved = incoming;
    setBaseline({ key: incomingKey, choices: incoming });
  }
  const [choices, setChoices] = useSeededDraft(
    saved,
    serializeChoices,
    draftRecordKey(profileId, "viewmodel-builder"),
  );
  const [presetOpen, setPresetOpen] = useState(false);
  const [preset, setPreset] = useState<ViewmodelPreset>("keep-melee");
  const [presetMode, setPresetMode] = useState<ViewmodelHideMode>("full");
  // The draft before the last whole-profile change, until another edit.
  const [undo, setUndo] = useState<ViewmodelDraftChoices | null>(null);
  const [building, setBuilding] = useState(false);
  const layouts = new Map(classes.map((name) => [name, viewmodelClassLayout(catalog, name)]));
  const layout = layouts.get(selectedClass);
  const reviewRequest =
    profilePreload === null ? null : viewmodelDraftBuildRequest(catalog, choices, profilePreload);
  const selected = reviewRequest?.choices ?? selectedViewmodelChoices(choices);
  const conflicts = conflictingViewmodelGroupIds(catalog, choices);
  const changed = !sameChoices(choices, saved);
  useExplicitDraft(changed || building);
  useEffect(() => {
    onPendingChange(changed || building);
    return () => onPendingChange(false);
  }, [changed, building, onPendingChange]);
  const canBuild =
    editable &&
    !locked &&
    !building &&
    reviewRequest !== null &&
    selected.length > 0 &&
    conflicts.size === 0;
  // Showing everything again over a built pack means the pack goes.
  const removesPack =
    changed && selected.length === 0 && Object.keys(saved).length > 0 && Boolean(onRemovePack);

  useEffect(() => {
    if (!active || !editable) setPresetOpen(false);
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

  function edit(change: (current: ViewmodelDraftChoices) => ViewmodelDraftChoices) {
    setUndo(null);
    setChoices(change);
  }

  async function build() {
    if (!reviewRequest || !canBuild) return;
    const sent = choices;
    setBuilding(true);
    try {
      if (await onBuild(reviewRequest)) {
        setBaseline((current) => ({ ...current, choices: sent }));
      }
    } catch {
      // The host reports failures. Keep the exact draft available for retry.
    } finally {
      setBuilding(false);
    }
  }

  const rowsByClass = new Map(classes.map((name) => [name, viewmodelRowsForClass(catalog, name)]));
  const hiddenRows = classes.flatMap((name) =>
    (rowsByClass.get(name) ?? []).filter((row) => viewmodelRowChoice(choices, row) !== "shown"),
  );
  // The summary and the class tabs read per class, the way the choices are made.
  const summaries = classes.flatMap((name) => {
    const classLayout = layouts.get(name);
    const summary = classLayout ? viewmodelClassSummary(choices, classLayout) : null;
    return summary ? [{ name, summary }] : [];
  });
  const changedIn = (className: string) => {
    const classLayout = layouts.get(className);
    if (!classLayout) return 0;
    return (
      classLayout.slots.filter((slot) => viewmodelSlotChoice(choices, slot.rows) !== "shown")
        .length +
      Number(viewmodelInspectChoice(choices, classLayout.inspect) !== "shown") +
      viewmodelExceptions(choices, classLayout).length
    );
  };

  return (
    <div>
      {classes.length ? (
        <ClassTabs
          tabs={classes.map((name) => ({
            id: name,
            label: (
              <>
                <ClassIcon classId={name} size={16} />
                {viewmodelClassLabel(name)}
              </>
            ),
            meta: changedIn(name) || undefined,
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
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              data-testid="viewmodel-presets"
              className="btn btn-ghost whitespace-nowrap"
              disabled={!editable}
              onClick={() => setPresetOpen(true)}
            >
              Set every class…
            </button>
            <p
              className="t-meta ml-2 min-w-0 flex-1 whitespace-nowrap"
              data-testid="viewmodel-choice-summary"
            >
              {hiddenRows.length
                ? `${summaries.length} ${summaries.length === 1 ? "class" : "classes"} changed`
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
          </div>

          {layout ? (
            <ViewmodelClassChoices
              key={selectedClass}
              catalog={catalog}
              className={selectedClass}
              layout={layout}
              choices={choices}
              editable={editable}
              onEdit={edit}
            />
          ) : null}
        </div>
      ) : null}

      <Modal
        open={presetOpen && active && editable}
        title="Set every class"
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
          {proposedChanges.length === 0 ? "Nothing changes." : "Afterwards:"}
        </p>
        {proposed && proposedChanges.length ? (
          <ul
            className="mt-2 grid max-h-64 gap-1.5 overflow-y-auto"
            data-testid="viewmodel-preset-changes"
          >
            {classes.map((name) => {
              const classLayout = layouts.get(name);
              if (!classLayout) return null;
              return (
                <li key={name} className="flex justify-between gap-3 t-meta">
                  <span className="text-ink">{viewmodelClassLabel(name)}</span>
                  <span className="text-right">
                    {viewmodelClassSummary(proposed, classLayout) ?? "Everything shown"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {proposedConflicts ? (
          <p role="alert" className="t-meta mt-3 text-warn">
            Some weapons share animations with a melee weapon. Make them match before applying.
          </p>
        ) : null}
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
            Set every class
          </button>
        </div>
      </Modal>

      {barSlot && (changed || building)
        ? createPortal(
            <ApplyBar
              testId="viewmodel-build"
              status={
                <span data-testid="viewmodel-build-progress">
                  {building ? (
                    <Loading>Applying… building from your TF2 files.</Loading>
                  ) : conflicts.size ? (
                    "Weapons that share animations must match before you apply."
                  ) : removesPack ? (
                    "Everything is shown again. Applying removes your viewmodel pack."
                  ) : (
                    "Your viewmodel changes aren't in TF2 yet."
                  )}
                </span>
              }
              actionLabel={building ? "Applying…" : "Apply changes"}
              lockedLabel="Close TF2 to apply"
              running={running}
              locked={removesPack ? locked || building || !editable : !canBuild}
              dirty
              extra={
                <button
                  type="button"
                  data-testid="viewmodel-discard-draft"
                  className="btn btn-ghost"
                  disabled={building || locked}
                  onClick={() => {
                    setChoices(saved);
                    setUndo(null);
                  }}
                >
                  Discard changes
                </button>
              }
              onApply={() => {
                if (removesPack) onRemovePack?.();
                else void build();
              }}
            />,
            barSlot,
          )
        : null}
    </div>
  );
}

/**
 * One class as a table: a row per slot with its weapons listed beneath it,
 * then inspect animations and weapons outside the slots. Each row is one
 * choice under shared Shown / Hidden / Hands only columns.
 */
function ViewmodelClassChoices({
  catalog,
  className,
  layout,
  choices,
  editable,
  onEdit,
}: {
  catalog: ViewmodelSourceCatalog;
  className: string;
  layout: ViewmodelClassLayout;
  choices: ViewmodelDraftChoices;
  editable: boolean;
  onEdit: (change: (current: ViewmodelDraftChoices) => ViewmodelDraftChoices) => void;
}) {
  const classLabel = viewmodelClassLabel(className);
  const inspect = viewmodelInspectChoice(choices, layout.inspect);
  const conflicts = viewmodelConflictRows(catalog, choices, className);

  function weaponRow(row: ViewmodelRow, base: ViewmodelChoice) {
    const choice = viewmodelRowChoice(choices, row);
    const names = viewmodelRowItemNames(row);
    const label = viewmodelRowLabel(row);
    return (
      <ChoiceMatrixRow<ViewmodelChoice>
        key={row.id}
        kind="member"
        name={`viewmodel-${row.id}`}
        label={<span className={choice === base ? "text-ink-muted" : "text-ink"}>{label}</span>}
        accessibleLabel={`${classLabel} ${label}`}
        title={names.length > 1 ? names.join(", ") : undefined}
        columns={MODE_OPTIONS}
        value={choice}
        neutralValue="shown"
        disabled={!editable}
        testId="viewmodel-weapon"
        testIdPrefix={`viewmodel-weapon-choice-${row.id}`}
        data={{ "group-id": row.id, choice }}
        onChange={(mode) => onEdit((current) => viewmodelWithRows(current, [row], mode))}
      />
    );
  }

  return (
    <div className="mt-4">
      <div className="choice-matrix" data-testid="viewmodel-matrix">
        <ChoiceMatrixHead columns={MODE_OPTIONS} />
        {layout.slots.map((slot) => {
          const base = viewmodelSlotChoice(choices, slot.rows);
          const single = slot.rows.length === 1;
          return (
            <Fragment key={slot.id}>
              <ChoiceMatrixRow<ViewmodelChoice>
                kind={single ? "item" : "group"}
                name={`viewmodel-${className}-${slot.id}`}
                label={slot.label}
                accessibleLabel={`${classLabel} ${slot.label}`}
                detail={single ? viewmodelRowLabel(slot.rows[0]) : undefined}
                title={single ? viewmodelRowItemNames(slot.rows[0]).join(", ") : undefined}
                columns={MODE_OPTIONS}
                value={base}
                neutralValue="shown"
                disabled={!editable}
                testId={`viewmodel-slot-${slot.id}`}
                testIdPrefix={`viewmodel-slot-choice-${slot.id}`}
                onChange={(mode) =>
                  onEdit((current) => viewmodelWithSlot(current, slot.rows, mode))
                }
              />
              {single ? null : slot.rows.map((row) => weaponRow(row, base))}
            </Fragment>
          );
        })}
        {layout.inspect.length ? (
          <ChoiceMatrixRow<ViewmodelChoice>
            kind="item"
            name={`viewmodel-${className}-inspect`}
            label="Inspect"
            accessibleLabel={`${classLabel} inspect`}
            detail={inspect === "mixed" ? "Some inspect animations are hidden." : undefined}
            columns={MODE_OPTIONS}
            available={["shown", "full"]}
            value={inspect === "mixed" ? null : inspect}
            neutralValue="shown"
            disabled={!editable}
            testId="viewmodel-slot-inspect"
            testIdPrefix="viewmodel-slot-choice-inspect"
            onChange={(mode) =>
              onEdit((current) => viewmodelWithRows(current, layout.inspect, mode))
            }
          />
        ) : null}
        {layout.other.length ? (
          <>
            <div className="choice-matrix-row choice-matrix-group">
              <div className="choice-matrix-label">
                <p className="t-row">Other</p>
              </div>
            </div>
            {layout.other.map((row) => weaponRow(row, "shown"))}
          </>
        ) : null}
      </div>

      {conflicts.length ? (
        <p role="alert" data-testid="viewmodel-conflict" className="t-meta mt-3 text-warn">
          {conflicts.map(viewmodelRowLabel).join(" and ")} share animations but are set differently.
          Set them the same to build.
        </p>
      ) : null}
    </div>
  );
}
