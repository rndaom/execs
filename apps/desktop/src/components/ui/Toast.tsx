import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  failureMessage,
  TOAST_SAVING_DELAY_MS,
  type ToastEvent,
  toastDismissible,
  toastInitial,
  toastLingerMs,
  toastStep,
} from "../../lib/toast-ui";
import { Loading } from "./Spinner";

export type ToastApi = {
  /** A write started: arms the delayed "Saving…" pill. */
  startSave: (source?: string) => void;
  /** A write landed. `message` names what happened when it was not a save. */
  finishSave: (message?: string, source?: string) => void;
  /** A write failed; `prefix` carries the verb ("Could not apply"). */
  failSave: (reason: unknown, prefix?: string, source?: string, active?: boolean) => void;
  /** A picker was cancelled; balance only this operation's in-flight count. */
  cancelSave: (source?: string) => void;
  /** TF2 is running and a dirty draft is waiting for it to close. */
  deferDraft: (source?: string) => void;
  /** This draft no longer owes any work. Other deferred drafts stay visible. */
  resolveDraft: (source: string) => void;
  /** Explicitly discarding a failed draft resolves its feedback only. */
  clearSource: (source: string) => void;
  dismiss: () => void;
};

/**
 * Panes rendered outside the provider (the static-markup tests, a preview of
 * one pane on its own) must not crash on a missing context, and they have no
 * toast to show either — so the fallback is a no-op, not a throw.
 */
const NO_TOAST: ToastApi = {
  startSave: () => undefined,
  finishSave: () => undefined,
  failSave: () => undefined,
  cancelSave: () => undefined,
  deferDraft: () => undefined,
  resolveDraft: () => undefined,
  clearSource: () => undefined,
  dismiss: () => undefined,
};

const ToastContext = createContext<ToastApi>(NO_TOAST);

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

/**
 * The app's one save-feedback surface: a single toast at the bottom of the
 * content area. Saving is automatic everywhere it can be, so this is where the
 * user finds out it happened — the rules live in `lib/toast-ui`, the timers
 * live here.
 */
export function ToastProvider({ children }: { children?: ReactNode }) {
  const [feedback, setFeedback] = useState(toastInitial);
  const toast = feedback.toast;
  const [inFlight, setInFlight] = useState<Record<string, number>>({});

  const send = useCallback((event: ToastEvent) => {
    setFeedback((current) => toastStep(current, event));
  }, []);

  const changeInFlight = useCallback((source: string | undefined, delta: number) => {
    setInFlight((current) => {
      const key = source ?? "default";
      const next = { ...current, [key]: Math.max(0, (current[key] ?? 0) + delta) };
      if (next[key] === 0) delete next[key];
      return next;
    });
  }, []);

  // Stable: `useAutosave` keys its own effects off this object, so a new
  // identity every render would look like a fresh edit.
  const api = useMemo<ToastApi>(
    () => ({
      startSave: (source) => changeInFlight(source, 1),
      finishSave: (message, source) => {
        changeInFlight(source, -1);
        send({ type: "done", message, source });
      },
      failSave: (reason, prefix, source, active = true) => {
        if (active) changeInFlight(source, -1);
        send({ type: "fail", message: failureMessage(reason, prefix), source });
      },
      cancelSave: (source) => changeInFlight(source, -1),
      deferDraft: (source) => send({ type: "defer", source }),
      resolveDraft: (source) => send({ type: "resolve-draft", source }),
      clearSource: (source) => send({ type: "clear-source", source }),
      dismiss: () => send({ type: "hide" }),
    }),
    [send, changeInFlight],
  );

  // Quick saves — the common case — never flash a pill.
  const activeSaves = Object.values(inFlight).reduce((total, count) => total + count, 0);
  useEffect(() => {
    if (activeSaves === 0) {
      send({ type: "cancel" });
      return;
    }
    const timer = window.setTimeout(() => send({ type: "slow" }), TOAST_SAVING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeSaves, send]);

  const linger = toastLingerMs(toast);
  useEffect(() => {
    if (linger === null || toast === null) {
      return;
    }
    // Every completion creates a fresh toast, even with identical copy. The
    // captured identity also makes an obsolete timer unable to hide a retry.
    const timer = window.setTimeout(() => send({ type: "hide", expected: toast }), linger);
    return () => window.clearTimeout(timer);
  }, [linger, toast, send]);

  const dismissible = toastDismissible(toast);
  useEffect(() => {
    if (!dismissible) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && toast) {
        send({ type: "hide", expected: toast });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismissible, send, toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Padding, not a left offset, is what centres this over the content
          column: it shifts the centre right by exactly half the sidebar. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-12 z-50 flex justify-center px-4 min-[761px]:pl-(--sidebar-width)"
      >
        {toast ? (
          dismissible ? (
            <button
              type="button"
              data-testid="toast"
              data-kind={toast.kind}
              data-source={toast.source}
              aria-label={`Dismiss: ${toast.message}`}
              onClick={() => send({ type: "hide", expected: toast })}
              className="overlay enter-fade pointer-events-auto max-w-[34rem] border-error/60 px-4 py-2.5 text-left text-[13.5px] leading-5 text-ink"
            >
              {toast.message}
            </button>
          ) : (
            <p
              data-testid="toast"
              data-kind={toast.kind}
              data-source={toast.source}
              className="overlay enter-fade pointer-events-auto max-w-[34rem] px-4 py-2.5 text-[13.5px] leading-5 text-ink"
            >
              {toast.kind === "saving" ? <Loading>{toast.message}</Loading> : toast.message}
            </p>
          )
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
