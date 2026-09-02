import {
  ArrowLeft,
  ArrowRight,
  ArrowSquareOut,
  FolderOpen,
  Images,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { Alert } from "./components/ui/Alert";
import { Disclosure } from "./components/ui/Disclosure";
import { Modal } from "./components/ui/Modal";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Segmented } from "./components/ui/Segmented";
import { Switch } from "./components/ui/Switch";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
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
  HUD_SORTS,
  type HudSort,
  hudInstallSourceCopy,
  hudOptionsDirty,
  hudStatCopy,
  installedHudLabel,
  isHudCheckboxOn,
  paginateHudCatalog,
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
  state: HudUiState;
  schema: HudSchemaView | null;
  onRefresh: () => void;
  onInstall: (id: string) => void;
  onUpdate: () => void;
  onMatch: (id: string) => void;
  onApplyOptions: (options: Record<string, string>) => void;
  /** Install a HUD from a zip/7z or a folder on this computer. */
  onImportArchive: () => void;
  onImportFolder: () => void;
}) {
  const { running, busy } = useAppStatus();
  const locked = !useCanWrite();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<HudSort>("name");
  const [page, setPage] = useState(0);
  const [viewer, setViewer] = useState<HudViewer | null>(null);
  const seeded = useMemo(() => seedHudOptions(schema, state.installed), [schema, state.installed]);
  const [draft, setDraft] = useSeededDraft(
    seeded,
    (value) => JSON.stringify(value),
    installedKeyOf(profileId, state),
  );
  const filtered = useMemo(
    () => sortHudCatalog(filterHudCatalog(catalog, query), stats, sort),
    [catalog, query, stats, sort],
  );
  const paged = paginateHudCatalog(filtered, page);
  const dirty = hudOptionsDirty(draft, seeded);
  const installedId = state.installed?.id ?? null;
  const installedLabel = installedHudLabel(state);
  // The active HUD's own art, when hud-db knows the entry — the hero shows
  // what you installed, not just its name.
  const installedEntry = installedId
    ? (catalog.find((entry) => entry.id.toLowerCase() === installedId.toLowerCase()) ?? null)
    : null;

  function goToPage(next: number) {
    setPage(next);
    document.getElementById("hud-catalog")?.scrollIntoView({ block: "start" });
  }

  return (
    <section data-testid="settings-hud" className="min-w-0 text-left">
      <PaneHeader
        title="HUD"
        lede="One HUD per profile, installed in a click. Layout, scheme and animations survive Valve Casual; custom materials usually do not."
        actions={<span className="tnum t-meta text-ink-faint">{catalog.length} in catalog</span>}
      />

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
                  ? "This profile already has a HUD folder. Match it to hud-db to enable updates."
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

          {state.installed && schema?.supported ? (
            <Disclosure
              storageKey="hud-options"
              summary="HUD options"
              testId="hud-options-disclosure"
              className="section"
            >
              <form
                data-testid="hud-options"
                className="flex flex-col"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (locked || !dirty) {
                    return;
                  }
                  onApplyOptions(draft);
                }}
              >
                <div className="flex items-center justify-between gap-3 border-b border-edge pb-2">
                  <p className="t-meta">
                    {schema.author ? `Schema by ${schema.author}` : "Options"}
                  </p>
                  <span className="t-meta text-ink-faint">
                    {dirty ? "Unsaved changes" : "Saved"}
                  </span>
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
                                disabled={locked}
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
                          // A short list is pills; only a long one still earns
                          // a dropdown (AGENTS.md, "Fewer controls").
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
                                  disabled={locked}
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
                                disabled={locked}
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
                                disabled={locked}
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
                                disabled={locked}
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
                                disabled={locked}
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
                <div className="flex items-center justify-end border-t border-edge pt-4">
                  <button
                    type="submit"
                    data-testid="hud-apply"
                    disabled={locked || !dirty}
                    className="btn btn-primary"
                  >
                    {running ? "Close TF2 to apply" : "Apply options"}
                  </button>
                </div>
              </form>
            </Disclosure>
          ) : state.installed && !state.schemaSupported ? (
            <p data-testid="hud-options-notes" className="t-meta section">
              This HUD has no in-app options. Open the author’s customization notes on comfig.app or
              GitHub.
            </p>
          ) : null}
        </section>
      ) : (
        <div>
          <p className="eyebrow">Active HUD</p>
          <h2 className="t-pane mt-2 text-[22px]">Stock Team Fortress 2</h2>
          <p className="t-meta mt-1">
            Install one from the catalog below, or bring your own from this computer.
          </p>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="hud-import-archive"
          disabled={locked}
          onClick={onImportArchive}
          className="btn btn-ghost"
        >
          <UploadSimple size={14} />
          Import a HUD archive…
        </button>
        <button
          type="button"
          data-testid="hud-import-folder"
          disabled={locked}
          onClick={onImportFolder}
          className="btn btn-ghost"
        >
          <FolderOpen size={14} />
          Import a HUD folder…
        </button>
        <span className="t-meta">
          A zip or 7z, or an extracted folder, with info.vdf inside. It replaces the active HUD.
        </span>
      </div>

      <section id="hud-catalog" className="section scroll-mt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="t-section">Catalog</h2>
            <p className="t-meta mt-1">
              {query.trim() ? `${paged.total} matching HUDs` : "Search hud-db by name or author"}
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
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
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
            onChange={(next) => {
              setSort(next);
              setPage(0);
            }}
          />
        </div>

        {catalogLoading ? (
          <p
            data-testid="hud-catalog-loading"
            role="status"
            aria-live="polite"
            className="t-meta mt-4"
          >
            {catalog.length === 0
              ? "Loading the HUD catalog…"
              : `Checking for catalog updates… ${catalog.length} cached HUDs remain available.`}
          </p>
        ) : null}

        {catalogError ? (
          <Alert tone="error" testId="hud-catalog-error" className="mt-4 py-2">
            <span className="font-medium">Could not refresh the HUD catalog.</span>{" "}
            <span className="text-ink-muted">
              {catalogError}
              {catalog.length > 0 ? " The last loaded catalog is still available." : ""}
            </span>
          </Alert>
        ) : null}

        <div data-testid="hud-catalog" aria-busy={catalogLoading} className="mt-4">
          {paged.items.length === 0 ? (
            catalogLoading ? null : (
              <p className="t-meta px-1 py-10 text-center">
                {query.trim()
                  ? "No HUDs match that search."
                  : catalogError
                    ? "The catalog is unavailable. Try refreshing it again."
                    : "No HUDs are available in the catalog."}
              </p>
            )
          ) : (
            /* Hairline rows, not per-row boxes. The banner keeps its own
               frame — that one is real media. */
            <div>
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
                    className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-edge py-3.5"
                  >
                    <button
                      type="button"
                      title={hasPictures ? `View ${entry.name} screenshots` : undefined}
                      disabled={!hasPictures}
                      onClick={() => setViewer({ entry, index: 0 })}
                      className="surface h-16 w-28 shrink-0 cursor-zoom-in disabled:cursor-default"
                    >
                      {entry.banner ? (
                        <img
                          src={entry.banner}
                          alt={`${entry.name} HUD preview`}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="grid h-full w-full place-items-center text-[11px] text-ink-faint">
                          No picture
                        </span>
                      )}
                    </button>
                    <div className="min-w-48 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <p className="t-row">{entry.name}</p>
                        <p className="truncate text-[12.5px] text-ink-faint">by {entry.author}</p>
                        {current ? <span className="badge badge-ok">Active</span> : null}
                      </div>
                      {statCopy || entry.flags.length > 0 || sourceCopy ? (
                        <p className="t-meta mt-0.5">
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
                    <div className="flex shrink-0 items-center gap-1">
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
                        className={`btn ml-1 ${current || !installable ? "btn-ghost" : "btn-primary"}`}
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
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-edge pt-4">
            <p className="t-meta tnum">
              Page {paged.page + 1} of {paged.pageCount} · {paged.total} HUDs
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="hud-page-prev"
                disabled={paged.page === 0}
                onClick={() => goToPage(paged.page - 1)}
                className="btn btn-ghost"
              >
                <ArrowLeft size={13} />
                Previous
              </button>
              <button
                type="button"
                data-testid="hud-page-next"
                disabled={paged.page >= paged.pageCount - 1}
                onClick={() => goToPage(paged.page + 1)}
                className="btn btn-ghost"
              >
                Next
                <ArrowRight size={13} />
              </button>
            </div>
          </div>
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

/**
 * Every picture of a HUD in one place: hud-db's own screenshots first, then
 * the author's album (Imgur or a GitHub showcase page) fetched in-app, so
 * nobody has to leave to see what they are choosing.
 */
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
      ? "Loading the author's album…"
      : albumFailed
        ? "The author's album could not be loaded in-app."
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
            {albumUrl && !albumFailed && album === null
              ? "Loading pictures…"
              : "No pictures for this HUD yet."}
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
