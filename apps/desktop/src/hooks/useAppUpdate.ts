import { useCallback, useEffect, useState } from "react";
import type { Api } from "../lib/api";
import {
  type AppUpdateInfo,
  type AppUpdateProgress,
  canInstallUpdate,
  updateCheckCopy,
} from "../lib/updater-ui";

export type AppUpdateState = {
  /** Empty when `get_app_version` failed — Check for updates stays available. */
  version: string;
  available: AppUpdateInfo | null;
  dismissed: boolean;
  progress: AppUpdateProgress | null;
  checkMessage: string | null;
  check: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
};

export function useAppUpdate(
  api: Api,
  {
    setError,
    seedProgress = null,
  }: { setError: (message: string | null) => void; seedProgress?: AppUpdateProgress | null },
): AppUpdateState {
  const [version, setVersion] = useState("");
  const [available, setAvailable] = useState<AppUpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState<AppUpdateProgress | null>(seedProgress);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function checkOnLaunch() {
      try {
        const next = await api.getAppVersion();
        if (!cancelled) {
          setVersion(next);
        }
      } catch {
        /* version stays empty; the Check control is rendered regardless */
      }
      try {
        const update = await api.checkAppUpdate();
        if (!cancelled) {
          setAvailable(update);
        }
      } catch {
        /* the launch check stays silent */
      }
    }
    void checkOnLaunch();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const check = useCallback(async () => {
    setCheckMessage(null);
    try {
      const update = await api.checkAppUpdate();
      if (update) {
        setAvailable(update);
        setDismissed(false);
        return;
      }
      setCheckMessage(updateCheckCopy("latest"));
    } catch {
      setCheckMessage(updateCheckCopy("error"));
    }
  }, [api]);

  const install = useCallback(async () => {
    if (!available || !canInstallUpdate(progress)) {
      return;
    }
    setCheckMessage(null);
    try {
      // Progress is driven by the adapter's own callback, so a backend that
      // cannot install never strands the banner on "Downloading".
      await api.installAppUpdate((step) => setProgress(step));
    } catch (err) {
      setProgress(null);
      setError(err instanceof Error ? err.message : "Could not install the update.");
    }
  }, [api, available, progress, setError]);

  return {
    version,
    available,
    dismissed,
    progress,
    checkMessage,
    check,
    install,
    dismiss: () => setDismissed(true),
  };
}
