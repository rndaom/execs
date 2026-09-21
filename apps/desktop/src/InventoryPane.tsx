import { CaretLeft, CaretRight, Cube, MagnifyingGlass, User } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Segmented } from "./components/ui/Segmented";
import { useInventorySnapshot } from "./hooks/useInventorySnapshot";
import type { Api } from "./lib/api";
import type { InventoryItem } from "./lib/bridge";
import {
  type InventorySort,
  inventoryPage,
  itemDescription,
  itemName,
  QUALITY_NAMES,
} from "./lib/inventory-ui";

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
  const { snapshot, loading, error, updatedAt, refresh } = useInventorySnapshot(
    api,
    active,
    running,
    busy,
  );
  const [iconError, setIconError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [quality, setQuality] = useState<number | null>(null);
  const [sort, setSort] = useState<InventorySort>("position");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const iconCache = useRef<Record<string, string>>({});
  const account = snapshot?.steamId;
  const previousAccount = useRef(account);
  useEffect(() => {
    if (account === previousAccount.current) return;
    previousAccount.current = account;
    setPage(1);
    setQuality(null);
    setSelected(null);
    setQuery("");
    iconCache.current = {};
    setIcons({});
    setIconError(null);
  }, [account]);
  const view = useMemo(
    () => (snapshot ? inventoryPage(snapshot, query, quality, page, sort) : null),
    [snapshot, query, quality, page, sort],
  );
  const item = snapshot?.items.find((entry) => entry.id === selected);
  const definition = item && snapshot ? itemDescription(snapshot, item) : undefined;
  const paths = useMemo(
    () => [
      ...new Set(
        [
          ...(view?.slots.flatMap(({ item }) => (item ? [item] : [])) ?? []),
          ...(item ? [item] : []),
        ].flatMap((entry) => {
          const path = snapshot && itemDescription(snapshot, entry)?.icon;
          return path ? [path] : [];
        }),
      ),
    ],
    [view, snapshot, item],
  );

  useEffect(() => {
    if (!active || paths.length === 0) return;
    let cancelled = false;
    setIconError(null);
    const missing = paths.filter((path) => !iconCache.current[path]);
    if (missing.length === 0) return;
    async function readIcons() {
      const images = [];
      const artwork = missing.filter((path) => !path.startsWith("materials/patterns/"));
      const patterns = missing.filter((path) => path.startsWith("materials/patterns/"));
      // Pattern textures are larger: keep each request within the native 32 MiB
      // aggregate cap, and decode batches sequentially to bound peak memory.
      for (const [paths, size] of [
        [artwork, 50],
        [patterns, 8],
      ] as const) {
        for (let start = 0; start < paths.length; start += size) {
          if (cancelled) return [];
          images.push(await api.getInventoryIcons(paths.slice(start, start + size)));
        }
      }
      return images;
    }
    readIcons()
      .then((images) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const [path, image] of images.flatMap((batch) => Object.entries(batch))) {
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
        iconCache.current = { ...iconCache.current, ...next };
        setIcons(iconCache.current);
      })
      .catch((reason) => {
        if (!cancelled) setIconError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [api, paths, active]);

  function card(entry: InventoryItem, position: number) {
    if (!snapshot) return null;
    const name = itemName(snapshot, entry);
    const path = itemDescription(snapshot, entry)?.icon;
    return (
      <button
        type="button"
        key={entry.id}
        aria-pressed={selected === entry.id}
        aria-label={`${name}, ${QUALITY_NAMES[entry.quality] ?? "Unknown quality"}, ${position ? `slot ${position}` : "unplaced"}`}
        title={name}
        onClick={() => setSelected(entry.id)}
        className={`relative flex min-h-24 min-w-0 flex-col items-center justify-center rounded-md p-1 pt-4 transition-colors ${selected === entry.id ? "ring-2 ring-brand bg-brand/6" : "bg-panel hover:bg-panel-raised"}`}
      >
        <span className="t-meta absolute top-1 left-1.5 text-ink-faint">{position || "New"}</span>
        {selected === entry.id ? (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-brand"
          />
        ) : null}
        {path && icons[path] ? (
          <img src={icons[path]} alt="" className="h-14 w-full object-contain" />
        ) : (
          <Cube aria-hidden="true" size={28} className="my-3 text-ink-faint" />
        )}
        <span className="w-full truncate text-center text-[10px]">{name}</span>
      </button>
    );
  }
  function navigation() {
    if (!view) return null;
    return (
      <nav aria-label="Backpack pages" className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Previous page"
          disabled={view.current === 1}
          onClick={() => setPage(view.current - 1)}
        >
          <CaretLeft size={14} />
        </button>
        <label className="t-meta flex items-center gap-2">
          Page{" "}
          <input
            aria-label="Backpack page"
            className="w-14 rounded border border-edge bg-panel px-2 py-1 text-center text-ink"
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
          aria-label="Next page"
          disabled={view.current === view.pages}
          onClick={() => setPage(view.current + 1)}
        >
          <CaretRight size={14} />
        </button>
      </nav>
    );
  }

  return (
    <div>
      <PaneHeader
        title="Inventory"
        actions={
          error ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || running || busy}
              onClick={() => void refresh()}
            >
              Retry connection
            </button>
          ) : undefined
        }
      />
      {running ? <p className="t-meta mb-4">Close TF2 to refresh your backpack.</p> : null}
      {loading && !snapshot ? <p role="status">Reading your backpack from Steam…</p> : null}
      {error ? (
        <p role="alert" className="mb-4 text-warn">
          {error}
          {snapshot
            ? " Showing the last confirmed snapshot; retrying automatically."
            : " Retrying automatically while Inventory is open."}
        </p>
      ) : null}
      {snapshot && view ? (
        <>
          <div className="mb-6 grid items-start gap-6 border-b border-edge pb-6 lg:grid-cols-[1fr_360px]">
            <div className="py-2">
              <div className="flex items-center gap-3">
                {snapshot.avatar ? (
                  <img
                    src={snapshot.avatar}
                    alt="Steam avatar"
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-panel">
                    <User size={26} className="text-ink-muted" />
                  </span>
                )}
                <div className="min-w-0">
                  <h2 className="t-section break-words">
                    {snapshot.personaName || "Your backpack"}
                  </h2>
                  <p className="t-meta mt-1">
                    {snapshot.items.length.toLocaleString()} items ·{" "}
                    {snapshot.capacity.toLocaleString()} slots
                  </p>
                </div>
              </div>
              <p className="t-meta mt-5" role="status">
                {loading
                  ? "Updating…"
                  : `Updated ${updatedAt === null ? "" : new Date(updatedAt).toLocaleTimeString()}`}
              </p>
              <details className="t-meta mt-2">
                <summary className="cursor-pointer hover:text-ink">About this backpack</summary>
                <p className="mt-2 break-all">Steam account {snapshot.steamId}</p>
                <p className="mt-2">
                  Refreshes every two minutes while this pane is visible and focused, and after TF2
                  closes. Steam may briefly show you playing TF2 while connecting.
                </p>
                <p className="mt-2">Browsing and sorting here do not move items in Steam.</p>
              </details>
            </div>
            <section aria-label="Item details" className="min-h-40 rounded-lg bg-panel p-5">
              {item ? (
                <div className="grid grid-cols-[112px_1fr] items-start gap-4">
                  {definition?.icon && icons[definition.icon] ? (
                    <img
                      src={icons[definition.icon]}
                      alt={itemName(snapshot, item)}
                      className="h-28 w-28 object-contain"
                    />
                  ) : (
                    <div className="mb-3 flex h-28 flex-col items-center justify-center gap-2 text-ink-faint">
                      <Cube size={36} />
                      <span className="t-meta">Artwork unavailable</span>
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="t-row break-words">{itemName(snapshot, item)}</h2>
                    {item.customName && definition?.name ? (
                      <p className="t-meta mt-1">{definition.name}</p>
                    ) : null}
                    <p className="t-meta mt-1">
                      {QUALITY_NAMES[item.quality] ?? `Quality ${item.quality}`} · Level{" "}
                      {item.level}
                    </p>
                    {snapshot.itemDescriptions?.[item.id]?.details.length ? (
                      <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                        {snapshot.itemDescriptions[item.id].details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    ) : null}
                    <details key={item.id} className="t-meta mt-3 border-t border-edge pt-3">
                      <summary className="cursor-pointer hover:text-ink">Item details</summary>
                      <p className="mt-2">{definition?.kind ?? "Unknown item type"}</p>
                      {definition?.classes.length ? (
                        <p className="mt-1 capitalize">{definition.classes.join(", ")}</p>
                      ) : null}
                      <p className="mt-1 break-all">
                        Item {item.id} · {item.position ? `Slot ${item.position}` : "Not placed"}
                      </p>
                    </details>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-28 flex-col items-center justify-center gap-3 text-ink-faint">
                  <Cube size={40} />
                  <p className="t-meta">Select an item for a closer look.</p>
                </div>
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
          <label className="relative block">
            <span className="sr-only">Search items</span>
            <MagnifyingGlass
              aria-hidden="true"
              size={16}
              className="absolute top-3 left-3 text-ink-muted"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
              placeholder="Search name, class, paint, or type…"
              className="w-full rounded-md border border-edge bg-panel py-2 pr-3 pl-9"
            />
          </label>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="View order"
              size="sm"
              options={[
                { id: "position", label: "Backpack" },
                { id: "name", label: "Name" },
                { id: "quality", label: "Quality" },
                { id: "type", label: "Type" },
              ]}
              value={sort}
              onChange={(value) => {
                setSort(value);
                setPage(1);
              }}
            />
            <details className="t-meta">
              <summary className="cursor-pointer hover:text-ink">
                {quality === null
                  ? "Filter quality"
                  : (QUALITY_NAMES[quality] ?? `Quality ${quality}`)}
              </summary>
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
                    {value === null
                      ? "All qualities"
                      : (QUALITY_NAMES[value] ?? `Quality ${value}`)}
                  </button>
                ))}
              </fieldset>
            </details>
          </div>
          <div className="my-4 flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="t-meta">
              {view.filtered
                ? `${view.matchCount} items · View only`
                : `Slots ${(view.current - 1) * 50 + 1}–${Math.min(view.current * 50, snapshot.capacity)}`}
            </p>
            {navigation()}
          </div>
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
          {!view.filtered && view.unplaced.length ? (
            <section className="mt-6 border-t border-edge pt-6">
              <h2 className="t-section">Unplaced items</h2>
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
          Your backpack loads automatically with Steam signed in and TF2 closed.
        </p>
      ) : null}
      <p className="t-meta mt-8 border-t border-edge pt-4">
        Development preview · Browse only. Inspired by{" "}
        <button
          type="button"
          className="underline hover:text-ink"
          onClick={() => void api.openExternal("https://www.jengerer.com/item_manager/")}
        >
          Jengerer’s Item Manager
        </button>
        .
      </p>
    </div>
  );
}
