import { useCallback, useEffect, useRef, useState } from "react";
import { ClassTabs } from "./components/ui/ClassTabs";
import { Modal } from "./components/ui/Modal";
import { Segmented } from "./components/ui/Segmented";
import { getViewmodelSourceCatalog, type ViewmodelSourceCatalog } from "./lib/bridge";
import {
  conflictingViewmodelGroupIds,
  selectedViewmodelChoices,
  type ViewmodelDraftChoices,
  type ViewmodelHideMode,
  viewmodelCatalogRevision,
  viewmodelClasses,
  viewmodelClassLabel,
  viewmodelDraftBuildRequest,
  viewmodelGroupLabel,
  viewmodelGroupsForClass,
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

/** A profile-scoped planning surface. It cannot write a pack before the retail and preview gates. */
export function ViewmodelBuilder({
  active,
  profilePreload,
}: {
  active: boolean;
  profilePreload: boolean | null;
}) {
  const [state, setState] = useState<CatalogState>(INITIAL_CATALOG);
  const mounted = useRef(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const inFlight = useRef(false);
  const refreshQueued = useRef(false);
  const attempted = useRef(false);
  const wasPresent = useRef(false);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshCatalog = useCallback(() => {
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
    inFlight.current = true;
    setState((current) => ({
      ...current,
      phase: current.catalog ? "checking" : "loading",
      error: null,
    }));
    void getViewmodelSourceCatalog()
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
          error:
            error instanceof Error ? error.message : "Could not read the installed TF2 sources.",
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
  refreshRef.current = refreshCatalog;

  useEffect(() => {
    if (!active) {
      // A mounted but hidden pane must recheck its catalog when opened again.
      wasPresent.current = false;
      return;
    }
    const observePresence = () => {
      const present = document.visibilityState !== "hidden" && document.hasFocus();
      if (present && (!attempted.current || !wasPresent.current)) refreshCatalog();
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
  const editable = active && state.phase === "ready";
  return (
    <section data-testid="viewmodel-builder" className="surface mb-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="t-row">Build from your TF2 install</h2>
          <p className="t-meta mt-2">
            Explore class and item groups derived from your installed TF2 files. These choices are a
            local draft and do not change the saved pack.
          </p>
        </div>
        <button
          type="button"
          data-testid="viewmodel-catalog-refresh"
          className="btn btn-ghost"
          disabled={!active || state.phase === "loading" || state.phase === "checking"}
          onClick={refreshCatalog}
        >
          Refresh sources
        </button>
      </div>

      <div role="status" data-testid="viewmodel-catalog-status" className="pane-note mt-3">
        {state.phase === "idle"
          ? "Open Viewmodels while execs is focused to inspect installed TF2 sources."
          : state.phase === "loading"
            ? "Reading installed TF2 sources…"
            : state.phase === "checking"
              ? "Checking whether installed TF2 sources changed…"
              : state.phase === "stale"
                ? "Installed source data could not be verified. Refresh to continue exploring."
                : `${catalog?.groups.length ?? 0} provisional groups from installed TF2 sources.`}
      </div>
      {state.error ? (
        <p role="alert" data-testid="viewmodel-catalog-error" className="t-meta mt-2 text-warn">
          {state.error}
        </p>
      ) : null}
      {state.changed ? (
        <p role="note" data-testid="viewmodel-catalog-changed" className="t-meta mt-2 text-warn">
          TF2 source data changed. Earlier planning choices were cleared; review the new groups.
        </p>
      ) : null}
      <p className="pane-note mt-3" data-testid="viewmodel-preview-status">
        Rendered preview unavailable. Group names come from installed metadata; their appearance and
        behavior in retail TF2 have not been verified yet.
      </p>
      {catalog &&
      (catalog.unresolvedItems.length ||
        catalog.unresolvedRoleCount ||
        catalog.candidateRoleCount) ? (
        <p className="pane-note mt-2" data-testid="viewmodel-catalog-coverage">
          Coverage is still incomplete: {catalog.unresolvedItems.length} item/class entries have no
          mapped animation, and {catalog.unresolvedRoleCount + catalog.candidateRoleCount} role
          paths need verification. These are not offered as choices.
        </p>
      ) : null}

      {catalog ? (
        <ViewmodelCatalogChoices
          key={viewmodelCatalogRevision(catalog)}
          catalog={catalog}
          editable={editable}
          active={active}
          profilePreload={profilePreload}
        />
      ) : null}
    </section>
  );
}

function ViewmodelCatalogChoices({
  catalog,
  editable,
  active,
  profilePreload,
}: {
  catalog: ViewmodelSourceCatalog;
  editable: boolean;
  active: boolean;
  profilePreload: boolean | null;
}) {
  const classes = viewmodelClasses(catalog);
  const [selectedClass, setSelectedClass] = useState(classes[0] ?? "");
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<ViewmodelDraftChoices>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const visibleGroups = viewmodelGroupsForClass(catalog, selectedClass, query);
  const reviewRequest =
    profilePreload === null ? null : viewmodelDraftBuildRequest(catalog, choices, profilePreload);
  const selected = reviewRequest?.choices ?? selectedViewmodelChoices(choices);
  const conflicts = conflictingViewmodelGroupIds(catalog, choices);

  useEffect(() => {
    if (!active || !editable) setReviewOpen(false);
  }, [active, editable]);

  function choose(groupId: string, mode: ViewmodelHideMode | "shown") {
    setChoices((current) => {
      const next = { ...current };
      if (mode === "shown") delete next[groupId];
      else next[groupId] = mode;
      return next;
    });
  }

  return (
    <div className="mt-5">
      {classes.length ? (
        <ClassTabs
          tabs={classes.map((name) => ({
            id: name,
            label: viewmodelClassLabel(name),
            meta: catalog.groups.filter((group) => group.class === name).length,
          }))}
          selected={selectedClass}
          label="Viewmodel class"
          idPrefix="viewmodel-class"
          panelId="viewmodel-class-panel"
          onSelect={setSelectedClass}
        />
      ) : (
        <p className="t-meta">No source-derived groups were found in this TF2 install.</p>
      )}
      {classes.length ? (
        <div
          id="viewmodel-class-panel"
          role="tabpanel"
          aria-labelledby={`viewmodel-class-${selectedClass}`}
        >
          <label className="mt-4 block t-meta" htmlFor="viewmodel-group-search">
            Search {viewmodelClassLabel(selectedClass)} items
          </label>
          <input
            id="viewmodel-group-search"
            data-testid="viewmodel-group-search"
            type="search"
            className="input mt-2 w-full"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Item name or ID"
          />
          {visibleGroups.length ? (
            <div className="mt-4">
              {visibleGroups.map((group) => {
                const names = [...new Set(group.items.map((item) => item.schemaName))];
                const label = viewmodelGroupLabel(group);
                return (
                  <div
                    key={group.id}
                    data-testid="viewmodel-group"
                    data-group-id={group.id}
                    className="border-b border-edge py-3 last:border-b-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="t-row">{label}</h3>
                        <p className="t-meta mt-1">
                          {group.items.length} installed item{" "}
                          {group.items.length === 1 ? "entry" : "entries"}
                          {names.length > 1
                            ? ` · Also ${names.slice(1, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`
                            : ""}
                        </p>
                      </div>
                      <Segmented<"shown" | ViewmodelHideMode>
                        label={`${viewmodelClassLabel(group.class)} ${label} model mode`}
                        options={[
                          { id: "shown", label: "Keep" },
                          { id: "full", label: "Hide full" },
                          { id: "weapon", label: "Hide weapon" },
                        ]}
                        value={choices[group.id] ?? "shown"}
                        disabled={!editable}
                        testIdPrefix={`viewmodel-choice-${group.id}`}
                        onChange={(mode) => choose(group.id, mode)}
                      />
                    </div>
                    {group.overlaps.length || group.teamVariantsDiffer ? (
                      <p className="pane-note mt-2">
                        {group.overlaps.length
                          ? `Shares animations with ${group.overlaps.length} other ${group.overlaps.length === 1 ? "group" : "groups"}. A choice here may affect those items. `
                          : ""}
                        {group.teamVariantsDiffer ? "RED and BLU sources differ." : ""}
                      </p>
                    ) : null}
                    {conflicts.has(group.id) ? (
                      <p className="t-meta mt-2 text-warn">
                        This choice conflicts with a different hide mode on a shared animation.
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="t-meta mt-4">
              No items match this search for {viewmodelClassLabel(selectedClass)}.
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-edge pt-4">
        <button
          type="button"
          data-testid="viewmodel-review-build"
          className="btn btn-primary"
          disabled={!editable || reviewRequest === null || selected.length === 0}
          onClick={() => setReviewOpen(true)}
        >
          Review {selected.length} {selected.length === 1 ? "choice" : "choices"}
        </button>
        <p className="t-meta">
          Build remains unavailable until retail and rendered-preview checks pass.
        </p>
      </div>

      <Modal
        open={reviewOpen && active && editable}
        title="Review Viewmodels build"
        description="These are planning choices from your installed TF2 files. No pack has been built or changed."
        testId="viewmodel-build-review"
        className="w-[min(560px,calc(100vw-2rem))]"
        onClose={() => setReviewOpen(false)}
      >
        <div className="mt-4 max-h-64 overflow-y-auto">
          <ul className="grid gap-2">
            {selected.map(({ groupId, mode }) => {
              const group = catalog.groups.find((candidate) => candidate.id === groupId);
              return (
                <li key={groupId} className="t-meta">
                  {group
                    ? `${viewmodelClassLabel(group.class)} · ${viewmodelGroupLabel(group)}`
                    : groupId}
                  : {mode === "full" ? "Hide full model" : "Hide weapon, keep hands"}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="t-meta mt-3">
          Casual preload: {reviewRequest?.preload ? "On" : "Off"}. Source patch:{" "}
          {reviewRequest?.catalog.patchVersion}.
        </p>
        {conflicts.size ? (
          <p role="alert" className="t-meta mt-3 text-warn">
            Some selected groups share animations but use different hide modes. Resolve those
            choices before a future build.
          </p>
        ) : null}
        <p role="status" data-testid="viewmodel-build-progress" className="pane-note mt-3">
          No build started. Rendered previews and retail TF2 behavior are still being verified.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" data-testid="viewmodel-build" disabled className="btn btn-primary">
            Build pack
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setReviewOpen(false)}>
            Close review
          </button>
        </div>
      </Modal>
    </div>
  );
}
