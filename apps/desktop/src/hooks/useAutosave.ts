import { createContext, useCallback, useContext, useEffect, useId, useRef } from "react";
import { useToast } from "../components/ui/Toast";

/** How long the user has to stop changing things before a save goes out. */
export const AUTOSAVE_DELAY_MS = 700;

/** Retained panes flush their debounce when hidden, and still observe unlocks. */
export const AutosaveActivity = createContext(true);

export const AutosavePending = createContext<((id: string, pending: boolean) => void) | null>(null);

/** Set before explicitly discarding/remounting retained panes. */
export const AutosaveDiscard = createContext<Readonly<{ current: boolean }> | null>(null);

/**
 * The scheduler behind `useAutosave`, as a pure step function.
 *
 * Every rule the panes depend on is here rather than tangled in effects and
 * timers: a burst of edits is one save, edits made *during* a save become one
 * follow-up save, nothing is written while TF2 holds the write lock, the draft
 * notice is said once per locked stretch, the pending save runs the moment the
 * lock lifts, and leaving a pane flushes rather than loses the debounce.
 */
export type AutosaveState = {
  /** Unsaved edits this scheduler still owes a save for. */
  dirty: boolean;
  /** The debounce elapsed while a save was already in flight. */
  due: boolean;
  /** A save is in flight. */
  saving: boolean;
  /** The draft notice has been shown for the current locked stretch. */
  announced: boolean;
};

export type AutosaveEvent =
  /** The draft changed. */
  | { type: "change"; locked: boolean }
  /** The debounce timer fired. */
  | { type: "elapsed"; locked: boolean }
  /** The save that was in flight finished, either way. */
  | { type: "settled"; locked: boolean }
  | { type: "failed"; locked: boolean }
  /** TF2 started. */
  | { type: "locked" }
  /** TF2 quit. */
  | { type: "unlocked" }
  /** The pane is going away. */
  | { type: "flush"; locked: boolean };

export type AutosaveEffect =
  | "none"
  /** (Re)start the debounce timer. */
  | "arm"
  /** Run the save now. */
  | "save"
  /** Tell the user the draft is kept until TF2 closes. */
  | "defer";

export type AutosaveStep = { state: AutosaveState; effect: AutosaveEffect };

export function autosaveInitial(): AutosaveState {
  return { dirty: false, due: false, saving: false, announced: false };
}

/** The draft notice, said once per locked stretch. */
function announce(state: AutosaveState): AutosaveStep {
  if (state.announced) {
    return { state, effect: "none" };
  }
  return { state: { ...state, announced: true }, effect: "defer" };
}

function begin(state: AutosaveState): AutosaveStep {
  return { state: { ...state, dirty: false, due: false, saving: true }, effect: "save" };
}

export function autosaveStep(state: AutosaveState, event: AutosaveEvent): AutosaveStep {
  switch (event.type) {
    case "failed": {
      if (state.dirty && state.due && !event.locked) {
        return begin({ ...state, saving: false });
      }
      const pending = { ...state, dirty: true, due: false, saving: false };
      return event.locked ? announce(pending) : { state: pending, effect: "none" };
    }
    case "change": {
      const dirty = { ...state, dirty: true };
      // While TF2 runs the edit is kept as a draft; nothing is armed, because
      // the lock lifting is what will start the save.
      return event.locked ? announce(dirty) : { state: dirty, effect: "arm" };
    }
    case "elapsed": {
      if (!state.dirty) {
        return { state, effect: "none" };
      }
      if (event.locked) {
        return announce(state);
      }
      // One save at a time: the queue serializes writes anyway, and a second
      // one now would be a save of the same draft.
      if (state.saving) {
        return { state: { ...state, due: true }, effect: "none" };
      }
      return begin(state);
    }
    case "settled": {
      const settled = { ...state, saving: false };
      if (!settled.due) {
        return { state: settled, effect: "none" };
      }
      // The debounce fired mid-save: everything typed during it collapses into
      // this one follow-up.
      if (!settled.dirty) {
        return { state: { ...settled, due: false }, effect: "none" };
      }
      return event.locked
        ? announce({ ...settled, due: false })
        : begin({ ...settled, due: false });
    }
    case "locked": {
      // A fresh stretch: the notice is owed again, and owed straight away when
      // the game started on top of unsaved edits.
      const armed = { ...state, announced: false };
      return armed.dirty ? announce(armed) : { state: armed, effect: "none" };
    }
    case "unlocked": {
      const free = { ...state, announced: false };
      if (free.dirty && free.saving) {
        return { state: { ...free, due: true }, effect: "none" };
      }
      if (!free.dirty) {
        return { state: free, effect: "none" };
      }
      return begin(free);
    }
    case "flush": {
      // Losing a debounced edit because the user clicked another pane is the
      // one failure autosave cannot have. Locked is the exception: the draft
      // survives the pane switch on its own.
      if (event.locked || !state.dirty) {
        return { state, effect: "none" };
      }
      if (state.saving) {
        return { state: { ...state, due: true }, effect: "none" };
      }
      return begin(state);
    }
  }
}

export type AutosaveOptions = {
  /** The draft differs from what is saved. */
  dirty: boolean;
  /** TF2 is running: keep the draft, write nothing. */
  locked: boolean;
  /** Runs the pane's existing write path; a promise is awaited before settling. */
  save: () => unknown;
  /**
   * Changes on every edit — the pane's serialized draft. `dirty` alone cannot
   * tell one edit from the next, so without this the debounce would never
   * restart while the user keeps dragging a slider.
   */
  token?: string;
  delay?: number;
};

/**
 * Saves a pane's draft on its own, shortly after the user stops changing it.
 *
 * The write goes through whatever path the pane already used for its Apply
 * button, so writes stay serialized in `SettingsHost`'s queue and the profile
 * reload behind them is unchanged — and so the toast is driven from there,
 * once, for explicit and automatic saves alike. The only message this hook
 * raises itself is the draft notice, which no write path can know about.
 */
export function useAutosave({
  dirty,
  locked,
  save,
  token,
  delay = AUTOSAVE_DELAY_MS,
}: AutosaveOptions): { flush: () => void } {
  const active = useContext(AutosaveActivity);
  const reportPending = useContext(AutosavePending);
  const discard = useContext(AutosaveDiscard);
  const discarded = useRef(false);
  const pendingId = useId();
  const mounted = useRef(true);
  const toast = useToast();
  const state = useRef<AutosaveState>(autosaveInitial());
  const timer = useRef<number | null>(null);
  const lockedRef = useRef(locked);
  const saveRef = useRef(save);
  const tokenRef = useRef(token);
  /** The draft we last handed to the write path, so its echo is not re-saved. */
  const attempted = useRef<string | undefined>(undefined);

  saveRef.current = save;
  tokenRef.current = token;
  lockedRef.current = locked;

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const dispatch = useCallback(
    function run(event: AutosaveEvent) {
      if (discarded.current) {
        return;
      }
      const next = autosaveStep(state.current, event);
      state.current = next.state;
      if (mounted.current) {
        reportPending?.(pendingId, next.state.dirty || next.state.saving);
      }
      if (next.effect === "arm") {
        cancel();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          run({ type: "elapsed", locked: lockedRef.current });
        }, delay);
        return;
      }
      if (next.effect === "defer") {
        toast.deferDraft();
        return;
      }
      if (next.effect === "save") {
        cancel();
        attempted.current = tokenRef.current;
        const submit = saveRef.current;
        // The write path owns the success and failure toasts; a rejection here
        // would only be a second report of the same thing.
        Promise.resolve()
          .then(() => (discarded.current ? false : submit()))
          .then((result) => {
            if (result === false) {
              attempted.current = undefined;
              run({ type: "failed", locked: lockedRef.current });
            } else {
              run({ type: "settled", locked: lockedRef.current });
            }
          })
          .catch(() => {
            attempted.current = undefined;
            run({ type: "failed", locked: lockedRef.current });
          });
      }
    },
    [cancel, delay, toast, reportPending, pendingId],
  );

  useEffect(() => {
    if (!dirty) {
      cancel();
      state.current = { ...state.current, dirty: false, due: false };
      reportPending?.(pendingId, state.current.saving);
      return;
    }
    // A save that came back and reseeded the pane is not a new edit.
    if (token !== undefined && token === attempted.current) {
      return;
    }
    dispatch({ type: "change", locked: lockedRef.current });
  }, [dirty, token, dispatch, cancel, reportPending, pendingId]);

  useEffect(() => {
    if (locked) {
      cancel();
      dispatch({ type: "locked" });
      return;
    }
    // A save refused while the game was up must be retried, not treated as an
    // echo of itself.
    attempted.current = undefined;
    dispatch({ type: "unlocked" });
  }, [locked, dispatch, cancel]);

  const flush = useCallback(() => {
    dispatch({ type: "flush", locked: lockedRef.current });
  }, [dispatch]);

  useEffect(() => {
    if (!active) {
      flush();
    }
  }, [active, flush]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount only.
  useEffect(() => {
    mounted.current = true;
    return () => {
      if (discard?.current) {
        discarded.current = true;
        state.current = autosaveInitial();
      } else {
        dispatch({ type: "flush", locked: lockedRef.current });
      }
      cancel();
      mounted.current = false;
      reportPending?.(pendingId, false);
    };
  }, []);

  return { flush };
}
