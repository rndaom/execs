import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { TidyReport } from "../lib/bridge";

/**
 * The once-per-version tidy-up after an update. It asks the native side once
 * per session, as soon as the profile library is ready and TF2 and other
 * writes are idle; the native side decides whether it is due and records it.
 */
export function useStartupTidy(
  api: Pick<Api, "runAutomaticTidyUp">,
  { ready, running, busy }: { ready: boolean; running: boolean; busy: boolean },
  onChanged: () => void,
) {
  const [report, setReport] = useState<TidyReport | null>(null);
  const asked = useRef(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  useEffect(() => {
    if (!ready || running || busy || asked.current) return;
    asked.current = true;
    let live = true;
    api
      .runAutomaticTidyUp()
      .then((next) => {
        if (!next) return;
        // Profile files may have changed underneath the open panes.
        changed.current();
        if (live) setReport(next);
      })
      .catch(() => {
        // The tidy-up is best effort; the next start asks again.
      });
    return () => {
      live = false;
    };
  }, [api, ready, running, busy]);
  const dismiss = useCallback(() => setReport(null), []);
  return { report, dismiss };
}
