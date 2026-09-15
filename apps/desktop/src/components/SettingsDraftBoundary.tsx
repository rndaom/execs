import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { AutosaveActivity, AutosaveDiscard, AutosavePending } from "../hooks/useAutosave";
import type { PendingSave, SettingsDraftStore } from "../lib/settings-drafts";
import type { SettingsTab } from "../lib/settings-ui";
import { useToast } from "./ui/Toast";

/** A discard resets exactly the named pane to its latest persisted props. */
export function SettingsDraftBoundary({
  store,
  profile,
  tab,
  active,
  blocked,
  onDiscard,
  children,
}: {
  store: SettingsDraftStore;
  profile: string | null;
  tab: SettingsTab;
  active: boolean;
  blocked: boolean;
  onDiscard?: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const toast = useToast();
  const [generation, setGeneration] = useState(() => ({ id: 0, discard: { current: false } }));
  const owner = `${id}:${generation.id}`;
  const reset = useRef(onDiscard);
  reset.current = onDiscard;
  const report = useCallback(
    (pendingId: string, pending: boolean, save?: PendingSave) => {
      store.report({ id: pendingId, owner, profile, tab, save }, pending);
    },
    [store, owner, profile, tab],
  );
  useEffect(
    () =>
      store.register(owner, () => {
        generation.discard.current = true;
        toast.clearSource(`${profile}:${tab}:save`);
        reset.current?.();
        store.removeOwner(owner);
        setGeneration({ id: generation.id + 1, discard: { current: false } });
      }),
    [store, owner, generation, toast, profile, tab],
  );
  return (
    <div hidden={!active} inert={blocked} data-testid={`settings-surface-${tab}`}>
      <AutosaveDiscard.Provider value={generation.discard}>
        <AutosavePending.Provider value={report}>
          <AutosaveActivity.Provider key={generation.id} value={active && !blocked}>
            {children}
          </AutosaveActivity.Provider>
        </AutosavePending.Provider>
      </AutosaveDiscard.Provider>
    </div>
  );
}
