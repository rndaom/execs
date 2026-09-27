import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { InventorySnapshot } from "../lib/bridge";

export const INVENTORY_REFRESH_MS = 120_000;
const MIN_RECONNECT_MS = 30_000;

/** One bounded Steam connection at a time, only while the backpack is in use. */
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
  const wasRunning = useRef(running);
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
    lastAttempt.current = Date.now();
    setLoading(true);
    setError(null);
    try {
      const next = await current.api.getInventory();
      if (!mounted.current || latest.current.api !== current.api || latest.current.running) return;
      failures.current = 0;
      nextDue.current = Date.now() + INVENTORY_REFRESH_MS;
      setSnapshot(next);
      setUpdatedAt(Date.now());
    } catch (reason) {
      if (!mounted.current || latest.current.api !== current.api) return;
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

  return { snapshot, loading, error, updatedAt, refresh };
}
