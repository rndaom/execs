import { useContext, useEffect, useId } from "react";
import { AutosavePending } from "./useAutosave";

/**
 * Protect an unapplied build/selection through the session exit guard. Omitting
 * a flush callback is deliberate: closing the app cannot run a heavy action.
 * SettingsDraftBoundary supplies review/discard and resets persisted props.
 */
export function useExplicitDraft(pending: boolean) {
  const reportPending = useContext(AutosavePending);
  const id = useId();
  useEffect(() => {
    reportPending?.(id, pending);
    return () => reportPending?.(id, false);
  }, [reportPending, id, pending]);
}
