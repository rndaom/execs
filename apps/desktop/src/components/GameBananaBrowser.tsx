import { ArrowClockwise, MagnifyingGlass, Package, SlidersHorizontal } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGameBananaBrowser } from "../hooks/useGameBananaBrowser";
import type { Api } from "../lib/api";
import type { GameBananaDownloadVariant, GameBananaMod, ModRecord } from "../lib/bridge";
import { openExternal } from "../lib/bridge";
import {
  GAMEBANANA_SORTS,
  gameBananaMetaLine,
  gameBananaPager,
  gameBananaPageScopeNote,
  gameBananaTotalLabel,
} from "../lib/gamebanana-browser-ui";
import {
  foldCategories,
  formatModBytes,
  isGameBananaInstalled,
  type ModInstallResult,
  modMetaLine,
} from "../lib/mods-ui";
import { GameBananaCard, type GameBananaInstallState } from "./GameBananaCard";
import { GameBananaPagination } from "./GameBananaPagination";
import { Alert } from "./ui/Alert";
import { Modal } from "./ui/Modal";
import { Segmented } from "./ui/Segmented";
import { Switch } from "./ui/Switch";

const ALL = "all";
const MORE = "more";

/** Search and install GameBanana listings without coupling presentation to request state. */
export function GameBananaBrowser({
  api,
  active,
  installed,
  locked,
  running,
  previewData = false,
  onInstall,
  onOpenHud,
  onManualImport,
  onManageInstalled,
}: {
  api: Api;
  /** The Browse task and the parent Mods pane are both visible. */
  active: boolean;
  /** The profile's own packs, so a listing can read as already installed. */
  installed: ModRecord[];
  locked: boolean;
  running: boolean;
  previewData?: boolean;
  /** Resolves after both the install and profile reload complete. */
  onInstall: (id: number, fileId: number) => Promise<ModInstallResult>;
  onOpenHud?: () => void;
  onManualImport?: () => void;
  onManageInstalled?: () => void;
}) {
  const browser = useGameBananaBrowser({ api, active });
  const [moreOpen, setMoreOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [install, setInstall] = useState<{
    id: number;
    state: GameBananaInstallState;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [chooser, setChooser] = useState<{
    mod: GameBananaMod;
    variants: GameBananaDownloadVariant[];
    selectedId: number | null;
  } | null>(null);
  const choiceToken = useRef(0);
  const focusAfterPage = useRef(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  function goToPage(next: number) {
    focusAfterPage.current = true;
    browser.goToPage(next);
  }

  async function prepareInstall(mod: GameBananaMod) {
    const token = ++choiceToken.current;
    setInstall({ id: mod.id, state: "loading" });
    setAnnouncement(`Loading files for ${mod.name}.`);
    try {
      const variants = await api.gameBananaDownloadVariants(mod.id);
      if (token !== choiceToken.current) return;
      setChooser({ mod, variants, selectedId: null });
      setInstall(null);
      setAnnouncement(`Choose a file for ${mod.name}.`);
    } catch {
      if (token !== choiceToken.current) return;
      setInstall({ id: mod.id, state: "failed" });
      setAnnouncement(`Could not load files for ${mod.name}. Retry is available on its card.`);
    }
  }

  async function installMod(id: number, name: string, fileId: number) {
    setChooser(null);
    setInstall({ id, state: "installing" });
    setAnnouncement(`Installing ${name}.`);
    let result: ModInstallResult = false;
    try {
      result = await onInstall(id, fileId);
    } catch {
      result = false;
    }
    if (result === "review-required" || result === "superseded") {
      setInstall(null);
      setAnnouncement(result === "review-required" ? `Review HUDs before installing ${name}.` : "");
    } else if (result) {
      setInstall(null);
      setAnnouncement(`${name} installed.`);
    } else {
      setInstall({ id, state: "failed" });
      setAnnouncement(`${name} could not be installed. Retry is available on its card.`);
    }
  }

  useEffect(() => {
    if (active) return;
    choiceToken.current += 1;
    setChooser(null);
    setInstall(null);
  }, [active]);

  // Only paging moves focus. Search, sort, category and mature filters leave the
  // user's current control alone so typing is never interrupted.
  useEffect(() => {
    if (!focusAfterPage.current || browser.loading || !browser.page) return;
    focusAfterPage.current = false;
    resultsRef.current?.focus();
    resultsRef.current?.scrollIntoView?.({ block: "start" });
  }, [browser.loading, browser.page]);

  const shown = browser.page?.records ?? [];
  const pager = gameBananaPager(
    browser.pageNumber,
    browser.page?.total ?? { kind: "unknown" },
    browser.page?.perPage ?? 0,
    browser.page?.complete ?? true,
  );
  const totalLabel = browser.page ? gameBananaTotalLabel(browser.page.total) : null;
  const scopeNote = browser.page ? gameBananaPageScopeNote(browser.page) : null;
  const categories = browser.categories.records;
  const { shown: pillCategories, hidden } = useMemo(() => foldCategories(categories), [categories]);
  const inHidden =
    browser.category !== null && hidden.some((entry) => entry.id === browser.category);
  const primary =
    moreOpen || inHidden ? MORE : browser.category === null ? ALL : String(browser.category);
  const categoryOptions = [
    { id: ALL, label: "All" },
    ...pillCategories.map((entry) => ({ id: String(entry.id), label: entry.name })),
    ...(hidden.length > 0 ? [{ id: MORE, label: "More" }] : []),
  ];
  const showPager = browser.page !== null && (pager.hasPrevious || pager.hasNext);

  return (
    <div data-testid="mods-gamebanana">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative block min-w-48 flex-1">
          <span className="sr-only">Search GameBanana</span>
          <MagnifyingGlass
            size={16}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            data-testid="mods-gb-search"
            value={browser.query}
            onChange={(event) => browser.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                browser.submitSearch();
              }
            }}
            placeholder="Search GameBanana…"
            className="field w-full py-2 pr-3 pl-9 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
        {categories.length > 0 ? (
          <Segmented
            label="Category"
            size="sm"
            testIdPrefix="mods-gb-category"
            options={categoryOptions}
            value={primary}
            onChange={(next) => {
              if (next === MORE) {
                setMoreOpen(true);
                return;
              }
              setMoreOpen(false);
              browser.setCategory(next === ALL ? null : Number(next));
            }}
          />
        ) : null}
        <div
          className="flex flex-wrap items-center gap-2"
          title="Popular, Likes and Views use all-time totals"
        >
          <Segmented
            label="Sort mods"
            size="sm"
            testIdPrefix="mods-gb-sort"
            options={GAMEBANANA_SORTS}
            value={browser.sort}
            onChange={browser.setSort}
          />
        </div>
        <button
          type="button"
          data-testid="mods-gb-filters-toggle"
          className={`btn btn-ghost px-2.5 ${filtersOpen || browser.includeMature ? "ring-1 ring-brand" : ""}`}
          aria-label={
            browser.includeMature ? "Content filters; mature content included" : "Content filters"
          }
          aria-expanded={filtersOpen}
          aria-controls="mods-gb-content-filters"
          title="Content filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={16} />
        </button>
        <button
          type="button"
          data-testid="mods-gb-refresh"
          className="btn btn-ghost px-2.5"
          aria-label="Refresh GameBanana results"
          title="Refresh results"
          disabled={browser.loading}
          onClick={browser.refresh}
        >
          <ArrowClockwise size={16} />
        </button>
      </div>

      {filtersOpen ? (
        <div id="mods-gb-content-filters" className="mt-3 border-y border-edge py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2">
              <span className="t-meta">Mature content</span>
              <Switch
                checked={browser.includeMature}
                label="Show mature content"
                testId="mods-gb-mature"
                onChange={browser.setIncludeMature}
              />
            </span>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setMoreOpen(false);
                browser.reset();
              }}
            >
              Reset filters
            </button>
          </div>
        </div>
      ) : null}
      {primary === MORE ? (
        <div className="mt-3">
          <Segmented
            label="More categories"
            size="sm"
            testIdPrefix="mods-gb-more"
            options={hidden.map((entry) => ({ id: String(entry.id), label: entry.name }))}
            value={inHidden ? String(browser.category) : ""}
            onChange={(next) => browser.setCategory(Number(next))}
          />
        </div>
      ) : null}
      {["downloads", "likes", "views"].includes(browser.sort) ? (
        <p className="t-meta mt-2">
          Ordered by GameBanana’s all-time{" "}
          {browser.sort === "downloads" ? "downloads" : browser.sort}.
        </p>
      ) : null}

      {browser.categories.status === "error" ? (
        <Alert tone="warn" testId="mods-gb-categories-error" className="mt-4 py-2">
          Categories are unavailable. {browser.categories.message}{" "}
          <button type="button" className="underline" onClick={browser.retryCategories}>
            Retry categories
          </button>
        </Alert>
      ) : null}

      {browser.error ? (
        <Alert tone="error" testId="mods-gb-error" className="mt-4 py-2">
          {browser.error}{" "}
          <button type="button" className="underline" onClick={browser.retry}>
            Retry
          </button>
        </Alert>
      ) : null}

      {browser.loading ? (
        <p data-testid="mods-gb-loading" role="status" aria-live="polite" className="t-meta mt-4">
          {browser.stale ? "Refreshing… showing saved results." : "Searching…"}
        </p>
      ) : null}

      {browser.page ? (
        <div
          ref={resultsRef}
          tabIndex={-1}
          data-testid="mods-gb-results-heading"
          className="mt-4 scroll-mt-4 border-t border-edge pt-3 outline-none"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="t-row">GameBanana results</h3>
              <span className="t-meta tnum">{pager.label}</span>
              {totalLabel ? <span className="t-meta tnum">· {totalLabel}</span> : null}
              {previewData ? <span className="badge">Preview data</span> : null}
            </div>
            {showPager ? (
              <GameBananaPagination
                compact
                position="top"
                page={browser.pageNumber}
                pager={pager}
                loading={browser.loading}
                onPage={goToPage}
              />
            ) : null}
          </div>
          {scopeNote ? (
            <details className="t-meta mt-2">
              <summary className="w-fit cursor-pointer text-ink-muted">About these results</summary>
              <p className="mt-1 max-w-[76ch]">{scopeNote}</p>
            </details>
          ) : null}
        </div>
      ) : null}

      {!browser.loading && shown.length === 0 && !browser.error ? (
        <div className="mt-4 border-y border-edge py-8">
          <h3 className="t-row">No matching mods</h3>
          <p className="t-meta mt-2">
            {browser.page && browser.page.total.kind !== "exact"
              ? "Nothing to show on this page. Try the next page or clear a filter."
              : browser.page?.total.kind === "exact" && browser.page.total.value > 0
                ? "Nothing to show on this page."
                : "No mods match that search."}
          </p>
          <button
            type="button"
            className="btn btn-ghost mt-4"
            onClick={() => {
              setMoreOpen(false);
              browser.reset();
            }}
          >
            Clear search and filters
          </button>
        </div>
      ) : null}

      {shown.length > 0 ? (
        <div
          className={
            onManageInstalled
              ? "mt-3 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_12rem]"
              : "mt-3"
          }
        >
          <div
            data-testid="mods-gb-grid"
            aria-busy={browser.loading}
            className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {shown.map((mod) => (
              <GameBananaCard
                key={mod.id}
                mod={mod}
                meta={gameBananaMetaLine(mod, browser.sort)}
                installed={isGameBananaInstalled(installed, mod.id)}
                locked={locked || install?.state === "installing"}
                running={running}
                installState={install?.id === mod.id ? install.state : "idle"}
                onView={() => void openExternal(mod.url)}
                onInstall={() => void prepareInstall(mod)}
                onRoute={() => {
                  if (mod.route === "hud") onOpenHud?.();
                  else onManualImport?.();
                }}
              />
            ))}
          </div>
          {onManageInstalled ? (
            <aside
              className="surface hidden min-w-0 p-3 xl:block"
              aria-label="Custom packs summary"
            >
              <div className="flex items-center justify-between gap-2 border-b border-edge pb-3">
                <h3 className="t-row">
                  Custom packs <span className="t-meta tnum ml-1">{installed.length}</span>
                </h3>
                <button type="button" className="btn btn-quiet px-2" onClick={onManageInstalled}>
                  Manage
                </button>
              </div>
              {installed.length > 0 ? (
                <ul className="m-0 list-none p-0">
                  {installed.slice(0, 3).map((mod) => (
                    <li
                      key={mod.id}
                      className="flex items-start gap-2 border-b border-edge py-3 last:border-b-0"
                    >
                      <Package size={18} className="mt-0.5 shrink-0 text-ink-muted" />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium leading-5 text-ink">
                          {mod.name}
                        </span>
                        <span className="t-meta mt-1 block">{modMetaLine(mod)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="t-meta py-3">Your installed mods will appear here.</p>
              )}
              {installed.length > 3 ? (
                <button
                  type="button"
                  className="btn btn-quiet mt-2 w-full"
                  onClick={onManageInstalled}
                >
                  View all {installed.length} mods
                </button>
              ) : null}
            </aside>
          ) : null}
        </div>
      ) : null}

      {showPager ? (
        <GameBananaPagination
          position="bottom"
          page={browser.pageNumber}
          pager={pager}
          loading={browser.loading}
          onPage={goToPage}
        />
      ) : null}

      {chooser ? (
        <Modal
          open
          title={`Choose a file for ${chooser.mod.name}`}
          description="GameBanana authors may offer separate versions or optional addons. Choose the intended VPK, ZIP, or 7z before downloading."
          testId="mods-gb-file-choice"
          onClose={() => setChooser(null)}
        >
          <div className="max-h-[55vh] space-y-2 overflow-y-auto py-4">
            {chooser.variants.map((variant) => (
              <label
                key={variant.id}
                className="flex cursor-pointer items-start gap-3 rounded border border-edge p-3"
              >
                <input
                  type="radio"
                  name="gamebanana-file"
                  value={variant.id}
                  checked={chooser.selectedId === variant.id}
                  disabled={!variant.supported}
                  onChange={() =>
                    setChooser((current) =>
                      current ? { ...current, selectedId: variant.id } : current,
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block break-all text-sm text-ink">{variant.fileName}</span>
                  {variant.description ? (
                    <span className="t-meta mt-1 block whitespace-pre-wrap break-words">
                      {variant.description}
                    </span>
                  ) : null}
                  <span className="t-meta mt-1 block">
                    {variant.sizeBytes === null
                      ? "Size unknown"
                      : formatModBytes(variant.sizeBytes)}
                    {!variant.supported ? " · Not supported for Mods" : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-edge pt-3">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void openExternal(chooser.mod.url)}
            >
              Author’s page
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setChooser(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="mods-gb-install-selected"
              disabled={chooser.selectedId === null || locked}
              onClick={() => {
                if (chooser.selectedId !== null) {
                  void installMod(chooser.mod.id, chooser.mod.name, chooser.selectedId);
                }
              }}
            >
              Download and install
            </button>
          </div>
        </Modal>
      ) : null}

      <p className="t-meta mt-6 text-ink-faint">
        Listings and files from{" "}
        <button
          type="button"
          className="text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
          onClick={() => void openExternal("https://gamebanana.com/games/297")}
        >
          GameBanana
        </button>
        . Every mod belongs to its author.
      </p>
    </div>
  );
}
