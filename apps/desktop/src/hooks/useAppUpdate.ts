import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import {
  clearPendingRelease,
  releaseNotesStorage,
  stagePendingRelease,
} from "../lib/release-notes-ui";
import {
  type AppUpdateInfo,
  type AppUpdateProgress,
  canInstallUpdate,
  updateCheckCopy,
} from "../lib/updater-ui";
import type { SetOperationError } from "./useOperationErrors";

export type AppUpdateState = {
  /** Empty when `get_app_version` failed — Check for updates stays available. */
  version: string;
  available: AppUpdateInfo | null;
  dismissed: boolean;
  progress: AppUpdateProgress | null;
  checkMessage: string | null;
  checking: boolean;
  check: () => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => void;
};

export function useAppUpdate(
  api: Api,
  {
    setError,
    seedProgress = null,
    checkOnStartup = true,
  }: {
    setError: SetOperationError;
    seedProgress?: AppUpdateProgress | null;
    /** null waits for global preferences; the manual check remains available. */
    checkOnStartup?: boolean | null;
  },
): AppUpdateState {
  const [version, setVersion] = useState("");
  const [available, setAvailable] = useState<AppUpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState<AppUpdateProgress | null>(seedProgress);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const request = useRef(0);
  const checkingRef = useRef(false);
  const installingRef = useRef(false);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const startupChecked = useRef(false);
  const manualCheckIssued = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function readVersion() {
      try {
        const next = await api.getAppVersion();
        if (!cancelled) {
          setVersion(next);
        }
      } catch {
        /* version stays empty; the Check control is rendered regardless */
      }
    }
    startupChecked.current = false;
    manualCheckIssued.current = false;
    checkingRef.current = false;
    setChecking(false);
    void readVersion();
    return () => {
      cancelled = true;
      request.current += 1;
    };
  }, [api]);

  const runCheck = useCallback(
    async (manual: boolean) => {
      if (installingRef.current || progressRef.current !== null) return;
      const generation = ++request.current;
      checkingRef.current = true;
      setChecking(true);
      if (manual) setCheckMessage(null);
      try {
        const update = await api.checkAppUpdate();
        if (generation !== request.current) return;
        // A successful no-update response is just as authoritative as an offer.
        // Reconcile all presentation state together; never leave an obsolete
        // Install action beside a message saying this version is current.
        setAvailable(update);
        setDismissed(false);
        setCheckMessage(manual && !update ? updateCheckCopy("latest") : null);
      } catch {
        if (generation === request.current && manual) {
          // A failed check says nothing about the last successful offer.
          setCheckMessage(updateCheckCopy("error"));
        }
      } finally {
        if (generation === request.current) {
          checkingRef.current = false;
          setChecking(false);
        }
      }
    },
    [api],
  );

  useEffect(() => {
    if (checkOnStartup === null || startupChecked.current) return;
    startupChecked.current = true;
    // A manual check made while preferences were loading already supplied
    // this launch's request; do not follow it with an older automatic intent.
    if (checkOnStartup && !manualCheckIssued.current) void runCheck(false);
  }, [checkOnStartup, runCheck]);

  const check = useCallback(async () => {
    startupChecked.current = true;
    manualCheckIssued.current = true;
    await runCheck(true);
  }, [runCheck]);

  const install = useCallback(async () => {
    if (
      !available ||
      checkingRef.current ||
      installingRef.current ||
      !canInstallUpdate(progressRef.current)
    ) {
      return;
    }
    // Close the synchronous double-click window before the adapter's first
    // progress callback arrives, without inventing a displayed progress step.
    installingRef.current = true;
    setCheckMessage(null);
    stagePendingRelease(releaseNotesStorage(), available);
    try {
      await api.installAppUpdate((step) => {
        progressRef.current = step;
        setProgress(step);
      });
      setError(null, "update:install");
    } catch (err) {
      clearPendingRelease(releaseNotesStorage(), available.version);
      installingRef.current = false;
      progressRef.current = null;
      setProgress(null);
      setError(
        err instanceof Error ? err.message : "Could not install the update.",
        "update:install",
      );
    }
  }, [api, available, setError]);

  return {
    version,
    available,
    dismissed,
    progress,
    checkMessage,
    checking,
    check,
    install,
    dismiss: () => setDismissed(true),
  };
}
