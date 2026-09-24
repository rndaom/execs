import { CaretLeft, CaretRight, Cube, MagnifyingGlass, User } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  qualityColor,
} from "./lib/inventory-ui";

const ICON_BATCH_SIZE = 8;

function isPattern(path: string | null | undefined): boolean {
  return Boolean(path?.startsWith("materials/patterns/"));
}

function WarPaintArtwork({
  itemIcon,
  pattern,
  large = false,
}: {
  itemIcon?: string;
  pattern?: string;
  large?: boolean;
}) {
  return (
    <div
      className={`inventory-paint-art ${large ? "inventory-paint-art-large" : ""}`}
      aria-hidden="true"
    >
      {itemIcon ? (
        <img src={itemIcon} alt="" className="inventory-paint-icon" />
      ) : pattern ? (
        <img src={pattern} alt="" className="inventory-paint-only-swatch" />
      ) : (
        <Cube size={large ? 40 : 28} className="text-ink-faint" />
      )}
      {itemIcon && pattern ? <img src={pattern} alt="" className="inventory-paint-swatch" /> : null}
    </div>
  );
}

function KitArtwork({
  kit,
  target,
  large = false,
}: {
  kit: string;
  target?: string;
  large?: boolean;
}) {
  return (
    <span className={`inventory-kit-art ${large ? "inventory-kit-art-large" : ""}`}>
      <img src={kit} alt="" className="inventory-kit-icon" />
      {target ? <img src={target} alt="" className="inventory-kit-target" /> : null}
    </span>
  );
}

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
  const [query, setQuery] = useState("");
  const [quality, setQuality] = useState<number | null>(null);
  const [sort, setSort] = useState<InventorySort>("position");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [, setArtworkRevision] = useState(0);
  const iconCache = useRef<Record<string, string>>({});
  const unavailableIcons = useRef(new Set<string>());
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
    unavailableIcons.current.clear();
    setIcons({});
  }, [account]);
  const view = useMemo(
    () => (snapshot ? inventoryPage(snapshot, query, quality, page, sort) : null),
    [snapshot, query, quality, page, sort],
  );
  const grid = useRef<HTMLElement>(null);
  const previousPage = useRef<number | null>(null);
  const currentPage = view?.current ?? null;
  useLayoutEffect(() => {
    const changed =
      previousPage.current !== null && currentPage !== null && previousPage.current !== currentPage;
    previousPage.current = currentPage;
    if (active && changed) {
      // Keep the first new slot below the sticky pager without moving keyboard
      // focus or animating. Reads, sorting and filtering on this page stay put.
      grid.current?.scrollIntoView({ block: "start", behavior: "instant" });
    }
  }, [active, currentPage]);
  const item = snapshot?.items.find((entry) => entry.id === selected);
  const definition = item && snapshot ? itemDescription(snapshot, item) : undefined;
  const specificDescription = item ? snapshot?.itemDescriptions?.[item.id] : undefined;
  const detailPatternIcon = specificDescription?.patternIcon;
  const detailTargetIcon = specificDescription?.targetIcon;
  const paths = useMemo(
    () => [
      ...new Set(
        [
          ...(view?.slots.flatMap(({ item }) => (item ? [item] : [])) ?? []),
          ...(item ? [item] : []),
        ].flatMap((entry) => {
          const description = snapshot && itemDescription(snapshot, entry);
          const specific = snapshot?.itemDescriptions?.[entry.id];
          return [description?.icon, specific?.targetIcon, specific?.patternIcon].filter(
            (path): path is string => Boolean(path),
          );
        }),
      ),
    ],
    [view, snapshot, item],
  );

  useEffect(() => {
    if (!active || paths.length === 0) return;
    let cancelled = false;
    const missing = paths.filter(
      (path) => !iconCache.current[path] && !unavailableIcons.current.has(path),
    );
    if (missing.length === 0) return;
    const artwork = missing.filter((path) => !isPattern(path));
    const patterns = missing.filter(isPattern);
    const batches: string[][] = [];
    for (let start = 0; start < artwork.length; start += ICON_BATCH_SIZE) {
      batches.push(artwork.slice(start, start + ICON_BATCH_SIZE));
    }
    for (const path of patterns) batches.push([path]);
    let nextBatch = 0;
    function markUnavailable(path: string) {
      if (cancelled || unavailableIcons.current.has(path)) return;
      unavailableIcons.current.add(path);
      setArtworkRevision((revision) => revision + 1);
    }
    function publish(images: Record<string, { width: number; height: number; rgba: number[] }>) {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [path, image] of Object.entries(images)) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          if (!context) throw Error("Canvas unavailable");
          const pixels = context.createImageData(image.width, image.height);
          pixels.data.set(image.rgba);
          context.putImageData(pixels, 0, 0);
          next[path] = canvas.toDataURL();
        } catch {
          markUnavailable(path);
        }
      }
      if (Object.keys(next).length) {
        iconCache.current = { ...iconCache.current, ...next };
        setIcons(iconCache.current);
      }
    }
    async function readBatch(batch: string[]): Promise<void> {
      try {
        const images = await api.getInventoryIcons(batch);
        publish(images);
        if (cancelled) return;
        const omitted = batch.filter((path) => !images[path]);
        if (omitted.length && batch.length > 1) {
          const midpoint = Math.ceil(omitted.length / 2);
          await readBatch(omitted.slice(0, midpoint));
          if (midpoint < omitted.length) await readBatch(omitted.slice(midpoint));
        } else if (omitted.length) {
          markUnavailable(omitted[0]);
        }
      } catch {
        if (batch.length > 1) {
          const midpoint = Math.ceil(batch.length / 2);
          await readBatch(batch.slice(0, midpoint));
          await readBatch(batch.slice(midpoint));
        } else if (!cancelled) {
          markUnavailable(batch[0]);
        }
      }
    }
    async function worker() {
      while (!cancelled && nextBatch < batches.length) {
        const batch = batches[nextBatch++];
        await readBatch(batch);
      }
    }
    void Promise.all([worker(), worker()]);
    return () => {
      cancelled = true;
    };
  }, [api, paths, active]);

  function card(entry: InventoryItem, position: number) {
    if (!snapshot) return null;
    const name = itemName(snapshot, entry);
    const description = itemDescription(snapshot, entry);
    const path = description?.icon;
    const specific = snapshot.itemDescriptions?.[entry.id];
    const wear = specific?.details.find((detail) =>
      ["Factory New", "Minimal Wear", "Field-Tested", "Well-Worn", "Battle Scarred"].includes(
        detail,
      ),
    );
    const border = qualityColor(snapshot, entry.quality);
    return (
      <button
        type="button"
        key={entry.id}
        aria-pressed={selected === entry.id}
        aria-label={`${name}, ${QUALITY_NAMES[entry.quality] ?? "Unknown quality"}, ${position ? `slot ${position}` : "unplaced"}`}
        title={name}
        onClick={() => setSelected(entry.id)}
        className={`inventory-item ${selected === entry.id ? "inventory-item-selected" : ""}`}
        style={{ borderColor: border }}
      >
        <span className="t-meta absolute top-1 left-1.5 text-ink-faint">{position || "New"}</span>
        {selected === entry.id ? (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full bg-brand"
          />
        ) : null}
        {specific?.patternIcon ? (
          <WarPaintArtwork
            itemIcon={path ? icons[path] : undefined}
            pattern={icons[specific.patternIcon]}
          />
        ) : path && icons[path] && specific?.targetIcon ? (
          <KitArtwork kit={icons[path]} target={icons[specific.targetIcon]} />
        ) : path && icons[path] ? (
          <img src={icons[path]} alt="" className="h-14 w-full object-contain" />
        ) : (
          <span className="flex h-14 w-full items-center justify-center" aria-hidden="true">
            <Cube size={28} className="text-ink-faint" />
          </span>
        )}
        {specific?.patternIcon && wear ? (
          <span className="inventory-wear-label" title="Wear tier; texture wear is not rendered">
            {wear}
          </span>
        ) : null}
        <span className="line-clamp-2 min-h-8 w-full break-words text-center text-xs leading-4">
          {name}
        </span>
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
            className="input tnum w-14 text-center"
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
    <div data-testid="settings-inventory" className="enter-fade">
      <PaneHeader
        compact
        title="Inventory"
        actions={
          <>
            <span className="badge">Development preview</span>
            {error ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={loading || running || busy}
                onClick={() => void refresh()}
              >
                Retry connection
              </button>
            ) : null}
          </>
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
          <div className="mb-4 flex flex-wrap items-start justify-between gap-4 border-b border-edge py-3">
            <div className="flex min-w-0 items-center gap-3">
              {snapshot.avatar ? (
                <img
                  src={snapshot.avatar}
                  alt="Steam avatar"
                  className="size-10 rounded-md object-cover"
                />
              ) : (
                <span className="flex size-10 items-center justify-center rounded-md bg-panel">
                  <User size={24} className="text-ink-muted" aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <h2 className="t-row break-words">{snapshot.personaName || "Your backpack"}</h2>
                <p className="t-meta">
                  {snapshot.items.length.toLocaleString()} items ·{" "}
                  {snapshot.capacity.toLocaleString()} slots
                </p>
              </div>
            </div>
            <div className="max-w-lg">
              <p className="t-meta" role="status">
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
          </div>
          {snapshot.warning ? (
            <p role="status" className="mb-4 text-warn">
              {snapshot.warning}
            </p>
          ) : null}
          <div className="inventory-workspace">
            <div className="min-w-0">
              <label className="relative mb-3 block">
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
                  className="input w-full pl-9"
                />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
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
                    {[null, ...new Set(snapshot.items.map((entry) => entry.quality))].map(
                      (value) => (
                        <button
                          key={value ?? "all"}
                          type="button"
                          aria-pressed={quality === value}
                          onClick={() => {
                            setQuality(value);
                            setPage(1);
                          }}
                          className={`btn btn-ghost ${quality === value ? "ring-1 ring-brand bg-brand/6" : ""}`}
                        >
                          {value === null
                            ? "All qualities"
                            : (QUALITY_NAMES[value] ?? `Quality ${value}`)}
                        </button>
                      ),
                    )}
                  </fieldset>
                </details>
              </div>
              <div className="inventory-paging">
                <p role="status" className="t-meta">
                  {view.filtered
                    ? `${view.matchCount} items · View only`
                    : `Slots ${(view.current - 1) * 50 + 1}–${Math.min(view.current * 50, snapshot.capacity)}`}
                </p>
                {navigation()}
              </div>
              <section
                ref={grid}
                className="inventory-grid"
                style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
                aria-label="Backpack items"
              >
                {view.slots.map(({ position, item }) =>
                  item ? (
                    card(item, position)
                  ) : (
                    <div key={`empty-${position}`} className="inventory-empty">
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
                <section className="mt-6 border-t border-edge pt-4">
                  <h2 className="t-section">Unplaced items</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {view.unplaced.map((entry) => (
                      <button
                        type="button"
                        key={entry.id}
                        aria-pressed={selected === entry.id}
                        className="btn btn-ghost"
                        onClick={() => setSelected(entry.id)}
                      >
                        {itemName(snapshot, entry)}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
            <section
              aria-label="Item details"
              className="inventory-detail surface p-4"
              style={{ borderColor: item ? qualityColor(snapshot, item.quality) : undefined }}
            >
              {item ? (
                <>
                  {detailPatternIcon ? (
                    <WarPaintArtwork
                      itemIcon={definition?.icon ? icons[definition.icon] : undefined}
                      pattern={icons[detailPatternIcon]}
                      large
                    />
                  ) : definition?.icon && icons[definition.icon] ? (
                    detailTargetIcon ? (
                      <KitArtwork
                        kit={icons[definition.icon]}
                        target={icons[detailTargetIcon]}
                        large
                      />
                    ) : (
                      <img
                        src={icons[definition.icon]}
                        alt={itemName(snapshot, item)}
                        className="mb-4 h-40 w-full object-contain"
                      />
                    )
                  ) : (
                    <div className="mb-4 flex h-40 flex-col items-center justify-center gap-2 text-ink-faint">
                      <Cube size={40} aria-hidden="true" />
                      <span className="t-meta">
                        {definition?.icon && !unavailableIcons.current.has(definition.icon)
                          ? "Loading artwork…"
                          : "Artwork unavailable"}
                      </span>
                    </div>
                  )}
                  <h2 className="t-section break-words">{itemName(snapshot, item)}</h2>
                  {item.customName && definition?.name ? (
                    <p className="t-meta mt-1">{definition.name}</p>
                  ) : null}
                  <p className="t-meta mt-1">
                    {QUALITY_NAMES[item.quality] ?? `Quality ${item.quality}`} · Level {item.level}
                  </p>
                  {detailPatternIcon ? (
                    <p className="t-meta mt-3">
                      Installed item icon and paint texture swatch, where available. In-game
                      mapping, wear and effects are not rendered.
                    </p>
                  ) : null}
                  {detailPatternIcon && unavailableIcons.current.has(detailPatternIcon) ? (
                    <p className="t-meta mt-2">
                      Pattern swatch unavailable in installed TF2 files.
                    </p>
                  ) : null}
                  {snapshot.itemDescriptions?.[item.id]?.details.length ? (
                    <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                      {snapshot.itemDescriptions[item.id].details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                  <details key={item.id} className="t-meta mt-4 border-t border-edge pt-3">
                    <summary className="cursor-pointer hover:text-ink">Item details</summary>
                    <p className="mt-2">{definition?.kind ?? "Unknown item type"}</p>
                    {definition?.classes.length ? (
                      <p className="mt-1 capitalize">{definition.classes.join(", ")}</p>
                    ) : null}
                    <p className="mt-1 break-all">
                      Item {item.id} · {item.position ? `Slot ${item.position}` : "Not placed"}
                    </p>
                  </details>
                </>
              ) : (
                <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center text-ink-faint">
                  <Cube size={40} aria-hidden="true" />
                  <p className="t-meta">Select an item for a closer look.</p>
                  <p className="t-meta">Browsing here does not move items in Steam.</p>
                </div>
              )}
            </section>
          </div>
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
