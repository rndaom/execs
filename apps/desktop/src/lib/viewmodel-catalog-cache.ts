import type { ViewmodelSourceCatalog } from "./bridge";

/** A read this recent is trusted when the pane opens instead of rereading TF2's files. */
export const VIEWMODEL_CATALOG_FRESH_MS = 2 * 60_000;

type Load = () => Promise<ViewmodelSourceCatalog>;

let cached: { catalog: ViewmodelSourceCatalog; at: number } | null = null;
let pending: Promise<ViewmodelSourceCatalog> | null = null;
const listeners = new Set<(catalog: ViewmodelSourceCatalog) => void>();

/** The most recent successful read, shared by the startup prefetch and the pane. */
export function cachedViewmodelCatalog(): ViewmodelSourceCatalog | null {
  return cached?.catalog ?? null;
}

export function viewmodelCatalogIsFresh(now = Date.now()): boolean {
  return cached !== null && now - cached.at < VIEWMODEL_CATALOG_FRESH_MS;
}

/** Read the installed catalog, joining a read that is already in flight. */
export function loadViewmodelCatalog(load: Load): Promise<ViewmodelSourceCatalog> {
  if (pending) return pending;
  // A loader that throws synchronously still becomes an ordinary rejected read.
  const read = Promise.resolve()
    .then(load)
    .then((catalog) => {
      cached = { catalog, at: Date.now() };
      for (const listener of listeners) listener(catalog);
      return catalog;
    });
  pending = read;
  void read.then(
    () => {
      if (pending === read) pending = null;
    },
    () => {
      if (pending === read) pending = null;
    },
  );
  return read;
}

/** Hear about every successful read, including one started before the listener existed. */
export function subscribeViewmodelCatalog(
  listener: (catalog: ViewmodelSourceCatalog) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Warm the cache in the background when the app opens; failures wait for the pane's own read. */
export function prefetchViewmodelCatalog(load: Load): void {
  if (cached || pending) return;
  loadViewmodelCatalog(load).catch(() => {});
}

/** Forget the cached read, for tests and install changes. */
export function resetViewmodelCatalogCache(): void {
  cached = null;
  pending = null;
}
