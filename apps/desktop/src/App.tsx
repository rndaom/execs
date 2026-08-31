import {
  CaretDown,
  Check,
  Copy,
  DownloadSimple,
  FolderOpen,
  Plus,
  UploadSimple,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import { FirstRunExisting } from "./FirstRunExisting";
import {
  type AbsorbDelta,
  absorbOwned,
  absorbPacks,
  applyUnusedWizard,
  browseTf2Root,
  checkAppUpdate,
  classifyFirstRun,
  confirmTf2Root,
  createFreshProfile,
  exportProfile,
  type FirstRunKind,
  getAppVersion,
  getInheritBinds,
  getProfileLibrary,
  getTf2Root,
  getTf2WriteLock,
  importProfile,
  initProfileLibrary,
  installAppUpdate,
  isTauri,
  onSwitchProgress,
  onTf2Running,
  type ProfileLibrary,
  type SwitchStep,
  saveCurrentAs,
  scanTf2Installs,
  setInheritBinds,
  switchProfile,
  type Tf2Install,
} from "./lib/bridge";
import { COPY_FEEDBACK_MS, type CopyFeedback, copyToClipboard } from "./lib/copy-ui";
import { confirmEnabled, formatInstallLabel } from "./lib/finder-ui";
import {
  type ComfigPresetId,
  canApplyWizard,
  firstRunSurface,
  type OfficialAddonId,
  showCreateNewChrome,
  toggleAddon,
} from "./lib/first-run-ui";
import {
  canCreateNew,
  canExportProfile,
  canImportProfile,
  canSaveCurrent,
  hasPackChanges,
  libraryStatusCopy,
  previewPackDelta,
  previewSavedLibrary,
  previewSavedProfile,
  previewSwitchStep,
  SWITCH_STEPS,
  switchStepIndex,
} from "./lib/library-ui";
import {
  type PreviewState,
  previewConfirmed,
  previewCreating,
  previewFirstRunKind,
  previewFirstRunReasons,
  previewInstalls,
  previewLibrary,
  previewLocked,
  previewSettingsTab,
  previewStateFromSearch,
  previewUpdate,
  previewUpdateProgress,
} from "./lib/preview";
import { type SettingsTab, showSettingsChrome } from "./lib/settings-ui";
import {
  idleSwitchProgress,
  SWITCH_DONE_HOLD_MS,
  SWITCH_STEP_MIN_MS,
  switchProgressNeedsAdvance,
  switchProgressPresenterReducer,
} from "./lib/switch-progress-ui";
import {
  type AppUpdateInfo,
  type AppUpdateProgress,
  appVersionCopy,
  CHECK_LABEL,
  canInstallUpdate,
  INSTALL_LABEL,
  LATER_LABEL,
  PREVIEW_APP_VERSION,
  showUpdateBanner,
  updateBannerCopy,
  updateCheckCopy,
  updateProgressCopy,
} from "./lib/updater-ui";
import { SettingsHost } from "./SettingsHost";
import { SettingsLayout } from "./SettingsLayout";
import { SetupWizard, wizardSpec } from "./SetupWizard";

type Screen = "finder" | "ready";

function initialPreview(): PreviewState {
  if (typeof window === "undefined") {
    return "empty";
  }
  return previewStateFromSearch(window.location.search) ?? "empty";
}

export function App() {
  const tauri = isTauri();
  const [preview] = useState<PreviewState>(initialPreview);
  const [screen, setScreen] = useState<Screen>(() =>
    !tauri && previewConfirmed(preview) ? "ready" : "finder",
  );
  const [scanning, setScanning] = useState(tauri);
  const [installs, setInstalls] = useState<Tf2Install[]>(() =>
    tauri ? [] : previewInstalls(preview),
  );
  const [selected, setSelected] = useState<string | null>(() => {
    if (tauri) {
      return null;
    }
    const list = previewInstalls(preview);
    return list.length === 1 ? list[0].path : null;
  });
  const [confirmed, setConfirmed] = useState<Tf2Install | null>(() =>
    tauri ? null : previewConfirmed(preview),
  );
  const [library, setLibrary] = useState<ProfileLibrary | null>(() =>
    tauri ? null : previewLibrary(preview),
  );
  const [draftName, setDraftName] = useState("");
  const [running, setRunning] = useState(() => !tauri && previewLocked(preview));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [packPrompt, setPackPrompt] = useState<AbsorbDelta | null>(() =>
    !tauri && preview === "absorb" ? previewPackDelta() : null,
  );
  const [absorbNonce, setAbsorbNonce] = useState(0);
  const [bindSyncRequest, setBindSyncRequest] = useState<number | null>(null);
  const [switchProgress, dispatchSwitchProgress] = useReducer(
    switchProgressPresenterReducer,
    undefined,
    () => {
      const state = idleSwitchProgress();
      if (!tauri && preview === "switch") {
        return switchProgressPresenterReducer(
          switchProgressPresenterReducer(state, { type: "start" }),
          { type: "report", step: previewSwitchStep() },
        );
      }
      return state;
    },
  );
  const switchStep = switchProgress.visibleStep;
  const [firstRunKind, setFirstRunKind] = useState<FirstRunKind | null>(() =>
    tauri ? null : previewFirstRunKind(preview),
  );
  const [firstRunReasons, setFirstRunReasons] = useState<string[]>(() =>
    tauri ? [] : previewFirstRunReasons(preview),
  );
  const [preset, setPreset] = useState<ComfigPresetId>("medium");
  const [addons, setAddons] = useState<OfficialAddonId[]>([]);
  const [creating, setCreating] = useState(() => !tauri && previewCreating(preview));
  const [inheritBinds, setInheritBindsState] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(
    () => previewSettingsTab(preview) ?? "comfig",
  );
  const [appVersion, setAppVersion] = useState(() => (tauri ? "" : PREVIEW_APP_VERSION));
  const [availableUpdate, setAvailableUpdate] = useState<AppUpdateInfo | null>(() =>
    tauri ? null : previewUpdate(preview),
  );
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<AppUpdateProgress | null>(() =>
    tauri ? null : previewUpdateProgress(preview),
  );
  const [updateCheckMessage, setUpdateCheckMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!switchProgress.visible || switchProgress.active || switchProgress.visibleStep !== "done") {
      return;
    }
    const timer = window.setTimeout(() => {
      dispatchSwitchProgress({ type: "dismiss" });
    }, SWITCH_DONE_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [switchProgress.active, switchProgress.visible, switchProgress.visibleStep]);

  // Paced reveal: each real backend stage stays on screen for a minimum beat.
  // Keyed on the revealed step + whether a reveal is pending — NOT the whole
  // state object — so queue appends from new backend reports never reset the
  // running beat.
  const advancePending = switchProgressNeedsAdvance(switchProgress);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately keyed so queue appends don't reset the beat.
  useEffect(() => {
    if (!advancePending) {
      return;
    }
    const timer = window.setTimeout(() => {
      dispatchSwitchProgress({ type: "advance" });
    }, SWITCH_STEP_MIN_MS);
    return () => window.clearTimeout(timer);
  }, [advancePending, switchProgress.visibleStep]);

  useEffect(() => {
    if (!tauri) {
      return;
    }

    let cancelled = false;

    async function boot() {
      try {
        const [stored, lock, inherit] = await Promise.all([
          getTf2Root(),
          getTf2WriteLock(),
          getInheritBinds(),
        ]);
        if (cancelled) {
          return;
        }
        setRunning(lock.running);
        setInheritBindsState(inherit);
        if (stored) {
          setConfirmed(stored);
          setSelected(stored.path);
          setScreen("ready");
          const current = await getProfileLibrary();
          if (!cancelled) {
            setLibrary(current);
            if (!lock.running) {
              setAbsorbNonce((value) => value + 1);
            }
          }
        }
        const found = await scanTf2Installs();
        if (cancelled) {
          return;
        }
        setInstalls(found);
        if (!stored && found.length === 1) {
          setSelected(found[0].path);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not scan for TF2.");
        }
      } finally {
        if (!cancelled) {
          setScanning(false);
        }
      }
    }

    boot();
    let lastRunning = false;
    const stops: Array<() => void> = [];
    onTf2Running((next) => {
      if (lastRunning && !next) {
        setAbsorbNonce((value) => value + 1);
      }
      lastRunning = next;
      setRunning(next);
    })
      .then((stop) => {
        if (cancelled) {
          stop();
          return;
        }
        stops.push(stop);
      })
      .catch(() => {});
    onSwitchProgress((progress) => {
      dispatchSwitchProgress({ type: "report", step: progress.step });
    })
      .then((stop) => {
        if (cancelled) {
          stop();
          return;
        }
        stops.push(stop);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      for (const stop of stops) {
        stop();
      }
    };
  }, [tauri]);

  useEffect(() => {
    if (!tauri) {
      return;
    }

    let cancelled = false;

    async function checkLaunchUpdate() {
      try {
        const version = await getAppVersion();
        if (!cancelled) {
          setAppVersion(version);
        }
      } catch {
        /* version stays empty until they check */
      }
      try {
        const update = await checkAppUpdate();
        if (!cancelled) {
          setAvailableUpdate(update);
        }
      } catch {
        /* auto-check stays silent */
      }
    }

    void checkLaunchUpdate();
    return () => {
      cancelled = true;
    };
  }, [tauri]);

  useEffect(() => {
    if (!tauri || !confirmed || running || !library) {
      return;
    }
    if (library.initialized || library.rootMismatch || !library.usable) {
      return;
    }

    let cancelled = false;
    initProfileLibrary()
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
  }, [tauri, confirmed, running, library]);

  useEffect(() => {
    if (!tauri || absorbNonce === 0 || running) {
      return;
    }
    let cancelled = false;
    absorbOwned()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setLibrary(result.library);
        setPackPrompt(hasPackChanges(result.delta) ? result.delta : null);
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
  }, [tauri, absorbNonce, running]);

  useEffect(() => {
    if (!tauri || !confirmed || !library) {
      return;
    }
    if (library.rootMismatch || !library.usable || library.profiles.length > 0) {
      setFirstRunKind(null);
      setFirstRunReasons([]);
      return;
    }

    let cancelled = false;
    classifyFirstRun()
      .then((result) => {
        if (!cancelled) {
          setFirstRunKind(result.kind);
          setFirstRunReasons(result.reasons);
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
  }, [tauri, confirmed, library]);

  async function onBrowse() {
    setError(null);
    if (!tauri) {
      const [demo] = previewInstalls("one");
      setInstalls((current) =>
        current.some((item) => item.path === demo.path) ? current : [...current, demo],
      );
      setSelected(demo.path);
      return;
    }
    setBusy(true);
    try {
      const picked = await browseTf2Root();
      if (!picked) {
        return;
      }
      setInstalls((current) =>
        current.some((item) => item.path === picked.path) ? current : [...current, picked],
      );
      setSelected(picked.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That folder is not a TF2 install.");
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    if (!selected) {
      return;
    }
    setError(null);
    if (!tauri) {
      setConfirmed({ path: selected });
      setLibrary(previewLibrary("library"));
      setFirstRunKind("existing");
      setFirstRunReasons(previewFirstRunReasons("library"));
      setScreen("ready");
      return;
    }
    setBusy(true);
    try {
      const stored = await confirmTf2Root(selected);
      setConfirmed(stored);
      setScreen("ready");
      setLibrary(await getProfileLibrary());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remember that install.");
    } finally {
      setBusy(false);
    }
  }

  async function onCheckUpdate() {
    setUpdateCheckMessage(null);
    if (!tauri) {
      const seeded = previewUpdate(preview);
      if (seeded) {
        setAvailableUpdate(seeded);
        setUpdateDismissed(false);
        return;
      }
      setUpdateCheckMessage(updateCheckCopy("latest"));
      return;
    }
    try {
      const update = await checkAppUpdate();
      if (update) {
        setAvailableUpdate(update);
        setUpdateDismissed(false);
        return;
      }
      setUpdateCheckMessage(updateCheckCopy("latest"));
    } catch {
      setUpdateCheckMessage(updateCheckCopy("error"));
    }
  }

  async function onInstallUpdate() {
    if (!availableUpdate || !canInstallUpdate(updateProgress)) {
      return;
    }
    setUpdateCheckMessage(null);
    setUpdateProgress("downloading");
    if (!tauri) {
      return;
    }
    try {
      await installAppUpdate((step) => setUpdateProgress(step));
    } catch (err) {
      setUpdateProgress(null);
      setError(err instanceof Error ? err.message : "Could not install the update.");
    }
  }

  async function onExport(id: string) {
    if (!library || !canExportProfile(library, running)) {
      return;
    }
    setError(null);
    if (!tauri) {
      return;
    }
    setBusy(true);
    try {
      await exportProfile(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export that profile.");
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    if (!library || !canImportProfile(library, running)) {
      return;
    }
    setError(null);
    if (!tauri) {
      const next = previewSavedProfile(
        `Imported ${library.profiles.length + 1}`,
        library.profiles.length + 1,
      );
      setLibrary({
        ...library,
        initialized: true,
        usable: true,
        profiles: [...library.profiles, next],
      });
      return;
    }
    setBusy(true);
    try {
      setLibrary(await importProfile());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import that profile.");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveCurrent() {
    if (!library || !canSaveCurrent(library, running, draftName)) {
      return;
    }
    setError(null);
    if (!tauri) {
      const next = previewSavedProfile(draftName, library.profiles.length + 1);
      setLibrary({
        ...library,
        initialized: true,
        usable: true,
        activeProfileId: library.activeProfileId ?? next.id,
        profiles: [...library.profiles, next],
      });
      setFirstRunKind(null);
      setFirstRunReasons([]);
      setDraftName("");
      return;
    }
    setBusy(true);
    try {
      setLibrary(await saveCurrentAs(draftName));
      setFirstRunKind(null);
      setFirstRunReasons([]);
      setDraftName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that profile.");
    } finally {
      setBusy(false);
    }
  }

  function onOpenCreate() {
    setCreating(true);
    setError(null);
    setDraftName("");
    setPreset("medium");
    setAddons([]);
    dispatchSwitchProgress({ type: "cancel" });
  }

  function onCancelCreate() {
    setCreating(false);
    setError(null);
    setDraftName("");
    dispatchSwitchProgress({ type: "cancel" });
  }

  async function onToggleInherit(next: boolean) {
    setInheritBindsState(next);
    if (!tauri) {
      return;
    }
    try {
      setInheritBindsState(await setInheritBinds(next));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that setting.");
    }
  }

  async function onApplyWizard() {
    if (!canApplyWizard(draftName, running, busy || settingsBusy) || switchProgress.active) {
      return;
    }
    setError(null);
    dispatchSwitchProgress({ type: "start" });
    if (!tauri) {
      for (const item of SWITCH_STEPS) {
        dispatchSwitchProgress({ type: "report", step: item.id });
      }
      const name = draftName.trim() || "Fresh";
      if (creating && library) {
        const next = previewSavedProfile(name, library.profiles.length + 1);
        setLibrary({
          ...library,
          activeProfileId: next.id,
          profiles: [...library.profiles, next],
        });
        setCreating(false);
      } else {
        const path = confirmed?.path ?? "";
        setLibrary(previewSavedLibrary(path, name));
      }
      setFirstRunKind(null);
      setFirstRunReasons([]);
      setDraftName("");
      dispatchSwitchProgress({ type: "complete" });
      return;
    }
    setBusy(true);
    try {
      const spec = wizardSpec(draftName, preset, addons);
      setLibrary(creating ? await createFreshProfile(spec) : await applyUnusedWizard(spec));
      dispatchSwitchProgress({ type: "complete" });
      setCreating(false);
      setFirstRunKind(null);
      setFirstRunReasons([]);
      setDraftName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply that setup.");
      dispatchSwitchProgress({ type: "cancel" });
    } finally {
      setBusy(false);
    }
  }

  async function onSwitch(id: string) {
    if (
      !library ||
      running ||
      busy ||
      settingsBusy ||
      switchProgress.active ||
      library.activeProfileId === id
    ) {
      return;
    }
    setError(null);
    setPackPrompt(null);
    dispatchSwitchProgress({ type: "start" });
    if (!tauri) {
      for (const item of SWITCH_STEPS) {
        dispatchSwitchProgress({ type: "report", step: item.id });
      }
      setLibrary({ ...library, activeProfileId: id });
      dispatchSwitchProgress({ type: "complete" });
      return;
    }
    setBusy(true);
    try {
      setLibrary(await switchProfile(id));
      dispatchSwitchProgress({ type: "complete" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not switch profiles.");
      dispatchSwitchProgress({ type: "cancel" });
    } finally {
      setBusy(false);
    }
  }

  async function onPackChoice(choice: "update" | "keep") {
    setError(null);
    if (!tauri) {
      setPackPrompt(null);
      return;
    }
    setBusy(true);
    try {
      setLibrary(await absorbPacks(choice));
      setPackPrompt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update packs.");
    } finally {
      setBusy(false);
    }
  }

  function onChange() {
    setError(null);
    setBindSyncRequest(null);
    setScreen("finder");
    if (confirmed && installs.some((item) => item.path === confirmed.path)) {
      setSelected(confirmed.path);
    } else if (installs.length === 1) {
      setSelected(installs[0].path);
    }
  }

  const canConfirm = confirmEnabled(selected, scanning || busy);
  const surface = firstRunSurface(library, firstRunKind);

  function renderReady(path: string) {
    if (surface === "first-existing") {
      return (
        <FirstRunExisting
          path={path}
          draftName={draftName}
          reasons={firstRunReasons}
          running={running}
          busy={busy}
          error={error}
          onDraftName={setDraftName}
          onSave={onSaveCurrent}
          onChange={onChange}
        />
      );
    }
    if (surface === "first-unused") {
      return (
        <>
          <SetupWizard
            title="Unused install"
            draftName={draftName}
            preset={preset}
            addons={addons}
            running={running}
            busy={busy}
            error={error}
            onDraftName={setDraftName}
            onPreset={setPreset}
            onToggleAddon={(id) => setAddons((current) => toggleAddon(current, id))}
            onApply={onApplyWizard}
          />
          <SwitchProgressList
            switchStep={switchStep}
            active={switchProgress.active}
            visible={switchProgress.visible}
          />
          <button
            type="button"
            onClick={onChange}
            disabled={busy || switchProgress.active}
            className="btn btn-ghost mt-6"
          >
            Change
          </button>
        </>
      );
    }
    if (creating && surface === "ready") {
      return (
        <>
          <SetupWizard
            title="New profile"
            draftName={draftName}
            preset={preset}
            addons={addons}
            running={running}
            busy={busy}
            error={error}
            creating
            chrome={
              <InheritBindsToggle
                inheritBinds={inheritBinds}
                disabled={busy}
                onChange={(next) => void onToggleInherit(next)}
              />
            }
            onDraftName={setDraftName}
            onPreset={setPreset}
            onToggleAddon={(id) => setAddons((current) => toggleAddon(current, id))}
            onApply={onApplyWizard}
            onCancel={onCancelCreate}
          />
          <SwitchProgressList
            switchStep={switchStep}
            active={switchProgress.active}
            visible={switchProgress.visible}
          />
        </>
      );
    }
    if (surface === "loading") {
      return (
        <section className="flex w-full flex-col items-center text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">execs</h1>
          <p className="mt-6 text-sm text-ink-muted">Checking this install…</p>
          <button type="button" onClick={onChange} className="btn btn-ghost mt-6">
            Change
          </button>
        </section>
      );
    }
    return (
      <ReadyPanel
        path={path}
        library={library}
        draftName={draftName}
        running={running}
        busy={busy || settingsBusy}
        error={error}
        packPrompt={packPrompt}
        switchStep={switchStep}
        progressActive={switchProgress.active}
        progressVisible={switchProgress.visible}
        inheritBinds={inheritBinds}
        settings={
          showSettingsChrome(library) ? (
            <SettingsLayout tab={settingsTab} running={running} onTab={setSettingsTab}>
              <SettingsHost
                tab={settingsTab}
                running={running}
                externalBusy={busy || switchProgress.active}
                preview={preview}
                refreshKey={`${library?.activeProfileId ?? ""}:${absorbNonce}`}
                bindSyncRequest={bindSyncRequest}
                onBindSyncHandled={(request) => {
                  setBindSyncRequest((current) => (current === request ? null : current));
                }}
                onBusyChange={setSettingsBusy}
                onError={setError}
              />
            </SettingsLayout>
          ) : null
        }
        onDraftName={setDraftName}
        onSave={onSaveCurrent}
        onSwitch={onSwitch}
        onPackChoice={onPackChoice}
        onExport={onExport}
        onImport={onImport}
        onCreateNew={onOpenCreate}
        onToggleInherit={(next) => void onToggleInherit(next)}
        onChange={onChange}
      />
    );
  }

  const settingsOpen =
    screen === "ready" &&
    confirmed !== null &&
    surface === "ready" &&
    !creating &&
    showSettingsChrome(library);
  const wideOnboarding =
    screen === "ready" && confirmed !== null && (surface === "first-unused" || creating);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-ink">
      {running ? (
        <div
          role="status"
          data-testid="tf2-write-lock"
          className="border-b border-team-red bg-team-red/20 px-4 py-2 text-center text-sm text-ink"
        >
          TF2 is running — execs is read-only until the game quits.
        </div>
      ) : null}
      {showUpdateBanner(availableUpdate, updateDismissed) && availableUpdate ? (
        <div
          role="status"
          data-testid="app-update-banner"
          className="flex flex-wrap items-center justify-center gap-3 border-b border-brand bg-brand/20 px-4 py-2 text-sm text-ink"
        >
          <p>{updateBannerCopy(availableUpdate.version)}</p>
          {updateProgress ? (
            <p data-testid="app-update-progress">{updateProgressCopy(updateProgress)}</p>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="app-update-install"
                onClick={() => void onInstallUpdate()}
                className="btn btn-primary px-4 py-1"
              >
                {INSTALL_LABEL}
              </button>
              <button
                type="button"
                data-testid="app-update-later"
                onClick={() => setUpdateDismissed(true)}
                className="btn btn-ghost px-4 py-1"
              >
                {LATER_LABEL}
              </button>
            </div>
          )}
        </div>
      ) : null}

      <main
        className={`flex min-h-0 w-full flex-1 flex-col ${
          settingsOpen
            ? "items-stretch overflow-hidden"
            : `mx-auto items-center justify-start overflow-y-auto px-6 py-10 ${
                wideOnboarding ? "max-w-6xl" : "max-w-xl"
              }`
        }`}
      >
        {screen === "ready" && confirmed ? (
          renderReady(confirmed.path)
        ) : (
          <FinderPanel
            scanning={scanning}
            installs={installs}
            selected={selected}
            error={error}
            canConfirm={canConfirm}
            busy={busy}
            onSelect={setSelected}
            onBrowse={onBrowse}
            onConfirm={onConfirm}
          />
        )}

        <div
          className={
            settingsOpen
              ? "flex min-h-7 shrink-0 items-center justify-between gap-4 border-t border-edge bg-panel px-4 py-1 text-[10px] text-ink-muted"
              : "mt-10 flex max-w-md flex-col items-center gap-2 text-center"
          }
        >
          {appVersion ? (
            <p className={settingsOpen ? "text-[10px] text-ink-muted" : "text-sm text-ink-muted"}>
              <span data-testid="app-version">{appVersionCopy(appVersion)}</span>
              {" · "}
              <button
                type="button"
                data-testid="app-update-check"
                onClick={() => void onCheckUpdate()}
                disabled={updateProgress !== null}
                className="text-ink underline decoration-edge underline-offset-2 hover:text-ink disabled:opacity-40"
              >
                {CHECK_LABEL}
              </button>
            </p>
          ) : null}
          {updateCheckMessage ? (
            <p data-testid="app-update-check-message" className="text-sm text-ink-muted">
              {updateCheckMessage}
            </p>
          ) : null}
          <p
            className={
              settingsOpen ? "truncate text-[10px] text-ink-faint" : "text-sm text-ink-muted"
            }
          >
            {settingsOpen
              ? "Fan project — not affiliated with Valve or Steam."
              : "execs is a fan project and is not affiliated with Valve Corporation or Steam. Team Fortress and Steam are trademarks of Valve Corporation."}
          </p>
        </div>
      </main>
    </div>
  );
}

function FinderPanel({
  scanning,
  installs,
  selected,
  error,
  canConfirm,
  busy,
  onSelect,
  onBrowse,
  onConfirm,
}: {
  scanning: boolean;
  installs: Tf2Install[];
  selected: string | null;
  error: string | null;
  canConfirm: boolean;
  busy: boolean;
  onSelect: (path: string) => void;
  onBrowse: () => void;
  onConfirm: () => void;
}) {
  return (
    <section className="flex w-full flex-col items-center text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Find TF2</h1>
      <p className="mt-3 max-w-md text-sm text-ink-muted">
        Scan Steam libraries and confirm this is Team Fortress 2 before any write. Profiles will be
        tied to this folder.
      </p>

      <div className="mt-8 w-full rounded-xl border border-edge bg-panel p-4 text-left">
        {scanning ? (
          <p className="text-sm text-ink-muted">Scanning Steam libraries…</p>
        ) : installs.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No Team Fortress 2 install found. Use Browse to pick the Team Fortress 2 folder.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {installs.map((install) => {
              const active = install.path === selected;
              return (
                <li key={install.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(install.path)}
                    data-selected={active ? "true" : "false"}
                    className={`w-full rounded-lg border px-4 py-3 text-left transition ${
                      active
                        ? "border-brand bg-panel-raised"
                        : "border-edge bg-bg hover:border-ink-faint"
                    }`}
                  >
                    <div className="text-sm font-medium text-ink">
                      {formatInstallLabel(install.path)}
                    </div>
                    <div className="mt-1 break-all text-xs text-ink-faint">{install.path}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {error ? <p className="mt-4 text-sm text-team-red">{error}</p> : null}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={onBrowse} disabled={busy} className="btn btn-ghost">
          Browse
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className="btn btn-primary"
        >
          Confirm
        </button>
      </div>
    </section>
  );
}

function InheritBindsToggle({
  inheritBinds,
  disabled,
  onChange,
}: {
  inheritBinds: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div data-testid="inherit-binds" className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm text-ink">Inherit binds</p>
        <p className="mt-0.5 text-xs text-ink-muted">Use this profile's binds for new profiles.</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={inheritBinds}
        disabled={disabled}
        onClick={() => onChange(!inheritBinds)}
        className={`relative h-6 w-11 shrink-0 rounded-pill border transition-colors disabled:opacity-40 ${
          inheritBinds ? "border-brand bg-brand" : "border-edge bg-bg"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 size-4 rounded-full transition-all ${
            inheritBinds ? "left-[22px] bg-on-brand" : "left-1 bg-ink-muted"
          }`}
        />
        <span className="sr-only">Inherit binds when creating a new profile</span>
      </button>
    </div>
  );
}

export function SwitchProgressList({
  switchStep,
  active,
  visible,
}: {
  switchStep: SwitchStep | null;
  active: boolean;
  visible: boolean;
}) {
  if (!visible) {
    return null;
  }
  const currentIndex = switchStep ? switchStepIndex(switchStep) : -1;
  const currentLabel = switchStep
    ? (SWITCH_STEPS[currentIndex]?.label ?? "Applying profile")
    : "Preparing profile operation…";
  const complete = !active && switchStep === "done";
  // Step-driven fill: revealed real stages over total — never an invented number.
  const fraction =
    switchStep === "done" ? 1 : switchStep === null ? 0 : (currentIndex + 1) / SWITCH_STEPS.length;
  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={active}
      aria-label="Profile progress"
      className="overlay fixed inset-x-4 bottom-4 z-50 p-4 text-left sm:left-auto sm:right-6 sm:w-[26rem]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">
          {complete ? "Profile applied" : "Applying profile"}
        </p>
        {complete ? <Check size={16} weight="bold" className="text-health" /> : null}
      </div>
      <p data-testid="switch-progress-current" className="mt-0.5 text-[13px] text-ink-muted">
        {complete ? "All profile steps completed." : `Current stage — ${currentLabel}`}
      </p>

      <div
        data-testid="switch-progress-bar"
        data-fraction={fraction.toFixed(3)}
        aria-hidden="true"
        className="mt-3 h-1 overflow-hidden rounded-pill bg-bg"
      >
        <div
          className="h-full rounded-pill bg-brand transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>

      <ol data-testid="switch-progress" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {SWITCH_STEPS.map((item, index) => {
          const done = complete || currentIndex > index;
          const current = active && item.id === switchStep;
          return (
            <li
              key={item.id}
              data-step={item.id}
              data-current={current ? "true" : "false"}
              data-done={done ? "true" : "false"}
              aria-current={current ? "step" : undefined}
              aria-label={`${item.label}: ${done ? "done" : current ? "current" : "pending"}`}
              className={`flex min-w-0 items-center gap-2 text-xs ${
                current ? "text-brand" : done ? "text-ink" : "text-ink-faint"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                  current
                    ? "border-brand bg-brand/15 text-brand"
                    : done
                      ? "border-health/60 bg-health/10 text-health"
                      : "border-edge text-ink-faint"
                }`}
              >
                {done ? <Check size={9} weight="bold" /> : index + 1}
              </span>
              <span className="truncate">{item.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ReadyPanel({
  path,
  library,
  draftName,
  running,
  busy,
  error,
  packPrompt,
  switchStep,
  progressActive,
  progressVisible,
  inheritBinds,
  onDraftName,
  onSave,
  onSwitch,
  onPackChoice,
  onExport,
  onImport,
  onCreateNew,
  onToggleInherit,
  onChange,
  settings,
}: {
  path: string;
  library: ProfileLibrary | null;
  draftName: string;
  running: boolean;
  busy: boolean;
  error: string | null;
  packPrompt: AbsorbDelta | null;
  switchStep: SwitchStep | null;
  progressActive: boolean;
  progressVisible: boolean;
  inheritBinds: boolean;
  settings?: ReactNode;
  onDraftName: (name: string) => void;
  onSave: () => void;
  onSwitch: (id: string) => void;
  onPackChoice: (choice: "update" | "keep") => void;
  onExport: (id: string) => void;
  onImport: () => void;
  onCreateNew: () => void;
  onToggleInherit: (next: boolean) => void;
  onChange: () => void;
}) {
  const controlsBusy = busy || progressActive;
  const canSave = library ? canSaveCurrent(library, running, draftName) && !controlsBusy : false;
  const showExport = library ? canExportProfile(library, running) : false;
  const canImport = library ? canImportProfile(library, running) && !controlsBusy : false;
  const showCreate = library ? canCreateNew(library) : false;
  const showInherit = showCreateNewChrome(library, "ready");
  const activeProfile = library?.profiles.find((profile) => profile.id === library.activeProfileId);
  const packPromptRef = useRef<HTMLDivElement | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>("idle");
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    if (packPrompt && !running) {
      packPromptRef.current?.focus();
    }
  }, [packPrompt, running]);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) {
        window.clearTimeout(copyTimer.current);
      }
    };
  }, []);

  async function onCopyPath() {
    const feedback = await copyToClipboard(path);
    setCopyFeedback(feedback);
    if (copyTimer.current !== null) {
      window.clearTimeout(copyTimer.current);
    }
    copyTimer.current = window.setTimeout(() => {
      setCopyFeedback("idle");
      copyTimer.current = null;
    }, COPY_FEEDBACK_MS);
  }

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header className="relative z-40 flex min-h-14 shrink-0 items-center gap-4 border-b border-edge bg-panel px-4 sm:px-6">
        <div className="mr-1 flex shrink-0 items-center gap-2">
          <span aria-hidden="true" className="size-2 rounded-sm bg-brand" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">execs</span>
        </div>

        <details data-testid="profile-library" className="group relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink hover:bg-panel [&::-webkit-details-marker]:hidden">
            <span className="hidden text-ink-muted sm:inline">Profile</span>
            <strong className="max-w-36 truncate font-medium text-brand">
              {activeProfile?.name ?? "Profiles"}
            </strong>
            <CaretDown
              size={14}
              className="text-ink-muted transition-transform group-open:rotate-180"
            />
            {activeProfile ? (
              <span
                data-testid="profile-active"
                className="hidden rounded-pill border border-brand/60 px-2 py-0.5 text-[11px] text-brand md:inline"
              >
                Active
              </span>
            ) : null}
          </summary>

          <div className="overlay absolute top-[calc(100%+10px)] left-0 z-50 w-[min(430px,calc(100vw-2rem))] p-4 text-left">
            <div className="flex items-start justify-between gap-4 border-b border-edge pb-3">
              <div>
                <p className="text-sm font-semibold text-ink">Profiles</p>
                <p data-testid="profile-library-status" className="mt-1 text-xs text-ink-muted">
                  {library ? libraryStatusCopy(library) : "Loading profiles…"}
                </p>
              </div>
              {showCreate ? (
                <button
                  type="button"
                  data-testid="create-new"
                  onClick={onCreateNew}
                  disabled={controlsBusy}
                  className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-on-brand hover:bg-brand-hover disabled:opacity-40"
                >
                  <Plus size={14} weight="bold" />
                  New profile
                </button>
              ) : null}
            </div>

            {library && library.profiles.length > 0 ? (
              <ul className="mt-2 max-h-52 overflow-y-auto">
                {library.profiles.map((profile) => {
                  const active = library.activeProfileId === profile.id;
                  const canSwitch = !active && !running && !controlsBusy;
                  return (
                    <li
                      key={profile.id}
                      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                        active ? "bg-brand/10" : "hover:bg-panel/70"
                      }`}
                    >
                      <button
                        type="button"
                        data-testid="profile-name"
                        disabled={!canSwitch}
                        onClick={() => onSwitch(profile.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
                      >
                        <span
                          className={`size-2 shrink-0 rounded-full ${active ? "bg-brand" : "bg-edge"}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-ink">{profile.name}</span>
                        <span className="text-[11px] text-ink-muted">
                          {active ? "Current" : "Switch"}
                        </span>
                      </button>
                      {showExport ? (
                        <button
                          type="button"
                          data-testid="profile-export"
                          title={`Export ${profile.name}`}
                          aria-label={`Export ${profile.name}`}
                          onClick={() => onExport(profile.id)}
                          disabled={controlsBusy}
                          className="rounded-md p-1.5 text-ink-muted hover:bg-panel-raised hover:text-ink disabled:opacity-40"
                        >
                          <DownloadSimple size={16} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {library && !library.rootMismatch && !running ? (
              <form
                className="mt-3 flex gap-2 border-t border-edge pt-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  onSave();
                }}
              >
                <label className="sr-only" htmlFor="profile-name">
                  Profile name
                </label>
                <input
                  id="profile-name"
                  value={draftName}
                  onChange={(event) => onDraftName(event.target.value)}
                  placeholder="Save current as…"
                  disabled={controlsBusy}
                  className="min-w-0 flex-1 rounded-lg border border-edge bg-bg px-3 py-2 text-xs text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!canSave}
                  className="rounded-lg border border-edge px-3 py-2 text-xs text-ink hover:bg-panel-raised disabled:opacity-40"
                >
                  Save
                </button>
              </form>
            ) : null}

            {showInherit ? (
              <div className="mt-3 border-t border-edge pt-3">
                <InheritBindsToggle
                  inheritBinds={inheritBinds}
                  disabled={controlsBusy}
                  onChange={onToggleInherit}
                />
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2 border-t border-edge pt-3">
              <button
                type="button"
                data-testid="profile-import"
                onClick={onImport}
                disabled={!canImport}
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs text-ink hover:bg-panel-raised disabled:opacity-40"
              >
                <UploadSimple size={15} />
                Import
              </button>
              <button
                type="button"
                onClick={onChange}
                disabled={controlsBusy}
                className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-xs text-ink hover:bg-panel-raised disabled:opacity-40"
              >
                <FolderOpen size={15} />
                Change install
              </button>
            </div>
            {library && running ? (
              <p className="mt-3 text-xs text-ink-muted">
                Read-only while TF2 is running. Export remains available.
              </p>
            ) : null}
          </div>
        </details>

        <div className="mx-1 hidden h-7 w-px bg-edge md:block" />

        <div className="hidden min-w-0 flex-1 items-center gap-3 md:flex">
          <span className="shrink-0 text-xs text-ink-muted">Install path</span>
          <span className="truncate font-mono text-xs text-ink-muted" title={path}>
            {path}
          </span>
          <button
            type="button"
            data-testid="install-path-copy"
            title={copyFeedback === "copied" ? "Copied" : "Copy install path"}
            aria-label={copyFeedback === "copied" ? "Copied install path" : "Copy install path"}
            onClick={() => void onCopyPath()}
            className={`flex shrink-0 items-center gap-1.5 rounded-md p-1.5 transition-colors ${
              copyFeedback === "copied"
                ? "text-health"
                : "text-ink-muted hover:bg-panel-raised hover:text-ink"
            }`}
          >
            {copyFeedback === "copied" ? <Check size={15} weight="bold" /> : <Copy size={15} />}
            <span
              aria-live="polite"
              className={copyFeedback === "idle" ? "sr-only" : "text-[11px]"}
            >
              {copyFeedback === "copied"
                ? "Copied"
                : copyFeedback === "failed"
                  ? "Copy failed"
                  : ""}
            </span>
          </button>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-ink-muted">
          <span
            className={`size-2 rounded-full ${running ? "bg-team-red" : "bg-ink-faint"}`}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">{running ? "Game running" : "Game closed"}</span>
        </div>
      </header>

      {error ? (
        <div
          role="alert"
          className="shrink-0 border-b border-team-red/50 bg-team-red/10 px-5 py-2 text-sm text-ink"
        >
          {error}
        </div>
      ) : null}

      {packPrompt && !running ? (
        <div
          ref={packPromptRef}
          data-testid="absorb-pack-prompt"
          role="alertdialog"
          aria-labelledby="absorb-pack-prompt-title"
          aria-describedby="absorb-pack-prompt-description"
          tabIndex={-1}
          className="fixed top-20 right-5 z-50 w-[min(390px,calc(100vw-2.5rem))] rounded-xl border border-edge bg-panel-raised p-4 shadow-2xl shadow-black/50"
        >
          <p id="absorb-pack-prompt-title" className="text-sm font-semibold text-ink">
            Custom files changed
          </p>
          <p id="absorb-pack-prompt-description" className="mt-1 text-sm text-ink-muted">
            TF2 changed packs in custom. Update the active profile?
          </p>
          {packPrompt.packsAdded.length > 0 ? (
            <p className="mt-2 text-xs text-ink-muted">Added: {packPrompt.packsAdded.join(", ")}</p>
          ) : null}
          {packPrompt.packsRemoved.length > 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              Removed: {packPrompt.packsRemoved.join(", ")}
            </p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              data-testid="absorb-pack-update"
              disabled={busy}
              onClick={() => onPackChoice("update")}
              className="btn btn-primary"
            >
              Update profile
            </button>
            <button
              type="button"
              data-testid="absorb-pack-keep"
              disabled={busy}
              onClick={() => onPackChoice("keep")}
              className="btn btn-ghost"
            >
              Keep profile
            </button>
          </div>
        </div>
      ) : null}

      {settings ?? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-lg rounded-xl border border-edge bg-panel p-6 text-center">
            <p className="text-lg font-semibold text-ink">Profile library</p>
            <p className="mt-2 text-sm text-ink-muted">
              {library ? libraryStatusCopy(library) : "Loading profiles…"}
            </p>
            <button
              type="button"
              onClick={onChange}
              disabled={controlsBusy}
              className="btn btn-ghost mt-5"
            >
              Change install
            </button>
          </div>
        </div>
      )}

      <SwitchProgressList
        switchStep={switchStep}
        active={progressActive}
        visible={progressVisible}
      />
    </section>
  );
}
