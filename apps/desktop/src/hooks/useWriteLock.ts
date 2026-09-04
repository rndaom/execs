import { useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import { shouldAbsorbOnLockChange } from "../lib/library-ui";

export type WriteLockState = {
  /** TF2 is running: the whole live surface is read-only. */
  running: boolean;
  /** Bumped on every observed quit — the absorb trigger. */
  quitNonce: number;
  /** The lock subscription failed; the banner cannot track the game. */
  degraded: string | null;
};

/**
 * The write lock and the quit → absorb edge, in one place.
 *
 * The Rust poller emits its current value on its very first tick, often before
 * this listener is registered, so the last-known state has to be reconciled
 * from the boot read too: "unknown → closed" counts as a quit. Without that, a
 * session that started with TF2 already open never absorbs the drift
 * (`shouldAbsorbOnLockChange` owns the rule and is unit-tested).
 */
export function useWriteLock(api: Api): WriteLockState {
  const [running, setRunning] = useState(false);
  const [quitNonce, setQuitNonce] = useState(0);
  const [degraded, setDegraded] = useState<string | null>(null);
  const lastRunning = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const stops: Array<() => void> = [];

    function failClosed(message: string) {
      setDegraded(message);
      // Once the lock source is unavailable, enablement cannot be based on the
      // last sample. Treat the surface as locked and let Rust remain the final
      // authority for any already-issued command.
      setRunning(true);
    }

    function observe(next: boolean) {
      if (shouldAbsorbOnLockChange(lastRunning.current, next)) {
        setQuitNonce((value) => value + 1);
      }
      lastRunning.current = next;
      setRunning(next);
    }

    api
      .getTf2WriteLock()
      .then((lock) => {
        if (!cancelled) {
          observe(lock.running);
        }
      })
      .catch(() => {
        if (!cancelled) {
          failClosed("Could not read the TF2 write lock — writes are disabled for safety.");
        }
      });

    api
      .onTf2Running((next) => observe(next))
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        stops.push(unlisten);
      })
      .catch(() => {
        if (!cancelled) {
          failClosed("execs cannot watch TF2 — writes are disabled for safety.");
        }
      });

    api
      .onTf2LockUnavailable(() => {
        if (!cancelled) {
          failClosed("execs can no longer watch TF2 — writes are disabled for safety.");
        }
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        stops.push(unlisten);
      })
      .catch(() => {
        if (!cancelled) {
          failClosed("execs cannot watch the TF2 lock health — writes are disabled for safety.");
        }
      });

    return () => {
      cancelled = true;
      for (const stop of stops) {
        stop();
      }
    };
  }, [api]);

  return { running, quitNonce, degraded };
}
