import { CaretLeft, CaretRight, Cube, MagnifyingGlass, User } from "@phosphor-icons/react";
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Modal } from "./components/ui/Modal";
import { Loading } from "./components/ui/Spinner";
import { useInventorySnapshot } from "./hooks/useInventorySnapshot";
import { clearInventoryCraftUncertainty, InventoryCrafting } from "./InventoryCrafting";
import { clearInventoryDeletionUncertainty, InventoryDeletion } from "./InventoryDeletion";
import { InventoryOrganizer } from "./InventoryOrganizer";
import { InventoryPolish, useInventoryPreferences } from "./InventoryPolish";
import type { Api } from "./lib/api";
import type { InventoryCapabilities, InventoryItem, InventorySnapshot } from "./lib/bridge";
import { executeReviewedInventoryOperation } from "./lib/inventory-operations";
import {
  inventoryLayout,
  inventoryLayoutChanges,
  moveInventoryItems,
  type OrganizerHistory,
  pushInventoryLayout,
  redoInventoryLayout,
  restoreInventoryLayout,
  sortInventoryLayout,
  undoInventoryLayout,
  verifyInventoryLayoutResult,
} from "./lib/inventory-organizer";
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
        <img draggable={false} src={itemIcon} alt="" className="inventory-paint-icon" />
      ) : pattern ? (
        <img draggable={false} src={pattern} alt="" className="inventory-paint-only-swatch" />
      ) : (
        <Cube size={large ? 40 : 28} className="text-ink-faint" />
      )}
      {itemIcon && pattern ? (
        <img draggable={false} src={pattern} alt="" className="inventory-paint-swatch" />
      ) : null}
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
      <img draggable={false} src={kit} alt="" className="inventory-kit-icon" />
      {target ? (
        <img draggable={false} src={target} alt="" className="inventory-kit-target" />
      ) : null}
    </span>
  );
}

export function InventoryPane({
  api,
  active,
  running,
  busy,
  onDraftChange,
  onOperationBusyChange,
}: {
  api: Api;
  active: boolean;
  running: boolean;
  busy: boolean;
  onDraftChange?: (dirty: boolean, reset: () => void) => void;
  onOperationBusyChange?: (busy: boolean) => void;
}) {
  const [draft, setDraft] = useState<{
    baseline: InventorySnapshot;
    history: OrganizerHistory;
  } | null>(null);
  const savedDrafts = useRef(
    new Map<string, { baseline: InventorySnapshot; history: OrganizerHistory }>(),
  );
  const [applying, setApplying] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const [uncertainAccounts, setUncertainAccounts] = useState<Set<string>>(() => new Set());
  const [craftBusy, setCraftBusy] = useState(false);
  const [capability, setCapability] = useState<InventoryCapabilities | null>(null);
  const [organizerError, setOrganizerError] = useState<string | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionAnchor = useRef<string | null>(null);
  const drag = useRef<{
    api: Api;
    steamId: string;
    baseline: InventorySnapshot;
    ids: string[];
  } | null>(null);
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  const dirty = !!draft && inventoryLayoutChanges(draft.baseline, draft.history.present).length > 0;
  const {
    snapshot: latestSnapshot,
    loading,
    error,
    updatedAt,
    refresh,
    replaceSnapshot,
  } = useInventorySnapshot(api, active, running, busy || dirty || applying || craftBusy);
  const operationContext = useRef({ api, account: latestSnapshot?.steamId });
  operationContext.current = { api, account: latestSnapshot?.steamId };
  const uncertain =
    !!latestSnapshot &&
    (uncertainAccounts.has(latestSnapshot.steamId) || !!latestSnapshot.pendingOperation);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const snapshot = useMemo(
    () =>
      dirty && draft && latestSnapshot?.steamId === draft.baseline.steamId
        ? {
            ...draft.baseline,
            items: draft.baseline.items.map((item) => ({
              ...item,
              position: draft.history.present[item.id],
            })),
          }
        : latestSnapshot,
    [dirty, draft, latestSnapshot],
  );
  const moves = draft ? inventoryLayoutChanges(draft.baseline, draft.history.present) : [];
  const preferences = useInventoryPreferences(latestSnapshot?.steamId);
  const protectedIds = preferences.protectedIds;
  const stale =
    !!draft &&
    !!latestSnapshot &&
    (latestSnapshot.steamId !== draft.baseline.steamId ||
      latestSnapshot.capacity !== draft.baseline.capacity ||
      JSON.stringify(latestSnapshot.items) !== JSON.stringify(draft.baseline.items));
  const resetDraft = useCallback(() => {
    if (!latestSnapshot) return;
    setDraft({
      baseline: latestSnapshot,
      history: { past: [], present: inventoryLayout(latestSnapshot), future: [] },
    });
    setOrganizerError(null);
  }, [latestSnapshot]);
  const resetAllDrafts = useCallback(() => {
    savedDrafts.current.clear();
    resetDraft();
  }, [resetDraft]);
  const anyDirty =
    dirty ||
    [...savedDrafts.current.values()].some(
      (saved) =>
        saved.baseline.steamId !== latestSnapshot?.steamId &&
        inventoryLayoutChanges(saved.baseline, saved.history.present).length > 0,
    );
  useEffect(() => {
    onDraftChange?.(anyDirty, resetAllDrafts);
  }, [anyDirty, resetAllDrafts, onDraftChange]);
  useEffect(() => {
    onOperationBusyChange?.(applying || craftBusy);
  }, [applying, craftBusy, onOperationBusyChange]);
  useEffect(() => {
    if (!anyDirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [anyDirty]);
  useEffect(() => {
    let cancelled = false;
    if (api.getInventoryCapabilities)
      void api
        .getInventoryCapabilities()
        .then((result) => {
          if (!cancelled) setCapability(result);
        })
        .catch(() => {
          if (!cancelled) setCapability(null);
        });
    return () => {
      cancelled = true;
    };
  }, [api]);
  useEffect(() => {
    if (!latestSnapshot) return;
    setDraft((current) => {
      if (
        current?.baseline.steamId === latestSnapshot.steamId &&
        inventoryLayoutChanges(current.baseline, current.history.present).length
      )
        return current;
      if (current && current.baseline.steamId !== latestSnapshot.steamId)
        savedDrafts.current.set(current.baseline.steamId, current);
      const saved = savedDrafts.current.get(latestSnapshot.steamId);
      if (current?.baseline.steamId !== latestSnapshot.steamId && saved) return saved;
      return {
        baseline: latestSnapshot,
        history: { past: [], present: inventoryLayout(latestSnapshot), future: [] },
      };
    });
  }, [latestSnapshot]);
  function moveTo(destination: number, ids: readonly string[] = selectedIds) {
    if (
      !draft ||
      stale ||
      busy ||
      running ||
      applying ||
      craftBusy ||
      uncertain ||
      preferences.storageError
    ) {
      setOrganizerError(
        !draft
          ? "No arrangement draft is loaded."
          : stale
            ? "The backpack changed. Reset and review a new draft."
            : running
              ? "Close TF2 before applying a draft."
              : busy
                ? "Wait for the current app operation to finish."
                : loading
                  ? "Wait for the backpack read to finish."
                  : applying || submitting.current || craftBusy
                    ? "An inventory operation is already in progress."
                    : uncertain
                      ? "Read a fresh backpack before another attempt."
                      : preferences.storageError || "Live Steam Apply is unavailable.",
      );
      return;
    }
    try {
      const next = moveInventoryItems(
        draft.baseline,
        draft.history.present,
        ids,
        destination,
        protectedIds,
      );
      setDraft({ ...draft, history: pushInventoryLayout(draft.history, next) });
      setOrganizerError(null);
      setOperationMessage("Draft updated. Review changes before Apply.");
    } catch (reason) {
      setOrganizerError(String(reason));
    }
  }
  function changeHistory(history: OrganizerHistory) {
    if (!draft || uncertain || busy || running || applying || craftBusy) return;
    try {
      restoreInventoryLayout(draft.baseline, draft.history.present, history.present, protectedIds);
      setDraft({ ...draft, history });
      setOrganizerError(null);
    } catch (reason) {
      setOrganizerError(String(reason));
    }
  }
  async function applyDraft() {
    if (
      !draft ||
      stale ||
      running ||
      busy ||
      loading ||
      applying ||
      submitting.current ||
      uncertain ||
      craftBusy ||
      preferences.storageError ||
      (capability?.organizer !== "simulation" && capability?.organizer !== "live")
    ) {
      setOrganizerError(
        !draft
          ? "No arrangement draft is loaded."
          : stale
            ? "The backpack changed. Reset and review a new draft."
            : running
              ? "Close TF2 before applying a draft."
              : busy
                ? "Wait for the current app operation to finish."
                : loading
                  ? "Wait for the backpack read to finish."
                  : applying || submitting.current || craftBusy
                    ? "An inventory operation is already in progress."
                    : uncertain
                      ? "Read a fresh backpack before another attempt."
                      : preferences.storageError || "Live Steam Apply is unavailable.",
      );
      return;
    }
    submitting.current = true;
    setApplying(true);
    setOrganizerError(null);
    try {
      const request = {
        steamId: draft.baseline.steamId,
        baseline: draft.baseline,
        moves,
        protectedIds: [...protectedIds],
      };
      const rawResult =
        capability.organizer === "live"
          ? await executeReviewedInventoryOperation(
              api,
              { kind: "layout", ...request },
              () =>
                mounted.current &&
                operationContext.current.api === api &&
                operationContext.current.account === draft.baseline.steamId,
            )
          : await api.applyInventoryLayout(request);
      if (
        !mounted.current ||
        operationContext.current.api !== api ||
        operationContext.current.account !== draft.baseline.steamId
      ) {
        if (mounted.current)
          setOrganizerError(
            "The account or inventory connection changed while applying. Read a fresh backpack before another attempt.",
          );
        return;
      }
      const result = verifyInventoryLayoutResult(
        draft.baseline,
        moves,
        rawResult,
        capability.organizer === "live" ? "live" : "simulation",
      );
      preferences.recordOperation({
        kind: "move",
        outcome: result.status,
        summary: result.message,
        itemIds: moves.map((move) => move.id),
      });
      setOperationMessage(result.message);
      if (result.snapshot) {
        replaceSnapshot(result.snapshot);
        setDraft({
          baseline: result.snapshot,
          history: { past: [], present: inventoryLayout(result.snapshot), future: [] },
        });
      }
      if (result.status === "partial" || result.status === "unknown") {
        setUncertainAccounts((accounts) => new Set([...accounts, draft.baseline.steamId]));
        setOrganizerError(
          "The operation was not fully confirmed. Review the returned backpack before making another plan.",
        );
      }
    } catch (reason) {
      if (
        !mounted.current ||
        operationContext.current.api !== api ||
        operationContext.current.account !== draft.baseline.steamId
      )
        return;
      setUncertainAccounts((accounts) => new Set([...accounts, draft.baseline.steamId]));
      setOrganizerError(String(reason));
    } finally {
      submitting.current = false;
      setApplying(false);
    }
  }
  async function reconcileBackpack() {
    if (submitting.current || busy || running || craftBusy || loading) return;
    submitting.current = true;
    const account = latestSnapshot?.steamId;
    setApplying(true);
    try {
      const live =
        capability?.organizer === "live" ||
        capability?.crafting === "live" ||
        capability?.deletion === "live";
      let reconciliation = null;
      if (live && account) {
        try {
          reconciliation = await api.reconcileInventoryOperation(account);
        } catch {
          /* A completed/nonexistent journal is resolved only by a fresh read with no pending marker below. */
        }
      }
      if (
        reconciliation &&
        reconciliation.status !== "confirmed" &&
        reconciliation.status !== "refused"
      )
        throw Error(reconciliation.message);
      const next = reconciliation?.snapshot ?? (await api.getInventory());
      if (
        !mounted.current ||
        operationContext.current.api !== api ||
        operationContext.current.account !== account
      )
        return;
      inventoryLayout(next);
      if (next.steamId !== account || next.pendingOperation)
        throw Error(
          next.pendingOperation?.message || "The Steam account changed during reconciliation.",
        );
      replaceSnapshot(next);
      setDraft({
        baseline: next,
        history: { past: [], present: inventoryLayout(next), future: [] },
      });
      setUncertainAccounts(
        (accounts) => new Set([...accounts].filter((id) => id !== next.steamId)),
      );
      setSelectedIds([]);
      clearInventoryCraftUncertainty(api, next.steamId);
      clearInventoryDeletionUncertainty(api, next.steamId);
      setMode("browse");
      setOrganizerError(null);
      setOperationMessage(
        "Read a fresh backpack. The previous operation was not replayed; make and review a new draft if needed.",
      );
    } catch (reason) {
      setOrganizerError(String(reason));
    } finally {
      submitting.current = false;
      setApplying(false);
    }
  }
  const [mode, setMode] = useState<"browse" | "arrange" | "craft" | "delete">("browse");
  const dragPageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragPageDirection = useRef<number | null>(null);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const cancelDragPage = useCallback(() => {
    if (dragPageTimer.current !== null) clearTimeout(dragPageTimer.current);
    dragPageTimer.current = null;
    dragPageDirection.current = null;
  }, []);
  const [query, setQuery] = useState("");
  const [quality, setQuality] = useState<number | null>(null);
  const canArrange =
    active &&
    !!draft &&
    !stale &&
    !uncertain &&
    !running &&
    !busy &&
    !loading &&
    !applying &&
    !craftBusy &&
    !preferences.storageError &&
    mode !== "craft" &&
    mode !== "delete";
  const canDrag = canArrange && !query.trim() && quality === null;
  useEffect(() => {
    if (
      !canDrag ||
      (drag.current && (drag.current.api !== api || drag.current.baseline !== draft?.baseline))
    ) {
      cancelDragPage();
      drag.current = null;
      setDragSourceId(null);
      setDropSlot(null);
    }
  }, [canDrag, api, draft?.baseline, cancelDragPage]);
  useEffect(() => cancelDragPage, [cancelDragPage]);
  function beginDrag(event: DragEvent<HTMLElement>, id: string) {
    if (!canDrag || !draft || protectedIds.has(id)) {
      event.preventDefault();
      return;
    }
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (ids.some((itemId) => protectedIds.has(itemId))) {
      event.preventDefault();
      setOrganizerError("Unprotect selected items before moving them.");
      setMode("arrange");
      return;
    }
    drag.current = {
      api,
      steamId: draft.baseline.steamId,
      baseline: draft.baseline,
      ids: [...ids],
    };
    setDragSourceId(event.currentTarget.parentElement === grid.current ? id : null);
    event.dataTransfer.effectAllowed = "move";
    // IDs stay in this component; external drops cannot initiate or export a move.
    event.dataTransfer.setData("application/x-execs-inventory", "draft");
    setSelected(id);
    setSelectedIds([...ids]);
  }
  function endDrag() {
    cancelDragPage();
    drag.current = null;
    setDragSourceId(null);
    setDropSlot(null);
  }
  function allowDrop(event: DragEvent<HTMLElement>, position: number) {
    if (
      !canDrag ||
      position < 1 ||
      !draft ||
      drag.current?.api !== api ||
      drag.current.steamId !== draft.baseline.steamId ||
      drag.current.baseline !== draft.baseline
    )
      return;
    event.preventDefault();
    cancelDragPage();
    event.dataTransfer.dropEffect = "move";
    setDropSlot(position);
  }
  function dropItems(event: DragEvent<HTMLElement>, position: number) {
    const source = drag.current;
    if (
      !canDrag ||
      position < 1 ||
      !draft ||
      !source ||
      source.api !== api ||
      source.steamId !== draft.baseline.steamId ||
      source.baseline !== draft.baseline
    )
      return;
    event.preventDefault();
    endDrag();
    setMode("arrange");
    moveTo(position, source.ids);
  }
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const craftBackButton = useRef<HTMLButtonElement>(null);
  const deleteBackButton = useRef<HTMLButtonElement>(null);
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
    cancelDragPage();
    drag.current = null;
    setDragSourceId(null);
    setDropSlot(null);
    setSelected(null);
    setSelectedIds([]);
    selectionAnchor.current = null;
    setOrganizerError(null);
    setOperationMessage(null);
    setQuery("");
    iconCache.current = {};
    unavailableIcons.current.clear();
    setIcons({});
  }, [account, cancelDragPage]);
  const view = useMemo(
    () => (snapshot ? inventoryPage(snapshot, query, quality, page) : null),
    [snapshot, query, quality, page],
  );
  const grid = useRef<HTMLElement>(null);
  const pendingPageFocus = useRef<number | null>(null);
  const previousPage = useRef<number | null>(null);
  const currentPage = view?.current ?? null;
  useLayoutEffect(() => {
    const changed =
      previousPage.current !== null && currentPage !== null && previousPage.current !== currentPage;
    previousPage.current = currentPage;
    if (active && changed && !drag.current) {
      // Ordinary page clicks keep focus on the pager. Keyboard page changes
      // restore the relative slot so navigation can continue through the grid.
      grid.current?.scrollIntoView({ block: "start", behavior: "instant" });
      if (pendingPageFocus.current !== null) {
        const buttons = grid.current?.querySelectorAll<HTMLButtonElement>(
          "button:not([data-inventory-drag-source])",
        );
        buttons?.[Math.min(pendingPageFocus.current, buttons.length - 1)]?.focus();
      }
    }
    pendingPageFocus.current = null;
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
          ...(view?.unplaced ?? []),
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

  function card(entry: InventoryItem, position: number, retainedDragSource = false) {
    if (!snapshot) return null;
    const name = itemName(snapshot, entry);
    const description = itemDescription(snapshot, entry);
    const path = description?.icon;
    const specific = snapshot.itemDescriptions?.[entry.id];
    const border = qualityColor(snapshot, entry.quality);
    return (
      <button
        type="button"
        key={entry.id}
        data-inventory-drag-source={retainedDragSource || undefined}
        aria-hidden={retainedDragSource || undefined}
        tabIndex={retainedDragSource ? -1 : undefined}
        aria-pressed={selectedIds.includes(entry.id)}
        aria-label={`${name}, ${QUALITY_NAMES[entry.quality] ?? "Unknown quality"}, ${position ? `slot ${position}` : "unplaced"}`}
        title={`${name} · ${position ? `Slot ${position}` : "Unplaced"}`}
        onDoubleClick={() => {
          setSelected(entry.id);
          setDetailsOpen(true);
        }}
        draggable={canDrag && !protectedIds.has(entry.id)}
        onDragStart={(event) => beginDrag(event, entry.id)}
        onDragEnd={endDrag}
        onDragOver={(event) => allowDrop(event, position)}
        onDragLeave={() => setDropSlot(null)}
        onDrop={(event) => dropItems(event, position)}
        onClick={(event) => {
          setSelected(entry.id);
          const visible = view?.slots.flatMap((slot) => (slot.item ? [slot.item.id] : [])) ?? [];
          const anchor = selectionAnchor.current ? visible.indexOf(selectionAnchor.current) : -1;
          const target = visible.indexOf(entry.id);
          if (event.shiftKey && anchor >= 0 && target >= 0)
            setSelectedIds((ids) => [
              ...new Set([
                ...ids,
                ...visible.slice(Math.min(anchor, target), Math.max(anchor, target) + 1),
              ]),
            ]);
          else if (event.ctrlKey || event.metaKey)
            setSelectedIds((ids) =>
              ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : [...ids, entry.id],
            );
          else setSelectedIds([entry.id]);
          if (!event.shiftKey) selectionAnchor.current = entry.id;
        }}
        className={`inventory-item ${selectedIds.includes(entry.id) ? "inventory-item-selected" : ""} ${canDrag && !protectedIds.has(entry.id) ? "cursor-grab active:cursor-grabbing" : ""} ${dropSlot === position ? "ring-2 ring-brand" : ""}`}
        style={{
          borderColor: border,
          ...(retainedDragSource
            ? { position: "fixed", left: -10000, opacity: 0, pointerEvents: "none" }
            : {}),
        }}
      >
        <span className="inventory-slot-number">{position || "New"}</span>
        {selectedIds.includes(entry.id) ? (
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
          <img draggable={false} src={icons[path]} alt="" className="inventory-item-art" />
        ) : (
          <span className="inventory-missing-art" aria-hidden="true">
            <Cube size={28} className="text-ink-faint" />
          </span>
        )}
        <span className={path && icons[path] ? "sr-only" : "inventory-item-name"}>{name}</span>
      </button>
    );
  }
  function handleGridKey(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not([data-inventory-drag-source])",
      ),
    ];
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -10, ArrowDown: 10 }[event.key];
    if (delta !== undefined) {
      event.preventDefault();
      buttons[Math.max(0, Math.min(buttons.length - 1, index + delta))]?.focus();
    } else if ((event.key === "PageDown" || event.key === "PageUp") && view) {
      event.preventDefault();
      pendingPageFocus.current = index;
      setPage(
        ((view.current - 1 + (event.key === "PageDown" ? 1 : -1) + view.pages) % view.pages) + 1,
      );
    } else if (event.key === "Escape") {
      setSelectedIds([]);
      setSelected(null);
    }
  }
  function sortBackpack(sort: Exclude<InventorySort, "position">) {
    if (!canArrange || !draft) return;
    endDrag();
    try {
      const next = sortInventoryLayout(draft.baseline, draft.history.present, sort, protectedIds);
      setDraft({ ...draft, history: pushInventoryLayout(draft.history, next) });
      setQuery("");
      setQuality(null);
      setPage(1);
      setMode("arrange");
      setOrganizerError(null);
      setOperationMessage(
        "Backpack sorted in the draft. Protected items stay in place. Review changes before Apply.",
      );
    } catch (reason) {
      setOrganizerError(String(reason));
    }
  }
  function navigation() {
    if (!view) return null;
    const turnPage = (direction: number) =>
      setPage((current) => ((current - 1 + direction + view.pages) % view.pages) + 1);
    const dragToPage = (event: DragEvent<HTMLButtonElement>, direction: number) => {
      if (
        !canDrag ||
        !drag.current ||
        drag.current.api !== api ||
        drag.current.baseline !== draft?.baseline ||
        view.pages <= 1
      )
        return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      if (dragPageDirection.current === direction) return;
      cancelDragPage();
      dragPageDirection.current = direction;
      setDropSlot(null);
      const advance = () => {
        dragPageTimer.current = null;
        if (
          drag.current &&
          dragPageDirection.current === direction &&
          drag.current.api === operationContext.current.api &&
          drag.current.steamId === operationContext.current.account
        ) {
          turnPage(direction);
          dragPageTimer.current = setTimeout(advance, 650);
        } else cancelDragPage();
      };
      dragPageTimer.current = setTimeout(advance, 650);
    };
    const leaveArrow = (event: DragEvent<HTMLButtonElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        return;
      cancelDragPage();
    };
    const dropOnArrow = (event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      endDrag();
    };
    return (
      <nav aria-label="Backpack pages" className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          aria-label="Previous page"
          disabled={view.pages <= 1}
          title="Previous page · hold dragged items here to keep turning pages"
          onClick={() => turnPage(-1)}
          onDragOver={(event) => dragToPage(event, -1)}
          onDragLeave={leaveArrow}
          onDrop={dropOnArrow}
        >
          <CaretLeft size={14} className="pointer-events-none" />
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
          disabled={view.pages <= 1}
          title="Next page · hold dragged items here to keep turning pages"
          onClick={() => turnPage(1)}
          onDragOver={(event) => dragToPage(event, 1)}
          onDragLeave={leaveArrow}
          onDrop={dropOnArrow}
        >
          <CaretRight size={14} className="pointer-events-none" />
        </button>
      </nav>
    );
  }

  return (
    <div data-testid="settings-inventory" className="inventory-pane enter-fade">
      <header className="inventory-heading">
        <div className="flex min-w-0 items-center gap-3">
          {snapshot?.avatar ? (
            <img src={snapshot.avatar} alt="Steam avatar" className="size-8 rounded object-cover" />
          ) : (
            <User size={24} className="text-ink-muted" aria-hidden="true" />
          )}
          <div>
            <h1 className="t-pane" data-pane-heading tabIndex={-1}>
              Inventory
            </h1>
            {snapshot ? (
              <p className="t-meta">
                {snapshot.personaName || "Your backpack"} · {snapshot.items.length.toLocaleString()}{" "}
                items / {snapshot.capacity.toLocaleString()} slots
              </p>
            ) : null}
          </div>
        </div>
        <details className="inventory-about t-meta">
          <summary className="cursor-pointer">
            {capability?.organizer === "simulation"
              ? "Test backpack"
              : capability?.organizer === "live"
                ? "Steam backpack"
                : "Live backpack · local draft"}
          </summary>
          <div className="surface p-3">
            <p>
              {loading
                ? "Updating…"
                : `Updated ${updatedAt === null ? "" : new Date(updatedAt).toLocaleTimeString()}`}
            </p>
            <p className="mt-2">
              {capability?.organizer === "simulation"
                ? "This fixture never contacts Steam."
                : capability?.organizer === "live"
                  ? "Reads your signed-in Steam backpack. Confirmed operations change this Steam account; customization profiles are separate."
                  : "Reads your signed-in Steam backpack. This connection supports local arrangement drafts."}
            </p>
            {snapshot ? <p className="mt-2 break-all">Steam account {snapshot.steamId}</p> : null}
            <p className="mt-2">
              Refreshes while visible and focused. Steam may briefly show TF2 while connecting.
            </p>
            <button
              type="button"
              className="mt-2 underline"
              onClick={() => void api.openExternal("https://www.jengerer.com/item_manager/")}
            >
              Inspired by Jengerer’s Item Manager
            </button>
          </div>
        </details>
      </header>
      {running ? (
        <p className="t-meta mb-2">Close TF2 to refresh or arrange your backpack.</p>
      ) : null}
      {loading && !snapshot ? (
        <p role="status">
          <Loading>Reading your backpack from Steam…</Loading>
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="mb-3 text-warn">
          {error}
          {snapshot
            ? " Showing the last confirmed snapshot."
            : " Retrying while Inventory is open."}
          <button
            type="button"
            className="btn ml-2"
            disabled={loading || running || busy}
            onClick={() => void refresh()}
          >
            Retry connection
          </button>
        </div>
      ) : null}
      {snapshot && view ? (
        <>
          {snapshot.warning ? (
            <p role="status" className="mb-2 text-warn">
              {snapshot.warning}
            </p>
          ) : null}
          {uncertain ? (
            <div className="mb-3 rounded border border-edge p-3">
              <p role="alert">
                An operation has an unconfirmed outcome. Refresh before planning another change.
              </p>
              <button
                type="button"
                className="btn mt-2"
                disabled={busy || running || loading || applying || craftBusy}
                onClick={() => void reconcileBackpack()}
              >
                Refresh and discard old plan
              </button>
            </div>
          ) : null}
          <div className="inventory-search-row">
            <label className="relative flex-1">
              <span className="sr-only">Search items</span>
              <MagnifyingGlass
                size={16}
                aria-hidden="true"
                className="absolute top-3 left-3 text-ink-muted"
              />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="Search your backpack…"
                className="input w-full pl-9"
              />
            </label>
            <label className="sr-only" htmlFor="inventory-sort">
              Sort backpack
            </label>
            <select
              id="inventory-sort"
              className="input"
              value=""
              disabled={!canArrange}
              title="Rearrange the whole backpack; review and apply to Steam. Protected items stay in place."
              onChange={(event) => {
                const order = event.target.value;
                if (order === "name" || order === "quality" || order === "type")
                  sortBackpack(order);
              }}
            >
              <option value="" disabled>
                Sort backpack…
              </option>
              <option value="name">Sort by name</option>
              <option value="quality">Sort by quality</option>
              <option value="type">Sort by type</option>
            </select>
            <label className="sr-only" htmlFor="inventory-quality">
              Filter quality
            </label>
            <select
              id="inventory-quality"
              className="input"
              value={quality ?? "all"}
              onChange={(event) => {
                setQuality(event.target.value === "all" ? null : Number(event.target.value));
                setPage(1);
              }}
            >
              <option value="all">All qualities</option>
              {[...new Set(snapshot.items.map((i) => i.quality))]
                .sort((a, b) => a - b)
                .map((value) => (
                  <option key={value} value={value}>
                    {QUALITY_NAMES[value] ?? `Quality ${value}`}
                  </option>
                ))}
            </select>
          </div>
          {draft ? (
            <InventoryOrganizer
              snapshot={draft.baseline}
              selectedIds={selectedIds}
              hiddenCount={
                selectedIds.filter((id) => !view.slots.some((slot) => slot.item?.id === id)).length
              }
              history={draft.history}
              moves={moves}
              capability={capability}
              disabled={busy || running || loading || applying || craftBusy || uncertain}
              stale={stale}
              error={organizerError || preferences.storageError}
              message={operationMessage}
              applying={applying}
              onMove={moveTo}
              onUndo={() => changeHistory(undoInventoryLayout(draft.history))}
              onRedo={() => changeHistory(redoInventoryLayout(draft.history))}
              onReset={resetDraft}
              onClear={() => setSelectedIds([])}
              onSelectVisible={() =>
                setSelectedIds(view.slots.flatMap((slot) => (slot.item ? [slot.item.id] : [])))
              }
              onApply={applyDraft}
            />
          ) : null}
          <div className="inventory-paging">
            <p role="status" className="t-meta">
              {view.filtered
                ? `${view.matchCount} matches · clear filters to drag items`
                : `Slots ${(view.current - 1) * 50 + 1}–${Math.min(view.current * 50, snapshot.capacity)}`}
            </p>
            {view.filtered ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setQuery("");
                  setQuality(null);
                  setPage(1);
                }}
              >
                Back to backpack
              </button>
            ) : null}
            {navigation()}
          </div>
          <section
            ref={grid}
            className="inventory-grid"
            aria-label="Backpack items"
            onKeyDown={handleGridKey}
          >
            {[
              ...view.slots.map((slot) => ({ ...slot, retained: false })),
              // Keep the actual browser drag source mounted across page turns.
              // Its stable key preserves the native drag until the final drop.
              ...snapshot.items
                .filter(
                  (entry) =>
                    entry.id === dragSourceId &&
                    !view.slots.some((slot) => slot.item?.id === entry.id),
                )
                .map((item) => ({ position: item.position, item, retained: true })),
            ].map(({ position, item, retained }) =>
              item ? (
                card(item, position, retained)
              ) : (
                <button
                  type="button"
                  key={`empty-${position}`}
                  data-inventory-slot={position}
                  aria-label={`Empty slot ${position}`}
                  title={
                    selectedIds.length
                      ? `Move selected items to slot ${position}`
                      : `Empty slot ${position}`
                  }
                  className={`inventory-empty ${dropSlot === position ? "inventory-drop-target" : ""}`}
                  onClick={() => {
                    setSelectedIds([]);
                    setSelected(null);
                  }}
                  onDragOver={(event) => allowDrop(event, position)}
                  onDragLeave={() => setDropSlot(null)}
                  onDrop={(event) => dropItems(event, position)}
                >
                  <span>{position}</span>
                </button>
              ),
            )}
          </section>
          {view.filtered && view.matchCount === 0 ? (
            <p className="t-meta py-6">No items match this search.</p>
          ) : null}
          <div className="inventory-bottom-bar">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink">
                {item ? itemName(snapshot, item) : "Select an item"}
              </p>
              <p className="t-meta">
                {item
                  ? `${QUALITY_NAMES[item.quality] ?? "Unknown quality"} · ${item.position ? `Slot ${item.position}` : "Unplaced"}`
                  : "Drag to move · Ctrl-click to select more · Shift-click for a range"}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!item}
              onClick={() => setDetailsOpen(true)}
            >
              Inspect
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || running || loading || applying || craftBusy}
              onClick={() => setMode("craft")}
            >
              Craft selected
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={
                selectedIds.length !== 1 || busy || running || loading || applying || craftBusy
              }
              onClick={() => setMode("delete")}
            >
              Delete selected
            </button>
          </div>
          {view.unplaced.length ? (
            <section className="inventory-unplaced">
              <h2 className="t-meta">Unplaced items · drag into your backpack</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                {view.unplaced.map((entry) => card(entry, 0))}
              </div>
            </section>
          ) : null}
          <details className="inventory-extra-tools">
            <summary className="t-meta cursor-pointer">
              Saved layouts, favorites and history
            </summary>
            {draft ? (
              <InventoryPolish
                snapshot={snapshot}
                selectedIds={selectedIds}
                query={query}
                quality={quality}
                sort="position"
                positions={draft.history.present}
                preferences={preferences}
                disabled={busy || running || loading || applying || craftBusy || uncertain}
                onSearch={(search) => {
                  setQuery(search.query);
                  setQuality(search.quality);
                  // Old saved view orders never silently rearrange the backpack.
                  setPage(1);
                }}
                onRestoreLayout={(positions) => {
                  try {
                    if (stale) throw Error("Reset the stale draft before restoring a layout.");
                    const next = restoreInventoryLayout(
                      draft.baseline,
                      draft.history.present,
                      positions,
                      protectedIds,
                    );
                    setDraft({ ...draft, history: pushInventoryLayout(draft.history, next) });
                    setMode("arrange");
                    setOrganizerError(null);
                  } catch (reason) {
                    setOrganizerError(String(reason));
                    throw reason;
                  }
                }}
                onSelectIds={setSelectedIds}
              />
            ) : null}
          </details>
          <Modal
            open={mode === "craft"}
            title="Craft items"
            initialFocusRef={craftBackButton}
            className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(600px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
            onClose={() => {
              if (!craftBusy) setMode("browse");
            }}
          >
            <InventoryCrafting
              key={snapshot.steamId}
              snapshot={snapshot}
              selectedIds={selectedIds}
              protectedIds={protectedIds}
              disabled={
                busy ||
                running ||
                loading ||
                applying ||
                dirty ||
                stale ||
                uncertain ||
                !!error ||
                !!preferences.storageError
              }
              disabledReason={
                dirty
                  ? "Apply or reset your arrangement draft before crafting."
                  : running
                    ? "Close TF2 before crafting."
                    : error
                      ? "Refresh a complete backpack before crafting."
                      : preferences.storageError || undefined
              }
              capability={capability?.crafting ?? "unavailable"}
              api={api}
              onBusyChange={setCraftBusy}
              onResult={(result) => {
                if (
                  !mounted.current ||
                  operationContext.current.api !== api ||
                  operationContext.current.account !== snapshot.steamId
                )
                  return;
                if (result.status === "partial" || result.status === "unknown")
                  setUncertainAccounts((accounts) => new Set([...accounts, snapshot.steamId]));
                preferences.recordOperation({
                  kind: "craft",
                  outcome: result.status,
                  summary: result.message,
                  itemIds: [...result.consumedIds, ...result.acquiredIds],
                });
                if (result.snapshot) {
                  replaceSnapshot(result.snapshot);
                  setDraft({
                    baseline: result.snapshot,
                    history: {
                      past: [],
                      present: inventoryLayout(result.snapshot),
                      future: [],
                    },
                  });
                  setSelectedIds([]);
                  setSelected(null);
                }
              }}
            />
            <div className="mt-4 flex justify-end">
              <button
                ref={craftBackButton}
                type="button"
                className="btn btn-ghost"
                disabled={craftBusy}
                onClick={() => setMode("browse")}
              >
                Back to backpack
              </button>
            </div>
          </Modal>
          <Modal
            open={mode === "delete"}
            title="Delete one item"
            initialFocusRef={deleteBackButton}
            className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(520px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
            onClose={() => {
              if (!craftBusy) setMode("browse");
            }}
          >
            <InventoryDeletion
              key={snapshot.steamId}
              snapshot={snapshot}
              selectedIds={selectedIds}
              protectedIds={protectedIds}
              capability={capability?.deletion ?? "unavailable"}
              api={api}
              disabled={
                busy ||
                running ||
                loading ||
                applying ||
                dirty ||
                stale ||
                uncertain ||
                !!error ||
                !!preferences.storageError
              }
              disabledReason={
                dirty
                  ? "Apply or reset the arrangement draft before deleting an item."
                  : running
                    ? "Close TF2 before deleting an item."
                    : uncertain
                      ? "Reconcile the unresolved operation before deleting an item."
                      : error
                        ? "Refresh a complete backpack before deleting an item."
                        : preferences.storageError || undefined
              }
              onBusyChange={setCraftBusy}
              onResult={(result) => {
                if (
                  !mounted.current ||
                  operationContext.current.api !== api ||
                  operationContext.current.account !== snapshot.steamId
                )
                  return;
                if (result.status === "partial" || result.status === "unknown")
                  setUncertainAccounts((accounts) => new Set([...accounts, snapshot.steamId]));
                preferences.recordOperation({
                  kind: "delete",
                  outcome: result.status,
                  summary: result.message,
                  itemIds: result.deletedIds.length ? result.deletedIds : selectedIds,
                });
                if (result.snapshot) {
                  replaceSnapshot(result.snapshot);
                  setDraft({
                    baseline: result.snapshot,
                    history: { past: [], present: inventoryLayout(result.snapshot), future: [] },
                  });
                  setSelectedIds([]);
                  setSelected(null);
                }
              }}
            />
            <div className="mt-4 flex justify-end">
              <button
                ref={deleteBackButton}
                type="button"
                className="btn btn-ghost"
                disabled={craftBusy}
                onClick={() => setMode("browse")}
              >
                Cancel
              </button>
            </div>
          </Modal>
          <Modal
            open={detailsOpen && !!item}
            title="Inspect item"
            className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
            onClose={() => setDetailsOpen(false)}
          >
            <section
              aria-label="Item details"
              className="inventory-detail"
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
                        {definition?.icon && !unavailableIcons.current.has(definition.icon) ? (
                          <Loading>Loading artwork…</Loading>
                        ) : (
                          "Artwork unavailable"
                        )}
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
            <button type="button" className="btn mt-4" onClick={() => setDetailsOpen(false)}>
              Close details
            </button>
          </Modal>
        </>
      ) : !loading ? (
        <p className="t-meta py-8">
          Your backpack loads automatically with Steam signed in and TF2 closed.
        </p>
      ) : null}
    </div>
  );
}
