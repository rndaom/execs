import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Segmented } from "./components/ui/Segmented";
import { Spinner } from "./components/ui/Spinner";
import type { Api } from "./lib/api";
import type { InventorySnapshot } from "./lib/bridge";
import {
  type CraftPlan,
  type CraftRecipeId,
  craftPlans,
  type InventoryCraftRequest,
  type InventoryCraftResult,
  inventoryCraftBaseline,
  METAL_NAMES,
  validateInventoryCraft,
  verifyInventoryCraftResult,
} from "./lib/inventory-crafting";
import {
  executeReviewedInventoryOperation,
  type InventoryLiveApi,
} from "./lib/inventory-operations";

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

const CHOICE_LABELS: Record<CraftRecipeId, string> = {
  combine_scrap: "Combine",
  combine_reclaimed: "Combine",
  craft_hat: "Random hat",
  smelt_reclaimed: "Smelt",
  smelt_refined: "Smelt",
};

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function outputText(plan: CraftPlan): string {
  const count = plan.batches.length * plan.recipe.outputCount;
  return plan.recipe.output === null
    ? plural(count, "random hat")
    : `${count} ${METAL_NAMES[plan.recipe.output]}`;
}

/** Whole-plan checks the per-craft validation cannot see: total room and ingredients. */
function planRefusal(
  snapshot: InventorySnapshot,
  plan: CraftPlan,
  protectedIds: ReadonlySet<string>,
) {
  const growth = plan.batches.length * (plan.recipe.outputCount - plan.recipe.inputCount);
  if (snapshot.items.length + Math.max(0, growth) > snapshot.capacity)
    return "There is not enough backpack space for every craft. Select fewer items.";
  for (const batch of plan.batches) {
    validateInventoryCraft(snapshot, {
      steamId: snapshot.steamId,
      baseline: inventoryCraftBaseline(snapshot),
      recipe: plan.recipe.id,
      inputIds: batch,
      protectedIds: [...protectedIds],
    });
  }
  return null;
}

type Review = {
  key: string;
  plans: CraftPlan[];
};

function reviewKey(
  snapshot: InventorySnapshot,
  selectedIds: readonly string[],
  protectedIds: ReadonlySet<string>,
) {
  return JSON.stringify([
    inventoryCraftBaseline(snapshot),
    [...selectedIds],
    [...protectedIds].sort(),
  ]);
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
  onCancel,
  cancelRef,
}: {
  onCancel?: () => void;
  cancelRef?: RefObject<HTMLButtonElement | null>;
  snapshot: InventorySnapshot;
  selectedIds: readonly string[];
  protectedIds: ReadonlySet<string>;
  disabled?: boolean;
  disabledReason?: string;
  capability: "live" | "simulation" | "unavailable";
  api: Pick<Api, "craftInventory"> & Partial<InventoryLiveApi>;
  onResult: (result: InventoryCraftResult, recipe: CraftRecipeId) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
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
  // Mounting inside the parent's Craft sheet is the review boundary. Never
  // silently recapture new ingredients while that sheet remains open.
  const [review, setReview] = useState<Review | null>(() => ({
    key: reviewKey(snapshot, selectedIds, protectedIds),
    plans: craftPlans(snapshot, selectedIds),
  }));
  const [choice, setChoice] = useState<CraftRecipeId | null>(
    () => review?.plans[0]?.recipe.id ?? null,
  );
  const plan = review?.plans.find((entry) => entry.recipe.id === choice) ?? null;
  let refusal: string | null = plan
    ? null
    : "Select Scrap, Reclaimed or Refined Metal of one kind. Three Refined Metal can also craft a random hat.";
  try {
    if (plan) refusal = planRefusal(snapshot, plan, protectedIds);
  } catch (error) {
    refusal = error instanceof Error ? error.message : "These ingredients cannot be crafted.";
  }
  const block =
    disabled || busy || uncertain || !!snapshot.pendingOperation || capability === "unavailable";
  const reviewChanged =
    reviewContext.current !== context ||
    (review !== null && review.key !== reviewKey(snapshot, selectedIds, protectedIds));
  const currentReview = useRef(false);
  currentReview.current = !disabled && !reviewChanged && !refusal && !snapshot.pendingOperation;

  useLayoutEffect(() => {
    if (reviewContext.current !== context) setReview(null);
    setMessage(uncertaintyFor(context.craft).get(context.account) ?? null);
    setBusy(false);
    setProgress(null);
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

  /** One reviewed craft from the latest confirmed backpack. */
  async function craftOnce(
    current: InventorySnapshot,
    request: InventoryCraftRequest,
  ): Promise<InventoryCraftResult> {
    const response =
      capability === "live"
        ? ((await executeReviewedInventoryOperation(
            api,
            {
              kind: "craft",
              steamId: request.steamId,
              baseline: current,
              recipe: request.recipe,
              inputIds: request.inputIds,
              protectedIds: request.protectedIds,
            },
            () => mounted.current && contextRef.current === context && currentReview.current,
          )) as InventoryCraftResult)
        : await api.craftInventory(request);
    return verifyInventoryCraftResult(
      current,
      request,
      response,
      capability === "live" ? "live" : "simulation",
    );
  }

  async function craft() {
    if (!plan || submitting.current || block || reviewChanged || refusal) return;
    submitting.current = true;
    const pendingMessage =
      "A crafting result has not been verified for this account. Do not repeat the craft; reconnect and reconcile it first.";
    uncertainty.set(context.account, pendingMessage);
    setBusy(true);
    onBusyChange?.(true);
    setMessage(null);
    const total = plan.batches.length;
    setProgress({ done: 0, total });
    let current = snapshot;
    const consumedIds: string[] = [];
    const acquiredIds: string[] = [];
    let last: InventoryCraftResult | null = null;
    let done = 0;
    try {
      for (const batch of plan.batches) {
        const request: InventoryCraftRequest = {
          steamId: current.steamId,
          baseline: inventoryCraftBaseline(current),
          recipe: plan.recipe.id,
          inputIds: batch,
          protectedIds: [...protectedIds],
        };
        const failed = (status: "refused" | "unknown", text: string): InventoryCraftResult => ({
          operationId: crypto.randomUUID(),
          kind: "craft",
          status,
          snapshot: null,
          consumedIds: [],
          acquiredIds: [],
          message: text,
        });
        let result: InventoryCraftResult;
        try {
          // Checked before sending, so a changed ingredient is a plain refusal.
          validateInventoryCraft(current, request);
        } catch (error) {
          last = failed("refused", error instanceof Error ? error.message : String(error));
          break;
        }
        try {
          result = await craftOnce(current, request);
        } catch {
          result = failed(
            "unknown",
            "No crafting result was received. Check the backpack before another attempt; do not repeat this craft.",
          );
        }
        last = result;
        if ((result.status === "simulated" || result.status === "confirmed") && result.snapshot) {
          current = result.snapshot;
          consumedIds.push(...result.consumedIds);
          acquiredIds.push(...result.acquiredIds);
          done += 1;
          if (mounted.current && contextRef.current === context) setProgress({ done, total });
          if (!mounted.current || contextRef.current !== context) break;
          continue;
        }
        break;
      }
      const status = last?.status ?? "unknown";
      const summary =
        done === total
          ? total === 1
            ? (last?.message ?? "")
            : `${capability === "live" ? "Crafted" : "Simulated"} ${plural(total, "craft")}: ${outputText(plan)}.${capability === "live" ? "" : " Steam items were not changed."}`
          : done > 0
            ? `${capability === "live" ? "Crafted" : "Simulated"} ${done} of ${total}, then stopped: ${last?.message ?? ""}`
            : (last?.message ?? "");
      const combined: InventoryCraftResult = {
        operationId: last?.operationId ?? crypto.randomUUID(),
        kind: "craft",
        status,
        snapshot: done > 0 ? current : (last?.snapshot ?? null),
        consumedIds,
        acquiredIds,
        message: summary,
      };
      if (status === "simulated" || status === "confirmed" || status === "refused")
        uncertainty.delete(context.account);
      else uncertainty.set(context.account, combined.message);
      if (!mounted.current || contextRef.current !== context) return;
      setMessage(combined.message);
      onResult(combined, plan.recipe.id);
    } finally {
      if (mounted.current && contextRef.current === context) {
        submitting.current = false;
        setBusy(false);
        setProgress(null);
        setReview(null);
        onBusyChange?.(false);
      }
    }
  }

  const count = plan?.batches.length ?? 0;
  const hat = plan?.recipe.output === null;
  const inputName = plan ? METAL_NAMES[plan.recipe.input] : "";
  return (
    <section aria-label="Crafting" className="mt-4 space-y-4">
      {review && review.plans.length > 1 && choice ? (
        <Segmented
          label="Recipe"
          size="sm"
          options={review.plans.map((entry) => ({
            id: entry.recipe.id,
            label: CHOICE_LABELS[entry.recipe.id],
          }))}
          value={choice}
          disabled={busy}
          onChange={setChoice}
        />
      ) : null}
      {plan ? (
        <div>
          <p className="inventory-recipe">
            <span>
              <span className="tnum">{count * plan.recipe.inputCount}</span> {inputName}
            </span>
            <span className="text-ink-faint"> → </span>
            <span className="text-ink tnum">{outputText(plan)}</span>
          </p>
          {count > 1 || plan.unused.length ? (
            <p className="t-meta mt-1">
              {count > 1 ? `${plural(count, "craft")}, one after another.` : null}
              {count > 1 && plan.unused.length ? " " : null}
              {plan.unused.length
                ? `${plural(plan.unused.length, inputName, inputName)} stay${plan.unused.length === 1 ? "s" : ""} in your backpack.`
                : null}
            </p>
          ) : null}
          {hat ? (
            <p className="t-meta mt-1">
              Steam picks each hat. Random hats need a premium TF2 account.
            </p>
          ) : null}
        </div>
      ) : null}
      {plan ? (
        <ul className="inventory-review-list" aria-label="Exact crafting ingredients">
          {plan.batches.flat().map((id) => {
            const item = snapshot.items.find((candidate) => candidate.id === id);
            return (
              <li key={id}>
                <span className="min-w-0 truncate text-ink">
                  {item ? (METAL_NAMES[item.definition] ?? "Metal") : "Unavailable item"}
                </span>
                <span className="inventory-review-slots tnum">
                  {item?.position ? `Slot ${item.position}` : "Unplaced"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {refusal ? (
        <p className="t-meta">{refusal}</p>
      ) : (
        <p className="t-meta">
          {capability === "simulation"
            ? "Test backpack only; Steam is not changed. Crafting has no Undo."
            : capability === "live"
              ? `Consumes these exact items from Steam account ${snapshot.steamId}. Crafting has no Undo.`
              : "Crafting is unavailable for this connection."}
        </p>
      )}
      {disabled && disabledReason ? <p className="t-meta text-warn">{disabledReason}</p> : null}
      {busy && progress ? (
        <p role="status" className="t-meta flex items-center gap-2">
          <Spinner />
          {hat
            ? progress.total > 1
              ? `Crafting hat ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
              : "Crafting your hat…"
            : progress.total > 1
              ? `Crafting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
              : "Waiting for the crafting result…"}
        </p>
      ) : null}
      {message ? (
        <p
          role={uncertain ? "alert" : "status"}
          className={uncertain ? "t-meta text-warn" : "t-meta"}
        >
          {message}
        </p>
      ) : null}
      {reviewChanged ? (
        <p role="alert" className="t-meta text-warn">
          The backpack, selection or protection changed. Close this sheet and review again.
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
            Back to backpack
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          disabled={block || !plan || reviewChanged || refusal !== null}
          onClick={() => void craft()}
        >
          {busy
            ? "Crafting…"
            : capability === "live"
              ? count > 1
                ? `Craft ${count} times permanently`
                : "Craft items permanently"
              : count > 1
                ? `Simulate ${count} crafts`
                : "Simulate craft"}
        </button>
      </div>
    </section>
  );
}
