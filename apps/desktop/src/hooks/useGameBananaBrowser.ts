import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { GameBananaCategory, GameBananaPage, GameBananaSort } from "../lib/bridge";
import {
  GAMEBANANA_DEFAULT_SORT,
  GAMEBANANA_SEARCH_DEBOUNCE_MS,
  type GameBananaPageCache,
  type GameBananaPageSnapshot,
  type GameBananaRequest,
  gameBananaQueryError,
  gameBananaRequestKey,
  normalizeGameBananaQuery,
  readGameBananaPageCache,
  writeGameBananaPageCache,
} from "../lib/gamebanana-browser-ui";
import { readMaturePreference, writeMaturePreference } from "../lib/mods-ui";

type RequestIdentity = GameBananaRequest & { key: string };

type PageResource =
  | { status: "idle" }
  | { status: "loading"; request: RequestIdentity; fallback: GameBananaPageSnapshot | null }
  | { status: "ready"; request: RequestIdentity; snapshot: GameBananaPageSnapshot }
  | {
      status: "stale";
      request: RequestIdentity;
      snapshot: GameBananaPageSnapshot;
      message: string;
    }
  | { status: "error"; request: RequestIdentity; message: string };

export type GameBananaCategoriesResource =
  | { status: "idle"; records: GameBananaCategory[] }
  | { status: "loading"; records: GameBananaCategory[] }
  | { status: "ready"; records: GameBananaCategory[] }
  | { status: "error"; records: GameBananaCategory[]; message: string };

export type GameBananaBrowserModel = {
  query: string;
  setQuery: (query: string) => void;
  submitSearch: () => void;
  sort: GameBananaSort;
  setSort: (sort: GameBananaSort) => void;
  category: number | null;
  setCategory: (category: number | null) => void;
  includeMature: boolean;
  setIncludeMature: (include: boolean) => void;
  pageNumber: number;
  goToPage: (page: number) => void;
  reset: () => void;
  page: GameBananaPage | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
  refresh: () => void;
  retry: () => void;
  categories: GameBananaCategoriesResource;
  retryCategories: () => void;
};

const defaultClock = () => Date.now();

function identity(request: GameBananaRequest): RequestIdentity {
  const normalized = { ...request, query: normalizeGameBananaQuery(request.query) };
  return { ...normalized, key: gameBananaRequestKey(normalized) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Check your connection and try again.";
}

export function useGameBananaBrowser({
  api,
  active,
  now = defaultClock,
}: {
  api: Api;
  active: boolean;
  /** Injectable monotonic-enough wall clock for deterministic cache tests. */
  now?: () => number;
}): GameBananaBrowserModel {
  const [query, setQueryValue] = useState("");
  const [term, setTerm] = useState("");
  const [sort, setSortValue] = useState<GameBananaSort>(GAMEBANANA_DEFAULT_SORT);
  const [category, setCategoryValue] = useState<number | null>(null);
  const [includeMature, setIncludeMatureValue] = useState(readMaturePreference);
  const [pageNumber, setPageNumber] = useState(1);
  const [resource, setResource] = useState<PageResource>({ status: "idle" });
  const [categories, setCategoriesValue] = useState<GameBananaCategoriesResource>({
    status: "idle",
    records: [],
  });

  const cache = useRef<GameBananaPageCache>(new Map());
  const requestSequence = useRef(0);
  const categorySequence = useRef(0);
  const mounted = useRef(true);
  const categoriesRef = useRef(categories);
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      categorySequence.current += 1;
    };
  }, []);

  const request = useMemo(
    () => identity({ query: term, sort, category, page: pageNumber, includeMature }),
    [term, sort, category, pageNumber, includeMature],
  );
  const desiredRequest = useMemo(
    () => identity({ query, sort, category, page: pageNumber, includeMature }),
    [query, sort, category, pageNumber, includeMature],
  );

  const loadRequest = useCallback(
    async (next: RequestIdentity, refreshNative: boolean) => {
      const validation = gameBananaQueryError(next.query);
      const token = ++requestSequence.current;
      if (validation) {
        setResource({ status: "error", request: next, message: validation });
        return;
      }

      const cached = readGameBananaPageCache(cache.current, next.key, nowRef.current());
      if (!refreshNative && cached?.freshness === "fresh") {
        setResource({ status: "ready", request: next, snapshot: cached.snapshot });
        return;
      }

      const fallback = cached?.snapshot ?? null;
      setResource({ status: "loading", request: next, fallback });
      try {
        const result = await api.searchGameBananaMods(
          next.query,
          next.sort,
          next.category,
          next.page,
          next.includeMature,
          refreshNative,
        );
        if (!mounted.current || token !== requestSequence.current) return;
        const snapshot = writeGameBananaPageCache(
          cache.current,
          next.key,
          result,
          nowRef.current(),
        );
        setResource({ status: "ready", request: next, snapshot });
      } catch (error) {
        if (!mounted.current || token !== requestSequence.current) return;
        const message = errorMessage(error);
        if (fallback) {
          setResource({
            status: "stale",
            request: next,
            snapshot: fallback,
            message: `Could not refresh GameBanana. Showing saved results. ${message}`,
          });
        } else {
          setResource({ status: "error", request: next, message });
        }
      }
    },
    [api],
  );

  useEffect(() => {
    if (active) void loadRequest(request, false);
  }, [active, request, loadRequest]);

  useEffect(() => {
    const normalized = normalizeGameBananaQuery(query);
    if (normalized === term) return;
    const timer = window.setTimeout(() => {
      setTerm(normalized);
      setPageNumber(1);
    }, GAMEBANANA_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, term]);

  const publishCategories = useCallback((next: GameBananaCategoriesResource) => {
    categoriesRef.current = next;
    setCategoriesValue(next);
  }, []);

  const loadCategories = useCallback(
    async (refresh: boolean) => {
      const token = ++categorySequence.current;
      publishCategories({ status: "loading", records: categoriesRef.current.records });
      try {
        const records = await api.gameBananaModCategories(refresh);
        if (!mounted.current || token !== categorySequence.current) return;
        publishCategories({ status: "ready", records });
      } catch (error) {
        if (!mounted.current || token !== categorySequence.current) return;
        publishCategories({
          status: "error",
          records: categoriesRef.current.records,
          message: errorMessage(error),
        });
      }
    },
    [api, publishCategories],
  );

  // Intentionally depends on activation, not category status: a failure stays
  // visible until Retry, while a hide/reopen starts one new attempt. Successful
  // completion after hiding remains publishable because hiding is not unmounting.
  useEffect(() => {
    if (
      active &&
      (categoriesRef.current.status === "idle" || categoriesRef.current.status === "error")
    ) {
      void loadCategories(categoriesRef.current.status === "error");
    }
  }, [active, loadCategories]);

  const setQuery = useCallback((next: string) => {
    setQueryValue(next);
    setPageNumber(1);
  }, []);
  const setSort = useCallback((next: GameBananaSort) => {
    setSortValue(next);
    setPageNumber(1);
  }, []);
  const setCategory = useCallback((next: number | null) => {
    setCategoryValue(next);
    setPageNumber(1);
  }, []);
  const setIncludeMature = useCallback((next: boolean) => {
    setIncludeMatureValue(next);
    setPageNumber(1);
    writeMaturePreference(next);
  }, []);
  const goToPage = useCallback((next: number) => setPageNumber(Math.max(1, next)), []);

  const submitSearch = useCallback(() => {
    const normalized = normalizeGameBananaQuery(query);
    if (normalized !== term || pageNumber !== 1) {
      setTerm(normalized);
      setPageNumber(1);
      return;
    }
    void loadRequest(request, true);
  }, [query, term, pageNumber, loadRequest, request]);

  const refresh = useCallback(() => void loadRequest(request, true), [loadRequest, request]);
  const retry = refresh;
  const retryCategories = useCallback(() => void loadCategories(true), [loadCategories]);
  const reset = useCallback(() => {
    setQueryValue("");
    setTerm("");
    setSortValue(GAMEBANANA_DEFAULT_SORT);
    setCategoryValue(null);
    setPageNumber(1);
  }, []);

  const requestSettled = desiredRequest.key === request.key;
  const resourceMatches = resource.status !== "idle" && resource.request.key === request.key;
  let visiblePage: GameBananaPage | null = null;
  let loading = !requestSettled;
  let stale = false;
  let error: string | null = gameBananaQueryError(desiredRequest.query);

  if (requestSettled && resourceMatches) {
    if (resource.status === "loading") {
      loading = true;
      visiblePage = resource.fallback?.page ?? null;
      stale = resource.fallback !== null;
    } else if (resource.status === "ready") {
      visiblePage = resource.snapshot.page;
    } else if (resource.status === "stale") {
      visiblePage = resource.snapshot.page;
      stale = true;
      error = resource.message;
    } else if (resource.status === "error") {
      error = resource.message;
    }
  }

  return {
    query,
    setQuery,
    submitSearch,
    sort,
    setSort,
    category,
    setCategory,
    includeMature,
    setIncludeMature,
    pageNumber,
    goToPage,
    reset,
    page: visiblePage,
    loading,
    stale,
    error,
    refresh,
    retry,
    categories,
    retryCategories,
  };
}
