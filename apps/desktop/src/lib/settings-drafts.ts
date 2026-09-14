import type { SettingsTab } from "./settings-ui";

export type PendingSave = {
  flush: () => Promise<boolean>;
  saving: boolean;
  failed: boolean;
  locked: boolean;
};

export type SettingsDraft = {
  id: string;
  owner: string;
  profile: string | null;
  tab: SettingsTab;
  save?: PendingSave;
};

/** Session-owned controls, never serialized draft bytes or a replacement write gate. */
export function createSettingsDraftStore() {
  let snapshot: readonly SettingsDraft[] = [];
  const listeners = new Set<() => void>();
  const owners = new Map<string, () => void>();
  let writing = () => false;
  function publish(next: readonly SettingsDraft[]) {
    snapshot = next;
    for (const listener of listeners) listener();
  }
  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    isWriting: () => writing(),
    registerWriteGuard(check: () => boolean) {
      writing = check;
      return () => {
        if (writing === check) writing = () => false;
      };
    },
    register(owner: string, discard: () => void) {
      owners.set(owner, discard);
      return () => {
        owners.delete(owner);
        store.removeOwner(owner);
      };
    },
    removeOwner(owner: string) {
      const next = snapshot.filter((entry) => entry.owner !== owner);
      if (next.length !== snapshot.length) publish(next);
    },
    report(entry: SettingsDraft, pending: boolean) {
      const previous = snapshot.find((item) => item.id === entry.id);
      if (!pending) {
        if (previous) publish(snapshot.filter((item) => item.id !== entry.id));
        return;
      }
      if (
        previous?.owner === entry.owner &&
        previous.save?.saving === entry.save?.saving &&
        previous.save?.failed === entry.save?.failed &&
        previous.save?.locked === entry.save?.locked &&
        previous.save?.flush === entry.save?.flush
      )
        return;
      publish([...snapshot.filter((item) => item.id !== entry.id), entry]);
    },
    async flush(tab?: SettingsTab): Promise<boolean> {
      const requested = snapshot.filter((entry) => tab === undefined || entry.tab === tab);
      let saved = true;
      for (const entry of requested) {
        // A changed profile/remounted pane invalidates an in-progress transition.
        if (!owners.has(entry.owner)) return false;
        if (!entry.save || !(await entry.save.flush())) saved = false;
        if (!owners.has(entry.owner)) return false;
      }
      return saved && !snapshot.some((entry) => tab === undefined || entry.tab === tab);
    },
    discard(tab?: SettingsTab): boolean {
      if (writing()) return false;
      const requested = snapshot.filter((entry) => tab === undefined || entry.tab === tab);
      // An in-flight native write cannot be cancelled by dropping its renderer.
      if (requested.some((entry) => entry.save?.saving || !owners.has(entry.owner))) return false;
      for (const owner of new Set(requested.map((entry) => entry.owner))) owners.get(owner)?.();
      return !snapshot.some((entry) => tab === undefined || entry.tab === tab);
    },
  };
  return store;
}

export type SettingsDraftStore = ReturnType<typeof createSettingsDraftStore>;
