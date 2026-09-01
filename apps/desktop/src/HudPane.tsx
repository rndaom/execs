import { ArrowLeft, ArrowRight, ArrowSquareOut, Images, X } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "./components/ui/Alert";
import { Disclosure } from "./components/ui/Disclosure";
import { Modal } from "./components/ui/Modal";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Switch } from "./components/ui/Switch";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { useSeededDraft } from "./hooks/useSeededDraft";
import {
  type HudCatalogEntry,
  type HudSchemaView,
  type HudUiState,
  openExternal,
} from "./lib/bridge";
import { hexToRgb, rgbToHex } from "./lib/color";
import {
  canInstallHud,
  filterHudCatalog,
  formatHudRgba,
  hudOptionsDirty,
  installedHudLabel,
  isHudCheckboxOn,
  paginateHudCatalog,
  parseHudRgba,
  seedHudOptions,
  stepHudScreenshot,
} from "./lib/hud-ui";

type HudViewer = { entry: HudCatalogEntry; index: number };

/** A 0–255 HUD alpha as the percentage people actually think in. */
function alphaPercent(alpha: number): number {
  return Math.round((alpha / 255) * 100);
}

/** Switching HUDs is a different record — that draft must not carry over. */
function installedKeyOf(state: HudUiState): string {
  return state.installed?.id ?? "";
}

export function HudPane({
  catalogLoading,
  catalogError,
  catalog,
  state,
  schema,
  onRefresh,
  onInstall,
  onUpdate,
  onMatch,
  onApplyOptions,
}: {
  catalogLoading: boolean;
  catalogError: string | null;
  catalog: HudCatalogEntry[];
  state: HudUiState;
  schema: HudSchemaView | null;
  onRefresh: () => void;
  onInstall: (id: string) => void;
  onUpdate: () => void;
  onMatch: (id: string) => void;
  onApplyOptions: (options: Record<string, string>) => void;
}) {
  const { running, busy } = useAppStatus();
  const locked = !useCanWrite();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [viewer, setViewer] = useState<HudViewer | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const seeded = useMemo(() => seedHudOptions(schema, state.installed), [schema, state.installed]);
  const [draft, setDraft] = useSeededDraft(
    seeded,
    (value) => JSON.stringify(value),
    installedKeyOf(state),
  );
  const filtered = filterHudCatalog(catalog, query);
  const paged = paginateHudCatalog(filtered, page);
  const dirty = hudOptionsDirty(draft, seeded);
  const installedId = state.installed?.id ?? null;
  const installedLabel = installedHudLabel(state);
  // The active HUD's own art, when hud-db knows the entry — the hero shows
  // what you installed, not just its name.
  const installedEntry = installedId
    ? (catalog.find((entry) => entry.id.toLowerCase() === installedId.toLowerCase()) ?? null)
    : null;

  // Escape and focus are the Modal's job; only the arrow-key paging is ours.
  useEffect(() => {
    if (!viewer) {
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (!viewer) {
        return;
      }
      if (event.key === "ArrowRight") {
        setViewer({
          entry: viewer.entry,
          index: stepHudScreenshot(viewer.index, 1, viewer.entry.screenshots.length),
        });
      } else if (event.key === "ArrowLeft") {
        setViewer({
          entry: viewer.entry,
          index: stepHudScreenshot(viewer.index, -1, viewer.entry.screenshots.length),
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer]);

  function goToPage(next: number) {
    setPage(next);
    listRef.current?.scrollTo({ top: 0 });
  }

  return (
    <section data-testid="settings-hud" className="flex min-h-0 min-w-0 flex-col text-left">
      <PaneHeader
        title="HUD"
        lede="One HUD is mounted per profile. Layout, scheme and animations generally survive Valve Casual; custom materials usually do not."
        actions={<span className="tnum t-meta text-ink-faint">{catalog.length} in catalog</span>}
      />

      {installedId ? (
        <section data-testid="hud-installed">
          <div className="hero-row">
            <div className="min-w-0">
              <p className="eyebrow">Active HUD</p>
              <h2 className="t-pane mt-2 text-[22px]">{installedId}</h2>
              <p className="t-meta mt-1">{installedLabel}</p>
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
              </div>
            </div>

            {installedEntry?.banner ? (
              <figure className="surface hero-preview m-0 self-start">
                <img
                  src={installedEntry.banner}
                  alt={`${installedEntry.name} HUD preview`}
                  className="aspect-video w-full object-cover"
                />
              </figure>
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
                                className="min-w-0 accent-brand disabled:opacity-50"
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
          <p className="t-meta mt-1">Install a HUD below to add it to this profile.</p>
        </div>
      )}

      <section className="section">
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

        {catalogLoading ? (
          <p
            data-testid="hud-catalog-loading"
            role="status"
            aria-live="polite"
            className="t-meta mt-4 rounded-lg border border-edge bg-panel px-4 py-2"
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

        <div
          ref={listRef}
          data-testid="hud-catalog"
          aria-busy={catalogLoading}
          className="mt-4 max-h-[34rem] overflow-y-auto"
        >
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
            /* Hairline rows, not per-row boxes: the de-carded rule the
               crosshair and viewmodel lists already follow. The banner keeps
               its own frame — that one is real media. */
            <div>
              {paged.items.map((entry) => {
                const current = installedId?.toLowerCase() === entry.id.toLowerCase();
                const installable = canInstallHud(entry);
                const shots = entry.screenshots.length;
                return (
                  <article
                    key={entry.id}
                    data-testid={`hud-card-${entry.id}`}
                    data-github={entry.github ? "true" : "false"}
                    className="flex flex-wrap items-start gap-x-4 gap-y-3 border-b border-edge py-3.5"
                  >
                    {entry.banner ? (
                      <button
                        type="button"
                        title={shots > 0 ? `View ${entry.name} screenshots` : undefined}
                        disabled={shots === 0}
                        onClick={() => setViewer({ entry, index: 0 })}
                        className="surface w-28 shrink-0 cursor-zoom-in disabled:cursor-default"
                      >
                        <img
                          src={entry.banner}
                          alt={`${entry.name} HUD preview`}
                          loading="lazy"
                          className="h-16 w-full object-cover"
                        />
                      </button>
                    ) : null}
                    <div className="min-w-48 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <p className="t-row">{entry.name}</p>
                        <p className="truncate text-[12.5px] text-ink-faint">by {entry.author}</p>
                        {current ? <span className="badge badge-ok">Active</span> : null}
                      </div>
                      {entry.flags.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {entry.flags.map((flag) => (
                            <span
                              key={flag}
                              className="rounded-pill border border-edge px-2 py-0.5 text-[11.5px] text-ink-faint"
                            >
                              {flag}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {!installable ? (
                        <p className="t-meta mt-1.5">
                          External install only. Open the author’s page for instructions.
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid={`hud-install-${entry.id}`}
                        disabled={locked || !installable || current}
                        onClick={() => onInstall(entry.id)}
                        className="btn btn-primary"
                      >
                        {/* Honest label: this row cannot be installed from
                            here, so "Install" was never the action on offer. */}
                        {current
                          ? "Installed"
                          : !installable
                            ? "External only"
                            : running
                              ? "Close TF2 to install"
                              : "Install"}
                      </button>
                      {shots > 0 ? (
                        <button
                          type="button"
                          data-testid={`hud-screenshots-${entry.id}`}
                          onClick={() => setViewer({ entry, index: 0 })}
                          className="btn btn-ghost"
                        >
                          <Images size={13} />
                          Screenshots ({shots})
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void openExternal(entry.comfigUrl)}
                        className="btn btn-ghost"
                      >
                        comfig.app
                        <ArrowSquareOut size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void openExternal(entry.tf2hudsUrl)}
                        className="btn btn-ghost"
                      >
                        tf2huds.dev
                        <ArrowSquareOut size={11} />
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
          viewer={viewer}
          onStep={(delta) =>
            setViewer({
              entry: viewer.entry,
              index: stepHudScreenshot(viewer.index, delta, viewer.entry.screenshots.length),
            })
          }
          onPick={(index) => setViewer({ entry: viewer.entry, index })}
          onClose={() => setViewer(null)}
        />
      ) : null}
    </section>
  );
}

function HudLightbox({
  viewer,
  onStep,
  onPick,
  onClose,
}: {
  viewer: HudViewer;
  onStep: (delta: number) => void;
  onPick: (index: number) => void;
  onClose: () => void;
}) {
  const { entry, index } = viewer;
  const count = entry.screenshots.length;
  const src = entry.screenshots[index];
  return (
    <Modal
      open
      testId="hud-lightbox"
      title={entry.name}
      description={`by ${entry.author} · ${index + 1} of ${count}`}
      className="fixed inset-4 z-50 flex flex-col sm:inset-8"
      onClose={onClose}
    >
      <div className="absolute top-3 right-3">
        <div className="flex items-center gap-2">
          {entry.album ? (
            <button
              type="button"
              onClick={() => void openExternal(entry.album as string)}
              className="btn btn-ghost"
            >
              Full album
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
            onClick={() => onStep(-1)}
            className="btn btn-ghost absolute left-0 z-10 p-2.5"
          >
            <ArrowLeft size={18} />
          </button>
        ) : null}
        <img
          key={src}
          data-testid="hud-lightbox-image"
          src={src}
          alt={`${entry.name} screenshot ${index + 1}`}
          className="max-h-full min-h-0 max-w-full rounded-lg border border-edge object-contain"
        />
        {count > 1 ? (
          <button
            type="button"
            aria-label="Next screenshot"
            onClick={() => onStep(1)}
            className="btn btn-ghost absolute right-0 z-10 p-2.5"
          >
            <ArrowRight size={18} />
          </button>
        ) : null}
      </div>

      {count > 1 ? (
        <div className="mt-3 flex justify-center gap-2 overflow-x-auto pb-1">
          {entry.screenshots.map((shot, shotIndex) => (
            <button
              key={shot}
              type="button"
              aria-label={`Screenshot ${shotIndex + 1}`}
              aria-current={shotIndex === index}
              onClick={() => onPick(shotIndex)}
              className={`shrink-0 overflow-hidden rounded-md border transition-colors ${
                shotIndex === index ? "border-brand" : "border-edge hover:border-edge-strong"
              }`}
            >
              <img src={shot} alt="" loading="lazy" className="h-12 w-20 object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
