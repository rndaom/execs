import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Spinner } from "./components/ui/Spinner";
import type { Api } from "./lib/api";
import type { InventorySnapshot } from "./lib/bridge";
import {
  type InventoryCraftRequest,
  type InventoryCraftResult,
  inventoryCraftBaseline,
  METAL_NAMES,
  METAL_RECIPES,
  selectedMetalRecipe,
  validateInventoryCraft,
  verifyInventoryCraftResult,
} from "./lib/inventory-crafting";
import {
  executeReviewedInventoryOperation,
  type InventoryLiveApi,
} from "./lib/inventory-operations";
import { itemName } from "./lib/inventory-ui";

// Switching tabs or accounts must not turn an unacknowledged operation into a
// retry. A new simulator API is an explicit fresh fixture; live APIs stay gated.
const uncertainCrafts = new WeakMap<Api["craftInventory"], Map<string, string>>();
function uncertaintyFor(api: Api["craftInventory"]) {
  let accounts = uncertainCrafts.get(api);
  if (!accounts) {
    accounts = new Map();
    uncertainCrafts.set(api, accounts);
  }
  return accounts;
}
export function clearInventoryCraftUncertainty(api: Pick<Api, "craftInventory">, steamId: string) {
  uncertaintyFor(api.craftInventory).delete(steamId);
}

export function InventoryCrafting({
  snapshot,
  selectedIds,
  protectedIds,
  disabled = false,
  disabledReason,
  capability,
  api,
  onResult,
  onBusyChange,
}: {
  snapshot: InventorySnapshot;
  selectedIds: readonly string[];
  protectedIds: ReadonlySet<string>;
  disabled?: boolean;
  disabledReason?: string;
  capability: "live" | "simulation" | "unavailable";
  api: Pick<Api, "craftInventory"> & Partial<InventoryLiveApi>;
  onResult: (result: InventoryCraftResult) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(false);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;
  const contextRef = useRef({
    account: snapshot.steamId,
    craft: api.craftInventory,
    prepare: api.prepareInventoryOperation,
    execute: api.executeInventoryOperation,
    capability,
  });
  if (
    contextRef.current.account !== snapshot.steamId ||
    contextRef.current.craft !== api.craftInventory ||
    contextRef.current.capability !== capability ||
    contextRef.current.prepare !== api.prepareInventoryOperation ||
    contextRef.current.execute !== api.executeInventoryOperation
  ) {
    contextRef.current = {
      account: snapshot.steamId,
      craft: api.craftInventory,
      prepare: api.prepareInventoryOperation,
      execute: api.executeInventoryOperation,
      capability,
    };
  }
  const context = contextRef.current;
  const reviewContext = useRef(context);
  const uncertainty = uncertaintyFor(context.craft);
  const uncertain = uncertainty.has(context.account);
  const recipe = selectedMetalRecipe(snapshot, selectedIds);
  const request: InventoryCraftRequest | null = recipe
    ? {
        steamId: snapshot.steamId,
        baseline: inventoryCraftBaseline(snapshot),
        recipe: recipe.id,
        inputIds: [...selectedIds],
        protectedIds: [...protectedIds],
      }
    : null;
  // Mounting inside the parent's Craft selected sheet is the review boundary.
  // Never silently recapture new ingredients while that sheet remains open.
  const [review, setReview] = useState<InventoryCraftRequest | null>(() => request);
  const reviewRecipe = METAL_RECIPES.find((entry) => entry.id === review?.recipe);
  let refusal: string | null = request
    ? null
    : "Select 3 Scrap Metal, 3 Reclaimed Metal, 1 Reclaimed Metal or 1 Refined Metal.";
  try {
    if (request) validateInventoryCraft(snapshot, request);
  } catch (error) {
    refusal = error instanceof Error ? error.message : "These ingredients cannot be crafted.";
  }
  const block =
    disabled || busy || uncertain || !!snapshot.pendingOperation || capability === "unavailable";
  const reviewChanged =
    reviewContext.current !== context ||
    (review !== null &&
      (!request ||
        review.baseline !== request.baseline ||
        review.steamId !== request.steamId ||
        review.inputIds.join(",") !== request.inputIds.join(",") ||
        review.recipe !== request.recipe ||
        review.protectedIds.slice().sort().join(",") !==
          request.protectedIds.slice().sort().join(",")));
  const currentReview = useRef(false);
  currentReview.current = !disabled && !reviewChanged && !refusal && !snapshot.pendingOperation;

  useLayoutEffect(() => {
    if (reviewContext.current !== context) setReview(null);
    setMessage(uncertaintyFor(context.craft).get(context.account) ?? null);
    setBusy(false);
    if (submitting.current) busyCallback.current?.(false);
    submitting.current = false;
  }, [context]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (submitting.current) busyCallback.current?.(false);
    };
  }, []);

  async function craft() {
    if (!review || submitting.current || block || reviewChanged) return;
    try {
      validateInventoryCraft(snapshot, { ...review, protectedIds: [...protectedIds] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review the ingredients again.");
      setReview(null);
      return;
    }
    submitting.current = true;
    const pendingMessage =
      "A crafting result has not been verified for this account. Do not repeat the craft; reconnect and reconcile it first.";
    uncertainty.set(context.account, pendingMessage);
    setBusy(true);
    onBusyChange?.(true);
    setMessage(null);
    const before = snapshot;
    try {
      const response =
        capability === "live"
          ? ((await executeReviewedInventoryOperation(
              api,
              {
                kind: "craft",
                steamId: review.steamId,
                baseline: before,
                recipe: review.recipe,
                inputIds: review.inputIds,
                protectedIds: review.protectedIds,
              },
              () => mounted.current && contextRef.current === context && currentReview.current,
            )) as InventoryCraftResult)
          : await api.craftInventory(review);
      const result = verifyInventoryCraftResult(
        before,
        review,
        response,
        capability === "live" ? "live" : "simulation",
      );
      if (
        result.status === "simulated" ||
        result.status === "confirmed" ||
        result.status === "refused"
      )
        uncertainty.delete(context.account);
      else uncertainty.set(context.account, result.message);
      if (!mounted.current || contextRef.current !== context) return;
      setMessage(result.message);
      onResult(result);
    } catch {
      const result: InventoryCraftResult = {
        operationId: crypto.randomUUID(),
        kind: "craft",
        status: "unknown",
        snapshot: null,
        consumedIds: [],
        acquiredIds: [],
        message:
          "No crafting result was received. Check the backpack before another attempt; do not repeat this craft.",
      };
      uncertainty.set(context.account, result.message);
      if (!mounted.current || contextRef.current !== context) return;
      setMessage(result.message);
      onResult(result);
    } finally {
      if (mounted.current && contextRef.current === context) {
        submitting.current = false;
        setBusy(false);
        setReview(null);
        onBusyChange?.(false);
      }
    }
  }

  return (
    <section aria-label="Metal crafting" className="space-y-3">
      <p className="t-meta">
        {capability === "simulation"
          ? "Simulation: practice with preview items. Your Steam backpack is untouched."
          : capability === "live"
            ? "Craft these exact items in your Steam backpack. Crafting cannot be undone."
            : "Crafting is unavailable for this connection."}
      </p>
      {recipe ? (
        <p className="t-body">
          {recipe.inputCount} {METAL_NAMES[recipe.input]} → {recipe.outputCount}{" "}
          {METAL_NAMES[recipe.output]}
        </p>
      ) : null}
      {refusal ? (
        <p className="t-meta">{refusal}</p>
      ) : (
        <p className="t-meta">
          All {selectedIds.length} selected ingredients will be consumed
          {capability === "simulation" ? " in the simulation" : ""}.
        </p>
      )}
      {disabled && disabledReason ? <p className="t-meta">{disabledReason}</p> : null}
      {busy ? (
        <p role="status" className="t-meta flex items-center gap-2">
          <Spinner /> Waiting for the crafting result…
        </p>
      ) : null}
      {message ? (
        <p role={uncertain ? "alert" : "status"} className="t-body">
          {message}
        </p>
      ) : null}
      {review ? (
        <div className="mt-4 space-y-3">
          <p className="t-meta break-all">Steam account {review?.steamId}</p>
          {reviewRecipe ? (
            <p className="t-body">
              Create {reviewRecipe.outputCount} {METAL_NAMES[reviewRecipe.output]}
            </p>
          ) : null}
          <ul className="max-h-64 space-y-2 overflow-auto" aria-label="Exact crafting ingredients">
            {review?.inputIds.map((id) => {
              const item = snapshot.items.find((candidate) => candidate.id === id);
              return (
                <li key={id} className="t-body break-words">
                  {item ? itemName(snapshot, item) : "Unavailable item"}
                  <span className="t-meta block break-all">
                    Item {id} · {item?.position ? `slot ${item.position}` : "unplaced"}
                  </span>
                </li>
              );
            })}
          </ul>
          {capability === "simulation" ? (
            <p className="t-meta">Preview simulation only. No Steam items will be consumed.</p>
          ) : null}
          <p className="t-meta">This consumes the exact ingredients above. Crafting has no Undo.</p>
        </div>
      ) : null}
      {reviewChanged ? (
        <p role="alert" className="t-body">
          The backpack, selection or protection changed. Close this sheet and review again.
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn-primary"
        disabled={block || !review || reviewChanged || refusal !== null}
        onClick={() => void craft()}
      >
        {busy ? "Crafting…" : capability === "live" ? "Craft items permanently" : "Simulate craft"}
      </button>
    </section>
  );
}
