import { ArrowLeft, GearSix } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppSettingsPane } from "./AppSettingsPane";
import { AppFooter } from "./components/AppFooter";
import { FinderPanel } from "./components/FinderPanel";
import { HudOwnershipDialog } from "./components/HudOwnershipDialog";
import { ReadyPanel } from "./components/ReadyPanel/ReadyPanel";
import { ReleaseNotes } from "./components/ReleaseNotes";
import { SwitchProgressList } from "./components/SwitchProgressList";
import { UpdateBanner } from "./components/UpdateBanner";
import { Modal } from "./components/ui/Modal";
import { ToastProvider } from "./components/ui/Toast";
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
import { useSwitchProgress } from "./hooks/useSwitchProgress";
import { useTf2Install } from "./hooks/useTf2Install";
import { useWriteLock } from "./hooks/useWriteLock";
import type { Api } from "./lib/api";
import { invokeErrorMessage } from "./lib/bridge";
import { createFilesDraftStore } from "./lib/files-drafts";
import { confirmEnabled } from "./lib/finder-ui";
import { firstRunSurface, showStartFromChoice } from "./lib/first-run-ui";
import { previewSwitchStep } from "./lib/library-ui";
import {
  type PreviewState,
  previewCreating,
  previewSettingsTab,
  previewUpdateProgress,
} from "./lib/preview";
import { createSettingsDraftStore } from "./lib/settings-drafts";
import { SETTINGS_TAB_LABELS, type SettingsTab, showSettingsChrome } from "./lib/settings-ui";
import { SettingsHost } from "./SettingsHost";
import { SettingsLayout } from "./SettingsLayout";
import { SetupWizard } from "./SetupWizard";

export function App({ api, preview }: { api: Api; preview: PreviewState }) {
  const { error, setError, dismissError } = useOperationErrors();
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
  const [launching, setLaunching] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [cancelLaunchOpen, setCancelLaunchOpen] = useState(false);
  const appSettingsButton = useRef<HTMLButtonElement>(null);
  const appSettingsReturnFocus = useRef<HTMLElement | null>(null);
  const profileSettings = useRef<HTMLDivElement>(null);
  const [settingsReviewRequest, setSettingsReviewRequest] = useState(0);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(
    () => previewSettingsTab(preview) ?? "comfig",
  );
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
    onChanged: () => {
      // A different install must never inherit the previous one's first-run
      // screen, reasons, pack prompt, library or draft name.
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

  const onSaveCurrent = useCallback(async () => {
    if (await profiles.saveCurrent(draftName)) {
      firstRun.clear();
      setDraftName("");
    }
  }, [profiles, firstRun, draftName]);

  const onApplyWizard = useCallback(async () => {
    if (await firstRun.applyWizard(draftName)) {
      setDraftName("");
    }
  }, [firstRun, draftName]);

  const surface = firstRunSurface(profiles.library, firstRun.kind);
  const settingsOpen =
    install.screen === "ready" &&
    install.confirmed !== null &&
    surface === "ready" &&
    !creating &&
    showSettingsChrome(profiles.library);

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
        <section className="flex w-full max-w-[640px] flex-col items-center text-center">
          <p className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-ink">
            <span aria-hidden="true" className="size-2 rounded-sm bg-brand" />
            execs
          </p>
          <p className="t-body mt-8 text-ink-muted">Checking this install…</p>
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
        onLaunch={() => {
          setLaunching(true);
          void api
            .launchTf2()
            .then(() => setError(null, "tf2:launch"))
            .catch((err) => setError(invokeErrorMessage(err), "tf2:launch"))
            .finally(() => {
              setLaunching(false);
              void lifecycle.refresh();
            });
        }}
        onCancelLaunch={() => {
          setCancelLaunchOpen(true);
        }}
        onReviewFiles={() => navigateSettings("files")}
        onInspectExport={(id) => api.inspectProfileExportCredentials(id)}
        settings={
          showSettingsChrome(profiles.library) ? (
            <SettingsLayout
              tab={settingsTab}
              page={appSettingsOpen ? "app" : null}
              onTab={navigateSettings}
              scrollIdentity={`${path}:${profiles.library?.activeProfileId ?? "none"}`}
              utility={
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
                  onNavigate={navigateSettings}
                  running={lock.running}
                  externalBusy={
                    busy ||
                    hudReviewBusy ||
                    progress.state.active ||
                    recoveryTargetId !== null ||
                    lifecycleBusy
                  }
                  refreshKey={`${profiles.refreshKey}:${hudReviewRevision}`}
                  bindSyncRequest={profiles.bindSyncRequest}
                  onBindSyncHandled={profiles.onBindSyncHandled}
                  onBusyChange={setSettingsBusy}
                  onWriteBusyChange={setSettingsWriting}
                  onRecoveryChange={setPreloaderRecovery}
                  onHudReviewRequired={setHudReviewId}
                  onError={setError}
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
          open={cancelLaunchOpen}
          title="Release the launch lock?"
          onClose={() => setCancelLaunchOpen(false)}
        >
          <p className="t-body text-ink-muted">
            Cancel the TF2 launch and close Steam completely before continuing. This lets execs
            resume changes to your setup.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setCancelLaunchOpen(false)}
            >
              Keep waiting
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setCancelLaunchOpen(false);
                void api
                  .cancelTf2Launch()
                  .then(() => {
                    setError(null, "tf2:cancel-launch");
                    return lifecycle.refresh();
                  })
                  .catch((err) => setError(invokeErrorMessage(err), "tf2:cancel-launch"));
              }}
            >
              Release launch lock
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
        <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-ink">
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

          <main
            className={`flex min-h-0 w-full flex-1 flex-col ${
              settingsOpen
                ? "items-stretch overflow-hidden"
                : "mx-auto items-center justify-start overflow-y-auto px-10 py-14"
            }`}
          >
            {appSettingsOpen && !settingsOpen ? (
              <section className="w-full max-w-[960px]">{renderAppPreferences()}</section>
            ) : install.screen === "ready" && install.confirmed ? (
              renderReady(install.confirmed.path)
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
              />
            )}

            <AppFooter
              api={api}
              update={{
                ...update,
                install: async () => {
                  filesExit.request(update.install);
                },
              }}
              pinned={settingsOpen}
              onSettings={settingsOpen ? undefined : openAppSettings}
            />
          </main>
        </div>
      </ToastProvider>
    </AppStatusProvider>
  );
}
