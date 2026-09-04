import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type {
  AbsorbDelta,
  PackChoice,
  ProfileImportReview,
  ProfileLibrary,
  ProfileSummary,
  Tf2Install,
} from "../lib/bridge";
import {
  canExportProfile,
  canImportProfile,
  canSaveCurrent,
  hasPackChanges,
  newlyImportedProfile,
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
  importing: boolean;
  importStage: "selecting" | "reading" | "review" | "saving" | "done" | null;
  importReview: ProfileImportReview | null;
  confirmImport: () => Promise<void>;
  cancelImport: () => Promise<void>;
  importError: string | null;
  importedProfile: ProfileSummary | null;
  dismissImport: () => void;
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
  const [bindSyncRequest, setBindSyncRequest] = useState<number | null>(null);
  const [packPromptDeferred, setPackPromptDeferred] = useState(false);
  const [absorbNonce, setAbsorbNonce] = useState(0);
  const [importStage, setImportStage] = useState<ProfileLibraryState["importStage"]>(null);
  const [importReview, setImportReview] = useState<ProfileImportReview | null>(null);
  const importInFlight = useRef(false);
  const importing = importStage !== null && importStage !== "done";
  const [importError, setImportError] = useState<string | null>(null);
  const [importedProfile, setImportedProfile] = useState<ProfileSummary | null>(null);

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
  useEffect(() => {
    if (!confirmed || !libraryReady || running || busy || quitNonce === 0) {
      return;
    }
    let cancelled = false;
    api
      .absorbOwned()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setLibrary(result.library);
        // A pack delta is a question, not a notification: keep the previous
        // unanswered one when this pass reports nothing new.
        setPackPrompt((current) => (hasPackChanges(result.delta) ? result.delta : current));
        setPackPromptDeferred(false);
        setAbsorbNonce((value) => value + 1);
        if (result.configCfgAbsorbed) {
          setBindSyncRequest((current) => (current ?? 0) + 1);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not absorb live changes.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, confirmed, libraryReady, running, busy, quitNonce, setError]);

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
    if (!library || busy || importInFlight.current || !canImportProfile(library, running)) return;
    importInFlight.current = true;
    setError(null);
    setImportedProfile(null);
    setImportReview(null);
    setImportError(null);
    setImportStage("selecting");
    setBusy(true);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await api.onProfileImportReading(() => setImportStage("reading"));
      const review = await api.importProfile();
      setImportReview(review);
      setImportStage(review ? "review" : null);
      if (!review) setBusy(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not read that ZIP.");
      setImportStage(null);
      setBusy(false);
    } finally {
      unlisten?.();
      importInFlight.current = false;
    }
  }, [api, library, running, busy, setError, setBusy]);

  const confirmImport = useCallback(async () => {
    if (!importReview || !library || running || importInFlight.current) return;
    importInFlight.current = true;
    setImportStage("saving");
    try {
      const next = await api.confirmProfileImport(importReview.token);
      setLibrary(next);
      setImportedProfile(newlyImportedProfile(library, next));
      setImportStage("done");
    } catch (err) {
      // Kept separately from settings errors so refresh cannot erase it.
      setImportError(err instanceof Error ? err.message : "Could not import that profile.");
      setImportStage(null);
      setImportReview(null);
    } finally {
      importInFlight.current = false;
      setBusy(false);
    }
  }, [api, importReview, library, running, setBusy]);

  const cancelImport = useCallback(async () => {
    if (importInFlight.current) return;
    importInFlight.current = true;
    if (importReview) {
      try {
        await api.cancelProfileImport(importReview.token);
      } catch (err) {
        setImportError(err instanceof Error ? err.message : "Could not cancel the import.");
      }
    }
    setImportReview(null);
    setImportStage(null);
    setBusy(false);
    importInFlight.current = false;
  }, [api, importReview, setBusy]);

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
      // The pack prompt is deferred, not answered: a switch must not throw the
      // question away — it is re-offered once the switch settles.
      progress.start();
      setBusy(true);
      try {
        setLibrary(await api.switchProfile(id));
        setImportedProfile(null);
        setImportStage(null);
        setImportReview(null);
        progress.complete();
        // Re-offer whatever the user deferred: the delta outlived the switch.
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
      setError(null);
      setBusy(true);
      try {
        setLibrary(await api.absorbPacks(choice));
        setPackPrompt(null);
        setPackPromptDeferred(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update packs.");
      } finally {
        setBusy(false);
      }
    },
    [api, setError, setBusy],
  );

  const reset = useCallback(() => {
    setLibrary(null);
    setPackPrompt(null);
    setPackPromptDeferred(false);
    setBindSyncRequest(null);
    setAbsorbNonce(0);
    setImportedProfile(null);
    setImportError(null);
  }, []);

  const onBindSyncHandled = useCallback((request: number) => {
    setBindSyncRequest((current) => (current === request ? null : current));
  }, []);

  return {
    library,
    packPrompt,
    packPromptDeferred,
    deferPackPrompt: () => setPackPromptDeferred(true),
    bindSyncRequest,
    refreshKey: `${library?.activeProfileId ?? ""}:${absorbNonce}`,
    onBindSyncHandled,
    saveCurrent,
    importProfile,
    importing,
    importStage,
    importReview,
    confirmImport,
    cancelImport,
    importError,
    importedProfile,
    dismissImport: () => {
      setImportedProfile(null);
      setImportReview(null);
      setImportStage(null);
      setImportError(null);
    },
    exportProfile,
    switchProfile,
    answerPackPrompt,
    setLibrary,
    reset,
  };
}
