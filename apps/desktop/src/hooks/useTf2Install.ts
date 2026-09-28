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
  /** The saved TF2 folder when it no longer holds TF2, such as a disconnected drive. */
  missing: string | null;
  /** Check the saved folder again after reconnecting its drive. */
  retryMissing: () => Promise<void>;
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
    onConfirmed,
  }: {
    setError: SetOperationError;
    setBusy: (busy: boolean) => void;
    /** Leaving for the finder must clear every install-scoped screen. */
    onChanged: () => void;
    /** Runs in the same update that publishes a newly confirmed install. */
    onConfirmed?: () => void;
  },
): Tf2InstallState {
  const [screen, setScreen] = useState<Screen>("finder");
  const [scanning, setScanning] = useState(true);
  const [installs, setInstalls] = useState<Tf2Install[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<Tf2Install | null>(null);
  const [missing, setMissing] = useState<string | null>(null);

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
        } else {
          const unavailable = await api.getMissingTf2Root();
          if (cancelled) return;
          setMissing(unavailable);
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

  const retryMissing = useCallback(async () => {
    setBusy(true);
    try {
      const stored = await api.getTf2Root();
      if (stored) {
        onConfirmed?.();
        setMissing(null);
        setConfirmed(stored);
        setSelected(stored.path);
        setScreen("ready");
        setError(null, "install:retry");
        return;
      }
      setMissing(await api.getMissingTf2Root());
      setError(
        "TF2 is still not there. Connect the drive, or choose where TF2 is now.",
        "install:retry",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not check that folder.",
        "install:retry",
      );
    } finally {
      setBusy(false);
    }
  }, [api, setError, setBusy, onConfirmed]);

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
      onConfirmed?.();
      setMissing(null);
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
  }, [api, selected, setError, setBusy, onConfirmed]);

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
    missing,
    retryMissing,
    select: setSelected,
    browse,
    confirm,
    change,
  };
}
