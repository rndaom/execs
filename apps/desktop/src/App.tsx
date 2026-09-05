import { useCallback, useState } from "react";
import { AppFooter } from "./components/AppFooter";
import { FinderPanel } from "./components/FinderPanel";
import { ReadyPanel } from "./components/ReadyPanel/ReadyPanel";
import { SwitchProgressList } from "./components/SwitchProgressList";
import { UpdateBanner } from "./components/UpdateBanner";
import { ToastProvider } from "./components/ui/Toast";
import { WriteLockBanner } from "./components/WriteLockBanner";
import { FirstRunExisting } from "./FirstRunExisting";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useFirstRun } from "./hooks/useFirstRun";
import { useLifecycleStatus } from "./hooks/useLifecycleStatus";
import { useProfileLibrary } from "./hooks/useProfileLibrary";
import { useSwitchProgress } from "./hooks/useSwitchProgress";
import { useTf2Install } from "./hooks/useTf2Install";
import { useWriteLock } from "./hooks/useWriteLock";
import type { Api } from "./lib/api";
import { invokeErrorMessage } from "./lib/bridge";
import { confirmEnabled } from "./lib/finder-ui";
import { firstRunSurface, showStartFromChoice } from "./lib/first-run-ui";
import { previewSwitchStep } from "./lib/library-ui";
import {
  type PreviewState,
  previewCreating,
  previewSettingsTab,
  previewUpdateProgress,
} from "./lib/preview";
import { type SettingsTab, showSettingsChrome } from "./lib/settings-ui";
import { SettingsHost } from "./SettingsHost";
import { SettingsLayout } from "./SettingsLayout";
import { SetupWizard } from "./SetupWizard";

export function App({ api, preview }: { api: Api; preview: PreviewState }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsPending, setSettingsPending] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(
    () => previewSettingsTab(preview) ?? "comfig",
  );

  const lock = useWriteLock(api);
  const lifecycle = useLifecycleStatus(api);
  const progress = useSwitchProgress(api, preview === "switch" ? previewSwitchStep() : null);
  const update = useAppUpdate(api, {
    setError,
    seedProgress: previewUpdateProgress(preview),
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
  const anyBusy =
    busy ||
    settingsBusy ||
    settingsPending ||
    launchPending ||
    lifecycleBusy ||
    update.progress !== null;

  const install = useTf2Install(api, {
    setError,
    setBusy,
    onChanged: () => {
      // A different install must never inherit the previous one's first-run
      // screen, reasons, pack prompt, library or draft name.
      setDraftName("");
      profiles.reset();
      firstRun.reset();
      progress.cancel();
    },
  });

  const profiles = useProfileLibrary(api, {
    confirmed: install.confirmed,
    running: lock.running,
    busy: anyBusy,
    quitNonce: lock.quitNonce,
    progress,
    setError,
    setBusy,
  });
  const recoveryTargetId = profiles.library?.pendingSwitchProfileId ?? null;

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

  function renderReady(path: string) {
    if (surface === "first-existing") {
      return (
        <FirstRunExisting
          path={path}
          draftName={draftName}
          reasons={firstRun.reasons}
          onDraftName={setDraftName}
          onSave={() => void onSaveCurrent()}
          onChange={install.change}
        />
      );
    }
    if (surface === "first-unused" || creating) {
      const isCreate = creating && surface === "ready";
      return (
        <>
          <SetupWizard
            title={isCreate ? "New profile" : "Unused install"}
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
              onClick={install.change}
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
          <button type="button" onClick={install.change} className="btn btn-ghost mt-6">
            Change install
          </button>
        </section>
      );
    }
    return (
      <ReadyPanel
        path={path}
        profiles={profiles}
        progress={progress}
        draftName={draftName}
        launching={launchPending}
        recoveryTargetId={recoveryTargetId}
        onLaunch={() => {
          setError(null);
          setLaunching(true);
          void api
            .launchTf2()
            .catch((err) => setError(invokeErrorMessage(err)))
            .finally(() => {
              setLaunching(false);
              void lifecycle.refresh();
            });
        }}
        onCancelLaunch={() => {
          if (
            !window.confirm(
              "Cancel the launch, then close Steam completely. Release execs' launch lock now?",
            )
          ) {
            return;
          }
          setError(null);
          void api
            .cancelTf2Launch()
            .then(() => lifecycle.refresh())
            .catch((err) => setError(invokeErrorMessage(err)));
        }}
        settings={
          showSettingsChrome(profiles.library) ? (
            <SettingsLayout tab={settingsTab} onTab={setSettingsTab}>
              <SettingsHost
                api={api}
                tab={settingsTab}
                running={lock.running}
                externalBusy={
                  busy || progress.state.active || recoveryTargetId !== null || lifecycleBusy
                }
                refreshKey={profiles.refreshKey}
                bindSyncRequest={profiles.bindSyncRequest}
                onBindSyncHandled={profiles.onBindSyncHandled}
                onBusyChange={setSettingsBusy}
                onPendingChange={setSettingsPending}
                onError={setError}
              />
            </SettingsLayout>
          ) : null
        }
        onDraftName={setDraftName}
        onSave={() => void onSaveCurrent()}
        onCreateNew={firstRun.openCreate}
        onChangeInstall={install.change}
      />
    );
  }

  return (
    <AppStatusProvider
      value={{
        error,
        setError,
        busy: anyBusy || progress.state.active,
        running: lock.running,
      }}
    >
      <ToastProvider>
        <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-ink">
          <WriteLockBanner
            running={lock.running}
            degraded={lock.degraded ?? lifecycle.degraded ?? progress.degraded}
            maintenance={maintenanceCopy}
          />
          <UpdateBanner
            update={update}
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
            {install.screen === "ready" && install.confirmed ? (
              renderReady(install.confirmed.path)
            ) : (
              <FinderPanel
                scanning={install.scanning}
                installs={install.installs}
                selected={install.selected}
                error={error}
                canConfirm={confirmEnabled(install.selected, install.scanning || busy)}
                busy={busy}
                onSelect={install.select}
                onBrowse={() => void install.browse()}
                onConfirm={() => void install.confirm()}
              />
            )}

            <AppFooter api={api} update={update} pinned={settingsOpen} />
          </main>
        </div>
      </ToastProvider>
    </AppStatusProvider>
  );
}
