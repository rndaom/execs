import { useCallback, useEffect, useId, useRef } from "react";
import type { SettingsDraftStore } from "../lib/settings-drafts";

/** Account drafts require explicit review; closing must never apply an arrangement or craft. */
export function useInventoryDraftGuard(store: SettingsDraftStore) {
  const owner = `inventory:${useId()}`;
  const state = useRef({ dirty: false, busy: false, reset: () => {} });
  const cannotAutosave = useCallback(async () => false, []);
  const report = useCallback(() => {
    store.report(
      {
        id: owner,
        owner,
        profile: null,
        tab: "inventory",
        save: state.current.busy
          ? { flush: cannotAutosave, saving: true, failed: false, locked: false }
          : undefined,
      },
      state.current.dirty || state.current.busy,
    );
  }, [store, owner, cannotAutosave]);
  useEffect(() => {
    const unregister = store.register(owner, () => {
      if (state.current.busy) return;
      state.current.reset();
      state.current.dirty = false;
      store.removeOwner(owner);
    });
    report();
    return unregister;
  }, [store, owner, report]);
  const onDraftChange = useCallback(
    (dirty: boolean, reset: () => void) => {
      state.current.dirty = dirty;
      state.current.reset = reset;
      report();
    },
    [report],
  );
  const onOperationBusyChange = useCallback(
    (busy: boolean) => {
      state.current.busy = busy;
      report();
    },
    [report],
  );
  return { onDraftChange, onOperationBusyChange };
}
