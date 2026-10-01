import { ArrowLeft, BookOpen, GearSix } from "@phosphor-icons/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppSettingsPane } from "./AppSettingsPane";
import { AppFooter } from "./components/AppFooter";
import { BootSplash } from "./components/BootSplash";
import { DotBackdrop } from "./components/DotBackdrop";
import { FinderPanel } from "./components/FinderPanel";
import { HudOwnershipDialog } from "./components/HudOwnershipDialog";
import { ReadyPanel } from "./components/ReadyPanel/ReadyPanel";
import { ReleaseNotes } from "./components/ReleaseNotes";
import { SwitchProgressList } from "./components/SwitchProgressList";
import { UpdateBanner } from "./components/UpdateBanner";
import { ClassIconProvider } from "./components/ui/ClassIcon";
import { Modal } from "./components/ui/Modal";
import { Loading } from "./components/ui/Spinner";
import { ToastProvider } from "./components/ui/Toast";
import { Wordmark } from "./components/ui/Wordmark";
import { WelcomeTour } from "./components/WelcomeTour";
import { WriteLockBanner } from "./components/WriteLockBanner";
import { FirstRunExisting } from "./FirstRunExisting";
import { useAppPreferences } from "./hooks/useAppPreferences";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useFilesExitGuard } from "./hooks/useFilesExitGuard";
import { useFirstRun } from "./hooks/useFirstRun";
import { useLifecycleStatus } from "./hooks/useLifecycleStatus";
import { useOperationErrors } from "./hooks/useOperationErrors";
import { useProfileLibrary } from "./hooks/useProfileLibrary";
import { useReleaseNotes } from "./hooks/useReleaseNotes";
import { useStartupTidy } from "./hooks/useStartupTidy";
import { useSwitchProgress } from "./hooks/useSwitchProgress";
import { useTf2Install } from "./hooks/useTf2Install";
import { useWriteLock } from "./hooks/useWriteLock";
import type { Api } from "./lib/api";
import {
  BOOT_MIN_MS,
  bootRemaining,
  bootStage,
  CONFIRM_HOLD_MS,
  CONFIRM_MAX_MS,
} from "./lib/boot-ui";
import { invokeErrorMessage, isTauri, type LaunchSyncStatus, openExternal } from "./lib/bridge";
import { motionHold, revealPane, revealScreen } from "./lib/entrance";
import { createFilesDraftStore } from "./lib/files-drafts";
import { confirmEnabled } from "./lib/finder-ui";
import { firstRunSurface, showStartFromChoice } from "./lib/first-run-ui";
import { guideUrl } from "./lib/guide";
import { launchSyncAction, launchSyncWarning } from "./lib/launch-ui";
import { previewSwitchStep } from "./lib/library-ui";
import {
  type PreviewState,
  previewCreating,
  previewSettingsTab,
  previewUpdateProgress,
  previewWelcome,
} from "./lib/preview";
import { createSettingsDraftStore } from "./lib/settings-drafts";
import {
  browserStorage,
  readLastPane,
  SETTINGS_TAB_LABELS,
  type SettingsTab,
  showSettingsChrome,
  writeLastPane,
} from "./lib/settings-ui";
import type { WelcomeOrigin } from "./lib/welcome-tour";
import { SettingsHost } from "./SettingsHost";
import { SettingsLayout } from "./SettingsLayout";
import { SetupWizard } from "./SetupWizard";

export function App({
  api,
  preview,
  bootSplash = false,
}: {
  api: Api;
  preview: PreviewState;
  /** Hold a startup screen over the app until its first screen is ready. */
  bootSplash?: boolean;
}) {
  const { error, setError, dismissError } = useOperationErrors();
  const [splash, setSplash] = useState<"shown" | "leaving" | "gone">(bootSplash ? "shown" : "gone");
  const [settingsSettled, setSettingsSettled] = useState(false);
  // A newly confirmed install stays on the finder for a beat, so the
  // confirmation is seen before setup continues. Skipped without motion.
  const [handoffSince, setHandoffSince] = useState<number | null>(null);
  const onInstallConfirmed = useCallback(() => {
    if (motionHold(CONFIRM_HOLD_MS) > 0) setHandoffSince(performance.now());
  }, []);
  const shell = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsWriting, setSettingsWriting] = useState(false);
  const [settingsDraftStore] = useState(createSettingsDraftStore);
  const settingsDrafts = useSyncExternalStore(
    settingsDraftStore.subscribe,
    settingsDraftStore.getSnapshot,
  );
  const settingsPending = settingsDrafts.length > 0;
  const [preloaderRecovery, setPreloaderRecovery] = useState(false);
  const [hudReviewId, setHudReviewId] = useState<string | null>(null);
  const [hudReviewBusy, setHudReviewBusy] = useState(false);
  const [hudReviewRevision, setHudReviewRevision] = useState(0);
  const [tidyRevision, setTidyRevision] = useState(0);
  const [launching, setLaunching] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [launchSync, setLaunchSync] = useState<LaunchSyncStatus | null>(null);
  const [launchSyncPrompt, setLaunchSyncPrompt] = useState<LaunchSyncStatus | null>(null);
  const appSettingsButton = useRef<HTMLButtonElement>(null);
  const appSettingsReturnFocus = useRef<HTMLElement | null>(null);
  const profileSettings = useRef<HTMLDivElement>(null);
  const [settingsReviewRequest, setSettingsReviewRequest] = useState(0);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(
    // Fixture previews choose their own pane; the installed app reopens the last one.
    () =>
      previewSettingsTab(preview) ??
      (isTauri() ? readLastPane(browserStorage()) : null) ??
      "comfig",
  );
  useEffect(() => {
    if (isTauri()) writeLastPane(browserStorage(), settingsTab);
  }, [settingsTab]);
  const navigateSettings = useCallback((tab: SettingsTab) => {
    setAppSettingsOpen(false);
    setSettingsTab(tab);
  }, []);
  const reviewSettings = useCallback(
    (tab: SettingsTab) => {
      navigateSettings(tab);
      setSettingsReviewRequest((request) => request + 1);
    },
    [navigateSettings],
  );
  useEffect(() => {
    if (settingsReviewRequest === 0 || document.querySelector('[aria-modal="true"]')) return;
    // Review changes routes out of a dialog. Focus after its layout cleanup;
    // ordinary navigation and Cancel keep their existing focus behavior.
    const heading = Array.from(
      profileSettings.current?.querySelectorAll<HTMLElement>("[data-pane-heading]") ?? [],
    ).find((node) => !node.closest("[hidden], [inert]"));
    heading?.focus();
  }, [settingsReviewRequest]);
  const closeAppSettings = useCallback(() => {
    setAppSettingsOpen(false);
    (appSettingsReturnFocus.current ?? appSettingsButton.current)?.focus();
  }, []);
  const openAppSettings = useCallback(() => {
    appSettingsReturnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setAppSettingsOpen(true);
  }, []);
  useEffect(() => {
    if (!appSettingsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        document.querySelector('[aria-modal="true"]')
      )
        return;
      event.preventDefault();
      closeAppSettings();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [appSettingsOpen, closeAppSettings]);

  const lock = useWriteLock(api);
  const [filesDraftStore] = useState(createFilesDraftStore);
  const lifecycle = useLifecycleStatus(api);
  useEffect(() => {
    if (lifecycle.launchWaitExpired) {
      setError(
        "The ten-minute launch wait ended without seeing TF2. Changes are unlocked. This does not cancel a queued Steam launch.",
        "tf2:launch",
      );
    }
  }, [lifecycle.launchWaitExpired, setError]);
  const progress = useSwitchProgress(api, preview === "switch" ? previewSwitchStep() : null);
  const appSettings = useAppPreferences(api);
  const update = useAppUpdate(api, {
    setError,
    seedProgress: previewUpdateProgress(preview),
    checkOnStartup: appSettings.data?.preferences.checkForUpdatesOnStartup ?? null,
  });
  const launchPending = launching || lifecycle.launchingTf2;
  const lifecycleBusy =
    !lifecycle.available ||
    lifecycle.launchingTf2 ||
    lifecycle.steamVerification ||
    lifecycle.installingUpdate;
  const maintenanceCopy = lifecycle.steamVerification
    ? "Steam verification owns TF2 files — finish or cancel it from Mods."
    : lifecycle.launchingTf2
      ? "Steam is still starting TF2 — changes remain locked."
      : lifecycle.installingUpdate
        ? "execs is installing an update — changes remain locked."
        : null;
  const filesExit = useFilesExitGuard(
    filesDraftStore,
    lock.running,
    busy ||
      hudReviewBusy ||
      appSettings.saving ||
      progress.state.active ||
      update.progress !== null,
    settingsDraftStore,
    reviewSettings,
  );
  const anyBusy =
    busy ||
    hudReviewBusy ||
    settingsBusy ||
    launchPending ||
    lifecycleBusy ||
    preloaderRecovery ||
    update.progress !== null;

  const install = useTf2Install(api, {
    setError,
    setBusy,
    onConfirmed: onInstallConfirmed,
    onChanged: () => {
      // A different install must never inherit the previous one's first-run
      // screen, reasons, pack prompt, library or draft name.
      setHandoffSince(null);
      setDraftName("");
      setAppSettingsOpen(false);
      setHudReviewId(null);
      profiles.reset();
      firstRun.reset();
      progress.cancel();
    },
  });
  const releaseNotes = useReleaseNotes({
    version: update.version,
    installResolved: !install.scanning,
    existingInstall: install.confirmed !== null,
    seed:
      preview === "release-notes"
        ? {
            version: "0.1.3",
            notes:
              "### Fixed\n\n- Mouse binds now use the correct TF2 names.\n- Profile repairs stop safely if TF2 starts.\n- Imported HUD options remain editable.",
          }
        : null,
  });

  const profiles = useProfileLibrary(api, {
    confirmed: install.confirmed,
    running: lock.running,
    busy: anyBusy,
    quitNonce: lock.quitNonce,
    progress,
    setError,
    setBusy,
    onHudReviewRequired: setHudReviewId,
  });
  const recoveryTargetId = profiles.library?.pendingSwitchProfileId ?? null;
  // The execs dot marks panes whose changes have not reached the profile yet:
  // a settings draft still waiting (debounce, TF2 running, failure) or
  // unsaved Files edits.
  const filesVersion = useSyncExternalStore(filesDraftStore.subscribe, filesDraftStore.getVersion);
  const changedProfileId = profiles.library?.activeProfileId ?? null;
  const changedTabs = useMemo(() => {
    const tabs = new Set<SettingsTab>(
      settingsDrafts
        .filter((entry) => entry.profile === changedProfileId)
        .map((entry) => entry.tab),
    );
    if (filesVersion >= 0 && filesDraftStore.hasDirty(changedProfileId)) tabs.add("files");
    return tabs;
  }, [settingsDrafts, filesVersion, filesDraftStore, changedProfileId]);
  const pendingPanes = [
    ...new Set(settingsDrafts.map((entry) => SETTINGS_TAB_LABELS[entry.tab])),
  ].join(", ");
  const failedPanes = [
    ...new Set(
      settingsDrafts
        .filter((entry) => entry.save?.failed)
        .map((entry) => SETTINGS_TAB_LABELS[entry.tab]),
    ),
  ].join(", ");
  const launchBlockReason =
    recoveryTargetId !== null
      ? "Finish profile switch recovery before launching TF2."
      : progress.state.active
        ? "Wait for the profile switch to finish before launching TF2."
        : preloaderRecovery
          ? "Finish preloader recovery in Mods before launching TF2."
          : lifecycle.steamVerification
            ? "Finish or cancel Steam verification in Mods before launching TF2."
            : lifecycle.installingUpdate || update.progress !== null
              ? "Wait for the update installation to finish."
              : !lifecycle.available
                ? "Waiting for the maintenance state before launching TF2."
                : settingsWriting
                  ? "Wait for the current settings write to finish."
                  : busy || settingsBusy
                    ? "Wait for the current operation to finish."
                    : settingsPending
                      ? `${failedPanes || pendingPanes}: ${failedPanes ? "save failed" : "unsaved changes"}. Review changes before launching TF2.`
                      : null;

  const firstRun = useFirstRun(api, {
    confirmed: install.confirmed,
    library: profiles.library,
    busy: anyBusy,
    running: lock.running,
    progress,
    setError,
    setBusy,
    setLibrary: profiles.setLibrary,
    seedCreating: previewCreating(preview),
  });

  const creating = firstRun.creating;

  // The welcome tour opens once, when first-run setup finishes, and again
  // from App settings. Nothing about it is stored.
  const [welcome, setWelcome] = useState<WelcomeOrigin | null>(() =>
    previewWelcome(preview) ? "saved" : null,
  );
  const [welcomeOffersComfig, setWelcomeOffersComfig] = useState(false);
  useEffect(() => {
    if (welcome === null) return;
    let cancelled = false;
    void api
      .getActiveProfileDetail()
      .then((detail) => {
        if (!cancelled) setWelcomeOffersComfig(detail !== null && detail.layer !== "comfig");
      })
      .catch(() => {
        if (!cancelled) setWelcomeOffersComfig(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, welcome]);

  // From Comfig or the welcome tour: a new profile from the current setup,
  // named for what it is for. The player's own profile is never converted.
  const tryComfig = useCallback(() => {
    setWelcome(null);
    setDraftName((name) => name || "Trying mastercomfig");
    filesExit.request(firstRun.openCreate);
  }, [filesExit, firstRun.openCreate]);

  const onSaveCurrent = useCallback(async () => {
    if (await profiles.saveCurrent(draftName)) {
      firstRun.clear();
      setDraftName("");
      setWelcome("saved");
    }
  }, [profiles, firstRun, draftName]);

  const tidy = useStartupTidy(
    api,
    {
      ready:
        install.screen === "ready" &&
        install.confirmed !== null &&
        profiles.library?.usable === true &&
        !profiles.library.rootMismatch,
      running: lock.running,
      busy: busy || progress.state.active,
    },
    () => {
      setTidyRevision((revision) => revision + 1);
      void api
        .getProfileLibrary()
        .then(profiles.setLibrary)
        .catch(() => {});
    },
  );
  const verifyAfterTidy = useCallback(() => {
    void api
      .repairGameFiles()
      .then(() => {
        setError(null, "tidy:verify");
        navigateSettings("mods");
        return lifecycle.refresh();
      })
      .catch((err) => setError(invokeErrorMessage(err), "tidy:verify"));
  }, [api, setError, navigateSettings, lifecycle]);
  const reviewLibraryMove = useCallback(() => api.reviewLibraryMove(), [api]);
  const { setLibrary } = profiles;
  const moveLibrary = useCallback(async () => {
    setBusy(true);
    try {
      setLibrary(await api.moveLibraryToInstall());
      setError(null, "profiles:move");
    } catch (err) {
      setError(invokeErrorMessage(err), "profiles:move");
    } finally {
      setBusy(false);
    }
  }, [api, setLibrary, setError]);

  const onApplyWizard = useCallback(async () => {
    // A later "Create new profile" uses the same wizard; only first run welcomes.
    const firstProfile = !firstRun.creating;
    if (await firstRun.applyWizard(draftName)) {
      setDraftName("");
      if (firstProfile) setWelcome("created");
    }
  }, [firstRun, draftName]);

  const onCreateOnly = useCallback(async () => {
    const created = await firstRun.applyWizard(draftName, false);
    if (created) setDraftName("");
    return created;
  }, [firstRun, draftName]);

  const surface = firstRunSurface(profiles.library, firstRun.kind);
  const installReady =
    install.screen === "ready" && install.confirmed !== null && handoffSince === null;
  const settingsOpen =
    installReady && surface === "ready" && !creating && showSettingsChrome(profiles.library);
  // The ready shell (header + library status) fills the window even before a
  // profile is active, so the empty library view is not an inset card.
  const readyShellOpen =
    settingsOpen || (installReady && surface === "ready" && !creating && !appSettingsOpen);
  // The sidebar holds App settings. Without it (first run, or a ready shell
  // with no active profile) the footer is the way there.
  const sidebarShown = readyShellOpen && showSettingsChrome(profiles.library);

  // Startup and a confirmed install each wait for the first screen's reads.
  const stageInput = {
    screen:
      install.screen === "ready" && install.confirmed ? ("ready" as const) : ("finder" as const),
    scanning: install.scanning,
    libraryLoaded: profiles.library !== null,
    surface,
    settingsOpen,
    settingsSettled,
    paneLabel: SETTINGS_TAB_LABELS[settingsTab],
    failed: error !== null,
  };
  const boot = bootStage(stageInput);
  const handoff = bootStage({ ...stageInput, settingsOpen: false });
  const bootSettled = boot.settled;
  useEffect(() => {
    if (splash !== "shown") return;
    const wait = bootRemaining(
      { settled: bootSettled, status: "" },
      performance.now(),
      motionHold(BOOT_MIN_MS),
    );
    const timer = window.setTimeout(() => setSplash("leaving"), wait);
    return () => window.clearTimeout(timer);
  }, [splash, bootSettled]);
  const handoffSettled = handoff.settled;
  useEffect(() => {
    if (handoffSince === null) return;
    const elapsed = performance.now() - handoffSince;
    const wait = handoffSettled
      ? Math.max(0, CONFIRM_HOLD_MS - elapsed)
      : Math.max(0, CONFIRM_MAX_MS - elapsed);
    const timer = window.setTimeout(() => setHandoffSince(null), wait);
    return () => window.clearTimeout(timer);
  }, [handoffSince, handoffSettled]);

  // Each new screen arrives in order: header, sidebar, then the pane's
  // sections, or an onboarding frame top to bottom. The first one enters as
  // the startup screen lifts off it.
  const screen =
    splash === "shown"
      ? "boot"
      : appSettingsOpen && !settingsOpen
        ? "app"
        : !installReady
          ? "finder"
          : surface === "first-existing"
            ? "existing"
            : surface === "first-unused" || creating
              ? "wizard"
              : surface === "loading"
                ? "loading"
                : settingsOpen
                  ? "workspace"
                  : "shell";
  const lastScreen = useRef(screen);
  useLayoutEffect(() => {
    const previous = lastScreen.current;
    lastScreen.current = screen;
    if (screen === "boot" || previous === screen) return;
    revealScreen(shell.current, previous === "boot" ? 160 : 0);
  }, [screen]);
  // A profile's settings finishing their read (after a switch) reveal the pane.
  const wasSettled = useRef(settingsSettled);
  useLayoutEffect(() => {
    const was = wasSettled.current;
    wasSettled.current = settingsSettled;
    if (!was && settingsSettled && lastScreen.current === "workspace") {
      revealPane(shell.current);
    }
  }, [settingsSettled]);

  const activeProfileId = profiles.library?.activeProfileId ?? null;
  const refreshLaunchSync = useCallback(async (): Promise<LaunchSyncStatus | null> => {
    if (!activeProfileId) {
      setLaunchSync(null);
      return null;
    }
    // A failed comparison never blocks launching; it only hides the flag.
    const status = await api.getLaunchSyncStatus().catch(() => null);
    setLaunchSync(status);
    return status;
  }, [api, activeProfileId]);

  // Steam's copy changes outside execs, so re-check when the window regains
  // focus as well as after profile, game and launch changes.
  useEffect(() => {
    if (lock.running || launchPending) return;
    void refreshLaunchSync();
    const onFocus = () => void refreshLaunchSync();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshLaunchSync, lock.running, launchPending]);

  function startLaunch(syncSteam: boolean, reviewToken?: string, adoptSteam = false) {
    setLaunching(true);
    void api
      .launchTf2(syncSteam, reviewToken, adoptSteam)
      .then(() => setError(null, "tf2:launch"))
      .catch((err) => setError(invokeErrorMessage(err), "tf2:launch"))
      .finally(() => {
        setLaunching(false);
        void lifecycle.refresh();
        void refreshLaunchSync();
      });
  }

  function renderAppPreferences() {
    return (
      <AppSettingsPane
        api={api}
        settings={appSettings}
        ready={filesExit.ready}
        update={update}
        confirmedRoot={install.confirmed?.path ?? null}
        backAction={
          <button type="button" className="btn btn-ghost" onClick={closeAppSettings}>
            <ArrowLeft size={15} aria-hidden="true" />
            {settingsOpen ? `Back to ${SETTINGS_TAB_LABELS[settingsTab]}` : "Back to setup"}
          </button>
        }
        onChangeInstall={() =>
          filesExit.request(() => {
            setAppSettingsOpen(false);
            install.change();
          })
        }
        onShowWelcome={
          settingsOpen
            ? () => {
                closeAppSettings();
                setWelcome("saved");
              }
            : undefined
        }
        onUninstall={(deleteData, onError) =>
          filesExit.request(async () => {
            try {
              await api.uninstallExecs(deleteData);
            } catch (err) {
              onError(invokeErrorMessage(err));
            }
          })
        }
        uninstallBlockedReason={
          lock.running
            ? "Close TF2 before uninstalling."
            : anyBusy || progress.state.active
              ? "Wait for the current operation to finish."
              : null
        }
        changeInstallDisabled={anyBusy || lock.running || progress.state.active}
        changeInstallReason={
          lock.running
            ? "Close TF2 before changing the install."
            : anyBusy
              ? "Wait for the current operation to finish."
              : null
        }
      />
    );
  }

  function renderReady(path: string) {
    if (surface === "first-existing") {
      return (
        <FirstRunExisting
          path={path}
          draftName={draftName}
          reasons={firstRun.reasons}
          onDraftName={setDraftName}
          onSave={() => filesExit.request(onSaveCurrent)}
          onChange={() => filesExit.request(install.change)}
        />
      );
    }
    if (surface === "first-unused" || creating) {
      const isCreate = creating && surface === "ready";
      return (
        <>
          <SetupWizard
            draftName={draftName}
            preset={firstRun.preset}
            addons={firstRun.addons}
            creating={isCreate}
            startFrom={showStartFromChoice(profiles.library, isCreate) ? firstRun.startFrom : null}
            onDraftName={setDraftName}
            onPreset={firstRun.setPreset}
            onToggleAddon={firstRun.toggleAddon}
            onStartFrom={firstRun.setStartFrom}
            onApply={() => void onApplyWizard()}
            onCreateOnly={isCreate ? onCreateOnly : undefined}
            onCancel={isCreate ? firstRun.cancelCreate : undefined}
          />
          <SwitchProgressList
            switchStep={progress.state.visibleStep}
            active={progress.state.active}
            visible={progress.state.visible}
            detail={progress.state.completionDetail}
          />
          {isCreate ? null : (
            <button
              type="button"
              onClick={() => filesExit.request(install.change)}
              disabled={busy || progress.state.active}
              className="btn btn-ghost mt-6"
            >
              Change install
            </button>
          )}
        </>
      );
    }
    if (surface === "loading") {
      return (
        <section
          data-reveal="group"
          className="flex w-full max-w-[640px] flex-col items-center text-center"
        >
          <Wordmark target />
          <p className="t-body mt-8 text-ink-muted">
            <Loading size={16}>Checking this install…</Loading>
          </p>
          <button
            type="button"
            onClick={() => filesExit.request(install.change)}
            className="btn btn-ghost mt-6"
          >
            Change install
          </button>
        </section>
      );
    }
    return (
      <ReadyPanel
        path={path}
        profiles={{
          ...profiles,
          switchProfile: async (id) => {
            filesExit.request(() => profiles.switchProfile(id));
          },
          repairFolders: async () => {
            filesExit.request(() => profiles.repairFolders());
          },
          importProfile: async () => {
            filesExit.request(() => profiles.importProfile());
          },
          reviewDelete: (id) => {
            filesExit.request(() => profiles.reviewDelete(id));
          },
        }}
        progress={progress}
        draftName={draftName}
        launching={launchPending}
        recoveryTargetId={recoveryTargetId}
        launchBlockReason={launchBlockReason}
        launchBlockAction={
          settingsPending
            ? "Review changes"
            : preloaderRecovery || lifecycle.steamVerification
              ? "Open Mods"
              : undefined
        }
        onLaunchBlocked={
          settingsPending
            ? () => filesExit.request(() => {})
            : preloaderRecovery || lifecycle.steamVerification
              ? () => navigateSettings("mods")
              : undefined
        }
        launchWarning={launchSyncWarning(launchSync)}
        onLaunch={() => {
          setLaunching(true);
          void refreshLaunchSync().then((status) => {
            const action = launchSyncAction(status);
            if (action === "ask") {
              setLaunching(false);
              setLaunchSyncPrompt(status);
              return;
            }
            startLaunch(action === "write-then-launch");
          });
        }}
        onCancelLaunch={() => {
          void api
            .cancelTf2Launch()
            .then(() => {
              setError(null, "tf2:launch");
              setError(null, "tf2:cancel-launch");
              return lifecycle.refresh();
            })
            .catch((err) => setError(invokeErrorMessage(err), "tf2:cancel-launch"));
        }}
        onReviewFiles={() => navigateSettings("files")}
        onReviewLibraryMove={reviewLibraryMove}
        tidyReport={tidy.report}
        onDismissTidy={tidy.dismiss}
        onVerifyTidy={verifyAfterTidy}
        onMoveLibrary={moveLibrary}
        onInspectExport={(id) => api.inspectProfileExport(id)}
        onCompareSwitch={(id) => api.compareProfileSwitch(id)}
        restoreApi={api}
        settings={
          showSettingsChrome(profiles.library) ? (
            <SettingsLayout
              tab={settingsTab}
              changed={changedTabs}
              page={appSettingsOpen ? "app" : null}
              onTab={navigateSettings}
              scrollIdentity={`${path}:${profiles.library?.activeProfileId ?? "none"}`}
              utility={
                <>
                  <button
                    type="button"
                    data-testid="guide-open"
                    className="settings-nav-item"
                    title={`Guide for ${appSettingsOpen ? "App settings" : SETTINGS_TAB_LABELS[settingsTab]}`}
                    onClick={() =>
                      void openExternal(
                        guideUrl(
                          appSettingsOpen ? "app-settings" : settingsTab,
                          update.version,
                          import.meta.env.DEV,
                        ),
                      ).catch(() => {})
                    }
                  >
                    <BookOpen size={16} aria-hidden="true" />
                    <span className="settings-nav-label">Guide</span>
                  </button>
                  <button
                    ref={appSettingsButton}
                    type="button"
                    data-testid="app-settings-open"
                    aria-current={appSettingsOpen ? "page" : undefined}
                    data-active={appSettingsOpen ? "true" : "false"}
                    className="settings-nav-item"
                    onClick={openAppSettings}
                  >
                    <GearSix size={16} aria-hidden="true" />
                    <span className="settings-nav-label">App settings</span>
                  </button>
                </>
              }
            >
              <div ref={profileSettings} hidden={appSettingsOpen}>
                <SettingsHost
                  api={api}
                  visible={!appSettingsOpen}
                  filesDraftStore={filesDraftStore}
                  filesSaver={filesExit.saver}
                  filesCloseReady={filesExit.ready}
                  settingsDraftStore={settingsDraftStore}
                  tab={settingsTab}
                  activeProfileId={profiles.library?.activeProfileId ?? null}
                  activeProfileName={
                    profiles.library?.profiles.find(
                      (profile) => profile.id === profiles.library?.activeProfileId,
                    )?.name ?? null
                  }
                  onNavigate={navigateSettings}
                  onTryComfig={tryComfig}
                  running={lock.running}
                  externalBusy={
                    busy ||
                    hudReviewBusy ||
                    progress.state.active ||
                    recoveryTargetId !== null ||
                    lifecycleBusy
                  }
                  refreshKey={`${profiles.refreshKey}:${hudReviewRevision}:${tidyRevision}`}
                  bindSyncRequest={profiles.bindSyncRequest}
                  bindSyncChanges={profiles.bindSyncChanges}
                  onBindSyncHandled={profiles.onBindSyncHandled}
                  onBusyChange={setSettingsBusy}
                  onSettledChange={setSettingsSettled}
                  onWriteBusyChange={setSettingsWriting}
                  onRecoveryChange={setPreloaderRecovery}
                  onHudReviewRequired={setHudReviewId}
                  onError={setError}
                  launchSync={launchSync}
                  onLaunchOptionsSaved={() => void refreshLaunchSync()}
                />
              </div>
              {appSettingsOpen ? renderAppPreferences() : null}
            </SettingsLayout>
          ) : null
        }
        onDraftName={setDraftName}
        onSave={() => filesExit.request(onSaveCurrent)}
        onCreateNew={() => filesExit.request(firstRun.openCreate)}
        onChangeInstall={() => filesExit.request(install.change)}
      />
    );
  }

  return (
    <AppStatusProvider
      value={{
        error,
        setError,
        dismissError,
        busy: anyBusy || progress.state.active,
        running: lock.running,
      }}
    >
      <ToastProvider>
        <WelcomeTour
          open={welcome !== null && settingsOpen && !progress.state.active}
          profileName={
            profiles.library?.profiles.find(
              (profile) => profile.id === profiles.library?.activeProfileId,
            )?.name ?? null
          }
          origin={welcome ?? "saved"}
          offerComfig={welcomeOffersComfig}
          onClose={() => setWelcome(null)}
          onTryComfig={tryComfig}
        />
        <HudOwnershipDialog
          api={api}
          profile={
            hudReviewId
              ? {
                  id: hudReviewId,
                  name:
                    profiles.library?.profiles.find((profile) => profile.id === hudReviewId)
                      ?.name ?? "this profile",
                }
              : null
          }
          running={lock.running}
          busy={
            busy ||
            settingsBusy ||
            progress.state.active ||
            lifecycleBusy ||
            update.progress !== null
          }
          onClose={() => setHudReviewId(null)}
          onBusyChange={setHudReviewBusy}
          onApplied={async () => {
            profiles.setLibrary(await api.getProfileLibrary());
            setHudReviewRevision((revision) => revision + 1);
            setHudReviewId(null);
          }}
        />
        <Modal
          open={launchSyncPrompt !== null}
          title="Choose launch options"
          testId="launch-sync-review"
          className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(540px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto sm:p-6"
          onClose={() => setLaunchSyncPrompt(null)}
        >
          <p className="t-body mt-2 text-ink-muted">
            Steam has different launch options than this profile. Keep them for this launch, save
            them to this profile, or replace them with the profile's options.
            {launchSyncPrompt?.steamRunning
              ? " Replacing them restarts Steam; downloads and chat pause."
              : ""}
          </p>
          <dl className="t-meta mt-4 grid gap-2">
            <div>
              <dt>This profile</dt>
              <dd className="mt-0.5 break-all text-ink">
                {launchSyncPrompt?.profileOptions || "No launch options"}
              </dd>
            </div>
            <div>
              <dt>Steam now</dt>
              <dd className="mt-0.5 break-all text-ink">
                {launchSyncPrompt?.steamOptions || "No launch options"}
              </dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setLaunchSyncPrompt(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="launch-sync-skip"
              className="btn btn-ghost"
              onClick={() => {
                setLaunchSyncPrompt(null);
                startLaunch(false);
              }}
            >
              Keep Steam options and launch
            </button>
            <button
              type="button"
              data-testid="launch-sync-adopt"
              className="btn btn-ghost"
              onClick={() => {
                const token = launchSyncPrompt?.reviewToken ?? undefined;
                setLaunchSyncPrompt(null);
                startLaunch(false, token, true);
              }}
            >
              Save Steam options to profile and launch
            </button>
            <button
              type="button"
              data-testid="launch-sync-restart"
              className="btn btn-primary"
              onClick={() => {
                const token = launchSyncPrompt?.reviewToken ?? undefined;
                setLaunchSyncPrompt(null);
                startLaunch(true, token);
              }}
            >
              {launchSyncPrompt?.steamRunning
                ? "Restart Steam and launch"
                : "Use profile options and launch"}
            </button>
          </div>
        </Modal>
        <ReleaseNotes
          api={api}
          release={releaseNotes.release}
          onClose={releaseNotes.dismiss}
          onError={(message) => setError(message, "release:open")}
        />
        {filesExit.modal}
        {filesExit.error ? <p role="alert">{filesExit.error}</p> : null}
        {splash === "gone" ? null : (
          <BootSplash
            status={boot.status}
            leaving={splash === "leaving"}
            onDone={() => setSplash("gone")}
          />
        )}
        <div
          ref={shell}
          inert={splash === "shown"}
          className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-ink"
        >
          <WriteLockBanner
            running={lock.running}
            degraded={lock.degraded ?? lifecycle.degraded ?? progress.degraded}
            maintenance={maintenanceCopy}
          />
          <UpdateBanner
            update={{
              ...update,
              install: async () => {
                filesExit.request(update.install);
              },
            }}
            blocked={
              busy ||
              settingsBusy ||
              settingsPending ||
              progress.state.active ||
              launchPending ||
              lock.running ||
              lifecycleBusy ||
              recoveryTargetId !== null
            }
          />

          {/* Pages without the sidebar keep the dot field anchored to the
              window while their content scrolls; the sidebar's workspace
              holds its own. */}
          <div className="relative flex min-h-0 w-full flex-1 flex-col">
            {sidebarShown ? null : <DotBackdrop />}
            <main
              className={`relative flex min-h-0 w-full flex-1 flex-col ${
                readyShellOpen
                  ? "items-stretch overflow-hidden"
                  : "mx-auto items-center justify-start overflow-y-auto px-10 py-14"
              }`}
            >
              {appSettingsOpen && !settingsOpen ? (
                <section className="w-full max-w-[960px]">{renderAppPreferences()}</section>
              ) : installReady && install.confirmed ? (
                <ClassIconProvider api={api} installPath={install.confirmed.path}>
                  {renderReady(install.confirmed.path)}
                </ClassIconProvider>
              ) : (
                <FinderPanel
                  scanning={install.scanning}
                  installs={install.installs}
                  selected={install.selected}
                  error={error}
                  onDismissError={dismissError}
                  canConfirm={confirmEnabled(install.selected, install.scanning || busy)}
                  busy={busy}
                  onSelect={install.select}
                  onBrowse={() => void install.browse()}
                  onConfirm={() => void install.confirm()}
                  confirmed={handoffSince !== null}
                  waitingFor={handoffSettled ? null : handoff.status}
                  missing={install.missing}
                  onRetryMissing={() => void install.retryMissing()}
                />
              )}

              {/* The ready shell has App settings in its sidebar, which holds the
                  version, update check, support and notices. First-run screens
                  keep this footer as their way there. */}
              {sidebarShown ? null : (
                <AppFooter
                  api={api}
                  update={{
                    ...update,
                    install: async () => {
                      filesExit.request(update.install);
                    },
                  }}
                  pinned={readyShellOpen}
                  onSettings={settingsOpen ? undefined : openAppSettings}
                />
              )}
            </main>
          </div>
        </div>
      </ToastProvider>
    </AppStatusProvider>
  );
}
