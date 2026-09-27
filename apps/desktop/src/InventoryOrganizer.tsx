import { useState } from "react";
import { Modal } from "./components/ui/Modal";
import type { InventoryCapabilities, InventorySnapshot } from "./lib/bridge";
import type { InventoryMove, OrganizerHistory } from "./lib/inventory-organizer";
import { itemName } from "./lib/inventory-ui";

export function InventoryOrganizer({
  snapshot,
  selectedIds,
  hiddenCount,
  history,
  moves,
  capability,
  disabled,
  stale,
  error,
  message,
  applying,
  onMove,
  onUndo,
  onRedo,
  onReset,
  onClear,
  onSelectVisible,
  onApply,
}: {
  snapshot: InventorySnapshot;
  selectedIds: readonly string[];
  hiddenCount: number;
  history: OrganizerHistory;
  moves: InventoryMove[];
  capability: InventoryCapabilities | null;
  disabled: boolean;
  stale: boolean;
  error: string | null;
  message: string | null;
  applying: boolean;
  onMove: (destination: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onClear: () => void;
  onSelectVisible: () => void;
  onApply: () => Promise<void>;
}) {
  const [destinationPage, setDestinationPage] = useState("1");
  const [destinationSlot, setDestinationSlot] = useState("1");
  const [review, setReview] = useState(false);
  const destination = (Number(destinationPage) - 1) * 50 + Number(destinationSlot);
  const validDestination =
    Number.isInteger(Number(destinationPage)) &&
    Number(destinationPage) >= 1 &&
    Number.isInteger(Number(destinationSlot)) &&
    Number(destinationSlot) >= 1 &&
    Number(destinationSlot) <= 50 &&
    destination <= snapshot.capacity;
  return (
    <section aria-label="Backpack organizer" className="inventory-organizer">
      <h2 className="sr-only">Arrange backpack</h2>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="t-meta text-ink">
            {selectedIds.length} selected
            {hiddenCount ? ` · ${hiddenCount} outside this page or filter` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || !history.past.length}
            aria-label="Undo draft"
            title="Undo draft"
            onClick={onUndo}
          >
            Undo
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || !history.future.length}
            aria-label="Redo draft"
            title="Redo draft"
            onClick={onRedo}
          >
            Redo
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={disabled || !moves.length}
            aria-label="Reset draft"
            title="Reset draft"
            onClick={onReset}
          >
            Reset
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disabled || !moves.length || stale}
            onClick={() => setReview(true)}
          >
            Review {moves.length || ""} changes
          </button>
        </div>
      </div>
      <details className="inventory-move-menu">
        <summary className="btn btn-ghost">More</summary>
        <div className="surface p-3">
          <div className="space-y-2">
            <p className="t-meta">
              Drag to move. Ctrl-click adds or removes; Shift-click selects a range.
            </p>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={disabled}
                onClick={onSelectVisible}
              >
                Select visible items
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!selectedIds.length || disabled}
                onClick={onClear}
              >
                Clear selection
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
            <div className="t-meta">
              <fieldset disabled={disabled} className="mt-2 flex flex-wrap items-end gap-2">
                <legend>Move to page / slot</legend>
                <label>
                  Destination page
                  <input
                    className="input mt-1 block w-20"
                    aria-label="Destination page"
                    type="number"
                    min={1}
                    max={Math.ceil(snapshot.capacity / 50)}
                    value={destinationPage}
                    onChange={(event) => setDestinationPage(event.target.value)}
                  />
                </label>
                <label>
                  Slot on page
                  <input
                    className="input mt-1 block w-20"
                    aria-label="Destination slot on page"
                    type="number"
                    min={1}
                    max={50}
                    value={destinationSlot}
                    onChange={(event) => setDestinationSlot(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!selectedIds.length || !validDestination}
                  onClick={() => onMove(destination)}
                >
                  Move selected in draft
                </button>
              </fieldset>
            </div>
          </div>
        </div>
      </details>
      {stale ? (
        <p role="alert" className="t-meta text-warn">
          This backpack changed after the draft began. Reset the draft before making new moves.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="t-meta text-warn">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="t-meta">
          {message}
        </p>
      ) : null}
      <Modal
        open={review}
        title="Review backpack arrangement"
        className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
        onClose={() => {
          if (!applying) setReview(false);
        }}
        description={`Steam account ${snapshot.steamId} · ${snapshot.capacity} slots`}
      >
        <p className="t-meta mb-3">
          Every affected item is listed, including swapped items and selections outside the current
          view. Undo applies only to drafts.
        </p>
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Item</th>
                <th>From</th>
                <th>To</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((move) => (
                <tr key={move.id}>
                  <td className="py-2">
                    {(() => {
                      const item = snapshot.items.find((item) => item.id === move.id);
                      return item ? itemName(snapshot, item) : move.id;
                    })()}
                    <span className="t-meta block break-all">{move.id}</span>
                  </td>
                  <td>{move.from || "Unplaced"}</td>
                  <td>{move.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error ? (
          <p role="alert" className="text-warn">
            {error}
          </p>
        ) : null}
        <p className="t-meta my-3">
          {capability?.organizer === "simulation"
            ? "Apply changes only this browser fixture. Steam is never contacted."
            : capability?.organizer === "live"
              ? "Apply these exact positions to your Steam backpack."
              : "This connection cannot apply backpack changes."}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={applying}
            onClick={() => setReview(false)}
          >
            Back to draft
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              disabled ||
              stale ||
              (capability?.organizer !== "simulation" && capability?.organizer !== "live") ||
              !moves.length
            }
            onClick={async () => {
              await onApply();
              setReview(false);
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
    </section>
  );
}
