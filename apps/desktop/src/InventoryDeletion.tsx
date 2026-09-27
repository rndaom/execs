import { type RefObject, useEffect, useRef, useState } from "react";
import type { InventorySnapshot } from "./lib/bridge";
import {
  type InventoryDeleteRequest,
  type InventoryDeleteResult,
  validateInventoryDelete,
  verifyInventoryDeleteResult,
} from "./lib/inventory-deletion";
import {
  executeReviewedInventoryOperation,
  type InventoryLiveApi,
} from "./lib/inventory-operations";
import { itemName, qualityColor } from "./lib/inventory-ui";

const pendingDeletes = new WeakMap<InventoryLiveApi["executeInventoryOperation"], Set<string>>();
function pendingFor(api: InventoryLiveApi) {
  let pending = pendingDeletes.get(api.executeInventoryOperation);
  if (!pending) {
    pending = new Set();
    pendingDeletes.set(api.executeInventoryOperation, pending);
  }
  return pending;
}
export function clearInventoryDeletionUncertainty(api: InventoryLiveApi, steamId: string) {
  pendingFor(api).delete(steamId);
}

export function InventoryDeletion({
  snapshot,
  selectedIds,
  protectedIds,
  capability,
  api,
  disabled = false,
  disabledReason,
  onBusyChange,
  onResult,
  onCancel,
  cancelRef,
}: {
  onCancel?: () => void;
  cancelRef?: RefObject<HTMLButtonElement | null>;
  snapshot: InventorySnapshot;
  selectedIds: readonly string[];
  protectedIds: ReadonlySet<string>;
  capability: "live" | "simulation" | "unavailable";
  api: InventoryLiveApi;
  disabled?: boolean;
  disabledReason?: string;
  onBusyChange: (busy: boolean) => void;
  onResult: (result: InventoryDeleteResult) => void;
}) {
  const [review] = useState<InventoryDeleteRequest>(() => ({
    steamId: snapshot.steamId,
    baseline: snapshot,
    itemId: selectedIds.length === 1 ? selectedIds[0] : "",
    protectedIds: [...protectedIds],
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const mounted = useRef(false);
  const submitting = useRef(false);
  const context = useRef({
    account: snapshot.steamId,
    prepare: api.prepareInventoryOperation,
    execute: api.executeInventoryOperation,
    capability,
  });
  if (
    context.current.account !== snapshot.steamId ||
    context.current.prepare !== api.prepareInventoryOperation ||
    context.current.execute !== api.executeInventoryOperation ||
    context.current.capability !== capability
  )
    context.current = {
      account: snapshot.steamId,
      prepare: api.prepareInventoryOperation,
      execute: api.executeInventoryOperation,
      capability,
    };
  const activeContext = context.current;
  const initialContext = useRef(activeContext);
  const callbacks = useRef(onBusyChange);
  callbacks.current = onBusyChange;
  const pending = pendingFor(api);
  const item = review.baseline.items.find((entry) => entry.id === review.itemId);
  let refusal: string | null = null;
  try {
    if (
      selectedIds.length !== 1 ||
      selectedIds[0] !== review.itemId ||
      initialContext.current !== activeContext ||
      review.protectedIds.slice().sort().join(",") !== [...protectedIds].sort().join(",")
    )
      throw Error(
        "The selection, account or protection changed. Close this sheet and review again.",
      );
    validateInventoryDelete(snapshot, { ...review, protectedIds: [...protectedIds] });
    if (capability === "live" && snapshot.craftingEligibility?.[review.itemId]?.deletable !== true)
      throw Error(
        snapshot.craftingEligibility?.[review.itemId]?.reason ||
          "Deletion eligibility has not been verified for this item.",
      );
  } catch (error) {
    refusal = error instanceof Error ? error.message : "Review the item again.";
  }
  const currentReview = useRef(false);
  currentReview.current = !disabled && !refusal && !snapshot.pendingOperation;
  const blocked =
    disabled ||
    !!refusal ||
    busy ||
    pending.has(review.steamId) ||
    !!snapshot.pendingOperation ||
    capability === "unavailable";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (submitting.current) callbacks.current(false);
    };
  }, []);
  async function remove() {
    if (blocked || submitting.current) return;
    submitting.current = true;
    pending.add(review.steamId);
    setBusy(true);
    onBusyChange(true);
    setMessage(null);
    try {
      const response = await executeReviewedInventoryOperation(
        api,
        { kind: "delete", ...review },
        () => mounted.current && context.current === activeContext && currentReview.current,
      );
      const result = verifyInventoryDeleteResult(
        review.baseline,
        review,
        response as InventoryDeleteResult,
        capability === "live" ? "live" : "simulation",
      );
      if (
        result.status === "confirmed" ||
        result.status === "simulated" ||
        result.status === "refused"
      )
        pending.delete(review.steamId);
      if (!mounted.current || context.current !== activeContext) return;
      setMessage(result.message);
      onResult(result);
    } catch {
      if (!mounted.current || context.current !== activeContext) return;
      const result: InventoryDeleteResult = {
        operationId: crypto.randomUUID(),
        kind: "delete",
        status: "unknown",
        snapshot: null,
        deletedIds: [],
        message:
          "No deletion result was received. Reconcile the backpack before another operation; do not repeat this deletion.",
      };
      setMessage(result.message);
      onResult(result);
    } finally {
      if (mounted.current && context.current === activeContext) {
        submitting.current = false;
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  return (
    <section aria-label="Single item deletion" className="mt-4 space-y-4">
      <div className="inventory-delete-target">
        <p
          className="t-row break-words"
          style={{ color: item ? qualityColor(review.baseline, item.quality) : undefined }}
        >
          {item ? itemName(review.baseline, item) : "No single item selected"}
        </p>
        <p className="t-meta break-all">
          {item ? (item.position ? `Slot ${item.position}` : "Unplaced") : ""}
          {item ? " · " : ""}Item {review.itemId || "not selected"}
        </p>
      </div>
      <p className="t-meta">
        {capability === "simulation"
          ? "Test backpack only; Steam is not changed. Deletion cannot be undone."
          : `Permanently removes this item from Steam account ${review.steamId}. Deletion cannot be undone.`}
      </p>
      {refusal || disabledReason ? (
        <p role="alert" className="t-meta text-warn">
          {refusal || disabledReason}
        </p>
      ) : null}
      {message ? (
        <p role={pending.has(review.steamId) ? "alert" : "status"} className="t-meta">
          {message}
        </p>
      ) : pending.has(review.steamId) && !busy ? (
        <p role="alert" className="t-meta text-warn">
          A deletion outcome is unresolved for this account. Reconcile before trying another
          operation.
        </p>
      ) : null}
      <div className="modal-actions">
        {onCancel ? (
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-danger"
          disabled={blocked}
          onClick={() => void remove()}
        >
          {busy
            ? "Deleting…"
            : capability === "simulation"
              ? "Simulate deletion"
              : "Delete item permanently"}
        </button>
      </div>
    </section>
  );
}
