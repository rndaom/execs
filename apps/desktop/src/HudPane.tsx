import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  FolderOpen,
  Images,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useReducer, useState } from "react";
import { Alert } from "./components/ui/Alert";
import { Disclosure } from "./components/ui/Disclosure";
import { Modal } from "./components/ui/Modal";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Segmented } from "./components/ui/Segmented";
import { Switch } from "./components/ui/Switch";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import type { Api } from "./lib/api";
import {
  type HudAlbumImage,
  type HudCatalogEntry,
  type HudSchemaView,
  type HudStat,
  type HudUiState,
  openExternal,
} from "./lib/bridge";
import { hexToRgb, rgbToHex } from "./lib/color";
import {
  canInstallHud,
  filterHudCatalog,
  formatHudRgba,
  HUD_CATALOG_PAGE_SIZE,
  HUD_SORTS,
  hudCatalogControls,
  hudInstallSourceCopy,
  hudOptionsDirty,
  hudPageLinks,
  hudStatCopy,
  installedHudLabel,
  isHudCheckboxOn,
  paginateHudCatalog,
  parseHudPageJump,
  parseHudRgba,
  seedHudOptions,
  sortHudCatalog,
  stepHudScreenshot,
} from "./lib/hud-ui";

type HudViewer = { entry: HudCatalogEntry; index: number };

/** A 0–255 HUD alpha as the percentage people actually think in. */
function alphaPercent(alpha: number): number {
  return Math.round((alpha / 255) * 100);
}

/** Above this many choices a schema combo stays a dropdown. */
const SEGMENTED_CHOICE_MAX = 4;

/** Switching profiles or HUDs is a different record — the draft goes with it. */
function installedKeyOf(profileId: string | null, state: HudUiState): string {
  return draftRecordKey(profileId, state.installed?.id ?? "");
}

export function HudPane({
  api,
  profileId,
  catalogLoading,
  catalogError,
  catalog,
  stats,
  statsLoading = false,
  statsError = null,
  previewData = false,
  state,
  schema,
  onRefresh,
  onInstall,
  onUpdate,
  onMatch,
  onApplyOptions,
  onImportArchive,
  onImportFolder,
}: {
  api: Api;
  /** The profile this draft belongs to; a switch discards it. */
  profileId: string | null;
  catalogLoading: boolean;
  catalogError: string | null;
  catalog: HudCatalogEntry[];
  /** Popularity and recency per id; empty until the stats have loaded. */
  stats: Record<string, HudStat>;
  statsLoading?: boolean;
  statsError?: string | null;
  previewData?: boolean;
  state: HudUiState;
  schema: HudSchemaView | null;
  onRefresh: () => void;
  onInstall: (id: string) => void;
  onUpdate: () => void;
  onMatch: (id: string) => void;
  /** Resolves when the write settles; the toast reports it. */
  onApplyOptions: (options: Record<string, string>) => Promise<unknown>;
  /** Install a HUD from a zip/7z or a folder on this computer. */
  onImportArchive: () => void;
  onImportFolder: () => void;
}) {
  const { running, busy } = useAppStatus();
  const locked = !useCanWrite();
  const [{ query, sort, page }, dispatchCatalog] = useReducer(hudCatalogControls, {
    query: "",
    sort: "name",
    page: 0,
  });
  const [viewer, setViewer] = useState<HudViewer | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const seeded = useMemo(() => seedHudOptions(schema, state.installed), [schema, state.installed]);
  const [draft, setDraft] = useSeededDraft(
    seeded,
    (value) => JSON.stringify(value),
    installedKeyOf(profileId, state),
  );
  const matching = useMemo(() => filterHudCatalog(catalog, query), [catalog, query]);
  const filtered = useMemo(() => sortHudCatalog(matching, stats, sort), [matching, stats, sort]);
  const paged = paginateHudCatalog(filtered, page);
  const missingStats = matching.length - filtered.length;
  const metric =
    sort === "updated" ? "update dates" : sort === "downloads" ? "download counts" : "view counts";
  // The schema options are a draft of the HUD's own file: they autosave, so
  // nothing in that block is disabled — the lock defers the write instead.
  const dirty = hudOptionsDirty(draft, seeded);
  useAutosave({
    dirty,
    locked: running,
    token: JSON.stringify(draft),
    save: () => onApplyOptions(draft),
  });
  const installedId = state.installed?.id ?? null;
  const installedLabel = installedHudLabel(state);
  const installedEntry = installedId
    ? (catalog.find((entry) => entry.id.toLowerCase() === installedId.toLowerCase()) ?? null)
    : null;

  function goToPage(next: number, fromBottom = false) {
    dispatchCatalog({ type: "page", page: next });
    if (fromBottom) {
      const heading = document.getElementById("hud-catalog-heading");
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: "start" });
    }
  }

  return (
    <section data-testid="settings-hud" className="min-w-0 text-left">
      <PaneHeader
        title="HUD"
        lede="One HUD per profile."
        actions={
          <button
            type="button"
            data-testid="hud-import"
            disabled={locked}
            onClick={() => setImportOpen(true)}
            className="btn btn-ghost"
          >
            <UploadSimple size={14} />
            Import HUD…
          </button>
        }
      />

      {state.catalogUnavailable ? (
        <Alert tone="warn" testId="hud-state-catalog-unavailable" className="mt-6">
          The installed HUD loaded, but its update status could not be checked. Refresh the catalog
          when the connection is available.
        </Alert>
      ) : null}

      {installedId ? (
        <section data-testid="hud-installed">
          <div className="hero-row">
            <div className="min-w-0">
              <p className="eyebrow">Active HUD</p>
              <h2 className="t-pane mt-2 text-[22px]">{installedEntry?.name ?? installedId}</h2>
              <p className="t-meta mt-1">
                {installedEntry ? `by ${installedEntry.author} · ` : ""}
                {installedLabel}
              </p>
              <p className="t-meta mt-3 max-w-[62ch]">
                {state.inferred
                  ? "Match it to hud-db to enable updates."
                  : "Installing another HUD replaces this one."}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {state.updateAvailable ? (
                  <button
                    type="button"
                    data-testid="hud-update"
                    disabled={locked}
                    onClick={onUpdate}
                    className="btn btn-primary"
                  >
                    {running ? "Close TF2 to update" : "Update HUD"}
                  </button>
                ) : null}
                {state.inferred ? (
                  <button
                    type="button"
                    data-testid="hud-match"
                    disabled={locked}
                    onClick={() => onMatch(installedId)}
                    className="btn btn-ghost"
                  >
                    Match to catalog…
                  </button>
                ) : null}
                {installedEntry &&
                (installedEntry.screenshots.length > 0 || installedEntry.album) ? (
                  <button
                    type="button"
                    onClick={() => setViewer({ entry: installedEntry, index: 0 })}
                    className="btn btn-ghost"
                  >
                    <Images size={13} />
                    Screenshots
                  </button>
                ) : null}
              </div>
            </div>

            {installedEntry?.banner ? (
              <button
                type="button"
                onClick={() => setViewer({ entry: installedEntry, index: 0 })}
                className="surface hero-preview m-0 cursor-zoom-in self-start"
                title={`View ${installedEntry.name} screenshots`}
              >
                <img
                  src={installedEntry.banner}
                  alt={`${installedEntry.name} HUD preview`}
                  className="aspect-video w-full object-cover"
                />
              </button>
            ) : null}
          </div>

          {state.installed && state.schemaSupported && schema ? (
            <Disclosure
              profileId={profileId}
              storageKey="hud-options"
              summary="HUD options"
              testId="hud-options-disclosure"
              className="section"
            >
              <div data-testid="hud-options" className="flex flex-col">
                <div className="flex items-center justify-between gap-3 border-b border-edge pb-2">
                  <p className="t-meta">
                    {schema.author ? `Schema by ${schema.author}` : "Options"}
                  </p>
                </div>
                <div className="grid gap-x-10 pt-1 lg:grid-cols-2">
                  {schema.sections.map((section) => (
                    <fieldset key={section.name} className="flex min-w-0 flex-col gap-2 py-3">
                      <legend className="eyebrow py-1">{section.name}</legend>
                      {section.controls.map((control) => {
                        const value = draft[control.name] ?? control.value;
                        if (control.controlType === "checkbox") {
                          const enabled = isHudCheckboxOn(value);
                          return (
                            <div
                              key={control.name}
                              className="flex items-center justify-between gap-3 py-1 text-[13.5px] text-ink"
                            >
                              <span>{control.label}</span>
                              <Switch
                                checked={enabled}
                                label={control.label}
                                testId={`hud-opt-${control.name}`}
                                onChange={(next) =>
                                  setDraft((current) => ({
                                    ...current,
                                    [control.name]: next ? "true" : "false",
                                  }))
                                }
                              />
                            </div>
                          );
                        }
                        if (control.controlType === "combo") {
                          if (control.choices.length <= SEGMENTED_CHOICE_MAX) {
                            return (
                              <div
                                key={control.name}
                                className="flex items-center justify-between gap-3 py-1 text-[13.5px] text-ink"
                              >
                                <span>{control.label}</span>
                                <Segmented
                                  label={control.label}
                                  size="sm"
                                  testIdPrefix={`hud-opt-${control.name}`}
                                  options={control.choices.map((choice) => ({
                                    id: choice.value,
                                    label: choice.label,
                                  }))}
                                  value={value}
                                  onChange={(next) =>
                                    setDraft((current) => ({ ...current, [control.name]: next }))
                                  }
                                />
                              </div>
                            );
                          }
                          return (
                            <label
                              key={control.name}
                              className="grid grid-cols-[minmax(0,1fr)_minmax(7rem,auto)] items-center gap-3 py-1 text-[13.5px] text-ink"
                              htmlFor={`hud-opt-${control.name}`}
                            >
                              <span>{control.label}</span>
                              <select
                                id={`hud-opt-${control.name}`}
                                data-testid={`hud-opt-${control.name}`}
                                value={value}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    [control.name]: event.target.value,
                                  }))
                                }
                                className="field min-w-0 px-2 py-1.5 text-[13px] text-ink focus:outline-none disabled:opacity-50"
                              >
                                {control.choices.map((choice) => (
                                  <option key={choice.value} value={choice.value}>
                                    {choice.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        }
                        if (control.controlType === "number") {
                          // The schema's own bounds — respected on the way out,
                          // not just advertised: `min`/`max` alone do not stop a
                          // typed value from being applied.
                          const minimum = Number(control.minimum);
                          const maximum = Number(control.maximum);
                          return (
                            <label
                              key={control.name}
                              className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 py-1 text-[13.5px] text-ink"
                              htmlFor={`hud-opt-${control.name}`}
                            >
                              <span>{control.label}</span>
                              <input
                                id={`hud-opt-${control.name}`}
                                data-testid={`hud-opt-${control.name}`}
                                type="number"
                                value={value}
                                min={control.minimum}
                                max={control.maximum}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    [control.name]: event.target.value,
                                  }))
                                }
                                onBlur={(event) => {
                                  const raw = Number(event.target.value);
                                  if (!Number.isFinite(raw)) {
                                    return;
                                  }
                                  let next = raw;
                                  if (Number.isFinite(minimum)) {
                                    next = Math.max(minimum, next);
                                  }
                                  if (Number.isFinite(maximum)) {
                                    next = Math.min(maximum, next);
                                  }
                                  if (next !== raw) {
                                    setDraft((current) => ({
                                      ...current,
                                      [control.name]: String(next),
                                    }));
                                  }
                                }}
                                className="field w-full px-2 py-1.5 text-[13px] text-ink focus:outline-none disabled:opacity-50"
                              />
                            </label>
                          );
                        }
                        const rgba = parseHudRgba(value);
                        return (
                          <div key={control.name} className="py-1">
                            <div className="flex items-center justify-between gap-3">
                              <label
                                className="text-[13.5px] text-ink"
                                htmlFor={`hud-opt-${control.name}`}
                              >
                                {control.label}
                              </label>
                              <input
                                id={`hud-opt-${control.name}`}
                                data-testid={`hud-opt-${control.name}`}
                                type="color"
                                value={rgbToHex(rgba.r, rgba.g, rgba.b)}
                                onChange={(event) => {
                                  const rgb = hexToRgb(event.target.value);
                                  if (!rgb) {
                                    return;
                                  }
                                  setDraft((current) => ({
                                    ...current,
                                    [control.name]: formatHudRgba(rgb.r, rgb.g, rgb.b, rgba.a),
                                  }));
                                }}
                                className="h-7 w-10 cursor-pointer rounded-md border border-edge-strong bg-panel disabled:opacity-50"
                              />
                            </div>
                            <label className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_3rem] items-center gap-2 text-[12px] text-ink-muted">
                              <span>Opacity</span>
                              <input
                                data-testid={`hud-opt-${control.name}-alpha`}
                                type="range"
                                min={0}
                                max={255}
                                value={rgba.a}
                                onChange={(event) =>
                                  setDraft((current) => ({
                                    ...current,
                                    [control.name]: formatHudRgba(
                                      rgba.r,
                                      rgba.g,
                                      rgba.b,
                                      Number(event.target.value),
                                    ),
                                  }))
                                }
                                className="range min-w-0"
                              />
                              {/* Percentage is what people mean by opacity; the
                                raw 0–255 the HUD file stores rides along. */}
                              <span
                                data-testid={`hud-opt-${control.name}-alpha-value`}
                                className="text-right tabular-nums"
                                title={`${rgba.a} of 255`}
                              >
                                {alphaPercent(rgba.a)}%
                              </span>
                            </label>
                          </div>
                        );
                      })}
                    </fieldset>
                  ))}
                </div>
              </div>
            </Disclosure>
          ) : state.installed && !state.schemaSupported ? (
            <p data-testid="hud-options-notes" className="t-meta section">
              No in-app options for this HUD.
            </p>
          ) : null}
        </section>
      ) : (
        <div>
          <p className="eyebrow">Active HUD</p>
          <h2 className="t-pane mt-2 text-[22px]">Stock Team Fortress 2</h2>
        </div>
      )}

      <p className="t-meta mt-3">Custom materials may not work on Valve Casual servers.</p>

      <section id="hud-catalog" className="section scroll-mt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="hud-catalog-heading" tabIndex={-1} className="t-section scroll-mt-4">
              Browse HUDs
            </h2>
            <p className="t-meta mt-1 tnum">
              {matching.length} {query.trim() ? "matching " : ""}HUD
              {matching.length === 1 ? "" : "s"}
              {query.trim() ? "" : " in the catalog"}
              {previewData ? (
                <>
                  {" "}
                  <span className="ml-2 text-ink-faint">Preview data</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex min-w-0 flex-1 flex-wrap items-end justify-end gap-2 sm:flex-nowrap">
            <label className="min-w-48 max-w-sm flex-1" htmlFor="hud-search">
              <span className="sr-only">Search catalog</span>
              <input
                id="hud-search"
                data-testid="hud-search"
                type="search"
                value={query}
                onChange={(event) => dispatchCatalog({ type: "search", query: event.target.value })}
                placeholder="Search HUDs…"
                className="field w-full px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
              />
            </label>
            <button
              type="button"
              data-testid="hud-refresh"
              disabled={catalogLoading || busy}
              onClick={onRefresh}
              className="btn btn-ghost shrink-0"
            >
              {catalogLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="t-meta">Sort</span>
          <Segmented
            label="Sort HUDs"
            size="sm"
            testIdPrefix="hud-sort"
            options={HUD_SORTS}
            value={sort}
            onChange={(next) => dispatchCatalog({ type: "sort", sort: next })}
          />
        </div>

        {statsLoading ? (
          <p data-testid="hud-stats-loading" role="status" className="t-meta mt-3">
            Loading dates and popularity…
          </p>
        ) : statsError ? (
          <Alert tone="warn" testId="hud-stats-error" className="mt-3 py-2">
            Could not refresh dates and popularity. {statsError} Available data is still shown.
          </Alert>
        ) : null}

        {sort !== "name" && matching.length > 0 ? (
          <div
            data-testid="hud-ranking-coverage"
            className="t-meta mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1"
          >
            <p>
              Ranking {paged.total} of {matching.length} {query.trim() ? "matching " : ""}HUD
              {matching.length === 1 ? "" : "s"} with {metric}.
              {missingStats > 0
                ? ` ${missingStats} ${missingStats === 1 ? "has" : "have"} no ${metric} available${statsLoading ? " yet" : ""}.`
                : ""}
            </p>
            {missingStats > 0 ? (
              <button
                type="button"
                data-testid="hud-view-all"
                onClick={() => dispatchCatalog({ type: "sort", sort: "name" })}
                className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
              >
                View all A to Z
              </button>
            ) : null}
          </div>
        ) : null}

        {paged.total > 0 ? (
          <HudPagination
            page={paged.page}
            pageCount={paged.pageCount}
            total={paged.total}
            position="top"
            onPage={goToPage}
          />
        ) : null}

        {catalogLoading ? (
          <p
            data-testid="hud-catalog-loading"
            role="status"
            aria-live="polite"
            className="t-meta mt-4"
          >
            {catalog.length === 0
              ? "Loading catalog…"
              : `Refreshing… showing ${catalog.length} cached HUDs.`}
          </p>
        ) : null}

        {catalogError ? (
          <Alert tone="error" testId="hud-catalog-error" className="mt-4 py-2">
            <span className="font-medium">Could not refresh the catalog.</span>{" "}
            <span className="text-ink-muted">
              {catalogError}
              {catalog.length > 0 ? " Showing the last loaded catalog." : ""}
            </span>
          </Alert>
        ) : null}

        <div
          data-testid="hud-catalog"
          aria-busy={catalogLoading || (sort !== "name" && statsLoading)}
          className="mt-4"
        >
          {paged.items.length === 0 ? (
            catalogLoading ? null : (
              <p className="t-meta px-1 py-10 text-center">
                {sort !== "name" && matching.length > 0
                  ? statsLoading
                    ? `Loading ${metric}…`
                    : `No ${metric} available for these HUDs. Choose A to Z to browse them.`
                  : query.trim()
                    ? "No HUDs match that search."
                    : catalogError
                      ? "Catalog unavailable — try Refresh."
                      : "Catalog is empty."}
              </p>
            )
          ) : (
            <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
              {paged.items.map((entry) => {
                const current = installedId?.toLowerCase() === entry.id.toLowerCase();
                const installable = canInstallHud(entry);
                const shots = entry.screenshots.length;
                const hasPictures = shots > 0 || entry.album !== null;
                const sourceCopy = hudInstallSourceCopy(entry);
                const statCopy = hudStatCopy(stats[entry.id.toLowerCase()] ?? stats[entry.id]);
                return (
                  <article
                    key={entry.id}
                    data-testid={`hud-card-${entry.id}`}
                    data-github={entry.github ? "true" : "false"}
                    data-install={entry.install}
                    className="flex min-w-0 flex-col gap-3 border-b border-edge pb-4"
                  >
                    <button
                      type="button"
                      title={hasPictures ? `View ${entry.name} screenshots` : undefined}
                      disabled={!hasPictures}
                      onClick={() => setViewer({ entry, index: 0 })}
                      className="surface aspect-[16/7] w-full shrink-0 cursor-zoom-in disabled:cursor-default"
                    >
                      {entry.banner ? (
                        <img
                          src={entry.banner}
                          alt={`${entry.name} HUD preview`}
                          loading="lazy"
                          className="h-full w-full bg-panel object-contain"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-[11px] text-ink-faint">
                          No picture
                        </span>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <p className="t-row">{entry.name}</p>
                        {current ? <span className="badge badge-ok">Active</span> : null}
                      </div>
                      <p className="t-meta truncate">by {entry.author}</p>
                      {statCopy || entry.flags.length > 0 || sourceCopy ? (
                        <p className="t-meta mt-1 text-ink-faint">
                          {[
                            statCopy,
                            entry.flags.length > 0 ? entry.flags.join(" · ") : null,
                            sourceCopy,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {hasPictures ? (
                        <button
                          type="button"
                          data-testid={`hud-screenshots-${entry.id}`}
                          onClick={() => setViewer({ entry, index: 0 })}
                          aria-label={`${entry.name} screenshots`}
                          title="Screenshots"
                          className="btn btn-quiet p-2"
                        >
                          <Images size={15} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void openExternal(entry.comfigUrl)}
                        aria-label={`${entry.name} on comfig.app`}
                        title="Open on comfig.app"
                        className="btn btn-quiet p-2"
                      >
                        <ArrowSquareOut size={15} />
                      </button>
                      <button
                        type="button"
                        data-testid={`hud-install-${entry.id}`}
                        disabled={(locked && installable) || current}
                        onClick={() =>
                          installable ? onInstall(entry.id) : void openExternal(entry.repo)
                        }
                        className={`btn ml-auto ${current || !installable ? "btn-ghost" : "btn-primary"}`}
                      >
                        {/* Honest label: a row with no fetchable archive
                            opens the author's page instead of pretending. */}
                        {current
                          ? "Installed"
                          : !installable
                            ? "Author's page"
                            : running
                              ? "Close TF2 to install"
                              : "Install"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        {paged.pageCount > 1 ? (
          <HudPagination
            page={paged.page}
            pageCount={paged.pageCount}
            total={paged.total}
            position="bottom"
            onPage={(next) => goToPage(next, true)}
          />
        ) : null}
      </section>

      <p className="section t-meta text-ink-faint">
        Catalog from{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://github.com/mastercomfig/hud-db")}
          className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          mastercomfig hud-db
        </button>{" "}
        (MIT) and{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://comfig.app/huds")}
          className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          comfig.app
        </button>
        . Option schemas from{" "}
        <button
          type="button"
          onClick={() => void openExternal("https://github.com/CriticalFlaw/TF2HUD.Editor")}
          className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
        >
          TF2HUD.Editor
        </button>{" "}
        (MIT) — first-party apply, not their editor. Credit each HUD’s author. Not affiliated with
        Valve or Steam.
      </p>

      {importOpen ? (
        <Modal
          open
          testId="hud-import-dialog"
          title="Import a HUD"
          description="Choose the HUD you downloaded. Importing replaces the active HUD."
          className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2"
          onClose={() => setImportOpen(false)}
        >
          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              data-testid="hud-import-archive"
              disabled={locked}
              onClick={() => {
                setImportOpen(false);
                onImportArchive();
              }}
              className="btn btn-ghost justify-start gap-3 px-3 py-3 text-left"
            >
              <UploadSimple size={20} />
              <span>
                <span className="block">Choose ZIP or 7z…</span>
                <span className="t-meta mt-1 block">Downloaded archive. No need to unzip it.</span>
              </span>
            </button>
            <button
              type="button"
              data-testid="hud-import-folder"
              disabled={locked}
              onClick={() => {
                setImportOpen(false);
                onImportFolder();
              }}
              className="btn btn-ghost justify-start gap-3 px-3 py-3 text-left"
            >
              <FolderOpen size={20} />
              <span>
                <span className="block">Choose folder…</span>
                <span className="t-meta mt-1 block">For a HUD you already extracted.</span>
              </span>
            </button>
          </div>
          <p className="t-meta mt-4">
            The package is checked before import. In-game compatibility depends on the HUD.
          </p>
          <div className="mt-5 flex justify-end">
            <button type="button" className="btn btn-quiet" onClick={() => setImportOpen(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      ) : null}

      {viewer ? (
        <HudLightbox
          api={api}
          viewer={viewer}
          onPick={(index) => setViewer({ entry: viewer.entry, index })}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </section>
  );
}

function HudPagination({
  page,
  pageCount,
  total,
  position,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  position: "top" | "bottom";
  onPage: (page: number) => void;
}) {
  const [jump, setJump] = useState(String(page + 1));
  useEffect(() => setJump(String(page + 1)), [page]);
  const jumpPage = parseHudPageJump(jump, pageCount);
  const first = page * HUD_CATALOG_PAGE_SIZE + 1;
  const last = Math.min((page + 1) * HUD_CATALOG_PAGE_SIZE, total);
  return (
    <nav
      aria-label={`HUD catalog pages, ${position}`}
      data-testid={`hud-pagination-${position}`}
      className="mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-edge pt-3"
    >
      <p className="t-meta tnum" aria-live={position === "top" ? "polite" : "off"}>
        {first === last ? first : `${first}–${last}`} of {total}
      </p>
      {pageCount > 1 ? (
        <>
          <div className="flex items-center gap-1">
            <button
              type="button"
              data-testid={`hud-page-prev-${position}`}
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => onPage(page - 1)}
              className="btn btn-quiet p-2"
            >
              <ArrowLeft size={14} />
            </button>
            {hudPageLinks(page, pageCount).map((link) =>
              typeof link === "number" ? (
                <button
                  key={link}
                  type="button"
                  aria-label={`Page ${link + 1}`}
                  aria-current={link === page ? "page" : undefined}
                  onClick={() => onPage(link)}
                  className={`btn btn-quiet tnum min-w-8 px-2 py-1.5 ${
                    link === page ? "bg-brand/6 ring-1 ring-brand" : ""
                  }`}
                >
                  {link + 1}
                </button>
              ) : (
                <span key={link} className="t-meta px-0.5" aria-hidden="true">
                  …
                </span>
              ),
            )}
            <button
              type="button"
              data-testid={`hud-page-next-${position}`}
              aria-label="Next page"
              disabled={page >= pageCount - 1}
              onClick={() => onPage(page + 1)}
              className="btn btn-quiet p-2"
            >
              <ArrowRight size={14} />
            </button>
          </div>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (jumpPage !== null) onPage(jumpPage);
            }}
          >
            <label htmlFor={`hud-page-jump-${position}`} className="t-meta">
              Page
            </label>
            <input
              id={`hud-page-jump-${position}`}
              data-testid={`hud-page-jump-${position}`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]+"
              value={jump}
              onChange={(event) => setJump(event.target.value)}
              aria-label={`Page number, 1 to ${pageCount}`}
              aria-invalid={jump !== "" && jumpPage === null ? true : undefined}
              className="field tnum w-12 px-2 py-1.5 text-center text-[13px] text-ink focus:outline-none"
            />
            <span className="t-meta tnum">/ {pageCount}</span>
            <button
              type="submit"
              disabled={jumpPage === null || jumpPage === page}
              className="btn btn-quiet px-2 py-1.5"
            >
              Go
            </button>
          </form>
        </>
      ) : null}
    </nav>
  );
}

function HudLightbox({
  api,
  viewer,
  onPick,
  onClose,
}: {
  api: Api;
  viewer: HudViewer;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const { entry, index } = viewer;
  const [album, setAlbum] = useState<HudAlbumImage[] | null>(null);
  const [albumFailed, setAlbumFailed] = useState(false);

  useEffect(() => {
    setAlbum(null);
    setAlbumFailed(false);
    if (!entry.album) {
      return;
    }
    let cancelled = false;
    api
      .getHudAlbum(entry.id)
      .then((images) => {
        if (!cancelled) {
          setAlbum(images);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlbumFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, entry.id, entry.album]);

  // hud-db screenshots first; album pictures after, minus any that duplicate them.
  const pictures = useMemo(() => {
    const own = entry.screenshots.map((url) => ({ url, thumb: url }));
    const extra = (album ?? [])
      .filter((image) => !entry.screenshots.includes(image.url))
      .map((image) => ({ url: image.url, thumb: image.thumb ?? image.url }));
    return [...own, ...extra];
  }, [entry.screenshots, album]);
  const count = pictures.length;
  const safeIndex = count === 0 ? 0 : Math.min(index, count - 1);
  const current = pictures[safeIndex];

  // Escape and focus are the Modal's job; only the arrow-key paging is ours.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowRight") {
        onPick(stepHudScreenshot(safeIndex, 1, count));
      } else if (event.key === "ArrowLeft") {
        onPick(stepHudScreenshot(safeIndex, -1, count));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [safeIndex, count, onPick]);

  const albumUrl = entry.album;
  const albumNote = albumUrl
    ? album === null && !albumFailed
      ? "Loading album…"
      : albumFailed
        ? "Album could not load in-app."
        : album && album.length > 0
          ? `${album.length} from the author's album`
          : null
    : null;

  return (
    <Modal
      open
      testId="hud-lightbox"
      title={entry.name}
      description={`by ${entry.author}${count > 0 ? ` · ${safeIndex + 1} of ${count}` : ""}${
        albumNote ? ` · ${albumNote}` : ""
      }`}
      className="fixed inset-4 z-50 flex flex-col sm:inset-8"
      onClose={onClose}
    >
      <div className="absolute top-3 right-3">
        <div className="flex items-center gap-2">
          {albumUrl && albumFailed ? (
            <button
              type="button"
              onClick={() => void openExternal(albumUrl)}
              className="btn btn-ghost"
            >
              Open album
              <ArrowSquareOut size={12} />
            </button>
          ) : null}
          <button
            type="button"
            data-testid="hud-lightbox-close"
            onClick={onClose}
            aria-label="Close screenshots"
            className="btn btn-ghost p-2"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="relative mt-3 flex min-h-0 flex-1 items-center justify-center">
        {count > 1 ? (
          <button
            type="button"
            aria-label="Previous screenshot"
            onClick={() => onPick(stepHudScreenshot(safeIndex, -1, count))}
            className="btn btn-ghost absolute left-0 z-10 p-2.5"
          >
            <ArrowLeft size={18} />
          </button>
        ) : null}
        {current ? (
          <img
            key={current.url}
            data-testid="hud-lightbox-image"
            src={current.url}
            alt={`${entry.name} screenshot ${safeIndex + 1}`}
            className="enter-fade max-h-full min-h-0 max-w-full rounded-lg border border-edge object-contain"
          />
        ) : (
          <p className="t-meta">
            {albumUrl && !albumFailed && album === null ? "Loading pictures…" : "No pictures yet."}
          </p>
        )}
        {count > 1 ? (
          <button
            type="button"
            aria-label="Next screenshot"
            onClick={() => onPick(stepHudScreenshot(safeIndex, 1, count))}
            className="btn btn-ghost absolute right-0 z-10 p-2.5"
          >
            <ArrowRight size={18} />
          </button>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="mt-3 flex justify-center gap-2 overflow-x-auto pb-1">
          {pictures.map((shot, shotIndex) => (
            <button
              key={shot.url}
              type="button"
              aria-label={`Screenshot ${shotIndex + 1}`}
              aria-current={shotIndex === safeIndex}
              onClick={() => onPick(shotIndex)}
              className={`shrink-0 overflow-hidden rounded-md transition-shadow ${
                shotIndex === safeIndex
                  ? "shadow-[inset_0_0_0_1.5px_var(--color-brand)]"
                  : "border border-edge hover:border-edge-strong"
              }`}
            >
              <img src={shot.thumb} alt="" loading="lazy" className="h-12 w-20 object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
