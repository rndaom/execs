import type { SwitchStep } from "./bridge";
import { SWITCH_STEPS, switchStepIndex } from "./library-ui";

export const SWITCH_DONE_HOLD_MS = 5_000;
/** Minimum time each revealed stage stays on screen. The backend finishes in
 * milliseconds; pacing real, already-reported stages keeps the checklist
 * readable without inventing progress. */
export const SWITCH_STEP_MIN_MS = 550;

export type SwitchProgressPresenterState = {
  /** True while the backend operation runs OR the checklist is still animating. */
  active: boolean;
  /** Keeps the final checklist visible without keeping the app write-locked. */
  visible: boolean;
  visibleStep: SwitchStep | null;
  /** Reported stages waiting for their minimum display slot. */
  queue: SwitchStep[];
  /** The backend command resolved; drain the queue, then show done. */
  backendDone: boolean;
};

export type SwitchProgressPresenterAction =
  | { type: "start" }
  | { type: "report"; step: SwitchStep }
  | { type: "advance" }
  | { type: "complete" }
  | { type: "dismiss" }
  | { type: "cancel" };

export function idleSwitchProgress(): SwitchProgressPresenterState {
  return {
    active: false,
    visible: false,
    visibleStep: null,
    queue: [],
    backendDone: false,
  };
}

/**
 * Queue-and-reveal presenter. Reported stages are real backend events; the
 * presenter only paces their display (SWITCH_STEP_MIN_MS each) so a
 * milliseconds-fast switch still reads as a sequence. Stages stay monotonic,
 * late/duplicate events are ignored, and only command completion (after the
 * queue drains) can mark the profile done. Errors reset immediately.
 */
export function switchProgressPresenterReducer(
  state: SwitchProgressPresenterState,
  action: SwitchProgressPresenterAction,
): SwitchProgressPresenterState {
  if (action.type === "start") {
    return { ...idleSwitchProgress(), active: true, visible: true };
  }

  if (action.type === "cancel" || action.type === "dismiss") {
    return idleSwitchProgress();
  }

  if (action.type === "complete") {
    if (!state.active) {
      return state;
    }
    return { ...state, backendDone: true };
  }

  if (action.type === "advance") {
    if (!state.active) {
      return state;
    }
    if (state.queue.length > 0) {
      const [next, ...rest] = state.queue;
      return { ...state, visibleStep: next, queue: rest };
    }
    if (state.backendDone) {
      return {
        active: false,
        visible: true,
        visibleStep: "done",
        queue: [],
        backendDone: true,
      };
    }
    return state;
  }

  // report
  if (!state.active || action.step === "done") {
    return state;
  }
  const nextIndex = switchStepIndex(action.step);
  const lastQueued = state.queue.length > 0 ? state.queue[state.queue.length - 1] : null;
  const frontierStep = lastQueued ?? state.visibleStep;
  const frontierIndex = frontierStep ? switchStepIndex(frontierStep) : -1;
  if (nextIndex <= frontierIndex) {
    return state;
  }
  if (state.visibleStep === null && state.queue.length === 0) {
    // First report shows immediately so the panel never sits empty.
    return { ...state, visibleStep: action.step };
  }
  return { ...state, queue: [...state.queue, action.step] };
}

/** True when the presenter is waiting on a paced reveal tick. */
export function switchProgressNeedsAdvance(state: SwitchProgressPresenterState): boolean {
  return state.active && (state.queue.length > 0 || state.backendDone);
}

/** Fraction of stages revealed so far, for the step-driven progress bar. */
export function switchProgressFraction(state: SwitchProgressPresenterState): number {
  if (!state.visible) {
    return 0;
  }
  if (state.visibleStep === "done") {
    return 1;
  }
  if (state.visibleStep === null) {
    return 0;
  }
  return (switchStepIndex(state.visibleStep) + 1) / SWITCH_STEPS.length;
}
