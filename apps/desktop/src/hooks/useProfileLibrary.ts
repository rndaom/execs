import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type { AbsorbDelta, PackChoice, ProfileLibrary, Tf2Install } from "../lib/bridge";
import {
  canExportProfile,
  canImportProfile,
  canSaveCurrent,
  hasPackChanges,
} from "../lib/library-ui";
import type { SwitchProgressController } from "./useSwitchProgress";

export type ProfileLibraryState = {
  library: ProfileLibrary | null;
  /** A pack delta the user has not answered yet. Deferred, never discarded. */
  packPrompt: AbsorbDelta | null;
  /** Dismissed for now — re-offered after the next switch or TF2 session. */
  packPromptDeferred: boolean;
  deferPackPrompt: () => void;
  /** Absorb reported `config.cfg` drift; the Binds pane re-syncs on this. */
  bindSyncRequest: number | null;
  /** Changes whenever the panes must reload (profile switch or a fresh absorb). */
  refreshKey: string;
  onBindSyncHandled: (request: number) => void;
  saveCurrent: (name: string) => Promise<boolean>;
  importProfile: () => Promise<void>;
  exportProfile: (id: string) => Promise<void>;
  switchProfile: (id: string) => Promise<void>;
  answerPackPrompt: (choice: PackChoice) => Promise<void>;
  setLibrary: (library: ProfileLibrary) => void;
  reset: () => void;
};

export function useProfileLibrary(
  api: Api,
  {
    confirmed,
    running,
    busy,
    quitNonce,
    progress,
    setError,
    setBusy,
  }: {
    confirmed: Tf2Install | null;
    running: boolean;
    busy: boolean;
    quitNonce: number;
    progress: SwitchProgressController;
    setError: (message: string | null) => void;
    setBusy: (busy: boolean) => void;
  },
): ProfileLibraryState {
  const [library, setLibrary] = useState<ProfileLibrary | null>(null);
  const [packPrompt, setPackPrompt] = useState<AbsorbDelta | null>(null);
  const [packPromptProfile, setPackPromptProfile] = useState<string | null>(null);
  const [bindSyncRequest, setBindSyncRequest] = useState<number | null>(null);
  const [packPromptDeferred, setPackPromptDeferred] = useState(false);
  const [absorbNonce, setAbsorbNonce] = useState(0);
  const [absorbRetry, setAbsorbRetry] = useState(0);
  const absorb = useRef({
    generation: 0,
    gate: 0,
    live: false,
    inFlight: false,
    completed: null as string | null,
    configDrift: false,
  });

  // Load the library for a confirmed root.
  useEffect(() => {
    if (!confirmed) {
      setLibrary(null);
      return;
    }
    let cancelled = false;
    api
      .getProfileLibrary()
      .then((next) => {
        if (!cancelled) {
          setLibrary(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not read the profile library.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, confirmed, setError]);

  // Materialize the library folder the first time we have a usable root.
  useEffect(() => {
    if (!confirmed || running || busy || !library) {
      return;
    }
    if (library.initialized || library.rootMismatch || !library.usable) {
      return;
    }
    let cancelled = false;
    api
      .initProfileLibrary()
      .then((next) => {
        if (!cancelled) {
          setLibrary(next);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not create the profile library.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, confirmed, running, busy, library, setError]);

  // Absorb live drift after every observed quit (and on boot with TF2 closed).
  const libraryReady = library !== null;
  const activeProfileId = library?.activeProfileId ?? null;
  const rootPath = confirmed?.path ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: ownership changes invalidate pending native snapshots, including A to B to A.
  useEffect(() => {
    const control = absorb.current;
    control.generation += 1;
    control.live = true;
    control.completed = null;
    control.configDrift = false;
    return () => {
      control.generation += 1;
      control.live = false;
    };
  }, [api, rootPath, activeProfileId]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: every gate transition invalidates a snapshot, even if it returns to idle before completion.
  useEffect(() => {
    absorb.current.gate += 1;
  }, [busy, running, quitNonce]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: absorbRetry resumes serialized work after an invalidated request settles.
  useEffect(() => {
    if (!confirmed || !libraryReady || running || busy || quitNonce === 0) {
      return;
    }
    // Busy changes are only a gate for a pending pass. An ordinary settings
    // save must not become another external-change event and reload every pane.
    const key = JSON.stringify([confirmed.path, activeProfileId, quitNonce]);
    const control = absorb.current;
    if (control.completed === key || control.inFlight) return;
    const generation = control.generation;
    const gate = control.gate;
    control.inFlight = true;
    api
      .absorbOwned()
      .then((result) => {
        if (generation !== control.generation || !control.live) return;
        // Native absorb may already have consumed config drift when a write
        // invalidates this snapshot. Keep that signal for the fresh idle pass,
        // but never replay stale library or pack data over a subsequent save.
        control.configDrift ||= result.configCfgAbsorbed;
        if (gate !== control.gate) return;
        control.completed = key;
        setLibrary(result.library);
        // Each result is a complete current snapshot. An old question must not
        // outlive its files or be presented as a choice for a different profile.
        setPackPrompt(hasPackChanges(result.delta) ? result.delta : null);
        setPackPromptProfile(result.library.activeProfileId);
        setPackPromptDeferred(false);
        setAbsorbNonce((value) => value + 1);
        if (control.configDrift) {
          setBindSyncRequest((current) => (current ?? 0) + 1);
        }
        control.configDrift = false;
      })
      .catch((err) => {
        if (control.live && generation === control.generation && gate === control.gate) {
          setError(err instanceof Error ? err.message : "Could not absorb live changes.");
        }
      })
      .finally(() => {
        control.inFlight = false;
        // Serialize retries, including a new owner waiting behind an old call.
        // Failures otherwise wait for the next gate/event instead of spinning.
        if (control.live && (generation !== control.generation || gate !== control.gate)) {
          setAbsorbRetry((value) => value + 1);
        }
      });
  }, [
    api,
    confirmed,
    libraryReady,
    activeProfileId,
    running,
    busy,
    quitNonce,
    setError,
    absorbRetry,
  ]);

  const saveCurrent = useCallback(
    async (name: string) => {
      if (!library || !canSaveCurrent(library, running, name)) {
        return false;
      }
      setError(null);
      setBusy(true);
      try {
        setLibrary(await api.saveCurrentAs(name));
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that profile.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [api, library, running, setError, setBusy],
  );

  const importProfile = useCallback(async () => {
    if (!library || !canImportProfile(library, running)) {
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setLibrary(await api.importProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import that profile.");
    } finally {
      setBusy(false);
    }
  }, [api, library, running, setError, setBusy]);

  const exportProfile = useCallback(
    async (id: string) => {
      if (!library || !canExportProfile(library, running)) {
        return;
      }
      setError(null);
      setBusy(true);
      try {
        await api.exportProfile(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not export that profile.");
      } finally {
        setBusy(false);
      }
    },
    [api, library, running, setError, setBusy],
  );

  const switchProfile = useCallback(
    async (id: string) => {
      if (!library || running || busy || progress.state.active || library.activeProfileId === id) {
        return;
      }
      setError(null);
      // The native switch reconciles the outgoing profile. A fresh absorb of
      // the target will report its own delta when the switch settles.
      progress.start();
      setBusy(true);
      try {
        setLibrary(await api.switchProfile(id));
        progress.complete();
        setPackPrompt(null);
        setPackPromptDeferred(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not switch profiles.");
        // A failure after the durable switch marker was written clears the
        // active profile on disk. Never leave the renderer showing the stale
        // pre-switch active id; the refreshed library also exposes recovery.
        try {
          setLibrary(await api.getProfileLibrary());
        } catch {
          /* Keep the switch error; it carries the recovery instruction. */
        }
        progress.cancel();
      } finally {
        setBusy(false);
      }
    },
    [api, library, running, busy, progress, setError, setBusy],
  );

  const answerPackPrompt = useCallback(
    async (choice: PackChoice) => {
      if (!packPrompt || packPromptProfile !== activeProfileId || running || busy) return;
      setError(null);
      setBusy(true);
      try {
        setLibrary(await api.absorbPacks(choice));
        setPackPrompt(null);
        setPackPromptDeferred(false);
        setAbsorbNonce((value) => value + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update packs.");
      } finally {
        setBusy(false);
      }
    },
    [api, packPrompt, packPromptProfile, activeProfileId, running, busy, setError, setBusy],
  );

  const reset = useCallback(() => {
    setLibrary(null);
    setPackPrompt(null);
    setPackPromptProfile(null);
    setPackPromptDeferred(false);
    setBindSyncRequest(null);
    setAbsorbNonce(0);
    absorb.current.generation += 1;
    absorb.current.completed = null;
    absorb.current.configDrift = false;
  }, []);

  const onBindSyncHandled = useCallback((request: number) => {
    setBindSyncRequest((current) => (current === request ? null : current));
  }, []);

  return {
    library,
    packPrompt: packPromptProfile === activeProfileId ? packPrompt : null,
    packPromptDeferred,
    deferPackPrompt: () => setPackPromptDeferred(true),
    bindSyncRequest,
    refreshKey: `${library?.activeProfileId ?? ""}:${absorbNonce}`,
    onBindSyncHandled,
    saveCurrent,
    importProfile,
    exportProfile,
    switchProfile,
    answerPackPrompt,
    setLibrary,
    reset,
  };
}
