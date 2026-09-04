import { useCallback, useEffect, useState } from "react";
import type { Api } from "../lib/api";
import type { FirstRunKind, ProfileLibrary, StartFrom, Tf2Install } from "../lib/bridge";
import {
  type ComfigPresetId,
  canApplyWizard,
  defaultStartFrom,
  type OfficialAddonId,
  toggleAddon,
} from "../lib/first-run-ui";
import { wizardSpec } from "../SetupWizard";
import type { SwitchProgressController } from "./useSwitchProgress";

export type FirstRunState = {
  kind: FirstRunKind | null;
  reasons: string[];
  preset: ComfigPresetId;
  addons: OfficialAddonId[];
  /** The Create-new wizard is open over an existing library. */
  creating: boolean;
  /** Where the new profile's `config.cfg` comes from. */
  startFrom: StartFrom;
  setPreset: (preset: ComfigPresetId) => void;
  toggleAddon: (id: OfficialAddonId) => void;
  setStartFrom: (next: StartFrom) => void;
  openCreate: () => void;
  cancelCreate: () => void;
  applyWizard: (name: string) => Promise<boolean>;
  clear: () => void;
  reset: () => void;
};

/** First-run classification plus the setup / create-new wizard. */
export function useFirstRun(
  api: Api,
  {
    confirmed,
    library,
    busy,
    running,
    progress,
    setError,
    setBusy,
    setLibrary,
    seedCreating = false,
  }: {
    confirmed: Tf2Install | null;
    library: ProfileLibrary | null;
    busy: boolean;
    running: boolean;
    progress: SwitchProgressController;
    setError: (message: string | null) => void;
    setBusy: (busy: boolean) => void;
    setLibrary: (library: ProfileLibrary) => void;
    /** `?preview=create` opens straight into the Create-new wizard. */
    seedCreating?: boolean;
  },
): FirstRunState {
  const [kind, setKind] = useState<FirstRunKind | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [preset, setPreset] = useState<ComfigPresetId>("medium");
  const [addons, setAddons] = useState<OfficialAddonId[]>([]);
  const [creating, setCreating] = useState(seedCreating);
  // `null` = the user has not picked, so the default tracks the library: the
  // library often arrives after this hook first runs (and `?preview=create`
  // seeds the wizard open before it loads at all).
  const [chosenStartFrom, setChosenStartFrom] = useState<StartFrom | null>(null);
  const startFrom = chosenStartFrom ?? defaultStartFrom(library);

  useEffect(() => {
    if (!confirmed || !library) {
      return;
    }
    if (library.rootMismatch || !library.usable || library.profiles.length > 0) {
      setKind(null);
      setReasons([]);
      return;
    }
    let cancelled = false;
    api
      .classifyFirstRun()
      .then((result) => {
        if (!cancelled) {
          setKind(result.kind);
          setReasons(result.reasons);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not check this install.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, confirmed, library, setError]);

  const clear = useCallback(() => {
    setKind(null);
    setReasons([]);
  }, []);

  const openCreate = useCallback(() => {
    setCreating(true);
    setError(null);
    setPreset("medium");
    setAddons([]);
    setChosenStartFrom(null);
    progress.cancel();
  }, [progress, setError]);

  const cancelCreate = useCallback(() => {
    setCreating(false);
    setError(null);
    progress.cancel();
  }, [progress, setError]);

  const applyWizard = useCallback(
    async (name: string) => {
      if (!canApplyWizard(name, running, busy) || progress.state.active) {
        return false;
      }
      setError(null);
      progress.start();
      setBusy(true);
      try {
        const spec = wizardSpec(name, preset, addons);
        // With no active profile there is nothing to copy, so the wizard shows
        // no tiles and this stays "fresh".
        setLibrary(
          creating
            ? await api.createFreshProfile(spec, startFrom)
            : await api.applyUnusedWizard(spec),
        );
        progress.complete();
        setCreating(false);
        clear();
        return true;
      } catch (err) {
        let message = err instanceof Error ? err.message : "Could not apply that setup.";
        // Materialization commits the new profile before the live switch. If
        // the game starts or the switch is interrupted after that boundary,
        // deleting the profile would discard the only safe retry target (and
        // is itself forbidden while TF2 runs). Refresh the library so it is
        // visible and can be applied once the blocker is gone.
        try {
          const recovered = await api.getProfileLibrary();
          if (recovered.profiles.length > (library?.profiles.length ?? 0)) {
            setLibrary(recovered);
            setCreating(false);
            clear();
            message = `${message} The new profile was saved; apply it again when ready.`;
          }
        } catch {
          /* Preserve the original, more useful switch error. */
        }
        setError(message);
        progress.cancel();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [
      api,
      addons,
      busy,
      clear,
      creating,
      library,
      preset,
      progress,
      running,
      setBusy,
      setError,
      setLibrary,
      startFrom,
    ],
  );

  const reset = useCallback(() => {
    setKind(null);
    setReasons([]);
    setCreating(false);
    setPreset("medium");
    setAddons([]);
    setChosenStartFrom(null);
  }, []);

  return {
    kind,
    reasons,
    preset,
    addons,
    creating,
    startFrom,
    setPreset,
    toggleAddon: (id) => setAddons((current) => toggleAddon(current, id)),
    setStartFrom: setChosenStartFrom,
    openCreate,
    cancelCreate,
    applyWizard,
    clear,
    reset,
  };
}
