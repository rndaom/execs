import { useCallback, useEffect, useState } from "react";
import type { Api } from "../lib/api";
import type { LifecycleStatus } from "../lib/bridge";

export type LifecycleState = LifecycleStatus & {
  available: boolean;
  degraded: string | null;
  refresh: () => Promise<void>;
};

const IDLE: LifecycleStatus = {
  launchingTf2: false,
  steamVerification: false,
  installingUpdate: false,
};

/**
 * Lifecycle leases can outlive a component and, for Steam hand-offs, the app
 * process itself. Polling this tiny in-memory command keeps every pane locked
 * after restart and also observes background launch completion.
 */
export function useLifecycleStatus(api: Api): LifecycleState {
  const [status, setStatus] = useState<LifecycleStatus>(IDLE);
  const [available, setAvailable] = useState(false);
  const [degraded, setDegraded] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getLifecycleStatus());
      setAvailable(true);
      setDegraded(null);
    } catch {
      // Unknown lifecycle state must fail closed: an external Steam writer may
      // own the surface even though the renderer cannot currently ask.
      setAvailable(false);
      setDegraded("Maintenance state unavailable — changes are locked.");
    }
  }, [api]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    async function poll() {
      await refresh();
      if (!stopped) {
        timer = window.setTimeout(() => void poll(), 1_000);
      }
    }
    void poll();
    return () => {
      stopped = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [refresh]);

  return { ...status, available, degraded, refresh };
}
