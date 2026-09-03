/**
 * The one save-feedback surface, as a state machine.
 *
 * Every pane used to carry its own sticky Apply bar, so "what is saved" was
 * answered in eight slightly different vocabularies. Saving is now automatic
 * and the answer lives in one toast, which means the rules about *when* a
 * message appears and what it may replace have to live in one place too.
 *
 * Precedence, in order:
 *  - a failure always wins, and stands until the next successful save or an
 *    explicit dismissal — a retry in flight does not quietly clear it;
 *  - a success always wins, including over a failure;
 *  - "Saving…" and "Draft kept until TF2 closes" are only shown when nothing
 *    more important is on screen, and the draft notice is said once per locked
 *    stretch rather than on every keystroke.
 */

/** A save quicker than this shows no pill at all: a flicker reads as a glitch. */
export const TOAST_SAVING_DELAY_MS = 400;

/** How long "Saved" stands before it fades. */
export const TOAST_SAVED_MS = 1600;

export type ToastKind = "saving" | "saved" | "error" | "deferred";

export type Toast = { kind: ToastKind; message: string };

export const SAVING_MESSAGE = "Saving…";
export const SAVED_MESSAGE = "Saved";
export const DEFERRED_MESSAGE = "Draft kept until TF2 closes";

export type ToastEvent =
  /** A save has been running longer than `TOAST_SAVING_DELAY_MS`. */
  | { type: "slow" }
  /** A write finished; `message` names what happened when it was not a save. */
  | { type: "done"; message?: string }
  | { type: "fail"; message: string }
  /** TF2 is running and a dirty draft is waiting for it to close. */
  | { type: "defer" }
  /** Escape, a click, or the "Saved" linger elapsing. */
  | { type: "hide" };

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

export function toastStep(state: Toast | null, event: ToastEvent): Toast | null {
  switch (event.type) {
    case "hide":
      return null;
    case "fail":
      return { kind: "error", message: event.message };
    case "done":
      return { kind: "saved", message: event.message ?? SAVED_MESSAGE };
    case "slow":
      // A failure is not cleared by the retry that follows it — only by that
      // retry actually succeeding.
      return state?.kind === "error" ? state : { kind: "saving", message: SAVING_MESSAGE };
    case "defer":
      // Said once while the lock is on, not on every keystroke. Returning the
      // same object keeps React from re-rendering the toast.
      if (state?.kind === "error" || state?.kind === "deferred") {
        return state;
      }
      return { kind: "deferred", message: DEFERRED_MESSAGE };
  }
}

/** Only "Saved" fades on its own; everything else waits for an event. */
export function toastLingerMs(toast: Toast | null): number | null {
  return toast?.kind === "saved" ? TOAST_SAVED_MS : null;
}

/** Escape and a click dismiss the toast only while it is waiting on the user. */
export function toastDismissible(toast: Toast | null): boolean {
  return toast?.kind === "error";
}
