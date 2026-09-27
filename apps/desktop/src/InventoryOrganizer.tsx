import { ArrowRight } from "@phosphor-icons/react";
import { useState } from "react";
import { Modal } from "./components/ui/Modal";
import type { InventoryCapabilities, InventorySnapshot } from "./lib/bridge";
import type { InventoryMove } from "./lib/inventory-organizer";
import { INVENTORY_PAGE_SIZE, itemName, qualityColor } from "./lib/inventory-ui";

const SHEET =
  "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6";

function slotLabel(slot: number) {
  if (!slot) return "Unplaced";
  const page = Math.ceil(slot / INVENTORY_PAGE_SIZE);
  return `Page ${page} · ${slot - (page - 1) * INVENTORY_PAGE_SIZE}`;
}

/** Lists every affected item, including swaps and items outside the current page. */
export function InventoryReviewDialog({
  open,
  snapshot,
  moves,
  capability,
  disabled,
  stale,
  error,
  applying,
  onClose,
  onApply,
}: {
  open: boolean;
  snapshot: InventorySnapshot;
  moves: InventoryMove[];
  capability: InventoryCapabilities | null;
  disabled: boolean;
  stale: boolean;
  error: string | null;
  applying: boolean;
  onClose: () => void;
  onApply: () => Promise<void>;
}) {
  const canApply = capability?.organizer === "simulation" || capability?.organizer === "live";
  return (
    <Modal
      open={open}
      title={`Review ${moves.length} ${moves.length === 1 ? "move" : "moves"}`}
      className={`${SHEET} w-[min(560px,calc(100vw-2rem))]`}
      onClose={() => {
        if (!applying) onClose();
      }}
      description={
        capability?.organizer === "simulation"
          ? "Test backpack. Steam is never contacted."
          : capability?.organizer === "live"
            ? `Applies these exact positions to Steam account ${snapshot.steamId}.`
            : "This connection cannot apply backpack changes."
      }
    >
      <ul className="inventory-review-list" aria-label="Arrangement changes">
        {moves.map((move) => {
          const item = snapshot.items.find((entry) => entry.id === move.id);
          return (
            <li key={move.id}>
              <span className="min-w-0">
                <span
                  className="block truncate text-ink"
                  style={{ color: item ? qualityColor(snapshot, item.quality) : undefined }}
                >
                  {item ? itemName(snapshot, item) : move.id}
                </span>
                <span className="block truncate text-ink-faint text-xs">{move.id}</span>
              </span>
              <span className="inventory-review-slots tnum">
                <span>{slotLabel(move.from)}</span>
                <ArrowRight size={12} aria-hidden="true" />
                <span className="text-ink">{slotLabel(move.to)}</span>
                <span className="sr-only">
                  , slot {move.from || "unplaced"} to {move.to}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="t-meta mt-3 text-warn">
          {error}
        </p>
      ) : null}
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" disabled={applying} onClick={onClose}>
          Back to draft
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={disabled || stale || !canApply || !moves.length}
          onClick={async () => {
            await onApply();
            onClose();
          }}
        >
          {applying
            ? "Applying…"
            : capability?.organizer === "live"
              ? "Apply to Steam"
              : "Apply simulation"}
        </button>
      </div>
    </Modal>
  );
}

/** Moves the selection to an exact page and slot, for targets far from the current page. */
export function InventoryMoveDialog({
  open,
  snapshot,
  selectedCount,
  initialPage,
  disabled,
  onClose,
  onMove,
}: {
  open: boolean;
  snapshot: InventorySnapshot;
  selectedCount: number;
  initialPage: number;
  disabled: boolean;
  onClose: () => void;
  onMove: (destination: number) => void;
}) {
  return (
    <Modal
      open={open}
      title={`Move ${selectedCount} ${selectedCount === 1 ? "item" : "items"}`}
      className={`${SHEET} w-[min(380px,calc(100vw-2rem))]`}
      onClose={onClose}
    >
      {open ? (
        <MoveFields
          snapshot={snapshot}
          selectedCount={selectedCount}
          initialPage={initialPage}
          disabled={disabled}
          onClose={onClose}
          onMove={onMove}
        />
      ) : null}
    </Modal>
  );
}

function MoveFields({
  snapshot,
  selectedCount,
  initialPage,
  disabled,
  onClose,
  onMove,
}: {
  snapshot: InventorySnapshot;
  selectedCount: number;
  initialPage: number;
  disabled: boolean;
  onClose: () => void;
  onMove: (destination: number) => void;
}) {
  const pages = Math.ceil(snapshot.capacity / INVENTORY_PAGE_SIZE);
  const [destinationPage, setDestinationPage] = useState(String(initialPage));
  const [destinationSlot, setDestinationSlot] = useState("1");
  const destination = (Number(destinationPage) - 1) * INVENTORY_PAGE_SIZE + Number(destinationSlot);
  const validDestination =
    Number.isInteger(Number(destinationPage)) &&
    Number(destinationPage) >= 1 &&
    Number.isInteger(Number(destinationSlot)) &&
    Number(destinationSlot) >= 1 &&
    Number(destinationSlot) <= INVENTORY_PAGE_SIZE &&
    destination <= snapshot.capacity;
  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!selectedCount || !validDestination || disabled) return;
        onMove(destination);
        onClose();
      }}
    >
      <fieldset disabled={disabled} className="grid grid-cols-2 gap-3">
        <legend className="sr-only">Move to page / slot</legend>
        <label className="t-meta flex flex-col gap-1">
          Page
          <input
            className="input tnum"
            aria-label="Destination page"
            type="number"
            min={1}
            max={pages}
            value={destinationPage}
            onChange={(event) => setDestinationPage(event.target.value)}
          />
        </label>
        <label className="t-meta flex flex-col gap-1">
          Slot
          <input
            className="input tnum"
            aria-label="Destination slot on page"
            type="number"
            min={1}
            max={INVENTORY_PAGE_SIZE}
            value={destinationSlot}
            onChange={(event) => setDestinationSlot(event.target.value)}
          />
        </label>
      </fieldset>
      <p className="t-meta mt-2">
        {selectedCount > 1
          ? "Items fill free slots from here, in backpack order."
          : "An item already there swaps places."}
      </p>
      <div className="modal-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={disabled || !selectedCount || !validDestination}
        >
          Move selected in draft
        </button>
      </div>
    </form>
  );
}
