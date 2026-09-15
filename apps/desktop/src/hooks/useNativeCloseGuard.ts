import { useEffect, useRef, useState } from "react";
import { isTauri } from "../lib/bridge";
import type { FilesDraftStore } from "../lib/files-drafts";
import type { SettingsDraftStore } from "../lib/settings-drafts";

/** Editing starts only after native close requests can be intercepted. */
export function useNativeCloseGuard(
  store: FilesDraftStore,
  request: (next: () => Promise<void>) => void,
  busy = false,
  settings?: SettingsDraftStore,
) {
  const [ready, setReady] = useState(() => !isTauri());
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        busyRef.current ||
        settings?.isWriting() ||
        store.dirty().length > 0 ||
        settings?.getSnapshot().length
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      setReady(false);
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          if (cancelled) return;
          const current = getCurrentWindow();
          const stop = await current.onCloseRequested((event) => {
            if (cancelled) {
              event.preventDefault();
              return;
            }
            if (
              !busyRef.current &&
              !settings?.isWriting() &&
              store.dirty().length === 0 &&
              !settings?.getSnapshot().length
            )
              return;
            event.preventDefault();
            requestRef.current(() => current.destroy());
          });
          if (cancelled) stop();
          else {
            unlisten = stop;
            setReady(true);
            setError(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setReady(false);
            setError(
              "Settings editing is unavailable because close protection could not start. Restart execs to retry.",
            );
          }
        });
    }
    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [store, settings]);

  return { ready, error };
}
