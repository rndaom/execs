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
  type Toast,
  type ToastEvent,
  toastDismissible,
  toastLingerMs,
  toastStep,
} from "../../lib/toast-ui";

export type ToastApi = {
  /** A write started: arms the delayed "Saving…" pill. */
  startSave: () => void;
  /** A write landed. `message` names what happened when it was not a save. */
  finishSave: (message?: string) => void;
  /** A write failed; `prefix` carries the verb ("Could not apply"). */
  failSave: (reason: unknown, prefix?: string) => void;
  /** TF2 is running and a dirty draft is waiting for it to close. */
  deferDraft: () => void;
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
  deferDraft: () => undefined,
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
  const [toast, setToast] = useState<Toast | null>(null);
  // A ref would be lost on re-render; plain state plus the reducer keeps the
  // whole surface driven by one function.
  const [inFlight, setInFlight] = useState(0);

  const send = useCallback((event: ToastEvent) => {
    setToast((current) => toastStep(current, event));
  }, []);

  // Stable: `useAutosave` keys its own effects off this object, so a new
  // identity every render would look like a fresh edit.
  const api = useMemo<ToastApi>(
    () => ({
      startSave: () => setInFlight((count) => count + 1),
      finishSave: (message?: string) => {
        setInFlight((count) => Math.max(0, count - 1));
        send({ type: "done", message });
      },
      failSave: (reason: unknown, prefix?: string) => {
        setInFlight((count) => Math.max(0, count - 1));
        send({ type: "fail", message: failureMessage(reason, prefix) });
      },
      deferDraft: () => send({ type: "defer" }),
      dismiss: () => send({ type: "hide" }),
    }),
    [send],
  );

  // Quick saves — the common case — never flash a pill.
  useEffect(() => {
    if (inFlight === 0) {
      return;
    }
    const timer = window.setTimeout(() => send({ type: "slow" }), TOAST_SAVING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [inFlight, send]);

  const linger = toastLingerMs(toast);
  useEffect(() => {
    if (linger === null) {
      return;
    }
    const timer = window.setTimeout(() => send({ type: "hide" }), linger);
    return () => window.clearTimeout(timer);
  }, [linger, send]);

  const dismissible = toastDismissible(toast);
  useEffect(() => {
    if (!dismissible) {
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        send({ type: "hide" });
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismissible, send]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Padding, not a left offset, is what centres this over the content
          column: it shifts the centre right by exactly half the sidebar. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-12 z-50 flex justify-center px-4 lg:pl-(--sidebar-width)"
      >
        {toast ? (
          dismissible ? (
            <button
              type="button"
              data-testid="toast"
              data-kind={toast.kind}
              onClick={api.dismiss}
              className="overlay overlay-enter pointer-events-auto max-w-[34rem] border-error/60 px-4 py-2.5 text-left text-[13.5px] leading-5 text-ink"
            >
              {toast.message}
            </button>
          ) : (
            <p
              data-testid="toast"
              data-kind={toast.kind}
              className="overlay overlay-enter pointer-events-auto max-w-[34rem] px-4 py-2.5 text-[13.5px] leading-5 text-ink"
            >
              {toast.message}
            </p>
          )
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}
