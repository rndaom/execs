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
    let stop: (() => void) | null = null;

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
          setDegraded("Could not read the TF2 write lock — close the game before saving.");
        }
      });

    api
      .onTf2Running((next) => observe(next))
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        stop = unlisten;
      })
      .catch(() => {
        if (!cancelled) {
          // A silent failure here leaves every pane enabled while the backend
          // refuses each write — say so instead of looking broken.
          setDegraded(
            "execs cannot watch TF2 — the read-only banner will not appear. Close the game before saving.",
          );
        }
      });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [api]);

  return { running, quitNonce, degraded };
}
