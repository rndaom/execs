import { ArrowLeft, ArrowRight, MagnifyingGlass } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { GameBananaCategory, GameBananaPage, GameBananaSort, ModRecord } from "../lib/bridge";
import { openExternal } from "../lib/bridge";
import {
  foldCategories,
  GAMEBANANA_SEARCH_DEBOUNCE_MS,
  GAMEBANANA_SORTS,
  gameBananaMetaLine,
  gameBananaPageKey,
  gameBananaPager,
  isGameBananaInstalled,
  readMaturePreference,
  sortGameBananaMods,
  writeMaturePreference,
} from "../lib/mods-ui";
import { Alert } from "./ui/Alert";
import { Segmented } from "./ui/Segmented";
import { Switch } from "./ui/Switch";

const ALL = "all";
const MORE = "more";

/**
 * Search GameBanana and install a listing straight into the active profile.
 *
 * Everything is loaded lazily: nothing is fetched until `active` says the
 * section has been unfolded, because `<details>` keeps its children mounted.
 */
export function GameBananaBrowser({
  api,
  active,
  installed,
  locked,
  running,
  onInstall,
}: {
  api: Api;
  /** The disclosure is open — only then does this talk to the network. */
  active: boolean;
  /** The profile's own packs, so a listing can read as already installed. */
  installed: ModRecord[];
  locked: boolean;
  running: boolean;
  /** Resolves once the install (and the profile reload behind it) finished. */
  onInstall: (id: number) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [sort, setSort] = useState<GameBananaSort>("downloads");
  const [category, setCategory] = useState<number | null>(null);
  const [mature, setMature] = useState(readMaturePreference);
  const [moreOpen, setMoreOpen] = useState(false);
  const [categories, setCategories] = useState<GameBananaCategory[]>([]);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<GameBananaPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<number | null>(null);
  // A slow response must never land on top of a newer search.
  const request = useRef(0);
  const categoriesLoaded = useRef(false);
  // Pages already fetched, so paging back is instant and costs no request.
  const cache = useRef(new Map<string, GameBananaPage>());

  useEffect(() => {
    if (!active || categoriesLoaded.current) {
      return;
    }
    categoriesLoaded.current = true;
    let cancelled = false;
    api
      .gameBananaModCategories()
      .then((next) => {
        if (!cancelled) {
          setCategories(next);
        }
      })
      .catch(() => {
        // Categories are a filter, not the content: the grid still works.
        categoriesLoaded.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [api, active]);

  /** A new search always starts at the first page. */
  function search(next: string) {
    setTerm(next);
    setPage(1);
  }

  // Typing settles into a search on its own; Enter skips the wait.
  useEffect(() => {
    if (query === term) {
      return;
    }
    const timer = window.setTimeout(() => {
      setTerm(query);
      setPage(1);
    }, GAMEBANANA_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, term]);

  const key = gameBananaPageKey(term, sort, category, page, mature);
  useEffect(() => {
    if (!active) {
      return;
    }
    const cached = cache.current.get(key);
    if (cached) {
      request.current += 1;
      setLoaded(cached);
      setLoading(false);
      setError(null);
      return;
    }
    const token = ++request.current;
    setLoading(true);
    setError(null);
    api
      .searchGameBananaMods(term, sort, category, page, mature)
      .then((result) => {
        cache.current.set(key, result);
        if (token !== request.current) {
          return;
        }
        setLoaded(result);
      })
      .catch((err) => {
        if (token !== request.current) {
          return;
        }
        setLoaded(null);
        setError(err instanceof Error ? err.message : "Check your connection and try again.");
      })
      .finally(() => {
        if (token === request.current) {
          setLoading(false);
        }
      });
  }, [api, active, key, term, sort, category, page, mature]);

  /** The choice outlives the session; a new filter starts at the first page. */
  function toggleMature(next: boolean) {
    setMature(next);
    setPage(1);
    writeMaturePreference(next);
  }

  function goToPage(next: number) {
    setPage(next);
    document.getElementById("mods-gamebanana-heading")?.scrollIntoView({ block: "start" });
  }

  async function install(id: number) {
    setInstalling(id);
    try {
      await onInstall(id);
    } finally {
      setInstalling(null);
    }
  }

  const records = loaded?.records ?? [];
  const shown = useMemo(() => sortGameBananaMods(records, sort), [records, sort]);
  const pager = gameBananaPager(
    page,
    loaded?.total ?? 0,
    loaded?.perPage ?? 0,
    loaded?.complete ?? true,
  );
  const { shown: pillCategories, hidden } = useMemo(() => foldCategories(categories), [categories]);
  const inHidden = category !== null && hidden.some((entry) => entry.id === category);
  const primary = moreOpen || inHidden ? MORE : category === null ? ALL : String(category);
  const categoryOptions = [
    { id: ALL, label: "All" },
    ...pillCategories.map((entry) => ({ id: String(entry.id), label: entry.name })),
    ...(hidden.length > 0 ? [{ id: MORE, label: "More" }] : []),
  ];

  return (
    <div data-testid="mods-gamebanana">
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="relative block min-w-56 flex-1">
          <span className="sr-only">Search GameBanana</span>
          <MagnifyingGlass
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-faint"
          />
          <input
            type="search"
            data-testid="mods-gb-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                search(query);
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
          value={sort}
          onChange={(next) => {
            setSort(next);
            setPage(1);
          }}
        />
        <span className="flex items-center gap-2">
          <span className="t-meta">Show mature content</span>
          <Switch
            checked={mature}
            label="Show mature content"
            testId="mods-gb-mature"
            onChange={toggleMature}
          />
        </span>
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
              setCategory(next === ALL ? null : Number(next));
              setPage(1);
            }}
          />
          {/* "More" reveals the rest as pills — never a dropdown. */}
          {primary === MORE ? (
            <Segmented
              label="More categories"
              size="sm"
              testIdPrefix="mods-gb-more"
              options={hidden.map((entry) => ({ id: String(entry.id), label: entry.name }))}
              value={inHidden ? String(category) : ""}
              onChange={(next) => {
                setCategory(Number(next));
                setPage(1);
              }}
            />
          ) : null}
        </div>
      ) : null}

      {error ? (
        <Alert tone="error" testId="mods-gb-error" className="mt-4 py-2">
          {error}
        </Alert>
      ) : null}

      {loading ? (
        <p data-testid="mods-gb-loading" role="status" aria-live="polite" className="t-meta mt-4">
          Searching…
        </p>
      ) : null}

      {!loading && shown.length === 0 && !error ? (
        <p className="t-meta mt-4">
          {/* Mature listings are dropped from the page, so a whole page can
              come back empty while the run carries on. */}
          {loaded && loaded.total > 0
            ? "Nothing to show on this page."
            : "No mods match that search."}
        </p>
      ) : null}

      {shown.length > 0 ? (
        <>
          {loaded && loaded.total > 0 ? (
            <p className="t-meta tnum mt-3">{loaded.total} found</p>
          ) : null}
          <div
            data-testid="mods-gb-grid"
            aria-busy={loading}
            className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {shown.map((mod) => {
              const already = isGameBananaInstalled(installed, mod.id);
              const busyHere = installing === mod.id;
              return (
                <article
                  key={mod.id}
                  data-testid={`mods-gb-card-${mod.id}`}
                  className="thumb items-stretch gap-2 text-left"
                >
                  {mod.thumb ? (
                    <img
                      src={mod.thumb}
                      alt=""
                      loading="lazy"
                      className="aspect-video w-full rounded-md bg-bg object-cover"
                    />
                  ) : (
                    <span className="grid aspect-video w-full place-items-center rounded-md bg-bg text-[11px] text-ink-faint">
                      No picture
                    </span>
                  )}
                  <span className="t-row block truncate" title={mod.name}>
                    {mod.name}
                  </span>
                  <button
                    type="button"
                    className="t-meta truncate text-left underline decoration-edge-strong underline-offset-2 hover:text-ink"
                    title={`${mod.name} on GameBanana`}
                    onClick={() => void openExternal(mod.url)}
                  >
                    by {mod.author}
                  </button>
                  <span className="t-meta block">
                    {mod.mature ? <span className="badge mr-1.5 align-middle">Mature</span> : null}
                    {gameBananaMetaLine(mod)}
                  </span>
                  <button
                    type="button"
                    data-testid={`mods-gb-install-${mod.id}`}
                    disabled={already || busyHere || locked}
                    onClick={() => void install(mod.id)}
                    className={`btn mt-1 ${already ? "btn-ghost" : "btn-primary"}`}
                  >
                    {already
                      ? "Installed"
                      : busyHere
                        ? "Installing…"
                        : running
                          ? "Close TF2 to install"
                          : "Install"}
                  </button>
                </article>
              );
            })}
          </div>
        </>
      ) : null}

      {loaded && (pager.hasPrevious || pager.hasNext) ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-edge pt-4">
          <p data-testid="mods-gb-page-label" className="t-meta tnum">
            {pager.label}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="mods-gb-page-prev"
              className="btn btn-ghost"
              disabled={loading || !pager.hasPrevious}
              onClick={() => goToPage(page - 1)}
            >
              <ArrowLeft size={13} />
              Previous
            </button>
            <button
              type="button"
              data-testid="mods-gb-page-next"
              className="btn btn-ghost"
              disabled={loading || !pager.hasNext}
              onClick={() => goToPage(page + 1)}
            >
              Next
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
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
