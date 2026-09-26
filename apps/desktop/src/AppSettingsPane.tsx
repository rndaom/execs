import { ArrowSquareOut, Copy, FolderOpen, Info } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { InstallHealthPanel } from "./components/InstallHealth";
import { Alert } from "./components/ui/Alert";
import { Disclosure } from "./components/ui/Disclosure";
import { PaneHeader } from "./components/ui/PaneHeader";
import { Segmented } from "./components/ui/Segmented";
import { Loading, Spinner } from "./components/ui/Spinner";
import { Switch } from "./components/ui/Switch";
import { useToast } from "./components/ui/Toast";
import type { AppPreferencesState } from "./hooks/useAppPreferences";
import type { AppUpdateState } from "./hooks/useAppUpdate";
import { useCopyFeedback } from "./hooks/useCopyFeedback";
import type { Api } from "./lib/api";
import {
  APP_NOTICES_URL,
  APP_RELEASES_URL,
  APP_SUPPORT_URL,
  type AppPreferences,
  MOTION_OPTIONS,
} from "./lib/app-settings-ui";
import { invokeErrorMessage } from "./lib/bridge";
import { copyButtonLabel } from "./lib/copy-ui";
import { releaseVersionCopy, updateProgressCopy } from "./lib/updater-ui";

export type AppSettingsPaneProps = {
  api: Api;
  settings: AppPreferencesState;
  update: AppUpdateState;
  confirmedRoot: string | null;
  onChangeInstall: () => void;
  changeInstallDisabled?: boolean;
  changeInstallReason?: string | null;
  backAction?: ReactNode;
  /** Preference writes wait for the native close listener. Reads remain usable. */
  ready?: boolean;
};

function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="surface grid min-w-0 gap-3 px-4 py-3 md:grid-cols-[minmax(160px,0.5fr)_minmax(0,1fr)] md:gap-5"
    >
      <div>
        <h2 id={id} className="t-section">
          {title}
        </h2>
        {description ? <p className="t-meta mt-1.5 max-w-[28ch]">{description}</p> : null}
      </div>
      <div className="min-w-0 md:border-l md:border-edge md:pl-5">{children}</div>
    </section>
  );
}

/** App-wide controls stay outside profile/gameplay settings and their write lock. */
export function AppSettingsPane({
  api,
  settings,
  update,
  confirmedRoot,
  onChangeInstall,
  changeInstallDisabled = false,
  changeInstallReason = null,
  backAction,
  ready = true,
}: AppSettingsPaneProps) {
  const installation = useCopyFeedback();
  const storage = useCopyFeedback();
  const diagnostics = useCopyFeedback();
  const toast = useToast();
  const [actionError, setActionError] = useState<string | null>(null);
  const [readingDiagnostics, setReadingDiagnostics] = useState(false);
  const preferences = settings.data?.preferences;
  // Persistence never disables the focused preference control. The hook
  // serializes quick edits, so keyboard focus and the latest choice survive.
  const preferencesDisabled = !ready || !preferences || settings.loading;

  async function persistPreferences(write: () => Promise<void>) {
    if (!ready) return;
    toast.startSave("app:preferences");
    try {
      await write();
      toast.finishSave("App settings saved", "app:preferences");
    } catch (err) {
      toast.failSave(err, "Could not save app settings", "app:preferences");
    }
  }

  function savePreferences(patch: Partial<AppPreferences>) {
    void persistPreferences(() => settings.save(patch));
  }

  async function openLink(url: string) {
    try {
      await api.openExternal(url);
      setActionError(null);
    } catch (err) {
      setActionError(invokeErrorMessage(err));
    }
  }

  async function copyDiagnostics() {
    setReadingDiagnostics(true);
    try {
      const text = await api.getDiagnostics();
      await diagnostics.copy(text);
      setActionError(null);
    } catch (err) {
      setActionError(invokeErrorMessage(err));
    } finally {
      setReadingDiagnostics(false);
    }
  }

  return (
    <div data-testid="app-settings" className="min-w-0 text-left">
      <PaneHeader
        title="App settings"
        actions={
          <>
            <span className="t-meta mr-2 flex items-center gap-2">
              <Info size={16} aria-hidden="true" />
              {update.version ? `execs ${releaseVersionCopy(update.version)}` : "execs"}
            </span>
            {backAction}
          </>
        }
      />

      {settings.error ? (
        <Alert className="mb-6" testId="app-settings-error">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>{settings.error}</span>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                settings.data ? void persistPreferences(settings.retry) : void settings.retry()
              }
              disabled={settings.loading || settings.saving || (!ready && !!settings.data)}
            >
              Retry app settings
            </button>
          </span>
        </Alert>
      ) : null}
      {actionError ? <Alert className="mb-6">{actionError}</Alert> : null}

      <div className="space-y-3" aria-busy={settings.loading || settings.saving}>
        <SettingsSection id="app-appearance" title="Appearance">
          <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
            <span className="t-row">Motion</span>
            <Segmented
              label="Motion"
              options={MOTION_OPTIONS}
              value={preferences?.motion ?? "system"}
              disabled={preferencesDisabled}
              testIdPrefix="app-motion"
              onChange={(motion) => savePreferences({ motion })}
            />
          </div>
          <p className="t-meta mt-2">
            Follow system respects your device’s reduced motion setting. Reduce turns off
            transitions in execs.
          </p>
        </SettingsSection>

        <SettingsSection id="app-updates" title="Updates">
          <div className="flex min-h-8 items-center justify-between gap-4">
            <span className="t-row">Check for updates on startup</span>
            <Switch
              label="Check for updates on startup"
              checked={preferences?.checkForUpdatesOnStartup ?? true}
              disabled={preferencesDisabled}
              testId="app-startup-updates"
              onChange={(checkForUpdatesOnStartup) => savePreferences({ checkForUpdatesOnStartup })}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="app-settings-update-check"
              disabled={update.checking || update.progress !== null}
              onClick={() => void update.check()}
            >
              {update.checking ? <Loading>Checking for updates…</Loading> : "Check for updates"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void openLink(APP_RELEASES_URL)}
            >
              Release notes <ArrowSquareOut size={15} aria-hidden="true" />
            </button>
          </div>
          <p className="t-meta mt-2" aria-live="polite" data-testid="app-settings-update-status">
            {update.progress
              ? `${updateProgressCopy(update.progress)} update…`
              : update.checkMessage ||
                (update.available
                  ? `execs ${releaseVersionCopy(update.available.version)} is available. Install when you’re ready.`
                  : "Updates install only when you choose Install.")}
          </p>
        </SettingsSection>

        <SettingsSection id="app-installation" title="TF2 installation">
          <p className="t-body break-all text-ink-muted" data-testid="app-install-location">
            {confirmedRoot ?? "No TF2 folder confirmed yet."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="app-change-install"
              disabled={changeInstallDisabled}
              aria-describedby={changeInstallReason ? "app-change-install-reason" : undefined}
              onClick={onChangeInstall}
            >
              <FolderOpen size={16} aria-hidden="true" />
              {confirmedRoot ? "Change install" : "Find TF2"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!confirmedRoot}
              onClick={() => confirmedRoot && void installation.copy(confirmedRoot)}
            >
              <Copy size={15} aria-hidden="true" />
              <span aria-live="polite">
                {copyButtonLabel(installation.feedback, "Copy install location")}
              </span>
            </button>
          </div>
          {changeInstallReason ? (
            <p className="t-meta mt-2" id="app-change-install-reason">
              {changeInstallReason}
            </p>
          ) : null}
        </SettingsSection>

        <SettingsSection
          id="app-storage"
          title="App data"
          description="Profiles, preferences and logs."
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <p className="t-body min-w-0 break-all text-ink-muted" data-testid="app-data-location">
              {settings.data?.dataDirectory ??
                (settings.loading ? (
                  <Loading>Reading app data location…</Loading>
                ) : (
                  "App data location unavailable."
                ))}
            </p>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!settings.data?.dataDirectory}
              onClick={() => settings.data && void storage.copy(settings.data.dataDirectory)}
            >
              <Copy size={15} aria-hidden="true" />
              <span aria-live="polite">
                {copyButtonLabel(storage.feedback, "Copy data location")}
              </span>
            </button>
          </div>
        </SettingsSection>

        <SettingsSection
          id="app-health"
          title="Health"
          description="What execs can check on this computer, without changing anything."
        >
          <InstallHealthPanel api={api} />
        </SettingsSection>

        <SettingsSection id="app-support" title="Support">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={readingDiagnostics}
              onClick={() => void copyDiagnostics()}
            >
              {readingDiagnostics ? <Spinner size={15} /> : <Copy size={15} aria-hidden="true" />}
              <span aria-live="polite">
                {readingDiagnostics
                  ? "Reading diagnostics…"
                  : copyButtonLabel(diagnostics.feedback, "Copy diagnostics")}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void openLink(APP_SUPPORT_URL)}
            >
              Report a bug <ArrowSquareOut size={15} aria-hidden="true" />
            </button>
          </div>
          <p className="t-meta mt-2">
            Diagnostics include your install path and active profile name.
          </p>
          <Disclosure
            profileId={null}
            storageKey="app-credits"
            summary="Credits and third-party notices"
            className="mt-4"
          >
            <div className="mt-3 space-y-3">
              <p className="t-meta">
                Built with the TF2 community: mastercomfig, hud-db, TF2HUD.Editor, casual-pre-loader
                and GameBanana. Previously built viewmodel packs used CompVMInstaller; previously
                installed Venom Crosshairs, TF2Hitsounds and comfig.app sounds remain credited.
              </p>
              <p className="t-meta">
                Inter by Rasmus Andersson. Icons by Phosphor. execs is a fan project and is not
                affiliated with Valve or Steam.
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void openLink(APP_NOTICES_URL)}
              >
                Read full notices <ArrowSquareOut size={15} aria-hidden="true" />
              </button>
            </div>
          </Disclosure>
        </SettingsSection>
      </div>
    </div>
  );
}
