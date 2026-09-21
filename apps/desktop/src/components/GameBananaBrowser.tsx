import { MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGameBananaBrowser } from "../hooks/useGameBananaBrowser";
import type { Api } from "../lib/api";
import type { ModRecord } from "../lib/bridge";
import { openExternal } from "../lib/bridge";
import {
  GAMEBANANA_SORTS,
  gameBananaMetaLine,
  gameBananaPager,
  gameBananaPageScopeNote,
  gameBananaTotalLabel,
} from "../lib/gamebanana-browser-ui";
import { foldCategories, isGameBananaInstalled } from "../lib/mods-ui";
import { GameBananaCard, type GameBananaInstallState } from "./GameBananaCard";
import { GameBananaPagination } from "./GameBananaPagination";
import { Alert } from "./ui/Alert";
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
  onInstall: (id: number) => Promise<boolean>;
}) {
  const browser = useGameBananaBrowser({ api, active });
  const [moreOpen, setMoreOpen] = useState(false);
  const [install, setInstall] = useState<{
    id: number;
    state: GameBananaInstallState;
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const focusAfterPage = useRef(false);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  function goToPage(next: number) {
    focusAfterPage.current = true;
    browser.goToPage(next);
  }

  async function installMod(id: number, name: string) {
    setInstall({ id, state: "installing" });
    setAnnouncement(`Installing ${name}.`);
    let installedSuccessfully = false;
    try {
      installedSuccessfully = await onInstall(id);
    } catch {
      installedSuccessfully = false;
    }
    if (installedSuccessfully) {
      setInstall(null);
      setAnnouncement(`${name} installed.`);
    } else {
      setInstall({ id, state: "failed" });
      setAnnouncement(`${name} could not be installed. Retry is available on its card.`);
    }
  }

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
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="relative block min-w-56 flex-1">
          <span className="sr-only">Search GameBanana</span>
          <MagnifyingGlass
            size={14}
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
            placeholder="Search by name…"
            className="field w-full py-2 pr-3 pl-8 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
        <Segmented
          label="Sort mods"
          size="sm"
          testIdPrefix="mods-gb-sort"
          options={GAMEBANANA_SORTS}
          value={browser.sort}
          onChange={browser.setSort}
        />
        <span className="flex items-center gap-2">
          <span className="t-meta">Show mature content</span>
          <Switch
            checked={browser.includeMature}
            label="Show mature content"
            testId="mods-gb-mature"
            onChange={browser.setIncludeMature}
          />
        </span>
        <button type="button" className="btn btn-ghost" onClick={browser.reset}>
          Reset
        </button>
        <button
          type="button"
          data-testid="mods-gb-refresh"
          className="btn btn-ghost"
          disabled={browser.loading}
          onClick={browser.refresh}
        >
          {browser.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {categories.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
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
          {primary === MORE ? (
            <Segmented
              label="More categories"
              size="sm"
              testIdPrefix="mods-gb-more"
              options={hidden.map((entry) => ({ id: String(entry.id), label: entry.name }))}
              value={inHidden ? String(browser.category) : ""}
              onChange={(next) => browser.setCategory(Number(next))}
            />
          ) : null}
        </div>
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
          className="mt-4 scroll-mt-4 outline-none"
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="t-row">GameBanana results</h3>
            <span className="t-meta tnum">{pager.label}</span>
            {totalLabel ? <span className="t-meta tnum">· {totalLabel}</span> : null}
            {previewData ? <span className="badge">Preview data</span> : null}
          </div>
          {scopeNote ? <p className="t-meta mt-1">{scopeNote}</p> : null}
        </div>
      ) : null}

      {showPager ? (
        <GameBananaPagination
          position="top"
          page={browser.pageNumber}
          pager={pager}
          loading={browser.loading}
          onPage={goToPage}
        />
      ) : null}

      {!browser.loading && shown.length === 0 && !browser.error ? (
        <p className="t-meta mt-4">
          {browser.page && browser.page.total.kind !== "exact"
            ? "Nothing to show on this page. Try the next page or clear a filter."
            : browser.page?.total.kind === "exact" && browser.page.total.value > 0
              ? "Nothing to show on this page."
              : "No mods match that search."}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <div
          data-testid="mods-gb-grid"
          aria-busy={browser.loading}
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
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
              onInstall={() => void installMod(mod.id, mod.name)}
            />
          ))}
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
