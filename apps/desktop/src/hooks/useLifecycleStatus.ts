import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { LifecycleStatus } from "../lib/bridge";

export type LifecycleState = LifecycleStatus & {
  available: boolean;
  degraded: string | null;
  refresh: () => Promise<void>;
};

type Snapshot = Omit<LifecycleState, "refresh">;

const INITIAL: Snapshot = {
  launchingTf2: false,
  steamVerification: false,
  installingUpdate: false,
  available: false,
  degraded: null,
};
const ACTIVE_POLL_MS = 1_000;
const IDLE_POLL_MS = 5_000;
const MAX_RETRY_MS = 30_000;

function sameSnapshot(left: Snapshot, right: Snapshot) {
  return (
    left.launchingTf2 === right.launchingTf2 &&
    left.steamVerification === right.steamVerification &&
    left.installingUpdate === right.installingUpdate &&
    left.available === right.available &&
    left.degraded === right.degraded
  );
}

/** Native write gates stay authoritative; this monitor only refreshes their presentation. */
export function useLifecycleStatus(api: Api): LifecycleState {
  const [snapshot, setSnapshot] = useState<Snapshot>(INITIAL);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let inFlight: Promise<void> | null = null;
    let refreshAgain = false;
    let failures = 0;
    let current = INITIAL;
    const isPresent = () => document.visibilityState !== "hidden" && document.hasFocus();
    let present = isPresent();
    setSnapshot(INITIAL);

    function publish(next: Snapshot) {
      current = next;
      setSnapshot((previous) => (sameSnapshot(previous, next) ? previous : next));
    }

    function clearTimer() {
      window.clearTimeout(timer);
      timer = undefined;
    }

    function schedule() {
      clearTimer();
      if (stopped || !isPresent()) return;
      const active = current.launchingTf2 || current.steamVerification || current.installingUpdate;
      const delay = failures
        ? Math.min(MAX_RETRY_MS, IDLE_POLL_MS * 2 ** Math.min(failures - 1, 3))
        : active
          ? ACTIVE_POLL_MS
          : IDLE_POLL_MS;
      timer = window.setTimeout(() => void request(), delay);
    }

    function request(requireFresh = false): Promise<void> {
      if (stopped) return Promise.resolve();
      clearTimer();
      if (requireFresh) {
        // A return to the app or a completed operation cannot use an old clear
        // sample while its authoritative read is still pending.
        publish({ ...current, available: false });
      }
      if (inFlight) {
        // An operation may have started after the pending command sampled the
        // gate. Coalesce callers into one follow-up read, and await that read.
        if (requireFresh) refreshAgain = true;
        return inFlight;
      }
      inFlight = (async () => {
        do {
          refreshAgain = false;
          try {
            const status: LifecycleStatus = await api.getLifecycleStatus();
            if (stopped) return;
            if (!refreshAgain) {
              failures = 0;
              publish({ ...status, available: true, degraded: null });
            }
          } catch {
            if (stopped) return;
            if (!refreshAgain) {
              failures += 1;
              publish({
                ...current,
                available: false,
                degraded: "Maintenance state unavailable — changes are locked.",
              });
            }
          }
        } while (refreshAgain && !stopped);
      })().finally(() => {
        inFlight = null;
        schedule();
      });
      return inFlight;
    }

    function observePresence() {
      const next = isPresent();
      const returned = next && !present;
      present = next;
      if (!next) clearTimer();
      else if (returned) void request(true);
    }

    refreshRef.current = () => request(true);
    // Restored durable operations must be read immediately, even at a hidden
    // startup. Subsequent background presentation polling sleeps until focus.
    void request();
    window.addEventListener("focus", observePresence);
    window.addEventListener("blur", observePresence);
    document.addEventListener("visibilitychange", observePresence);
    return () => {
      stopped = true;
      refreshRef.current = () => Promise.resolve();
      clearTimer();
      window.removeEventListener("focus", observePresence);
      window.removeEventListener("blur", observePresence);
      document.removeEventListener("visibilitychange", observePresence);
    };
  }, [api]);

  return { ...snapshot, refresh };
}
