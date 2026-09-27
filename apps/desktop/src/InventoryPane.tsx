import {
  ArrowClockwise,
  ArrowCounterClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  Cube,
  DotsThree,
  Info,
  Lock,
  MagnifyingGlass,
  SortAscending,
  Star,
  User,
  X,
} from "@phosphor-icons/react";
import {
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from "./components/ui/ContextMenu";
import { Modal } from "./components/ui/Modal";
import { Loading, LoadingState, Spinner } from "./components/ui/Spinner";
import { useInventorySnapshot } from "./hooks/useInventorySnapshot";
import { type SteamImageRequest, useSteamItemArt } from "./hooks/useSteamItemArt";
import { clearInventoryCraftUncertainty, InventoryCrafting } from "./InventoryCrafting";
import { clearInventoryDeletionUncertainty, InventoryDeletion } from "./InventoryDeletion";
import {
  InventoryInspect,
  InventoryItemHeading,
  InventoryItemLines,
  inventoryItemArt,
} from "./InventoryItemView";
import { InventoryMoveDialog, InventoryReviewDialog } from "./InventoryOrganizer";
import {
  InventoryPolish,
  type InventoryPolishTab,
  useInventoryPreferences,
} from "./InventoryPolish";
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
  INVENTORY_PAGE_SIZE,
  type InventorySort,
  inventoryPage,
  itemDescription,
  itemTitle,
  QUALITY_NAMES,
  qualityColor,
} from "./lib/inventory-ui";
import { animate } from "./lib/motion";

const ICON_BATCH_SIZE = 8;
const HOLD_PAGE_MS = 650;
const EASE_OUT = "cubic-bezier(0.2, 0, 0, 1)";
const SHEET =
  "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6";
const SORTS: { id: Exclude<InventorySort, "position">; label: string }[] = [
  { id: "name", label: "By name" },
  { id: "quality", label: "By quality" },
  { id: "type", label: "By type" },
];

function isPattern(path: string | null | undefined): boolean {
  return Boolean(path?.startsWith("materials/patterns/"));
}

/** Shows the current page; typing a number jumps there on Enter or blur. */
function PageField({
  current,
  pages,
  onChange,
}: {
  current: number;
  pages: number;
  onChange: (page: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft !== null && draft !== "") onChange(Math.min(pages, Math.max(1, Number(draft))));
    setDraft(null);
  }
  return (
    <input
      aria-label="Backpack page"
      className="inventory-page-input tnum"
      inputMode="numeric"
      style={{ width: `${String(pages).length + 2}ch` }}
      value={draft ?? String(current)}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 5))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type MenuState = { kind: "quality" | "sort" | "more"; x: number; y: number };
type DropPreview = { slot: number; valid: boolean; landing: Set<number>; reason: string | null };
type Hover = { id: string; left: number; top: number; below: boolean };

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
  // Mirrors `drag` for rendering: dims the carried items and pauses refreshes.
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const dirty = !!draft && inventoryLayoutChanges(draft.baseline, draft.history.present).length > 0;
  const {
    snapshot: latestSnapshot,
    loading,
    error,
    updatedAt,
    refresh,
    replaceSnapshot,
  } = useInventorySnapshot(
    api,
    active,
    running,
    busy || dirty || applying || craftBusy || draggingIds.length > 0,
  );
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
  const favoriteIds = preferences.favoriteIds;
  const stale =
    !!draft &&
    !!latestSnapshot &&
    (latestSnapshot.steamId !== draft.baseline.steamId ||
      latestSnapshot.capacity !== draft.baseline.capacity ||
      JSON.stringify(latestSnapshot.items) !== JSON.stringify(draft.baseline.items));
  // Layout changes animate: sliding items to new slots, landing dropped items.
  const layoutMotion = useRef<{ kind: "shift" | "drop"; ids: Set<string> } | null>(null);
  const resetDraft = useCallback(() => {
    if (!latestSnapshot) return;
    layoutMotion.current = { kind: "shift", ids: new Set() };
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
  // Success notes fade on their own; errors stay until the next action or dismissal.
  useEffect(() => {
    if (!operationMessage) return;
    const timer = setTimeout(() => setOperationMessage(null), 8000);
    return () => clearTimeout(timer);
  }, [operationMessage]);
  function blockedReason(): string | null {
    return !draft
      ? "No arrangement draft is loaded."
      : stale
        ? "The backpack changed. Reset and review a new draft."
        : running
          ? "Close TF2 before arranging your backpack."
          : busy
            ? "Wait for the current app operation to finish."
            : applying || submitting.current || craftBusy
              ? "An inventory operation is already in progress."
              : uncertain
                ? "Read a fresh backpack before another attempt."
                : preferences.storageError || null;
  }
  function moveTo(
    destination: number,
    ids: readonly string[] = selectedIds,
    motion: "shift" | "drop" = "shift",
  ) {
    const reason = blockedReason();
    if (reason || !draft) {
      setOrganizerError(reason);
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
      layoutMotion.current = { kind: motion, ids: new Set(ids) };
      setDraft({ ...draft, history: pushInventoryLayout(draft.history, next) });
      setOrganizerError(null);
      setOperationMessage(null);
    } catch (reason) {
      setOrganizerError(errorText(reason));
    }
  }
  function changeHistory(history: OrganizerHistory) {
    if (!draft || uncertain || busy || running || applying || craftBusy) return;
    try {
      restoreInventoryLayout(draft.baseline, draft.history.present, history.present, protectedIds);
      layoutMotion.current = { kind: "shift", ids: new Set() };
      setDraft({ ...draft, history });
      setOrganizerError(null);
    } catch (reason) {
      setOrganizerError(errorText(reason));
    }
  }
  async function applyDraft() {
    // A repeated click while the first request is in flight is not an error.
    if (submitting.current) return;
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
        loading && !blockedReason()
          ? "Wait for the backpack read to finish."
          : blockedReason() || "Live Steam Apply is unavailable.",
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
          `${result.message} The operation was not fully confirmed. Review the returned backpack before making another plan.`,
        );
      } else if (result.status === "refused") setOrganizerError(result.message);
      else {
        setOrganizerError(null);
        setOperationMessage(result.message);
      }
    } catch (reason) {
      if (
        !mounted.current ||
        operationContext.current.api !== api ||
        operationContext.current.account !== draft.baseline.steamId
      )
        return;
      setUncertainAccounts((accounts) => new Set([...accounts, draft.baseline.steamId]));
      setOrganizerError(errorText(reason));
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
      setOrganizerError(errorText(reason));
    } finally {
      submitting.current = false;
      setApplying(false);
    }
  }
  const [mode, setMode] = useState<"browse" | "craft" | "delete" | "reveal">("browse");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [toolsTab, setToolsTab] = useState<InventoryPolishTab | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const about = useRef<HTMLDivElement>(null);
  const dragPageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragPageDirection = useRef<number | null>(null);
  const [armedArrow, setArmedArrow] = useState<number | null>(null);
  const [dragSourceId, setDragSourceId] = useState<string | null>(null);
  const cancelDragPage = useCallback(() => {
    if (dragPageTimer.current !== null) clearTimeout(dragPageTimer.current);
    dragPageTimer.current = null;
    dragPageDirection.current = null;
    setArmedArrow(null);
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
    !applying &&
    !craftBusy &&
    !preferences.storageError &&
    mode === "browse";
  const canDrag = canArrange && !query.trim() && quality === null;
  const clearDrag = useCallback(() => {
    cancelDragPage();
    drag.current = null;
    setDragSourceId(null);
    setDraggingIds([]);
    setDropPreview(null);
  }, [cancelDragPage]);
  useEffect(() => {
    if (
      !canDrag ||
      (drag.current && (drag.current.api !== api || drag.current.baseline !== draft?.baseline))
    )
      clearDrag();
  }, [canDrag, api, draft?.baseline, clearDrag]);
  useEffect(() => cancelDragPage, [cancelDragPage]);
  const [page, setPage] = useState(1);
  // +1 / -1 while a page turn is in flight, so the grid slides the matching way.
  const pageTurn = useRef(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Hats a random-hat craft just produced, shown until dismissed.
  const [reveal, setReveal] = useState<{ ids: string[] } | null>(null);
  const craftBackButton = useRef<HTMLButtonElement>(null);
  const deleteBackButton = useRef<HTMLButtonElement>(null);
  const toolsDoneButton = useRef<HTMLButtonElement>(null);
  const detailsCloseButton = useRef<HTMLButtonElement>(null);
  const revealDoneButton = useRef<HTMLButtonElement>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [, setArtworkRevision] = useState(0);
  const iconCache = useRef<Record<string, string>>({});
  const unavailableIcons = useRef(new Set<string>());
  const [hover, setHover] = useState<Hover | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const account = snapshot?.steamId;
  const previousAccount = useRef(account);
  useEffect(() => {
    if (account === previousAccount.current) return;
    previousAccount.current = account;
    setPage(1);
    setQuality(null);
    clearDrag();
    setSelected(null);
    setSelectedIds([]);
    selectionAnchor.current = null;
    setOrganizerError(null);
    setOperationMessage(null);
    setQuery("");
    iconCache.current = {};
    unavailableIcons.current.clear();
    setIcons({});
  }, [account, clearDrag]);
  useEffect(() => {
    if (!aboutOpen) return;
    const close = (event: Event) => {
      if (
        "key" in event
          ? event.key === "Escape"
          : !about.current?.contains(event.target as Node | null)
      )
        setAboutOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close, true);
    };
  }, [aboutOpen]);
  const cancelHover = useCallback(() => {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setHover(null);
  }, []);
  useEffect(() => cancelHover, [cancelHover]);
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
      grid.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
      if (pendingPageFocus.current !== null) {
        const buttons = grid.current?.querySelectorAll<HTMLButtonElement>(
          "button:not([data-inventory-drag-source])",
        );
        buttons?.[Math.min(pendingPageFocus.current, buttons.length - 1)]?.focus();
      }
    }
    pendingPageFocus.current = null;
  }, [active, currentPage]);

  // Motion: a page turn slides the grid; a layout change slides each moved item
  // from its old slot (FLIP) and lets newly arrived or dropped items settle in.
  const tilePositions = useRef<{ page: number | null; at: Map<string, { x: number; y: number }> }>({
    page: null,
    at: new Map(),
  });
  const firstPaint = useRef(true);
  useLayoutEffect(() => {
    const root = grid.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const tiles = new Map<string, HTMLElement>();
    const at = new Map<string, { x: number; y: number }>();
    for (const tile of root.querySelectorAll<HTMLElement>(
      ":scope > [data-item-id]:not([data-inventory-drag-source])",
    )) {
      const id = tile.dataset.itemId ?? "";
      const box = tile.getBoundingClientRect();
      tiles.set(id, tile);
      at.set(id, { x: box.left - origin.left, y: box.top - origin.top });
    }
    const previous = tilePositions.current;
    const turned = previous.page !== null && previous.page !== currentPage;
    const motion = layoutMotion.current;
    layoutMotion.current = null;
    if (turned) {
      const direction = pageTurn.current || 1;
      animate(
        root,
        [
          { transform: `translateX(${direction * 18}px)`, opacity: 0.25 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 220, easing: EASE_OUT },
      );
    } else if (motion || (firstPaint.current && tiles.size)) {
      let entering = 0;
      for (const [id, tile] of tiles) {
        const from = previous.at.get(id);
        const to = at.get(id);
        if (!to) continue;
        if (motion?.kind === "drop" && motion.ids.has(id)) {
          animate(tile, [{ transform: "scale(0.9)" }, { transform: "none" }], {
            duration: 220,
            easing: EASE_OUT,
          });
        } else if (from && !firstPaint.current) {
          if (from.x !== to.x || from.y !== to.y)
            animate(
              tile,
              [
                { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)` },
                { transform: "none" },
              ],
              { duration: 280, easing: EASE_OUT },
            );
        } else {
          animate(
            tile,
            [
              { opacity: 0, transform: "scale(0.94)" },
              { opacity: 1, transform: "none" },
            ],
            {
              duration: 200,
              delay: Math.min(entering++ * 10, 240),
              easing: EASE_OUT,
              fill: "backwards",
            },
          );
        }
      }
      if (tiles.size) firstPaint.current = false;
    }
    pageTurn.current = 0;
    tilePositions.current = { page: currentPage, at };
  });

  const item = snapshot?.items.find((entry) => entry.id === selected);
  const revealItems = useMemo(
    () => (snapshot?.items ?? []).filter((entry) => reveal?.ids.includes(entry.id)),
    [snapshot, reveal],
  );
  const paths = useMemo(
    () => [
      ...new Set(
        [
          ...(view?.slots.flatMap(({ item }) => (item ? [item] : [])) ?? []),
          ...(view?.unplaced ?? []),
          ...(item ? [item] : []),
          ...revealItems,
        ].flatMap((entry) => {
          const description = snapshot && itemDescription(snapshot, entry);
          const specific = snapshot?.itemDescriptions?.[entry.id];
          return [description?.icon, specific?.targetIcon, specific?.patternIcon].filter(
            (path): path is string => Boolean(path),
          );
        }),
      ),
    ],
    [view, snapshot, item, revealItems],
  );
  const [steamWanted, setSteamWanted] = useState<SteamImageRequest[]>([]);
  const steam = useSteamItemArt(api, snapshot, active, steamWanted);
  const steamItems = steam.items;
  useEffect(() => {
    const wanted: SteamImageRequest[] = [];
    for (const entry of [
      ...(view?.slots.flatMap(({ item }) => (item ? [item] : [])) ?? []),
      ...(view?.unplaced ?? []),
    ]) {
      const image = steamItems[entry.id]?.image;
      if (image) wanted.push({ image, size: 192 });
    }
    for (const entry of [...(item && detailsOpen ? [item] : []), ...revealItems]) {
      const image = steamItems[entry.id]?.image;
      if (image) wanted.push({ image, size: 360 });
    }
    const key = wanted.map((entry) => `${entry.size}:${entry.image}`).join("|");
    setSteamWanted((current) =>
      current.map((entry) => `${entry.size}:${entry.image}`).join("|") === key ? current : wanted,
    );
  }, [view, item, detailsOpen, revealItems, steamItems]);

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

  // Every candidate slot is judged once per drag and layout; the answer paints
  // where the carried items would land, or why they cannot.
  const dropCache = useRef<{ key: unknown; slot: number; result: DropPreview } | null>(null);
  function evaluateDrop(position: number): DropPreview {
    const source = drag.current;
    const key = draft?.history.present;
    const cached = dropCache.current;
    if (cached && cached.key === key && cached.slot === position) return cached.result;
    let result: DropPreview;
    try {
      if (!draft || !source) throw Error("Nothing is being moved.");
      const next = moveInventoryItems(
        draft.baseline,
        draft.history.present,
        source.ids,
        position,
        protectedIds,
      );
      result = {
        slot: position,
        valid: true,
        landing: new Set(source.ids.map((id) => next[id])),
        reason: null,
      };
    } catch (reason) {
      result = {
        slot: position,
        valid: false,
        landing: new Set([position]),
        reason: errorText(reason),
      };
    }
    dropCache.current = { key, slot: position, result };
    return result;
  }
  function beginDrag(event: DragEvent<HTMLElement>, id: string) {
    cancelHover();
    if (!canDrag || !draft || protectedIds.has(id)) {
      event.preventDefault();
      if (protectedIds.has(id))
        setOrganizerError(
          favoriteIds.has(id)
            ? "Favorites stay in place. Unfavorite this item to move it."
            : "Protected items stay in place. Unprotect this item to move it.",
        );
      return;
    }
    const ids = selectedIds.includes(id) ? selectedIds : [id];
    if (ids.some((itemId) => protectedIds.has(itemId))) {
      event.preventDefault();
      setOrganizerError("Unprotect selected items before moving them.");
      return;
    }
    drag.current = {
      api,
      steamId: draft.baseline.steamId,
      baseline: draft.baseline,
      ids: [...ids],
    };
    dropCache.current = null;
    setDragSourceId(event.currentTarget.parentElement === grid.current ? id : null);
    setDraggingIds([...ids]);
    setOrganizerError(null);
    event.dataTransfer.effectAllowed = "move";
    // IDs stay in this component; external drops cannot initiate or export a move.
    event.dataTransfer.setData("application/x-execs-inventory", "draft");
    if (ids.length > 1 && typeof event.dataTransfer.setDragImage === "function") {
      // A group carries a count badge on the grabbed tile's image.
      const ghost = event.currentTarget.cloneNode(true) as HTMLElement;
      const badge = document.createElement("span");
      badge.className = "inventory-drag-count";
      badge.textContent = String(ids.length);
      ghost.append(badge);
      const box = event.currentTarget.getBoundingClientRect();
      ghost.style.cssText = `position:fixed;top:-1000px;left:-1000px;width:${box.width}px;height:${box.height}px;`;
      document.body.append(ghost);
      event.dataTransfer.setDragImage(ghost, event.clientX - box.left, event.clientY - box.top);
      setTimeout(() => ghost.remove());
    }
    setSelected(id);
    setSelectedIds([...ids]);
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
    cancelDragPage();
    const preview = evaluateDrop(position);
    if (dropPreview?.slot !== position || dropPreview.valid !== preview.valid)
      setDropPreview(preview);
    if (!preview.valid) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }
  function leaveDrop(event: DragEvent<HTMLElement>, position: number) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
      return;
    setDropPreview((current) => (current?.slot === position ? null : current));
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
    clearDrag();
    moveTo(position, source.ids, "drop");
  }
  function select(event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, id: string) {
    setSelected(id);
    const visible = view?.slots.flatMap((slot) => (slot.item ? [slot.item.id] : [])) ?? [];
    const anchor = selectionAnchor.current ? visible.indexOf(selectionAnchor.current) : -1;
    const target = visible.indexOf(id);
    if (event.shiftKey && anchor >= 0 && target >= 0)
      setSelectedIds((ids) => [
        ...new Set([
          ...ids,
          ...visible.slice(Math.min(anchor, target), Math.max(anchor, target) + 1),
        ]),
      ]);
    else if (event.ctrlKey || event.metaKey)
      setSelectedIds((ids) =>
        ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id],
      );
    else setSelectedIds([id]);
    if (!event.shiftKey) selectionAnchor.current = id;
  }
  function showHover(target: HTMLElement, id: string) {
    if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null;
      const host = stage.current;
      if (!host || drag.current || !target.isConnected) return;
      const origin = host.getBoundingClientRect();
      const box = target.getBoundingClientRect();
      const below = box.top - origin.top < 96;
      setHover({
        id,
        left: Math.max(
          0,
          Math.min(box.left - origin.left + box.width / 2 - 120, origin.width - 240),
        ),
        top: below ? box.bottom - origin.top + 6 : box.top - origin.top - 6,
        below,
      });
    }, 450);
  }

  function card(entry: InventoryItem, position: number, retainedDragSource = false) {
    if (!snapshot) return null;
    const steamItem = steamItems[entry.id];
    const name = itemTitle(snapshot, entry, steamItem);
    const isSelected = selectedIds.includes(entry.id);
    const locked = protectedIds.has(entry.id);
    const draggable = canDrag && !locked;
    const drop = dropPreview?.landing.has(position) && position > 0 ? dropPreview : null;
    const art = inventoryItemArt({
      snapshot,
      item: entry,
      icons,
      steamImage: steamItem ? steam.image(steamItem.image, 192) : undefined,
    });
    return (
      <button
        type="button"
        key={entry.id}
        data-item-id={entry.id}
        data-inventory-drag-source={retainedDragSource || undefined}
        data-dragging={draggingIds.includes(entry.id) || undefined}
        data-drop={drop ? (drop.valid ? "ok" : "refused") : undefined}
        aria-hidden={retainedDragSource || undefined}
        tabIndex={retainedDragSource ? -1 : undefined}
        aria-pressed={isSelected}
        aria-label={`${name}, ${QUALITY_NAMES[entry.quality] ?? "Unknown quality"}, ${position ? `slot ${position}` : "unplaced"}`}
        onDoubleClick={() => {
          setSelected(entry.id);
          setDetailsOpen(true);
        }}
        draggable={draggable}
        onDragStart={(event) => beginDrag(event, entry.id)}
        onDragEnd={clearDrag}
        onDragOver={(event) => allowDrop(event, position)}
        onDragLeave={(event) => leaveDrop(event, position)}
        onDrop={(event) => dropItems(event, position)}
        onPointerEnter={(event) => showHover(event.currentTarget, entry.id)}
        onPointerLeave={cancelHover}
        onPointerDown={cancelHover}
        onClick={(event) => select(event, entry.id)}
        className={`inventory-item ${isSelected ? "inventory-item-selected" : ""}`}
        style={
          {
            "--quality": qualityColor(snapshot, entry.quality) ?? "var(--color-edge-strong)",
            ...(retainedDragSource
              ? { position: "fixed", left: -10000, opacity: 0, pointerEvents: "none" }
              : {}),
          } as CSSProperties
        }
      >
        {isSelected ? <span aria-hidden="true" className="inventory-item-dot" /> : null}
        {favoriteIds.has(entry.id) ? (
          <Star weight="fill" size={10} aria-hidden="true" className="inventory-item-flag" />
        ) : locked ? (
          <Lock weight="fill" size={10} aria-hidden="true" className="inventory-item-flag" />
        ) : null}
        {art ?? null}
        <span className={art ? "sr-only" : "inventory-item-name"}>{name}</span>
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
      turnPage(event.key === "PageDown" ? 1 : -1);
    } else if (event.key === "Escape") {
      setSelectedIds([]);
      setSelected(null);
    }
  }
  function handlePaneKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      target.closest("input, textarea, [role='dialog'], [role='menu']")
    )
      return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey && draft?.history.past.length) {
      event.preventDefault();
      changeHistory(undoInventoryLayout(draft.history));
    } else if ((key === "y" || (key === "z" && event.shiftKey)) && draft?.history.future.length) {
      event.preventDefault();
      changeHistory(redoInventoryLayout(draft.history));
    } else if (key === "a" && view && target.closest(".inventory-grid")) {
      event.preventDefault();
      setSelectedIds(view.slots.flatMap((slot) => (slot.item ? [slot.item.id] : [])));
    }
  }
  function sortBackpack(sort: Exclude<InventorySort, "position">) {
    if (!canArrange || !draft) return;
    clearDrag();
    try {
      const next = sortInventoryLayout(draft.baseline, draft.history.present, sort, protectedIds);
      layoutMotion.current = { kind: "shift", ids: new Set() };
      setDraft({ ...draft, history: pushInventoryLayout(draft.history, next) });
      setQuery("");
      setQuality(null);
      setPage(1);
      setOrganizerError(null);
      setOperationMessage(
        `Sorted ${SORTS.find((entry) => entry.id === sort)?.label.toLowerCase()}${protectedIds.size ? ". Protected items stayed in place" : ""}.`,
      );
    } catch (reason) {
      setOrganizerError(errorText(reason));
    }
  }
  function turnPage(direction: number) {
    if (!view) return;
    pageTurn.current = direction;
    setPage((current) => ((current - 1 + direction + view.pages) % view.pages) + 1);
  }
  function setFlag(kind: "favorite" | "protect", ids: string[], value: boolean) {
    try {
      if (kind === "favorite") preferences.setFavorite(ids, value);
      else preferences.setProtected(ids, value);
      setOrganizerError(null);
    } catch (reason) {
      setOrganizerError(errorText(reason));
    }
  }
  function openMenu(kind: MenuState["kind"], target: HTMLElement, width = 256) {
    const box = target.getBoundingClientRect();
    setMenu({
      kind,
      x: kind === "more" ? box.right - width : box.left,
      y: box.bottom + 4,
    });
  }
  function navigation() {
    if (!view) return null;
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
      setArmedArrow(direction);
      setDropPreview(null);
      const advance = () => {
        dragPageTimer.current = null;
        if (
          drag.current &&
          dragPageDirection.current === direction &&
          drag.current.api === operationContext.current.api &&
          drag.current.steamId === operationContext.current.account
        ) {
          turnPage(direction);
          // Restart the arrow's fill so each turn shows its own countdown.
          setArmedArrow(null);
          requestAnimationFrame(() => {
            if (dragPageDirection.current === direction) setArmedArrow(direction);
          });
          dragPageTimer.current = setTimeout(advance, HOLD_PAGE_MS);
        } else cancelDragPage();
      };
      dragPageTimer.current = setTimeout(advance, HOLD_PAGE_MS);
    };
    const leaveArrow = (event: DragEvent<HTMLButtonElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        return;
      cancelDragPage();
    };
    const dropOnArrow = (event: DragEvent<HTMLButtonElement>) => {
      event.preventDefault();
      clearDrag();
    };
    const arrow = (direction: number) => (
      <button
        type="button"
        className="inventory-page-arrow"
        data-armed={armedArrow === direction || undefined}
        aria-label={direction < 0 ? "Previous page" : "Next page"}
        disabled={view.pages <= 1}
        title={
          draggingIds.length
            ? "Hold here to turn pages"
            : direction < 0
              ? "Previous page"
              : "Next page"
        }
        onClick={() => turnPage(direction)}
        onDragOver={(event) => dragToPage(event, direction)}
        onDragLeave={leaveArrow}
        onDrop={dropOnArrow}
      >
        {direction < 0 ? (
          <CaretLeft size={16} weight="bold" className="pointer-events-none" />
        ) : (
          <CaretRight size={16} weight="bold" className="pointer-events-none" />
        )}
      </button>
    );
    return (
      <nav
        aria-label="Backpack pages"
        className="inventory-pager"
        data-dragging={draggingIds.length > 0 || undefined}
      >
        {arrow(-1)}
        <span className="t-meta tnum flex items-center gap-1.5">
          <PageField
            current={view.current}
            pages={view.pages}
            onChange={(next) => {
              pageTurn.current = Math.sign(next - view.current);
              setPage(next);
            }}
          />
          <span aria-hidden="true">/</span>
          <span>
            <span className="sr-only">of </span>
            {view.pages}
          </span>
        </span>
        {arrow(1)}
      </nav>
    );
  }

  const disabledOperation = busy || running || loading || applying || craftBusy;
  const selectedItems = snapshot
    ? selectedIds.flatMap((id) => snapshot.items.filter((entry) => entry.id === id))
    : [];
  const hiddenCount = view
    ? selectedIds.filter(
        (id) =>
          !view.slots.some((slot) => slot.item?.id === id) &&
          !view.unplaced.some((entry) => entry.id === id),
      ).length
    : 0;
  const allFavorite =
    selectedItems.length > 0 && selectedItems.every((entry) => favoriteIds.has(entry.id));
  const allProtected =
    selectedItems.length > 0 &&
    selectedItems.every((entry) => preferences.preferences.protectedIds.includes(entry.id));
  const hovered = hover && snapshot?.items.find((entry) => entry.id === hover.id);
  /** Installed art that is still on its way, as opposed to art that does not exist. */
  function artLoading(entry: InventoryItem) {
    const icon = snapshot ? itemDescription(snapshot, entry)?.icon : null;
    return !!icon && !icons[icon] && !unavailableIcons.current.has(icon);
  }
  const detailSteam = item ? steamItems[item.id] : undefined;
  const detailSteamImage = detailSteam
    ? (steam.image(detailSteam.image, 360) ?? steam.image(detailSteam.image, 192))
    : undefined;
  const detailPattern = item ? snapshot?.itemDescriptions?.[item.id]?.patternIcon : undefined;
  // Without Valve's render, a war paint is only a swatch; say so.
  const detailNote =
    [
      detailPattern && !detailSteamImage
        ? unavailableIcons.current.has(detailPattern)
          ? "Pattern swatch unavailable in installed TF2 files."
          : "Item icon and pattern swatch. In-game mapping, wear and effects are not rendered."
        : null,
      !detailSteam && steam.status !== "ready" && steam.status !== "loading" ? steam.message : null,
    ]
      .filter(Boolean)
      .join(" ") || null;
  const feedback = organizerError || preferences.storageError;

  function selectionSummary() {
    if (!snapshot || !view) return null;
    if (applying)
      return (
        <p role="status" className="t-meta">
          <Loading>
            {moves.length
              ? `Applying ${moves.length} ${moves.length === 1 ? "move" : "moves"}…`
              : "Working…"}
          </Loading>
        </p>
      );
    if (draggingIds.length)
      return (
        <p
          role="status"
          className={`t-meta ${dropPreview && !dropPreview.valid ? "text-warn" : ""}`}
        >
          {dropPreview && !dropPreview.valid
            ? dropPreview.reason
            : `Moving ${draggingIds.length === 1 ? "1 item" : `${draggingIds.length} items`}`}
        </p>
      );
    if (selectedItems.length === 1) {
      const only = selectedItems[0];
      return (
        <div className="min-w-0">
          <p
            className="truncate text-sm font-medium"
            style={{ color: qualityColor(snapshot, only.quality) }}
          >
            {itemTitle(snapshot, only, steamItems[only.id])}
          </p>
          <p role="status" className="t-meta truncate">
            1 selected · {QUALITY_NAMES[only.quality] ?? "Unknown quality"} ·{" "}
            {only.position ? `Slot ${only.position}` : "Unplaced"}
            {hiddenCount ? " · not on this page" : ""}
          </p>
        </div>
      );
    }
    if (selectedItems.length)
      return (
        <p role="status" className="t-meta text-ink">
          {selectedItems.length} selected
          {hiddenCount ? <span className="text-ink-muted"> · {hiddenCount} not shown</span> : null}
        </p>
      );
    return (
      <p role="status" className="t-meta tnum">
        {view.filtered ? (
          <>
            {view.matchCount} {view.matchCount === 1 ? "match" : "matches"}
            <span className="text-ink-faint"> · clear filters to move items</span>
          </>
        ) : (
          <>
            <span className="sr-only">0 selected · </span>
            Slots {(view.current - 1) * INVENTORY_PAGE_SIZE + 1}–
            {Math.min(view.current * INVENTORY_PAGE_SIZE, snapshot.capacity)}
          </>
        )}
      </p>
    );
  }

  function reportResult(status: string, message: string) {
    setMode("browse");
    if (status === "simulated" || status === "confirmed") {
      setOrganizerError(null);
      setOperationMessage(message);
    } else setOrganizerError(message);
  }

  const header = (
    <header className="inventory-heading">
      <div className="flex min-w-0 items-center gap-3">
        {snapshot?.avatar ? (
          <img src={snapshot.avatar} alt="Steam avatar" className="size-9 rounded object-cover" />
        ) : (
          <span className="inventory-avatar-empty" aria-hidden="true">
            <User size={18} />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="t-pane" data-pane-heading tabIndex={-1}>
            Inventory
          </h1>
          {snapshot ? (
            <p className="t-meta tnum truncate">
              {snapshot.personaName || "Your backpack"} · {snapshot.items.length.toLocaleString()} /{" "}
              {snapshot.capacity.toLocaleString()} slots
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {loading && snapshot ? (
          <span className="t-meta flex items-center gap-2" role="status">
            <Spinner size={14} />
            <span className="sr-only">Updating backpack</span>
          </span>
        ) : null}
        <div ref={about} className="relative">
          <button
            type="button"
            className="inventory-icon-button"
            aria-label="About this backpack"
            aria-expanded={aboutOpen}
            title="About this backpack"
            onClick={() => setAboutOpen((open) => !open)}
          >
            <Info size={16} aria-hidden="true" />
          </button>
          {aboutOpen ? (
            <div className="overlay menu-enter inventory-about t-meta">
              <p className="text-ink">
                {capability?.organizer === "simulation"
                  ? "Test backpack. Steam is never contacted."
                  : capability?.organizer === "live"
                    ? "Your signed-in Steam backpack. Applied changes affect this Steam account, not a customization profile."
                    : "Your signed-in Steam backpack. This connection supports local arrangement drafts."}
              </p>
              {snapshot ? <p className="mt-2 break-all">Steam account {snapshot.steamId}</p> : null}
              <p className="mt-2">
                {loading
                  ? "Updating…"
                  : updatedAt === null
                    ? "Not read yet."
                    : `Updated ${new Date(updatedAt).toLocaleTimeString()}. Refreshes while execs is focused; Steam may briefly show TF2 while connecting.`}
              </p>
              <button
                type="button"
                className="mt-2 underline hover:text-ink"
                onClick={() => void api.openExternal("https://www.jengerer.com/item_manager/")}
              >
                Inspired by Jengerer’s Item Manager
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: pane-wide Undo/Redo shortcuts; every control stays keyboard reachable.
    <div
      data-testid="settings-inventory"
      className="inventory-pane enter-fade"
      onKeyDown={handlePaneKey}
    >
      {header}
      {error ? (
        <div role="alert" className="inventory-strip inventory-strip-warn">
          <p className="min-w-0 flex-1">
            {error}
            {snapshot
              ? " Showing the last confirmed snapshot."
              : " Retrying while Inventory is open."}
          </p>
          <button
            type="button"
            className="btn btn-ghost"
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
            <p role="status" className="inventory-strip">
              {snapshot.warning}
            </p>
          ) : null}
          {uncertain ? (
            <div className="inventory-strip inventory-strip-warn">
              <p role="alert" className="min-w-0 flex-1">
                An operation has an unconfirmed outcome. Refresh before planning another change.
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy || running || loading || applying || craftBusy}
                onClick={() => void reconcileBackpack()}
              >
                Refresh and discard old plan
              </button>
            </div>
          ) : null}
          <div className="inventory-toolbar">
            <label className="inventory-search">
              <span className="sr-only">Search items</span>
              <MagnifyingGlass size={15} aria-hidden="true" className="inventory-search-icon" />
              <input
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && query) {
                    event.preventDefault();
                    setQuery("");
                  }
                }}
                placeholder="Search backpack"
                className="input w-full"
              />
            </label>
            <button
              type="button"
              className="inventory-menu-button"
              aria-label="Filter quality"
              aria-haspopup="menu"
              aria-expanded={menu?.kind === "quality"}
              data-active={quality !== null || undefined}
              onClick={(event) => openMenu("quality", event.currentTarget)}
            >
              {quality !== null ? (
                <span
                  aria-hidden="true"
                  className="inventory-quality-dot"
                  style={{ background: qualityColor(snapshot, quality) }}
                />
              ) : null}
              <span>
                {quality === null
                  ? "All qualities"
                  : (QUALITY_NAMES[quality] ?? `Quality ${quality}`)}
              </span>
              <CaretDown size={12} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="inventory-menu-button"
              aria-label="Sort backpack"
              aria-haspopup="menu"
              aria-expanded={menu?.kind === "sort"}
              disabled={!canArrange}
              title="Pack the whole backpack in order. Protected items stay in place."
              onClick={(event) => openMenu("sort", event.currentTarget)}
            >
              <SortAscending size={15} aria-hidden="true" />
              <span>Sort</span>
              <CaretDown size={12} aria-hidden="true" />
            </button>
            <span className="flex-1" />
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inventory-icon-button"
                disabled={!draft || !canArrange || !draft.history.past.length}
                aria-label="Undo draft"
                title="Undo (Ctrl+Z)"
                onClick={() => draft && changeHistory(undoInventoryLayout(draft.history))}
              >
                <ArrowCounterClockwise size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="inventory-icon-button"
                disabled={!draft || !canArrange || !draft.history.future.length}
                aria-label="Redo draft"
                title="Redo (Ctrl+Y)"
                onClick={() => draft && changeHistory(redoInventoryLayout(draft.history))}
              >
                <ArrowClockwise size={16} aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              className={`btn ${moves.length ? "btn-primary" : "btn-ghost"} inventory-review-button`}
              disabled={
                busy ||
                running ||
                loading ||
                applying ||
                craftBusy ||
                uncertain ||
                !moves.length ||
                stale
              }
              onClick={() => setReviewOpen(true)}
            >
              Review {moves.length || ""} changes
            </button>
            <button
              type="button"
              className="inventory-icon-button"
              aria-label="More inventory actions"
              aria-haspopup="menu"
              aria-expanded={menu?.kind === "more"}
              title="More"
              onClick={(event) => openMenu("more", event.currentTarget)}
            >
              <DotsThree size={18} weight="bold" aria-hidden="true" />
            </button>
          </div>
          {stale ? (
            <div className="inventory-strip inventory-strip-warn">
              <p role="alert" className="min-w-0 flex-1">
                This backpack changed after the draft began.
              </p>
              <button type="button" className="btn btn-ghost" onClick={resetDraft}>
                Reset draft
              </button>
            </div>
          ) : null}
          <div ref={stage} className="inventory-stage" data-applying={applying || undefined}>
            <section
              ref={grid}
              className="inventory-grid"
              aria-label="Backpack items"
              aria-busy={applying || undefined}
              data-dragging={draggingIds.length > 0 || undefined}
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
                    data-drop={
                      dropPreview?.landing.has(position)
                        ? dropPreview.valid
                          ? "ok"
                          : "refused"
                        : undefined
                    }
                    aria-label={`Empty slot ${position}`}
                    className="inventory-empty"
                    onClick={() => {
                      setSelectedIds([]);
                      setSelected(null);
                    }}
                    onDragOver={(event) => allowDrop(event, position)}
                    onDragLeave={(event) => leaveDrop(event, position)}
                    onDrop={(event) => dropItems(event, position)}
                  >
                    <span className="inventory-slot-number tnum">{position}</span>
                  </button>
                ),
              )}
              {view.filtered
                ? // Filtered pages keep the full grid height so results never jump.
                  Array.from(
                    { length: Math.max(0, INVENTORY_PAGE_SIZE - view.slots.length) },
                    (_, index) => (
                      <span
                        // biome-ignore lint/suspicious/noArrayIndexKey: fixed filler slots.
                        key={`filler-${index}`}
                        className="inventory-empty"
                        data-filler
                        aria-hidden="true"
                      />
                    ),
                  )
                : null}
            </section>
            {view.filtered && view.matchCount === 0 ? (
              <div className="inventory-grid-empty">
                <p className="t-meta">No items match.</p>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setQuery("");
                    setQuality(null);
                    setPage(1);
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : null}
            {hover && hovered && !draggingIds.length ? (
              <div
                aria-hidden="true"
                className="inventory-hovercard overlay"
                data-below={hover.below || undefined}
                style={{ left: hover.left, top: hover.top }}
              >
                <InventoryItemHeading
                  snapshot={snapshot}
                  item={hovered}
                  steam={steamItems[hovered.id]}
                />
                <InventoryItemLines
                  snapshot={snapshot}
                  item={hovered}
                  steam={steamItems[hovered.id]}
                  limit={3}
                />
                {favoriteIds.has(hovered.id) || protectedIds.has(hovered.id) ? (
                  <p className="inventory-inspect-meta">
                    {favoriteIds.has(hovered.id) ? "Favorite" : "Protected"}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <section
            aria-label="Backpack organizer"
            className="inventory-footer"
            data-feedback={feedback || operationMessage ? true : undefined}
          >
            {feedback ? (
              <div className="inventory-feedback inventory-feedback-warn">
                <p role="alert" className="min-w-0 flex-1">
                  {feedback}
                </p>
                {organizerError ? (
                  <button
                    type="button"
                    className="inventory-icon-button"
                    aria-label="Dismiss"
                    onClick={() => setOrganizerError(null)}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : operationMessage ? (
              <div className="inventory-feedback">
                <p role="status" className="min-w-0 flex-1">
                  {operationMessage}
                </p>
              </div>
            ) : null}
            <div className="inventory-footer-row">
              <div className="inventory-selection">{selectionSummary()}</div>
              <div className="inventory-actions">
                <button
                  type="button"
                  className="inventory-icon-button"
                  aria-label="Favorite selected"
                  aria-pressed={allFavorite}
                  title={allFavorite ? "Remove favorite" : "Favorite (also keeps items in place)"}
                  disabled={!selectedItems.length || !!preferences.storageError}
                  onClick={() =>
                    setFlag(
                      "favorite",
                      selectedItems.map((entry) => entry.id),
                      !allFavorite,
                    )
                  }
                >
                  <Star size={16} weight={allFavorite ? "fill" : "regular"} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="inventory-icon-button"
                  aria-label="Protect selected"
                  aria-pressed={allProtected}
                  title={
                    allProtected
                      ? "Remove protection"
                      : "Protect: keep out of moves, crafting and deletion"
                  }
                  disabled={!selectedItems.length || !!preferences.storageError}
                  onClick={() =>
                    setFlag(
                      "protect",
                      selectedItems.map((entry) => entry.id),
                      !allProtected,
                    )
                  }
                >
                  <Lock size={16} weight={allProtected ? "fill" : "regular"} aria-hidden="true" />
                </button>
                <span className="inventory-actions-rule" aria-hidden="true" />
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={!item || !selectedIds.includes(item.id)}
                  onClick={() => setDetailsOpen(true)}
                >
                  Inspect
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  aria-label="Craft selected"
                  title="Craft the selected metal"
                  disabled={!selectedItems.length || disabledOperation}
                  onClick={() => {
                    cancelHover();
                    setMode("craft");
                  }}
                >
                  Craft
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  aria-label="Delete selected"
                  title={selectedIds.length > 1 ? "Delete one item at a time" : "Delete this item"}
                  disabled={selectedIds.length !== 1 || disabledOperation}
                  onClick={() => {
                    cancelHover();
                    setMode("delete");
                  }}
                >
                  Delete
                </button>
              </div>
              {navigation()}
            </div>
          </section>
          {view.unplaced.length ? (
            <section className="inventory-unplaced" aria-label="Unplaced items">
              <p className="t-meta">
                <span className="text-ink">Unplaced · {view.unplaced.length}</span>
                <span className="text-ink-faint"> — drag into an empty slot</span>
              </p>
              <div className="inventory-unplaced-row">
                {view.unplaced.map((entry) => card(entry, 0))}
              </div>
            </section>
          ) : null}
          {menu ? (
            <ContextMenu
              label={
                menu.kind === "quality"
                  ? "Filter quality"
                  : menu.kind === "sort"
                    ? "Sort backpack"
                    : "More inventory actions"
              }
              position={menu}
              onClose={() => setMenu(null)}
            >
              {menu.kind === "quality" ? (
                <>
                  <ContextMenuItem
                    checked={quality === null}
                    onSelect={() => {
                      setMenu(null);
                      setQuality(null);
                      setPage(1);
                    }}
                  >
                    All qualities
                  </ContextMenuItem>
                  {[...new Set(snapshot.items.map((entry) => entry.quality))]
                    .sort((a, b) => a - b)
                    .map((value) => (
                      <ContextMenuItem
                        key={value}
                        checked={quality === value}
                        detail={String(
                          snapshot.items.filter((entry) => entry.quality === value).length,
                        )}
                        onSelect={() => {
                          setMenu(null);
                          setQuality(value);
                          setPage(1);
                        }}
                      >
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="inventory-quality-dot"
                            style={{ background: qualityColor(snapshot, value) }}
                          />
                          {QUALITY_NAMES[value] ?? `Quality ${value}`}
                        </span>
                      </ContextMenuItem>
                    ))}
                </>
              ) : menu.kind === "sort" ? (
                SORTS.map((sort) => (
                  <ContextMenuItem
                    key={sort.id}
                    disabled={!canArrange}
                    onSelect={() => {
                      setMenu(null);
                      sortBackpack(sort.id);
                    }}
                  >
                    {sort.label}
                  </ContextMenuItem>
                ))
              ) : (
                <>
                  <ContextMenuItem
                    onSelect={() => {
                      setMenu(null);
                      setSelectedIds(
                        view.slots.flatMap((slot) => (slot.item ? [slot.item.id] : [])),
                      );
                    }}
                  >
                    Select this page
                  </ContextMenuItem>
                  {(
                    [
                      ["Select unplaced", view.unplaced],
                      [
                        "Select favorites",
                        snapshot.items.filter((entry) => favoriteIds.has(entry.id)),
                      ],
                      [
                        "Select protected",
                        snapshot.items.filter((entry) => protectedIds.has(entry.id)),
                      ],
                    ] as const
                  ).map(([label, entries]) => (
                    <ContextMenuItem
                      key={label}
                      disabled={!entries.length}
                      detail={String(entries.length)}
                      onSelect={() => {
                        setMenu(null);
                        setSelectedIds(entries.map((entry) => entry.id));
                      }}
                    >
                      {label}
                    </ContextMenuItem>
                  ))}
                  <ContextMenuItem
                    disabled={!selectedIds.length}
                    onSelect={() => {
                      setMenu(null);
                      setSelectedIds([]);
                      setSelected(null);
                    }}
                  >
                    Clear selection
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    disabled={!selectedIds.length || !canArrange}
                    onSelect={() => {
                      setMenu(null);
                      setMoveOpen(true);
                    }}
                  >
                    Move selected to…
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!moves.length || applying}
                    onSelect={() => {
                      setMenu(null);
                      resetDraft();
                    }}
                  >
                    Reset draft
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => {
                      setMenu(null);
                      setToolsTab("searches");
                    }}
                  >
                    Saved searches and layouts…
                  </ContextMenuItem>
                  <ContextMenuItem
                    detail={
                      preferences.preferences.history.length
                        ? String(preferences.preferences.history.length)
                        : undefined
                    }
                    onSelect={() => {
                      setMenu(null);
                      setToolsTab("history");
                    }}
                  >
                    Operation history…
                  </ContextMenuItem>
                </>
              )}
            </ContextMenu>
          ) : null}
          {draft ? (
            <>
              <InventoryReviewDialog
                open={reviewOpen}
                snapshot={draft.baseline}
                moves={moves}
                capability={capability}
                disabled={busy || running || loading || applying || craftBusy || uncertain}
                stale={stale}
                error={organizerError}
                applying={applying}
                onClose={() => setReviewOpen(false)}
                onApply={applyDraft}
              />
              <InventoryMoveDialog
                open={moveOpen}
                snapshot={draft.baseline}
                selectedCount={selectedIds.length}
                initialPage={view.filtered ? 1 : view.current}
                disabled={!canArrange}
                onClose={() => setMoveOpen(false)}
                onMove={(destination) => moveTo(destination)}
              />
              <Modal
                open={toolsTab !== null}
                title="Saved searches, layouts and history"
                initialFocusRef={toolsDoneButton}
                className={`${SHEET} w-[min(560px,calc(100vw-2rem))]`}
                onClose={() => setToolsTab(null)}
              >
                <InventoryPolish
                  snapshot={snapshot}
                  query={query}
                  quality={quality}
                  sort="position"
                  positions={draft.history.present}
                  preferences={preferences}
                  initialTab={toolsTab ?? "searches"}
                  disabled={busy || running || loading || applying || craftBusy || uncertain}
                  onSearch={(search) => {
                    setQuery(search.query);
                    setQuality(search.quality);
                    // Old saved view orders never silently rearrange the backpack.
                    setPage(1);
                    setToolsTab(null);
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
                      layoutMotion.current = { kind: "shift", ids: new Set() };
                      setDraft({ ...draft, history: pushInventoryLayout(draft.history, next) });
                      setOrganizerError(null);
                    } catch (reason) {
                      setOrganizerError(errorText(reason));
                      throw reason;
                    }
                  }}
                />
                <div className="modal-actions">
                  <button
                    ref={toolsDoneButton}
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setToolsTab(null)}
                  >
                    Done
                  </button>
                </div>
              </Modal>
            </>
          ) : null}
          <Modal
            open={mode === "craft"}
            title="Craft"
            initialFocusRef={craftBackButton}
            className={`${SHEET} w-[min(520px,calc(100vw-2rem))]`}
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
              cancelRef={craftBackButton}
              onCancel={() => setMode("browse")}
              onBusyChange={setCraftBusy}
              onResult={(result, recipe) => {
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
                  layoutMotion.current = { kind: "shift", ids: new Set() };
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
                reportResult(result.status, result.message);
                // A random hat is a surprise; show what Steam picked.
                if (recipe === "craft_hat" && result.snapshot && result.acquiredIds.length) {
                  setReveal({ ids: result.acquiredIds });
                  setMode("reveal");
                }
              }}
            />
          </Modal>
          <Modal
            open={mode === "reveal" && revealItems.length > 0}
            title={revealItems.length === 1 ? "You crafted a hat" : "You crafted hats"}
            className={`${SHEET} ${revealItems.length > 1 ? "w-[min(560px,calc(100vw-2rem))]" : "w-[min(380px,calc(100vw-2rem))]"}`}
            initialFocusRef={revealDoneButton}
            onClose={() => {
              setMode("browse");
              setReveal(null);
            }}
          >
            <ul className="inventory-reveal" aria-label="Crafted hats">
              {revealItems.map((hat, index) => (
                <li
                  key={hat.id}
                  className="inventory-reveal-item"
                  style={
                    {
                      "--quality": qualityColor(snapshot, hat.quality),
                      animationDelay: `${index * 120}ms`,
                    } as CSSProperties
                  }
                >
                  <div className="inventory-reveal-art">
                    {inventoryItemArt({
                      snapshot,
                      item: hat,
                      icons,
                      steamImage: steamItems[hat.id]
                        ? steam.image(steamItems[hat.id].image, 360)
                        : undefined,
                      large: true,
                    }) ??
                      (artLoading(hat) ? (
                        <Spinner />
                      ) : (
                        <Cube size={40} aria-hidden="true" className="text-ink-faint" />
                      ))}
                  </div>
                  <InventoryItemHeading snapshot={snapshot} item={hat} steam={steamItems[hat.id]} />
                  <p className="inventory-inspect-meta">
                    {hat.position ? `Slot ${hat.position}` : "Not placed"}
                  </p>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button
                ref={revealDoneButton}
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setMode("browse");
                  setReveal(null);
                }}
              >
                Done
              </button>
            </div>
          </Modal>
          <Modal
            open={mode === "delete"}
            title="Delete item"
            initialFocusRef={deleteBackButton}
            className={`${SHEET} w-[min(460px,calc(100vw-2rem))]`}
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
              cancelRef={deleteBackButton}
              onCancel={() => setMode("browse")}
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
                  layoutMotion.current = { kind: "shift", ids: new Set() };
                  replaceSnapshot(result.snapshot);
                  setDraft({
                    baseline: result.snapshot,
                    history: { past: [], present: inventoryLayout(result.snapshot), future: [] },
                  });
                  setSelectedIds([]);
                  setSelected(null);
                }
                reportResult(result.status, result.message);
              }}
            />
          </Modal>
          <Modal
            open={detailsOpen && !!item}
            hideTitle
            title={item ? itemTitle(snapshot, item, steamItems[item.id]) : "Inspect item"}
            className={`${SHEET} w-[min(420px,calc(100vw-2rem))]`}
            initialFocusRef={detailsCloseButton}
            onClose={() => setDetailsOpen(false)}
          >
            {item ? (
              <InventoryInspect
                snapshot={snapshot}
                item={item}
                steam={steamItems[item.id]}
                art={inventoryItemArt({
                  snapshot,
                  item,
                  icons,
                  steamImage: detailSteamImage,
                  large: true,
                  alt: itemTitle(snapshot, item, steamItems[item.id]),
                })}
                artLoading={artLoading(item)}
                steamNote={detailNote}
                flags={[
                  ...(favoriteIds.has(item.id)
                    ? ["Favorite"]
                    : protectedIds.has(item.id)
                      ? ["Protected"]
                      : []),
                ]}
              />
            ) : null}
            <div className="modal-actions">
              <button
                ref={detailsCloseButton}
                type="button"
                className="btn btn-ghost"
                aria-label="Close details"
                onClick={() => setDetailsOpen(false)}
              >
                Close
              </button>
            </div>
          </Modal>
        </>
      ) : (
        <div className="inventory-stage">
          <div className="inventory-grid inventory-grid-placeholder" aria-hidden="true">
            {Array.from({ length: INVENTORY_PAGE_SIZE }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder slots.
              <span key={index} className="inventory-empty" />
            ))}
          </div>
          <div className="inventory-grid-empty">
            {loading ? (
              <LoadingState>Reading your backpack from Steam…</LoadingState>
            ) : (
              <p className="t-meta">
                {running
                  ? "Close TF2 to read your backpack."
                  : "Your backpack loads automatically with Steam signed in and TF2 closed."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
