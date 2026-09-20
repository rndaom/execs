import { useEffect, useMemo, useRef, useState } from "react";
import { PaneHeader } from "./components/ui/PaneHeader";
import type { Api } from "./lib/api";
import type { InventoryItem, InventorySnapshot } from "./lib/bridge";
import { inventoryPage, itemName, QUALITY_NAMES } from "./lib/inventory-ui";

export function InventoryPane({
  api,
  active,
  running,
  busy,
}: {
  api: Api;
  active: boolean;
  running: boolean;
  busy: boolean;
}) {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState("");
  const [query, setQuery] = useState("");
  const [quality, setQuality] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const view = useMemo(
    () => (snapshot ? inventoryPage(snapshot, query, quality, page) : null),
    [snapshot, query, quality, page],
  );
  const item = snapshot?.items.find((entry) => entry.id === selected);
  const definition = item ? snapshot?.definitions[item.definition] : undefined;
  const paths = useMemo(
    () => [
      ...new Set(
        view?.slots.flatMap(({ item }) =>
          item && snapshot?.definitions[item.definition]?.icon
            ? [snapshot.definitions[item.definition].icon as string]
            : [],
        ) ?? [],
      ),
    ],
    [view, snapshot],
  );

  useEffect(() => {
    if (!active || paths.length === 0) return;
    let cancelled = false;
    setIconError(null);
    api
      .getInventoryIcons(paths)
      .then((images) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const [path, image] of Object.entries(images)) {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          if (!context) continue;
          const pixels = context.createImageData(image.width, image.height);
          pixels.data.set(image.rgba);
          context.putImageData(pixels, 0, 0);
          next[path] = canvas.toDataURL();
        }
        setIcons((previous) => ({ ...previous, ...next }));
      })
      .catch((reason) => {
        if (!cancelled) setIconError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [api, paths, active]);

  async function load() {
    if (inFlight.current || running || busy) return;
    inFlight.current = true;
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    setSnapshot(null);
    setIcons({});
    setSelected(null);
    try {
      const next = await api.getInventory();
      if (request !== generation.current) return;
      setSnapshot(next);
      setPage(1);
      setLoadedAt(new Date().toLocaleTimeString());
    } catch (reason) {
      if (request === generation.current) setError(String(reason));
    } finally {
      inFlight.current = false;
      if (request === generation.current) setLoading(false);
    }
  }

  function card(entry: InventoryItem, position: number) {
    if (!snapshot) return null;
    const name = itemName(snapshot, entry);
    const path = snapshot.definitions[entry.definition]?.icon;
    return (
      <button
        type="button"
        key={entry.id}
        aria-pressed={selected === entry.id}
        aria-label={`${name}, ${QUALITY_NAMES[entry.quality] ?? "Unknown quality"}, ${position ? `slot ${position}` : "unplaced"}`}
        title={name}
        onClick={() => setSelected(entry.id)}
        className={`relative flex min-h-24 min-w-0 flex-col items-center justify-center rounded-md bg-panel p-1 transition-colors ${selected === entry.id ? "ring-2 ring-brand bg-brand/6" : "hover:bg-panel-raised"}`}
      >
        <span className="t-meta absolute top-1 left-1">{position || "New"}</span>
        {path && icons[path] ? (
          <img src={icons[path]} alt="" className="h-14 w-full object-contain" />
        ) : (
          <span className="t-meta py-3">#{entry.definition}</span>
        )}
        <span className="w-full truncate text-center text-[10px]">{name}</span>
      </button>
    );
  }
  function navigation(label: string) {
    if (!view) return null;
    return (
      <nav aria-label={label} className="my-4 flex items-center justify-between gap-3">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={view.current === 1}
          onClick={() => setPage(view.current - 1)}
        >
          Previous
        </button>
        <label className="t-meta flex items-center gap-2">
          Page{" "}
          <input
            aria-label={`${label} page`}
            className="w-16 rounded border border-edge bg-panel p-2 text-ink"
            type="number"
            min={1}
            max={view.pages}
            value={view.current}
            onChange={(event) => setPage(Number(event.target.value))}
          />{" "}
          of {view.pages}
        </label>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={view.current === view.pages}
          onClick={() => setPage(view.current + 1)}
        >
          Next
        </button>
      </nav>
    );
  }

  return (
    <div>
      <PaneHeader
        title="Inventory"
        lede="Your backpack, connected through Steam."
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || running || busy}
            onClick={() => void load()}
          >
            {loading ? "Reading backpack…" : snapshot ? "Refresh backpack" : "Load backpack"}
          </button>
        }
      />
      <p className="t-meta mb-4">
        Development preview · Browse only. Keep Steam signed in and TF2 closed while loading. Steam
        may briefly show you playing TF2.
      </p>
      {loading ? <p role="status">Connecting to Steam and reading your backpack…</p> : null}
      {error ? (
        <p role="alert" className="mb-4 text-warn">
          {error}
        </p>
      ) : null}
      {snapshot && view ? (
        <>
          <div className="mb-6 grid gap-6 border-b border-edge pb-6 lg:grid-cols-[1fr_360px]">
            <div>
              <h2 className="t-section">{snapshot.items.length.toLocaleString()} items</h2>
              <p className="t-meta mt-2">
                {snapshot.capacity.toLocaleString()} slots · Snapshot at {loadedAt}
              </p>
              <p className="t-meta mt-2 break-all">Steam account {snapshot.steamId}</p>
              <p className="t-meta mt-2">Refresh after trades, account changes, or playing TF2.</p>
            </div>
            <section aria-label="Item details" className="min-h-36 rounded-lg bg-panel p-4">
              {item ? (
                <>
                  <h2 className="t-row">{itemName(snapshot, item)}</h2>
                  <p className="t-meta mt-2">
                    {QUALITY_NAMES[item.quality] ?? `Quality ${item.quality}`} · Level {item.level}
                  </p>
                  <p className="t-meta mt-2">{definition?.kind ?? "Item details unavailable"}</p>
                  <p className="t-meta mt-2 capitalize">{definition?.classes.join(", ")}</p>
                  <p className="t-meta mt-2 break-all">
                    Item {item.id} · {item.position ? `Slot ${item.position}` : "Not placed"}
                  </p>
                  <p className="t-meta mt-2">
                    Base artwork; paint, wear, and effects aren’t previewed.
                  </p>
                </>
              ) : (
                <p className="t-meta">Select an item to inspect it.</p>
              )}
            </section>
          </div>
          {snapshot.warning ? (
            <p role="status" className="mb-4 text-warn">
              {snapshot.warning}
            </p>
          ) : null}
          {iconError ? (
            <p role="status" className="mb-4 text-warn">
              Some artwork could not be loaded. {iconError}
            </p>
          ) : null}
          <label className="block">
            <span className="t-meta">Search items</span>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Name, class, type, or item ID"
              className="mt-2 w-full rounded-md border border-edge bg-panel px-3 py-2"
            />
          </label>
          <fieldset aria-label="Filter by quality" className="mt-3 flex flex-wrap gap-2">
            {[null, ...new Set(snapshot.items.map((entry) => entry.quality))].map((value) => (
              <button
                key={value ?? "all"}
                type="button"
                aria-pressed={quality === value}
                onClick={() => {
                  setQuality(value);
                  setPage(1);
                }}
                className={`rounded-full px-3 py-1 text-sm ${quality === value ? "ring-1 ring-brand bg-brand/6" : "bg-panel"}`}
              >
                {value === null ? "All qualities" : (QUALITY_NAMES[value] ?? `Quality ${value}`)}
              </button>
            ))}
          </fieldset>
          {view.filtered ? (
            <p role="status" className="t-meta mt-4">
              {view.matchCount} matching items · Backpack positions unchanged
            </p>
          ) : null}
          {navigation("Backpack top")}
          <section className="grid grid-cols-5 gap-2 sm:grid-cols-10" aria-label="Backpack items">
            {view.slots.map(({ position, item }) =>
              item ? (
                card(item, position)
              ) : (
                <div
                  key={`empty-${position}`}
                  className="min-h-24 rounded-md border border-edge p-1"
                >
                  <span className="t-meta">
                    <span className="sr-only">Empty slot </span>
                    {position}
                  </span>
                </div>
              ),
            )}
          </section>
          {view.filtered && view.matchCount === 0 ? (
            <p className="t-meta py-8">No items match this search.</p>
          ) : null}
          {navigation("Backpack bottom")}
          {!view.filtered && view.unplaced.length ? (
            <section className="mt-6 border-t border-edge pt-6">
              <h2 className="t-section">Unplaced items</h2>
              <p className="t-meta mt-2">
                Search for “{view.unplaced[0].id}” to inspect an unplaced item. Placement is not
                available yet.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {view.unplaced.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className="btn btn-ghost"
                    onClick={() => setSelected(entry.id)}
                  >
                    {itemName(snapshot, entry)}
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : !loading ? (
        <p className="t-meta py-8">
          Load your backpack to browse pages and inspect items. No items will be moved or changed.
        </p>
      ) : null}
      <p className="t-meta mt-8 border-t border-edge pt-4">
        Inspired by{" "}
        <button
          type="button"
          className="underline hover:text-ink"
          onClick={() => void api.openExternal("https://www.jengerer.com/item_manager/")}
        >
          Jengerer’s Item Manager
        </button>
        , by Jengerer and its contributors.
      </p>
    </div>
  );
}
