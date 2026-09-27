import { useCallback, useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api";
import type {
  AbsorbDelta,
  CustomFolderRepair,
  PackChoice,
  ProfileImportReview,
  ProfileLibrary,
  ProfileSummary,
  RetiredCasualReview,
  Tf2Install,
} from "../lib/bridge";
import { parseInvokeError } from "../lib/bridge";
import {
  canExportProfile,
  canImportProfile,
  canSaveCurrent,
  hasPackChanges,
  newlyImportedProfile,
  profileNameProblem,
} from "../lib/library-ui";
import type { SetOperationError } from "./useOperationErrors";
import type { SwitchProgressController } from "./useSwitchProgress";

function hudReviewProfile(error: unknown, requested: string | null, active: string | null) {
  const { code } = parseInvokeError(error);
  if (code === "HudLiveReviewRequired") return active;
  return code === "HudReviewRequired" ? requested : null;
}

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
  /** Resolves true once the new name is saved; failures report and keep the old name. */
  renameProfile: (id: string, name: string) => Promise<boolean>;
  /** Resolves true once the inactive copy exists. */
  duplicateProfile: (id: string, name: string) => Promise<boolean>;
  importProfile: () => Promise<void>;
  importing: boolean;
  importStage: "selecting" | "reading" | "review" | "saving" | "done" | null;
  importReview: ProfileImportReview | null;
  selectImportHud: (hud: string) => void;
  confirmImport: () => Promise<void>;
  cancelImport: () => Promise<void>;
  importError: string | null;
  importedProfile: ProfileSummary | null;
  dismissImport: () => void;
  exportProfile: (id: string, expectedReviewRevision: string) => Promise<void>;
  switchProfile: (id: string) => Promise<void>;
  retiredCasualReview: (RetiredCasualReview & { name: string; error?: string }) | null;
  retiredCasualInFlight: boolean;
  confirmRetiredCasualReview: () => Promise<void>;
  cancelRetiredCasualReview: () => void;
  switchHandoff: { kind: "kept" | "retained"; message: string; ownerId: string | null } | null;
  captureKeptPacks: () => Promise<void>;
  dismissSwitchHandoff: () => void;
  deleteTarget: ProfileSummary | null;
  deleting: boolean;
  deleteError: string | null;
  reviewDelete: (id: string) => void;
  confirmDelete: (keepInstalled: boolean, switchToId?: string) => Promise<void>;
  cancelDelete: () => void;
  folderRepair: { id: string; name: string; plan: CustomFolderRepair[]; error?: string } | null;
  reviewFolderRepair: (id: string) => Promise<void>;
  repairFolders: () => Promise<void>;
  cancelFolderRepair: () => void;
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
    onHudReviewRequired,
  }: {
    confirmed: Tf2Install | null;
    running: boolean;
    busy: boolean;
    quitNonce: number;
    progress: SwitchProgressController;
    setError: SetOperationError;
    setBusy: (busy: boolean) => void;
    onHudReviewRequired?: (profileId: string) => void;
  },
): ProfileLibraryState {
  const [library, setLibrary] = useState<ProfileLibrary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProfileSummary | null>(null);
  const [switchHandoff, setSwitchHandoff] = useState<ProfileLibraryState["switchHandoff"]>(null);
  const [retiredCasualReview, setRetiredCasualReview] =
    useState<ProfileLibraryState["retiredCasualReview"]>(null);
  const [retiredCasualInFlight, setRetiredCasualInFlight] = useState(false);
  const retiredCasualInFlightRef = useRef(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deleteInFlight = useRef(false);
  const [folderRepair, setFolderRepair] = useState<ProfileLibraryState["folderRepair"]>(null);
  const [packPrompt, setPackPrompt] = useState<AbsorbDelta | null>(null);
  const [packPromptProfile, setPackPromptProfile] = useState<string | null>(null);
  const [bindSyncRequest, setBindSyncRequest] = useState<number | null>(null);
  const [packPromptDeferred, setPackPromptDeferred] = useState(false);
  const [absorbNonce, setAbsorbNonce] = useState(0);
  const [importStage, setImportStage] = useState<ProfileLibraryState["importStage"]>(null);
  const [importReview, setImportReview] = useState<ProfileImportReview | null>(null);
  const importInFlight = useRef(false);
  const importing = importStage !== null && importStage !== "done";
  const [importError, setImportError] = useState<string | null>(null);
  const [importedProfile, setImportedProfile] = useState<ProfileSummary | null>(null);
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
          setError(null, "profiles:read");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not read the profile library.",
            "profiles:read",
          );
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
          setError(null, "profiles:init");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Could not create the profile library.",
            "profiles:init",
          );
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
        setError(null, "profiles:absorb");
      })
      .catch((err) => {
        if (control.live && generation === control.generation && gate === control.gate) {
          const reviewId = hudReviewProfile(err, activeProfileId, activeProfileId);
          if (reviewId && onHudReviewRequired) {
            setError(null, "profiles:absorb");
            onHudReviewRequired(reviewId);
            return;
          }
          setError(
            err instanceof Error ? err.message : "Could not absorb live changes.",
            "profiles:absorb",
          );
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
    onHudReviewRequired,
    absorbRetry,
  ]);

  const renameProfile = useCallback(
    async (id: string, name: string) => {
      if (running || profileNameProblem(name) !== null) return false;
      setBusy(true);
      try {
        setLibrary(await api.renameProfile(id, name));
        setError(null, "profiles:rename");
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not rename that profile.",
          "profiles:rename",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [api, running, setBusy, setError],
  );

  const duplicateProfile = useCallback(
    async (id: string, name: string) => {
      if (running || profileNameProblem(name) !== null) return false;
      setBusy(true);
      try {
        setLibrary(await api.duplicateProfile(id, name));
        setError(null, "profiles:duplicate");
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not duplicate that profile.",
          "profiles:duplicate",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [api, running, setBusy, setError],
  );

  const saveCurrent = useCallback(
    async (name: string) => {
      if (!library || !canSaveCurrent(library, running, name)) {
        return false;
      }
      setBusy(true);
      try {
        setLibrary(await api.saveCurrentAs(name));
        setSwitchHandoff(null);
        setRetiredCasualReview(null);
        setError(null, "profiles:save-current");
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not save that profile.",
          "profiles:save-current",
        );
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
    setImportedProfile(null);
    setImportReview(null);
    setImportError(null);
    setImportStage("selecting");
    setBusy(true);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await api.onProfileImportReading(() => setImportStage("reading"));
      const review = await api.importProfile();
      // Multiple HUDs always need a fresh, visible choice, including native
      // exports whose previous selection is present as a review hint.
      setImportReview(
        review && (review.huds?.length ?? 0) > 1 ? { ...review, selectedHud: null } : review,
      );
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
  }, [api, library, running, busy, setBusy]);

  const selectImportHud = useCallback(
    (hud: string) => {
      if (importStage !== "review" || importInFlight.current) return;
      setImportReview((review) =>
        review?.huds?.includes(hud) ? { ...review, selectedHud: hud } : review,
      );
    },
    [importStage],
  );

  const confirmImport = useCallback(async () => {
    if (!importReview || !library || running || importInFlight.current) return;
    if (
      (importReview.huds?.length ?? 0) > 1 &&
      !importReview.huds?.includes(importReview.selectedHud ?? "")
    )
      return;
    importInFlight.current = true;
    setImportStage("saving");
    try {
      const next = await api.confirmProfileImport(
        importReview.token,
        importReview.selectedHud ?? undefined,
      );
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
    async (id: string, expectedReviewRevision: string) => {
      if (!library || !canExportProfile(library, running)) {
        return;
      }
      setBusy(true);
      try {
        const exported = await api.exportProfile(id, expectedReviewRevision);
        if (exported !== null) setError(null, `profiles:export:${id}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not export that profile.",
          `profiles:export:${id}`,
        );
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
      // The native switch reconciles the outgoing profile. A fresh absorb of
      // the target will report its own delta when the switch settles.
      progress.start();
      setBusy(true);
      let reviewId: string | null = null;
      try {
        setLibrary(await api.switchProfile(id));
        setSwitchHandoff(null);
        setImportedProfile(null);
        setImportStage(null);
        setImportReview(null);
        setError(null, "profiles:switch");
        progress.complete();
        setPackPrompt(null);
        setPackPromptDeferred(false);
      } catch (err) {
        reviewId = hudReviewProfile(err, id, library.activeProfileId);
        const { code, message } = parseInvokeError(err);
        if (code === "KeptPackHandoff" || code === "PendingLiveHandoff") {
          setSwitchHandoff({
            kind: code === "KeptPackHandoff" ? "kept" : "retained",
            message,
            ownerId: library.activeProfileId,
          });
          setError(null, "profiles:switch");
        } else if (code === "LegacyCasualSourceMissing") {
          try {
            const review = await api.reviewRetiredCasualProfile(id);
            setRetiredCasualReview({
              ...review,
              name: library.profiles.find((profile) => profile.id === id)?.name ?? "this profile",
            });
            setError(null, "profiles:switch");
          } catch (reviewError) {
            setError(
              reviewError instanceof Error
                ? reviewError.message
                : "Could not review saved Casual choices.",
              "profiles:switch",
            );
          }
        } else if (reviewId && onHudReviewRequired) setError(null, "profiles:switch");
        else
          setError(
            err instanceof Error ? err.message : "Could not switch profiles.",
            "profiles:switch",
          );
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
      if (reviewId) onHudReviewRequired?.(reviewId);
    },
    [api, library, running, busy, progress, setError, setBusy, onHudReviewRequired],
  );

  const confirmRetiredCasualReview = useCallback(async () => {
    if (
      !retiredCasualReview ||
      retiredCasualInFlightRef.current ||
      running ||
      busy ||
      progress.state.active
    ) {
      return;
    }
    const { profileId, revision } = retiredCasualReview;
    retiredCasualInFlightRef.current = true;
    setRetiredCasualInFlight(true);
    setBusy(true);
    let cleared = false;
    try {
      setLibrary(await api.clearRetiredCasualProfile(profileId, revision));
      setRetiredCasualReview(null);
      setError(null, "profiles:switch");
      cleared = true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update the saved profile.";
      setRetiredCasualReview((current) =>
        current?.profileId === profileId ? { ...current, error: message } : current,
      );
    } finally {
      setBusy(false);
    }
    try {
      if (cleared) await switchProfile(profileId);
    } finally {
      retiredCasualInFlightRef.current = false;
      setRetiredCasualInFlight(false);
    }
  }, [api, retiredCasualReview, running, busy, progress, setBusy, setError, switchProfile]);

  const cancelRetiredCasualReview = useCallback(() => {
    if (!retiredCasualInFlightRef.current) setRetiredCasualReview(null);
  }, []);

  const captureKeptPacks = useCallback(async () => {
    if (switchHandoff?.kind !== "kept" || running || busy) return;
    if (library?.activeProfileId !== switchHandoff.ownerId) {
      setSwitchHandoff(null);
      setError(
        "The active profile changed. Choose the profile to switch to again.",
        "profiles:switch",
      );
      return;
    }
    setBusy(true);
    try {
      setLibrary(await api.absorbPacks("captureKept"));
      setSwitchHandoff(null);
      setAbsorbNonce((value) => value + 1);
      setError(null, "profiles:switch");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not capture kept packs.",
        "profiles:switch",
      );
    } finally {
      setBusy(false);
    }
  }, [api, switchHandoff, library, running, busy, setBusy, setError]);

  const reviewDelete = useCallback(
    (id: string) => {
      if (running || busy || progress.state.active || library?.pendingSwitchProfileId) return;
      const target = library?.profiles.find((profile) => profile.id === id);
      if (!target || !library?.usable || library.rootMismatch) return;
      setDeleteError(null);
      setDeleteTarget(target);
    },
    [library, running, busy, progress.state.active],
  );

  const confirmDelete = useCallback(
    async (keepInstalled: boolean, switchToId?: string) => {
      if (
        !deleteTarget ||
        !library ||
        running ||
        busy ||
        deleteInFlight.current ||
        progress.state.active ||
        library.pendingSwitchProfileId
      )
        return;
      const target = library.profiles.find((profile) => profile.id === deleteTarget.id);
      if (!target) {
        setDeleteError("This profile is no longer in the library.");
        return;
      }
      const active = library.activeProfileId === target.id;
      const replacement = library.profiles.find((profile) => profile.id === switchToId);
      if (active && !keepInstalled && (!replacement || replacement.id === target.id)) {
        setDeleteError("Choose another profile, or keep the installed TF2 files.");
        return;
      }
      if (active && !keepInstalled && replacement?.unsafeCustomFolders?.length) {
        setDeleteError("Repair that profile’s folder names before switching to it.");
        return;
      }
      deleteInFlight.current = true;
      setDeleting(true);
      setDeleteError(null);
      setBusy(true);
      let switching = false;
      let reviewId: string | null = null;
      try {
        if (active && !keepInstalled && replacement) {
          switching = true;
          progress.start();
          const switched = await api.switchProfile(replacement.id);
          setLibrary(switched);
          if (switched.activeProfileId !== replacement.id || switched.pendingSwitchProfileId) {
            throw new Error("The profile switch did not finish. Your saved profile was kept.");
          }
          progress.complete();
          switching = false;
        }
        const next = await api.deleteProfile(target.id, active && keepInstalled);
        setLibrary(next);
        setSwitchHandoff(null);
        setDeleteTarget(null);
        setPackPrompt(null);
        setPackPromptDeferred(false);
        setImportedProfile((current) => (current?.id === target.id ? null : current));
        setError(null, `profiles:delete:${target.id}`);
      } catch (error) {
        if (switching) progress.cancel();
        reviewId = switching
          ? hudReviewProfile(error, replacement?.id ?? null, library.activeProfileId)
          : null;
        if (reviewId && onHudReviewRequired) {
          setDeleteTarget(null);
          setDeleteError(null);
        } else
          setDeleteError(error instanceof Error ? error.message : "Could not delete that profile.");
        // An interruption can happen after the index commit. Native reads
        // recover payload cleanup, and refresh must not imply it is active.
        try {
          const next = await api.getProfileLibrary();
          setLibrary(next);
          if (!next.profiles.some((profile) => profile.id === target.id)) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        } catch {
          // Keep the original failure and its recovery context visible.
        }
      } finally {
        deleteInFlight.current = false;
        setDeleting(false);
        setBusy(false);
      }
      if (reviewId) onHudReviewRequired?.(reviewId);
    },
    [api, deleteTarget, library, running, busy, progress, setBusy, setError, onHudReviewRequired],
  );

  const cancelDelete = useCallback(() => {
    if (deleteInFlight.current) return;
    setDeleteTarget(null);
    setDeleteError(null);
  }, []);

  const answerPackPrompt = useCallback(
    async (choice: PackChoice) => {
      if (!packPrompt || packPromptProfile !== activeProfileId || running || busy) return;
      setBusy(true);
      let reviewId: string | null = null;
      try {
        setLibrary(await api.absorbPacks(choice));
        setError(null, "profiles:packs");
        setPackPrompt(null);
        setPackPromptDeferred(false);
        setAbsorbNonce((value) => value + 1);
      } catch (err) {
        reviewId = hudReviewProfile(err, activeProfileId, activeProfileId);
        if (reviewId && onHudReviewRequired) {
          setPackPromptDeferred(true);
          setError(null, "profiles:packs");
        } else
          setError(
            err instanceof Error ? err.message : "Could not update packs.",
            "profiles:packs",
          );
      } finally {
        setBusy(false);
      }
      if (reviewId) onHudReviewRequired?.(reviewId);
    },
    [
      api,
      packPrompt,
      packPromptProfile,
      activeProfileId,
      running,
      busy,
      setError,
      setBusy,
      onHudReviewRequired,
    ],
  );

  const reviewFolderRepair = useCallback(
    async (id: string) => {
      if (running || busy) return;
      const profile = library?.profiles.find((profile) => profile.id === id);
      if (!profile) return;
      setBusy(true);
      try {
        const plan = await api.planCustomFolderRepair(id);
        if (plan.length) setFolderRepair({ id, name: profile.name, plan });
        else setLibrary(await api.getProfileLibrary());
        setError(null, `profiles:folder-review:${id}`);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not review folder names.",
          `profiles:folder-review:${id}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [api, library, running, busy, setBusy, setError],
  );

  const repairFolders = useCallback(async () => {
    if (!folderRepair || running || busy) return;
    setBusy(true);
    try {
      setLibrary(await api.repairCustomFolders(folderRepair.id, folderRepair.plan));
      setFolderRepair(null);
      setPackPrompt(null);
      setAbsorbNonce((value) => value + 1);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Could not repair folder names.";
      setFolderRepair((current) =>
        current?.id === folderRepair.id ? { ...current, error } : current,
      );
    } finally {
      setBusy(false);
    }
  }, [api, folderRepair, running, busy, setBusy]);

  const reset = useCallback(() => {
    setLibrary(null);
    setSwitchHandoff(null);
    setRetiredCasualReview(null);
    setDeleteTarget(null);
    setDeleteError(null);
    setFolderRepair(null);
    setPackPrompt(null);
    setPackPromptProfile(null);
    setPackPromptDeferred(false);
    setBindSyncRequest(null);
    setAbsorbNonce(0);
    setImportedProfile(null);
    setImportError(null);
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
    renameProfile,
    duplicateProfile,
    importProfile,
    importing,
    importStage,
    importReview,
    selectImportHud,
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
    retiredCasualReview,
    retiredCasualInFlight,
    confirmRetiredCasualReview,
    cancelRetiredCasualReview,
    switchHandoff,
    captureKeptPacks,
    dismissSwitchHandoff: () => setSwitchHandoff(null),
    deleteTarget,
    deleting,
    deleteError,
    reviewDelete,
    confirmDelete,
    cancelDelete,
    folderRepair,
    reviewFolderRepair,
    repairFolders,
    cancelFolderRepair: () => setFolderRepair(null),
    answerPackPrompt,
    setLibrary,
    reset,
  };
}
