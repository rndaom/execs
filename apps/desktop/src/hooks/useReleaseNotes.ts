import { useCallback, useEffect, useRef, useState } from "react";
import {
  dismissInstalledRelease,
  installedReleaseForLaunch,
  releaseNotesStorage,
} from "../lib/release-notes-ui";
import type { AppUpdateInfo } from "../lib/updater-ui";

export function useReleaseNotes({
  version,
  installResolved,
  existingInstall,
  seed = null,
}: {
  version: string;
  installResolved: boolean;
  existingInstall: boolean;
  seed?: AppUpdateInfo | null;
}) {
  const [release, setRelease] = useState<AppUpdateInfo | null>(seed);
  const resolved = useRef(seed !== null);

  useEffect(() => {
    if (resolved.current || !version || !installResolved) return;
    resolved.current = true;
    setRelease(installedReleaseForLaunch(releaseNotesStorage(), version, existingInstall));
  }, [version, installResolved, existingInstall]);

  const dismiss = useCallback(() => {
    setRelease((current) => {
      if (current) dismissInstalledRelease(releaseNotesStorage(), current.version);
      return null;
    });
  }, []);

  return { release, dismiss };
}
