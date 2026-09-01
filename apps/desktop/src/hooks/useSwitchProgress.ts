import { useEffect, useReducer, useState } from "react";
import type { Api } from "../lib/api";
import type { SwitchStep } from "../lib/bridge";
import {
  idleSwitchProgress,
  SWITCH_DONE_HOLD_MS,
  SWITCH_STEP_MIN_MS,
  type SwitchProgressPresenterState,
  switchProgressNeedsAdvance,
  switchProgressPresenterReducer,
} from "../lib/switch-progress-ui";

export type SwitchProgressController = {
  state: SwitchProgressPresenterState;
  /** The listener could not be registered — the panel cannot follow the switch. */
  degraded: string | null;
  start: () => void;
  complete: () => void;
  cancel: () => void;
};

/**
 * Owns the paced switch-progress presenter and its backend subscription.
 * Reported stages are real events; the presenter only paces their reveal.
 */
export function useSwitchProgress(
  api: Api,
  seedStep?: SwitchStep | null,
): SwitchProgressController {
  const [state, dispatch] = useReducer(switchProgressPresenterReducer, undefined, () => {
    const idle = idleSwitchProgress();
    if (!seedStep) {
      return idle;
    }
    return switchProgressPresenterReducer(switchProgressPresenterReducer(idle, { type: "start" }), {
      type: "report",
      step: seedStep,
    });
  });
  const [degraded, setDegraded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    api
      .onSwitchProgress((progress) => {
        dispatch({ type: "report", step: progress.step });
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        stop = unlisten;
      })
      .catch(() => {
        if (!cancelled) {
          // Never silent: without this the panel sits on "Preparing profile
          // operation…" for the whole switch with no explanation.
          setDegraded("Switch progress updates are unavailable — the panel may not advance.");
        }
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [api]);

  useEffect(() => {
    if (!state.visible || state.active || state.visibleStep !== "done") {
      return;
    }
    const timer = window.setTimeout(() => dispatch({ type: "dismiss" }), SWITCH_DONE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [state.active, state.visible, state.visibleStep]);

  // Paced reveal: each real backend stage stays on screen for a minimum beat.
  // Keyed on the revealed step + whether a reveal is pending — NOT the whole
  // state object — so queue appends from new backend reports never reset the
  // running beat.
  const advancePending = switchProgressNeedsAdvance(state);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed so queue appends don't reset the beat.
  useEffect(() => {
    if (!advancePending) {
      return;
    }
    const timer = window.setTimeout(() => dispatch({ type: "advance" }), SWITCH_STEP_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [advancePending, state.visibleStep]);

  return {
    state,
    degraded,
    start: () => dispatch({ type: "start" }),
    complete: () => dispatch({ type: "complete" }),
    cancel: () => dispatch({ type: "cancel" }),
  };
}
