/**
 * The one save-feedback surface, as a state machine.
 *
 * Every pane used to carry its own sticky Apply bar, so "what is saved" was
 * answered in eight slightly different vocabularies. Saving is now automatic
 * and the answer lives in one toast, which means the rules about *when* a
 * message appears and what it may replace have to live in one place too.
 *
 * Precedence, in order:
 *  - failures stand until their own operation succeeds or is dismissed;
 *  - other completions cannot hide an outstanding failure;
 *  - "Saving…" and "Draft kept until TF2 closes" are only shown when nothing
 *    more important is on screen, and the draft notice is said once per locked
 *    stretch rather than on every keystroke.
 */

/** A save quicker than this shows no pill at all: a flicker reads as a glitch. */
export const TOAST_SAVING_DELAY_MS = 400;

/** How long "Saved" stands before it fades. */
export const TOAST_SAVED_MS = 1600;
/** A locked draft remains pending after this brief notice disappears. */
export const TOAST_DEFERRED_MS = 2400;

export type ToastKind = "saving" | "saved" | "error" | "deferred";

export type Toast = { kind: ToastKind; message: string; source?: string };

export type ToastState = {
  toast: Toast | null;
  failures: Record<string, Toast>;
  deferred: string[];
};

export function toastInitial(): ToastState {
  return { toast: null, failures: {}, deferred: [] };
}

export const SAVING_MESSAGE = "Saving…";
export const SAVED_MESSAGE = "Saved";
export const DEFERRED_MESSAGE = "Draft kept until TF2 closes";

export type ToastEvent =
  /** A save has been running longer than `TOAST_SAVING_DELAY_MS`. */
  | { type: "slow" }
  /** A write finished; `message` names what happened when it was not a save. */
  | { type: "done"; message?: string; source?: string }
  | { type: "fail"; message: string; source?: string }
  /** TF2 is running and a dirty draft is waiting for it to close. */
  | { type: "defer"; source?: string }
  | { type: "resolve-draft"; source: string }
  | { type: "clear-source"; source: string }
  | { type: "cancel" }
  /** Escape, a click, or the "Saved" linger elapsing. */
  | { type: "hide"; expected?: Toast };

/**
 * "Could not save — the reason the backend gave", or the bare line when it
 * gave none. `prefix` carries the verb for panes that do something other than
 * save ("Could not apply", "Could not build").
 */
export function failureMessage(reason: unknown, prefix = "Could not save"): string {
  const raw =
    reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : String(reason ?? "");
  const text = raw.trim().replace(/\.$/, "");
  return text.length > 0 ? `${prefix} — ${text}` : `${prefix}.`;
}

function remaining(state: ToastState): Toast | null {
  return Object.values(state.failures).at(-1) ?? null;
}

function withoutFailure(state: ToastState, source: string): ToastState {
  const failures = { ...state.failures };
  delete failures[source];
  return { ...state, failures };
}

export function toastStep(state: ToastState, event: ToastEvent): ToastState {
  switch (event.type) {
    case "hide": {
      if (event.expected && event.expected !== state.toast) return state;
      const next =
        state.toast?.kind === "error"
          ? withoutFailure(state, state.toast.source ?? "default")
          : state;
      return { ...next, toast: remaining(next) };
    }
    case "fail": {
      const source = event.source ?? "default";
      const toast: Toast = { kind: "error", message: event.message, source };
      const next = withoutFailure(state, source);
      return { ...next, failures: { ...next.failures, [source]: toast }, toast };
    }
    case "done": {
      const next = withoutFailure(state, event.source ?? "default");
      return {
        ...next,
        toast: Object.values(next.failures).at(-1) ?? {
          kind: "saved",
          message: event.message ?? SAVED_MESSAGE,
          source: event.source,
        },
      };
    }
    case "slow":
      // A failure is not cleared by the retry that follows it — only by that
      // retry actually succeeding.
      return state.toast?.kind === "error"
        ? state
        : { ...state, toast: { kind: "saving", message: SAVING_MESSAGE } };
    case "defer": {
      // A pending source announces once. The notice fades, while its draft
      // remains tracked until it is saved or discarded.
      const source = event.source ?? "default";
      if (state.deferred.includes(source)) return state;
      const next = { ...state, deferred: [...state.deferred, source] };
      return state.toast?.kind === "error"
        ? next
        : { ...next, toast: { kind: "deferred", message: DEFERRED_MESSAGE } };
    }
    case "resolve-draft": {
      if (!state.deferred.includes(event.source)) return state;
      const next = {
        ...state,
        deferred: state.deferred.filter((source) => source !== event.source),
      };
      return state.toast?.kind === "deferred" ? { ...next, toast: remaining(next) } : next;
    }
    case "clear-source": {
      const next = withoutFailure(state, event.source);
      return state.toast?.kind === "error" && state.toast.source === event.source
        ? { ...next, toast: remaining(next) }
        : next;
    }
    case "cancel":
      return state.toast?.kind === "saving" ? { ...state, toast: remaining(state) } : state;
  }
}

/** Success and deferred-draft notices fade; failures wait for an action. */
export function toastLingerMs(toast: Toast | null): number | null {
  if (toast?.kind === "saved") return TOAST_SAVED_MS;
  if (toast?.kind === "deferred") return TOAST_DEFERRED_MS;
  return null;
}

/** Escape and a click dismiss the toast only while it is waiting on the user. */
export function toastDismissible(toast: Toast | null): boolean {
  return toast?.kind === "error";
}
