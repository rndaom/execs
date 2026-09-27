import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { HudCatalogEntry, HudSchemaView, HudStat, HudStatePayload } from "../lib/bridge";
import { HudReloadQueue } from "../lib/hud-reload-ui";
import { emptyHudState } from "../lib/hud-ui";

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** Local identity/options never wait for catalog or popularity requests. */
export function useHudResources(
  api: Api,
  profileId: string | null,
  active: boolean,
  refreshKey: string | number,
) {
  const [catalog, setCatalog] = useState<HudCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogWarning, setCatalogWarning] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, HudStat>>({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [local, setLocal] = useState<{
    state: HudStatePayload | null;
    schema: HudSchemaView | null;
    stateLoading: boolean;
    stateError: string | null;
    schemaLoading: boolean;
    schemaError: string | null;
  }>({
    state: null,
    schema: null,
    stateLoading: true,
    stateError: null,
    schemaLoading: false,
    schemaError: null,
  });
  const localRequest = useRef(0);
  const localState = useRef<HudStatePayload | null>(null);
  const catalogRequest = useRef(0);
  const statsRequest = useRef(0);
  const catalogQueue = useRef(new HudReloadQueue());
  const statsQueue = useRef(new HudReloadQueue());

  const reloadLocal = useCallback(async () => {
    if (!profileId) return;
    const request = ++localRequest.current;
    const current = () => request === localRequest.current;
    setLocal((previous) => ({
      ...previous,
      schema: null,
      stateLoading: true,
      stateError: null,
      schemaLoading: false,
      schemaError: null,
    }));
    try {
      const state = await api.getHudState();
      if (!current()) return;
      if (state.profileId !== profileId)
        throw new Error("The active profile changed. Reload the installed HUD.");
      localState.current = state;
      setLocal({
        state,
        schema: null,
        stateLoading: false,
        stateError: null,
        schemaLoading: state.schemaSupported,
        schemaError: null,
      });
      if (!state.installed || !state.schemaSupported) return;
      // Option schemas can use the network. The local read (and an already
      // committed import) finishes now; schema failure has its own result.
      void api
        .getHudSchema(profileId, state.installed.id)
        .then((schema) => {
          if (!current()) return;
          setLocal((previous) => ({
            ...previous,
            schema,
            schemaLoading: false,
            schemaError: schema
              ? null
              : "No options were returned for this HUD. Retry loading options.",
          }));
        })
        .catch((error) => {
          if (!current()) return;
          setLocal((previous) => ({
            ...previous,
            schema: null,
            schemaLoading: false,
            schemaError: message(error, "Could not load HUD options."),
          }));
        });
    } catch (error) {
      if (!current()) return;
      setLocal((previous) => ({
        ...previous,
        schema: null,
        stateLoading: false,
        stateError: message(error, "Could not load the installed HUD."),
        schemaLoading: false,
      }));
    }
  }, [api, profileId]);

  const reloadCatalog = useCallback(
    (refresh: boolean) => {
      const request = ++catalogRequest.current;
      setCatalogLoading(true);
      setCatalogError(null);
      setCatalogWarning(null);
      return catalogQueue.current.enqueue(async () => {
        if (request !== catalogRequest.current && !refresh) return;
        try {
          const result = await api.getHudCatalog(refresh);
          if (request !== catalogRequest.current) return;
          setCatalog(result.entries);
          setCatalogWarning(result.warning);
          // Re-evaluate update status against the newly written cache, without
          // replacing a schema or draft already loaded for this identity.
          const localVersion = localRequest.current;
          let state: HudStatePayload;
          try {
            state = await api.getHudState();
          } catch (error) {
            if (request === catalogRequest.current && localVersion === localRequest.current) {
              localRequest.current += 1;
              setLocal((previous) => ({
                ...previous,
                schema: null,
                schemaLoading: false,
                stateLoading: false,
                stateError: message(error, "Could not load the installed HUD."),
              }));
            }
            return;
          }
          if (request !== catalogRequest.current || localVersion !== localRequest.current) return;
          if (
            state.profileId !== profileId ||
            localState.current?.profileId !== state.profileId ||
            localState.current.installed?.id !== state.installed?.id
          ) {
            // A write/absorb can finish while the catalog is loading. That is
            // a new local identity, so discard its predecessor's schema now.
            void reloadLocal();
            return;
          }
          localState.current = state;
          setLocal((previous) =>
            previous.state?.profileId === state.profileId &&
            previous.state.installed?.id === state.installed?.id
              ? {
                  ...previous,
                  state: {
                    ...state,
                    catalogUnavailable: state.catalogUnavailable || result.warning !== null,
                  },
                }
              : previous,
          );
        } catch (error) {
          if (request === catalogRequest.current) {
            setCatalogError(message(error, "Could not refresh the catalog."));
            setLocal((previous) =>
              previous.state
                ? { ...previous, state: { ...previous.state, catalogUnavailable: true } }
                : previous,
            );
          }
        } finally {
          if (request === catalogRequest.current) setCatalogLoading(false);
        }
      });
    },
    [api, profileId, reloadLocal],
  );

  const reloadStats = useCallback(
    (refresh: boolean) => {
      const request = ++statsRequest.current;
      setStatsLoading(true);
      setStatsError(null);
      return statsQueue.current.enqueue(async () => {
        if (request !== statsRequest.current && !refresh) return;
        try {
          const result = await api.getHudStats(refresh);
          if (request !== statsRequest.current) return;
          setStats(result.stats);
          setStatsError(result.warning);
        } catch (error) {
          if (request === statsRequest.current)
            setStatsError(message(error, "Could not refresh HUD activity."));
        } finally {
          if (request === statsRequest.current) setStatsLoading(false);
        }
      });
    },
    [api],
  );

  const reload = useCallback(
    (refresh: boolean) => {
      void reloadLocal();
      statsRequest.current += 1;
      setStatsLoading(true);
      setStatsError(null);
      // Counts need the catalog's repository identities. A failed catalog still
      // permits a stats attempt against its cache; neither delays local reads.
      const request = catalogRequest.current + 1;
      void reloadCatalog(refresh).then(() => {
        if (request === catalogRequest.current) return reloadStats(refresh);
      });
    },
    [reloadCatalog, reloadLocal, reloadStats],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: an external profile refresh must re-read local HUD state even if its profile id did not change.
  useEffect(() => {
    if (!active || !profileId) return;
    reload(false);
    return () => {
      localRequest.current += 1;
      catalogRequest.current += 1;
      statsRequest.current += 1;
    };
  }, [active, profileId, refreshKey, reload]);

  const matching = local.state?.profileId === profileId;
  return {
    catalog,
    catalogLoading,
    catalogError,
    catalogWarning,
    stats,
    statsLoading,
    statsError,
    state: matching && local.state ? local.state : emptyHudState(),
    schema: matching ? local.schema : null,
    stateLoading: local.stateLoading || (!matching && !local.stateError),
    stateError: local.stateError,
    schemaLoading: matching && local.schemaLoading,
    schemaError: matching ? local.schemaError : null,
    reload,
    reloadLocal,
  };
}
