import { useCallback, useEffect, useState } from "react";
import type { Api } from "../lib/api";
import type { Tf2Install } from "../lib/bridge";
import type { SetOperationError } from "./useOperationErrors";

export type Screen = "finder" | "ready";

export type Tf2InstallState = {
  screen: Screen;
  scanning: boolean;
  installs: Tf2Install[];
  selected: string | null;
  confirmed: Tf2Install | null;
  select: (path: string) => void;
  browse: () => Promise<void>;
  confirm: () => Promise<void>;
  change: () => void;
};

/** Finder state and the confirmed TF2 root. No write happens before Confirm. */
export function useTf2Install(
  api: Api,
  {
    setError,
    setBusy,
    onChanged,
  }: {
    setError: SetOperationError;
    setBusy: (busy: boolean) => void;
    /** Leaving for the finder must clear every install-scoped screen. */
    onChanged: () => void;
  },
): Tf2InstallState {
  const [screen, setScreen] = useState<Screen>("finder");
  const [scanning, setScanning] = useState(true);
  const [installs, setInstalls] = useState<Tf2Install[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Tf2Install | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const stored = await api.getTf2Root();
        if (cancelled) {
          return;
        }
        if (stored) {
          setConfirmed(stored);
          setSelected(stored.path);
          setScreen("ready");
        }
        const found = await api.scanTf2Installs();
        if (cancelled) {
          return;
        }
        setInstalls(found);
        setError(null, "install:scan");
        if (!stored && found.length === 1) {
          setSelected(found[0].path);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not scan for TF2.", "install:scan");
        }
      } finally {
        if (!cancelled) {
          setScanning(false);
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [api, setError]);

  const browse = useCallback(async () => {
    setBusy(true);
    try {
      const picked = await api.browseTf2Root();
      if (!picked) {
        return;
      }
      setInstalls((current) =>
        current.some((item) => item.path === picked.path) ? current : [...current, picked],
      );
      setSelected(picked.path);
      setError(null, "install:browse");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That folder is not a TF2 install.",
        "install:browse",
      );
    } finally {
      setBusy(false);
    }
  }, [api, setError, setBusy]);

  const confirm = useCallback(async () => {
    if (!selected) {
      return;
    }
    setBusy(true);
    try {
      const stored = await api.confirmTf2Root(selected);
      setConfirmed(stored);
      setScreen("ready");
      setError(null, "install:confirm");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not remember that install.",
        "install:confirm",
      );
    } finally {
      setBusy(false);
    }
  }, [api, selected, setError, setBusy]);

  const change = useCallback(() => {
    setScreen("finder");
    setConfirmed(null);
    setSelected((current) => {
      if (current && installs.some((item) => item.path === current)) {
        return current;
      }
      return installs.length === 1 ? installs[0].path : null;
    });
    onChanged();
  }, [installs, onChanged]);

  return {
    screen,
    scanning,
    installs,
    selected,
    confirmed,
    select: setSelected,
    browse,
    confirm,
    change,
  };
}
