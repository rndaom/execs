import { useCallback, useState } from "react";
import { AppFooter } from "./components/AppFooter";
import { FinderPanel } from "./components/FinderPanel";
import { ReadyPanel } from "./components/ReadyPanel/ReadyPanel";
import { SwitchProgressList } from "./components/SwitchProgressList";
import { UpdateBanner } from "./components/UpdateBanner";
import { WriteLockBanner } from "./components/WriteLockBanner";
import { FirstRunExisting } from "./FirstRunExisting";
import { AppStatusProvider } from "./hooks/useAppStatus";
import { useAppUpdate } from "./hooks/useAppUpdate";
import { useFirstRun } from "./hooks/useFirstRun";
import { useProfileLibrary } from "./hooks/useProfileLibrary";
import { useSwitchProgress } from "./hooks/useSwitchProgress";
import { useTf2Install } from "./hooks/useTf2Install";
import { useWriteLock } from "./hooks/useWriteLock";
import type { Api } from "./lib/api";
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
  const [draftName, setDraftName] = useState("");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(
    () => previewSettingsTab(preview) ?? "comfig",
  );

  const lock = useWriteLock(api);
  const progress = useSwitchProgress(api, preview === "switch" ? previewSwitchStep() : null);
  const anyBusy = busy || settingsBusy;

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

  const update = useAppUpdate(api, {
    setError,
    seedProgress: previewUpdateProgress(preview),
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
  const wideOnboarding =
    install.screen === "ready" &&
    install.confirmed !== null &&
    (surface === "first-unused" || creating);

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
          />
          {isCreate ? null : (
            <button
              type="button"
              onClick={install.change}
              disabled={busy || progress.state.active}
              className="btn btn-ghost mt-6"
            >
              Change
            </button>
          )}
        </>
      );
    }
    if (surface === "loading") {
      return (
        <section className="flex w-full flex-col items-center text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">execs</h1>
          <p className="mt-6 text-sm text-ink-muted">Checking this install…</p>
          <button type="button" onClick={install.change} className="btn btn-ghost mt-6">
            Change
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
        settings={
          showSettingsChrome(profiles.library) ? (
            <SettingsLayout tab={settingsTab} onTab={setSettingsTab}>
              <SettingsHost
                api={api}
                tab={settingsTab}
                running={lock.running}
                externalBusy={busy || progress.state.active}
                refreshKey={profiles.refreshKey}
                bindSyncRequest={profiles.bindSyncRequest}
                onBindSyncHandled={profiles.onBindSyncHandled}
                onBusyChange={setSettingsBusy}
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
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-ink">
        <WriteLockBanner running={lock.running} degraded={lock.degraded ?? progress.degraded} />
        <UpdateBanner update={update} />

        <main
          className={`flex min-h-0 w-full flex-1 flex-col ${
            settingsOpen
              ? "items-stretch overflow-hidden"
              : `mx-auto items-center justify-start overflow-y-auto px-6 py-10 ${
                  wideOnboarding ? "max-w-6xl" : "max-w-xl"
                }`
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

          <AppFooter update={update} pinned={settingsOpen} />
        </main>
      </div>
    </AppStatusProvider>
  );
}
