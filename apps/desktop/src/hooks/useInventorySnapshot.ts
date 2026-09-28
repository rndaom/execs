import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { InventorySnapshot } from "../lib/bridge";

const MIN_RECONNECT_MS = 30_000;

/**
 * One bounded Steam connection at a time, only while the backpack is in use.
 * Each read runs TF2's Steam client briefly, so Steam shows the player as in
 * TF2 while it lasts. Reads happen when Inventory is opened, after TF2 closes
 * and on Refresh, never on a timer; a failed read retries with backoff.
 */
export function useInventorySnapshot(api: Api, active: boolean, running: boolean, busy: boolean) {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const latest = useRef({ api, active, running, busy });
  latest.current = { api, active, running, busy };
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const lastAttempt = useRef(Number.NEGATIVE_INFINITY);
  const nextDue = useRef(0);
  const failures = useRef(0);
  const revision = useRef(0);
  const wasRunning = useRef(running);
  const wasActive = useRef(active);
  const schedule = useRef<() => void>(() => {});

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const current = latest.current;
    if (
      !mounted.current ||
      inFlight.current ||
      !current.active ||
      current.running ||
      current.busy ||
      document.visibilityState === "hidden" ||
      !document.hasFocus()
    )
      return;
    inFlight.current = true;
    const requestRevision = revision.current;
    lastAttempt.current = Date.now();
    setLoading(true);
    setError(null);
    try {
      const next = await current.api.getInventory();
      if (
        !mounted.current ||
        latest.current.api !== current.api ||
        latest.current.running ||
        revision.current !== requestRevision
      )
        return;
      failures.current = 0;
      nextDue.current = Number.POSITIVE_INFINITY;
      setSnapshot(next);
      setUpdatedAt(Date.now());
    } catch (reason) {
      if (
        !mounted.current ||
        latest.current.api !== current.api ||
        revision.current !== requestRevision
      )
        return;
      failures.current++;
      nextDue.current =
        Date.now() + Math.min(300_000, MIN_RECONNECT_MS * 2 ** Math.min(failures.current - 1, 4));
      setError(String(reason));
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setLoading(false);
        schedule.current();
      }
    }
  }, []);

  useEffect(() => {
    if (wasRunning.current && !running) nextDue.current = 0;
    wasRunning.current = running;
    // Opening Inventory again reads again (after the reconnect cooldown).
    if (!wasActive.current && active) nextDue.current = 0;
    wasActive.current = active;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function tick() {
      clearTimeout(timer);
      if (
        !active ||
        running ||
        busy ||
        inFlight.current ||
        document.visibilityState === "hidden" ||
        !document.hasFocus()
      )
        return;
      if (nextDue.current === Number.POSITIVE_INFINITY) return;
      const delay = Math.max(nextDue.current, lastAttempt.current + MIN_RECONNECT_MS) - Date.now();
      if (delay > 0) timer = setTimeout(tick, delay);
      else void refresh();
    }
    schedule.current = tick;
    tick();
    window.addEventListener("focus", tick);
    window.addEventListener("blur", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(timer);
      schedule.current = () => {};
      window.removeEventListener("focus", tick);
      window.removeEventListener("blur", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, running, busy, refresh]);

  const replaceSnapshot = useCallback((next: InventorySnapshot) => {
    revision.current++;
    setSnapshot(next);
    setError(null);
    setUpdatedAt(Date.now());
    failures.current = 0;
    nextDue.current = Number.POSITIVE_INFINITY;
  }, []);

  return { snapshot, loading, error, updatedAt, refresh, replaceSnapshot };
}
