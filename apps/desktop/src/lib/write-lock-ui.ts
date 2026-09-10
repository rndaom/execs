import type { Api } from "./api";
import { shouldAbsorbOnLockChange } from "./library-ui";

export type WriteLockState = {
  running: boolean;
  quitNonce: number;
  degraded: string | null;
};

type LockApi = Pick<Api, "getTf2WriteLock" | "onTf2Running" | "onTf2LockUnavailable">;

/** A failed subscription stays locked until a new subscription session starts. */
export function watchWriteLock(api: LockApi, publish: (state: WriteLockState) => void) {
  let cancelled = false;
  let unhealthy = false;
  let ready = false;
  let observedEvent = false;
  let lastRunning: boolean | null = null;
  let quitNonce = 0;
  const stops: Array<() => void> = [];

  publish({ running: true, quitNonce, degraded: null });

  function failClosed(message: string) {
    if (cancelled || unhealthy) return;
    unhealthy = true;
    publish({ running: true, quitNonce, degraded: message });
  }

  function observe(next: boolean) {
    if (cancelled || unhealthy) return;
    if (shouldAbsorbOnLockChange(lastRunning, next)) quitNonce += 1;
    lastRunning = next;
    if (ready) publish({ running: next, quitNonce, degraded: null });
  }

  function retain(unlisten: () => void) {
    if (cancelled) unlisten();
    else stops.push(unlisten);
  }

  const runningSubscription = api
    .onTf2Running((next) => {
      if (cancelled || unhealthy) return;
      observedEvent = true;
      observe(next);
    })
    .then(retain)
    .catch(() => failClosed("execs cannot watch TF2 — writes are disabled for safety."));
  const healthSubscription = api
    .onTf2LockUnavailable(() =>
      failClosed("execs can no longer watch TF2 — writes are disabled for safety."),
    )
    .then(retain)
    .catch(() =>
      failClosed("execs cannot watch the TF2 lock health — writes are disabled for safety."),
    );

  void Promise.all([runningSubscription, healthSubscription]).then(async () => {
    if (cancelled || unhealthy) return;
    ready = true;
    if (lastRunning !== null) {
      publish({ running: lastRunning, quitNonce, degraded: null });
    }
    // Subscribe before sampling so a transition cannot fall between the two.
    // Live events always supersede this asynchronous boot sample.
    try {
      const lock = await api.getTf2WriteLock();
      if (!observedEvent) observe(lock.running);
    } catch {
      if (!observedEvent) {
        failClosed("Could not read the TF2 write lock — writes are disabled for safety.");
      }
    }
  });

  return () => {
    cancelled = true;
    for (const stop of stops) stop();
  };
}
