import { useEffect, useMemo, useRef, useState } from "react";
import { GameBananaBrowser } from "./components/GameBananaBrowser";
import { ModImport } from "./components/ModImport";
import { ModList } from "./components/ModList";
import { Alert } from "./components/ui/Alert";
import { ClassTabs } from "./components/ui/ClassTabs";
import { Disclosure } from "./components/ui/Disclosure";
import { Modal } from "./components/ui/Modal";
import { PaneHeader } from "./components/ui/PaneHeader";
import { PaneSection } from "./components/ui/PaneSection";
import { Switch, SwitchRow } from "./components/ui/Switch";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { useExplicitDraft } from "./hooks/useExplicitDraft";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import type { Api } from "./lib/api";
import type {
  CatalogAddon,
  CatalogParticleMod,
  ModRecord,
  ModsCatalog,
  ParticleSource,
  PreloaderReport,
  PreloaderStatusPayload,
} from "./lib/bridge";
import {
  formatModBytes,
  installedModSelection,
  type ModInstallResult,
  type ModSelection,
  modDomId,
  modsApplyEnabled,
  modsStatusLine,
  PRELOADER_CREDIT,
  REPAIR_TIMEOUT_MS,
  type RepairState,
  repairActionDisabled,
  repairPollDelay,
  repairReadyForConfirmation,
  repairStateAfterBackendRead,
  selectionDirty,
  serializeModSelection,
  summarizeReport,
  toggleName,
  visibleModSelection,
} from "./lib/mods-ui";

export type ModsPaneProps = {
  api: Api;
  /** Whether the retained Mods pane is the visible pane. */
  active: boolean;
  previewData?: boolean;
  /** Active profile; draft selection is remembered per profile. */
  profileId: string | null;
  payload: PreloaderStatusPayload | null;
  catalog: ModsCatalog | null;
  /** The active profile's own packs; absent on an older backend. */
  mods: ModRecord[];
  loading: boolean;
  report: PreloaderReport | null;
  onDownloadLibrary: () => void;
  onApply: (addons: string[], particleMods: string[], profileParticleMods: string[]) => void;
  onToggleBypass: (enabled: boolean) => void;
  onTogglePreload: (enabled: boolean) => void;
  onRevert: () => void;
  /** Finish a crash-interrupted preloader transaction without changing selection. */
  onRecover: () => void;
  /** Start Steam's verify; the pane polls `onRefreshStatus` until it finishes. */
  onRepair: () => Promise<void>;
  /** User-confirmed completion; backend also requires a stable clean interval. */
  onCompleteRepair: (selection: ModSelection) => Promise<boolean>;
  /** Escape a cancelled verify only after Steam and TF2 are both closed. */
  onCancelRepair: () => Promise<boolean>;
  onRefreshStatus: () => Promise<void>;
  onOpenRepo: () => void;
  onImportArchive: () => void;
  onImportFolder: () => void;
  onRemoveMod: (id: string) => void;
  /** Resolves once the install and the profile reload behind it finished. */
  onInstallGameBananaMod: (id: number) => Promise<ModInstallResult>;
  /** A refused mod payload that must use the HUD replacement review. */
  hudImportRequired?: string | null;
  onReviewHudImport?: () => void;
  onDismissHudImport?: () => void;
};

type ModsTask = "browse" | "installed" | "casual";

export function ModsPane({
  api,
  active,
  previewData = false,
  profileId,
  payload,
  catalog,
  mods,
  loading,
  report,
  onDownloadLibrary,
  onApply,
  onToggleBypass,
  onTogglePreload,
  onRevert,
  onRecover,
  onRepair,
  onCompleteRepair,
  onCancelRepair,
  onRefreshStatus,
  onOpenRepo,
  onImportArchive,
  onImportFolder,
  onRemoveMod,
  onInstallGameBananaMod,
  hudImportRequired,
  onReviewHudImport,
  onDismissHudImport,
}: ModsPaneProps) {
  const { running, busy } = useAppStatus();
  const canWrite = useCanWrite();
  const status = payload?.status ?? null;
  // A profile reload and its preloader status arrive independently. Never
  // offer an old status row after the active profile's own mod list changes.
  const particleSources = useMemo(
    () =>
      (payload?.profileParticleSources ?? []).filter((source) =>
        mods.some((mod) => mod.id === source.modId),
      ),
    [mods, payload],
  );
  const installed = useMemo<ModSelection>(
    () => visibleModSelection(installedModSelection(payload), particleSources),
    [payload, particleSources],
  );
  const [draft, setSelection] = useSeededDraft(
    installed,
    serializeModSelection,
    draftRecordKey(profileId, "mods"),
  );
  // Removing a pack takes its rows with it; a pick left behind would keep Apply
  // lit over something nothing on screen can switch off.
  const selection = visibleModSelection(draft, particleSources);
  const { addons, particleMods, profileParticleMods } = selection;
  const [task, setTask] = useState<ModsTask>("browse");
  const [confirmRestore, setConfirmRestore] = useState(false);
  // Steam's verify runs outside the app; while it does, poll the status and,
  // once every stale file reads as stock again, put the selection back.
  const [repair, setRepair] = useState<RepairState>("idle");
  const repairStarted = useRef(0);
  const repairStartPending = useRef(false);
  const repairSelection = useRef<ModSelection>(installed);
  const locked =
    !canWrite ||
    payload?.repairInProgress === true ||
    payload?.recoveryRequired === true ||
    repair === "waiting";
  const canApply = modsApplyEnabled(payload, selection);
  const dirty = selectionDirty(payload, selection);
  useExplicitDraft(dirty);
  const showApply = dirty || status?.stale === true;
  const untracked = status?.untrackedModified ?? [];
  const hasRepair = untracked.length > 0 || payload?.repairInProgress || repair === "waiting";
  const needsSteamLaunch = payload?.profilePreload && !payload.preloadLaunchInSteam;
  useEffect(() => {
    if (!active || task !== "casual") setConfirmRestore(false);
  }, [active, task]);

  // The backend owns verification state so navigation/remounts cannot unlock
  // the app while Steam is still mutating game files.
  useEffect(() => {
    if (payload?.repairInProgress && repair === "idle") {
      repairStarted.current = Date.now();
      repairSelection.current = installed;
      setRepair("waiting");
    }
  }, [installed, payload?.repairInProgress, repair]);

  useEffect(() => {
    if (!payload) {
      return;
    }
    const reconciled = repairStateAfterBackendRead(
      repair,
      payload.repairInProgress === true,
      repairStartPending.current,
    );
    if (reconciled !== repair) {
      setRepair(reconciled);
    }
  }, [payload, repair]);

  useEffect(() => {
    const delay = repairPollDelay(repair);
    if (delay === null) {
      return;
    }
    if (repairReadyForConfirmation(payload)) {
      // A clean scan is only readiness for explicit confirmation. Steam can
      // restore the affected VPK before its external verify job has ended.
      return;
    }
    if (repair === "waiting" && Date.now() - repairStarted.current > REPAIR_TIMEOUT_MS) {
      setRepair("timeout");
      return;
    }
    const timer = window.setTimeout(() => {
      void onRefreshStatus().catch(() => {});
    }, delay);
    return () => window.clearTimeout(timer);
  }, [repair, payload, onRefreshStatus]);

  async function startRepair() {
    repairStartPending.current = true;
    repairStarted.current = Date.now();
    repairSelection.current = selection;
    setRepair("waiting");
    try {
      await onRepair();
    } catch {
      setRepair("idle");
    } finally {
      repairStartPending.current = false;
    }
  }

  async function finishRepair() {
    setRepair("confirming");
    try {
      const want = visibleModSelection(repairSelection.current, particleSources);
      if (!(await onCompleteRepair(want))) {
        setRepair("waiting");
        return;
      }
      setRepair("done");
    } catch {
      // A lost response may follow a successful backend clear. The refreshed
      // payload reconciles this to waiting again only if the marker remains.
      setRepair("idle");
    }
  }

  async function cancelRepair() {
    try {
      if (await onCancelRepair()) {
        setRepair("idle");
      }
    } catch {
      // SettingsHost presents the structured reason (usually SteamRunning).
      setRepair("idle");
    }
  }
  const anythingInstalled =
    (status?.patchedFiles.length ?? 0) > 0 ||
    (status?.addons.length ?? 0) > 0 ||
    status?.customVpkPresent === true ||
    status?.gameinfoBypassed === true;

  return (
    <div data-testid="settings-mods" className="min-w-0 text-left">
      <PaneHeader
        compact
        title="Mods"
        lede="Find, install, and prepare profile mods."
        actions={
          <ModImport
            active={active}
            locked={locked}
            onImportArchive={onImportArchive}
            onImportFolder={onImportFolder}
          />
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-edge">
        <ClassTabs
          tabs={[
            { id: "browse", label: "Browse" },
            { id: "installed", label: "Installed", meta: mods.length },
            { id: "casual", label: "Casual setup", meta: dirty ? "Draft" : undefined },
          ]}
          selected={task}
          label="Mod tasks"
          idPrefix="mods-task"
          panelId="mods-task-panel"
          onSelect={setTask}
        />
        {task !== "casual" && hasRepair ? (
          <button
            type="button"
            data-testid="mods-repair-notice"
            className="btn btn-quiet mb-1 gap-2"
            onClick={() => setTask("casual")}
          >
            <WarningCircle size={16} className="text-warn" />
            {payload?.repairInProgress
              ? "Review Steam verification"
              : `${untracked.length} Casual ${untracked.length === 1 ? "repair" : "repairs"} to review`}
          </button>
        ) : null}
        {task === "casual" ? (
          <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1 pb-3">
            <Stat label="Preload" value={payload ? (payload.profilePreload ? "On" : "Off") : "—"} />
            <Stat label="Patched files" value={status ? String(status.patchedFiles.length) : "—"} />
          </dl>
        ) : null}
      </div>

      {hudImportRequired ? (
        <Alert tone="warn" testId="mods-hud-import-required" className="mt-4">
          <span className="block font-medium">This pack needs HUD review</span>
          <span className="mt-1 block">{hudImportRequired}</span>
          <span className="t-meta mt-1 block">
            Open HUD, then choose Import HUD and select the intended source again to review the
            replacement.
          </span>
          <span className="mt-3 flex flex-wrap gap-2">
            {onReviewHudImport ? (
              <button type="button" className="btn btn-ghost" onClick={onReviewHudImport}>
                Review in HUD
              </button>
            ) : null}
            {onDismissHudImport ? (
              <button type="button" className="btn btn-quiet" onClick={onDismissHudImport}>
                Dismiss
              </button>
            ) : null}
          </span>
        </Alert>
      ) : null}

      {task !== "casual" && dirty ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-edge pb-3">
          <p className="t-meta">Your Casual selection has unapplied changes.</p>
          <button type="button" className="btn btn-quiet" onClick={() => setTask("casual")}>
            Review selection
          </button>
        </div>
      ) : null}

      {payload?.recoveryRequired ? (
        <Alert tone="warn" testId="mods-recovery-required" className="mt-6">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>An interrupted mod change must finish before other files can be changed.</span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!canWrite || payload.repairInProgress === true}
              onClick={onRecover}
            >
              Finish recovery
            </button>
          </span>
        </Alert>
      ) : null}

      {status?.stale ? (
        <Alert tone="warn" testId="mods-stale" className="mt-4">
          <span className="flex flex-wrap items-center justify-between gap-3">
            <span>TF2 updated — the old patches are gone. Apply again to re-install them.</span>
            <button type="button" className="btn btn-ghost" onClick={() => setTask("casual")}>
              Open Casual setup
            </button>
          </span>
        </Alert>
      ) : null}
      {task === "casual" && hasRepair ? (
        <section data-testid="mods-repair" className="surface mt-4 border-warn/30 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
            <div className="min-w-0 max-w-[62ch]">
              <h2 className="t-row">
                {repair === "confirming"
                  ? "Confirming Steam is finished"
                  : payload?.repairInProgress && untracked.length === 0
                    ? "Finish Steam verification"
                    : repair === "waiting"
                      ? "Waiting for Steam to verify"
                      : `${untracked.length} particle ${untracked.length === 1 ? "file needs" : "files need"} a repair`}
              </h2>
              <p className="t-meta mt-1">
                {repair === "confirming"
                  ? "Checking that TF2's official files stay unchanged before unlocking writes."
                  : payload?.repairInProgress && untracked.length === 0
                    ? "Wait until Steam says verification is complete, then confirm here. execs checks again before unlocking writes."
                    : repair === "waiting"
                      ? "Keep the game closed. Confirm here only after Steam reports verification complete."
                      : repair === "timeout"
                        ? "Steam has not finished. Keep waiting, or close Steam and cancel the repair lock if you stopped it."
                        : "Patched by an earlier install with no snapshot to restore. Repair asks Steam to verify TF2, then re-applies your selection."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {payload?.repairInProgress && untracked.length === 0 ? (
                <button
                  type="button"
                  data-testid="mods-repair-complete"
                  className="btn btn-primary"
                  disabled={running || repair === "confirming"}
                  onClick={() => void finishRepair()}
                >
                  {repair === "confirming" ? "Checking…" : "Steam says it’s finished"}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="mods-repair-button"
                  className="btn btn-primary"
                  disabled={repairActionDisabled(
                    running,
                    busy,
                    payload?.repairInProgress === true,
                    repair,
                  )}
                  onClick={() => void startRepair()}
                >
                  {payload?.repairInProgress || repair === "waiting"
                    ? "Verifying…"
                    : "Repair with Steam"}
                </button>
              )}
              {payload?.repairInProgress ? (
                <button
                  type="button"
                  data-testid="mods-repair-cancel"
                  className="btn btn-ghost"
                  disabled={running || repair === "confirming"}
                  onClick={() => void cancelRepair()}
                >
                  Cancel repair lock
                </button>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}
      {status && !status.gameinfoFound ? (
        <Alert tone="error" testId="mods-no-gameinfo" className="mt-6">
          gameinfo.txt not found — check the TF2 folder.
        </Alert>
      ) : null}

      <div
        id="mods-task-panel"
        role="tabpanel"
        aria-labelledby={`mods-task-${task}`}
        className="mt-4"
      >
        <div hidden={task !== "browse"}>
          <GameBananaBrowser
            api={api}
            active={active && task === "browse"}
            installed={mods}
            locked={locked}
            running={running}
            previewData={previewData}
            onInstall={onInstallGameBananaMod}
            onManageInstalled={() => setTask("installed")}
          />
        </div>

        <div hidden={task !== "installed"}>
          <ModList
            first
            active={active && task === "installed"}
            showImport={false}
            mods={mods}
            locked={locked}
            running={running}
            onImportArchive={onImportArchive}
            onImportFolder={onImportFolder}
            onRemove={onRemoveMod}
            selectedParticleMods={installed.profileParticleMods}
            onManageParticles={() => setTask("casual")}
            onBrowse={() => setTask("browse")}
          />
        </div>

        <div hidden={task !== "casual"}>
          {needsSteamLaunch ? (
            <Alert tone="warn" testId="mods-launch-warning" className="mb-4">
              <span className="flex flex-wrap items-center justify-between gap-3">
                <span className="min-w-56 flex-1">
                  The preload launch option has not reached Steam. Close Steam fully, then retry the
                  launch setup.
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={locked}
                  onClick={() => onTogglePreload(true)}
                >
                  Retry launch setup
                </button>
              </span>
            </Alert>
          ) : null}
          <section aria-label="Casual behavior" id="mods-casual">
            <div>
              <SwitchRow
                id="mods-profile-preload"
                testId="mods-profile-preload"
                label="Preload on launch"
                description="Opens the offline itemtest map, then returns to the menu. Saves immediately."
                checked={payload?.profilePreload ?? false}
                disabled={locked || !payload}
                onChange={onTogglePreload}
              />
              <SwitchRow
                id="mods-bypass-toggle"
                testId="mods-bypass-toggle"
                label="Material bypass"
                description="Keeps preloaded materials live on sv_pure; edits one line in gameinfo.txt, backed up first."
                checked={status?.gameinfoBypassed ?? false}
                disabled={locked || !status?.gameinfoFound}
                onChange={onToggleBypass}
              />
            </div>
          </section>

          <PaneSection
            title="Casual selection"
            description="Choose sources, then Apply mods."
            meta={
              payload && !payload.modsCached ? (
                <button
                  type="button"
                  data-testid="mods-download"
                  className="btn btn-primary"
                  disabled={busy || loading}
                  onClick={onDownloadLibrary}
                >
                  {loading
                    ? "Downloading…"
                    : `Download library (${formatModBytes(payload.modsSizeBytes)})`}
                </button>
              ) : null
            }
          >
            {payload && !payload.modsCached && !loading ? (
              <p className="t-meta mt-4">One-time download, verified and cached.</p>
            ) : null}
            {loading && !catalog ? (
              <p className="t-meta mt-4" role="status">
                Loading library…
              </p>
            ) : null}

            <div className="mt-4 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="min-w-0">
                {catalog ? (
                  <div className="grid gap-5">
                    <Disclosure
                      profileId={profileId}
                      storageKey="mods-addons"
                      summary={
                        <span>
                          Addons <span className="t-meta ml-2">{addons.length} selected</span>
                        </span>
                      }
                    >
                      <div>
                        <p className="t-meta mt-2">
                          From cueki’s default library, packed into your preload addon.
                        </p>
                        <ul className="mt-3 list-none p-0">
                          {catalog.addons.map((addon) => (
                            <AddonRow
                              key={addon.id}
                              addon={addon}
                              checked={addons.includes(addon.id)}
                              disabled={
                                !payload ||
                                busy ||
                                payload.repairInProgress === true ||
                                payload.recoveryRequired === true
                              }
                              onToggle={() =>
                                setSelection((current) => ({
                                  ...current,
                                  addons: toggleName(current.addons, addon.id),
                                }))
                              }
                            />
                          ))}
                        </ul>
                      </div>
                    </Disclosure>
                    <Disclosure
                      profileId={profileId}
                      storageKey="mods-particles"
                      defaultOpen
                      summary={
                        <span>
                          Particle sources{" "}
                          <span className="t-meta ml-2">{particleMods.length} selected</span>
                        </span>
                      }
                    >
                      <div>
                        <p className="t-meta mt-2">
                          Stock files are backed up before patching. Later picks win overlapping
                          files.
                        </p>
                        <ul className="mt-3 list-none p-0">
                          {catalog.particleMods.map((mod) => (
                            <ParticleRow
                              key={mod.name}
                              mod={mod}
                              checked={particleMods.includes(mod.name)}
                              disabled={
                                !payload ||
                                busy ||
                                payload.repairInProgress === true ||
                                payload.recoveryRequired === true
                              }
                              onToggle={() =>
                                setSelection((current) => ({
                                  ...current,
                                  particleMods: toggleName(current.particleMods, mod.name),
                                }))
                              }
                            />
                          ))}
                        </ul>
                      </div>
                    </Disclosure>
                  </div>
                ) : null}

                {/* Particles the user's own packs bring: same patching, same Apply. */}
                {particleSources.length > 0 ? (
                  <div data-testid="mods-profile-particles" className="mt-6">
                    <h3 className="eyebrow">From your mods</h3>
                    <ul className="mt-3 list-none p-0">
                      {particleSources.map((source) => (
                        <ProfileParticleRow
                          key={source.modId}
                          source={source}
                          checked={profileParticleMods.includes(source.modId)}
                          disabled={
                            !payload ||
                            busy ||
                            payload.repairInProgress === true ||
                            payload.recoveryRequired === true
                          }
                          onToggle={() =>
                            setSelection((current) => ({
                              ...current,
                              profileParticleMods: toggleName(
                                current.profileParticleMods,
                                source.modId,
                              ),
                            }))
                          }
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <aside className="surface min-w-0 p-4" aria-label="Selected Casual sources">
                <h3 className="t-row">
                  {!payload
                    ? "Selection unavailable"
                    : selectionDirty(payload, selection)
                      ? "Ready to apply"
                      : "Applied selection"}
                </h3>
                {addons.length + particleMods.length + profileParticleMods.length > 0 ? (
                  <ul className="t-meta mt-3 list-none space-y-3 p-0">
                    {addons.map((name) => (
                      <li key={`addon-${name}`}>
                        <span className="block text-ink">
                          {catalog?.addons.find((addon) => addon.id === name)?.name ?? name}
                        </span>
                        <span>Addon</span>
                      </li>
                    ))}
                    {particleMods.map((name) => (
                      <li key={`particle-${name}`}>
                        <span className="block text-ink">{name.replace(/_/g, " ")}</span>
                        <span>Library particles</span>
                      </li>
                    ))}
                    {profileParticleMods.map((id) => (
                      <li key={`profile-${id}`}>
                        <span className="block text-ink">
                          {particleSources.find((source) => source.modId === id)?.name ?? id}
                        </span>
                        <span>Installed mod particles</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="t-meta mt-2">
                    {payload
                      ? "No addon or particle changes selected."
                      : "Waiting for this profile’s installed selection."}
                  </p>
                )}
                {selectionDirty(payload, selection) ? (
                  <button
                    type="button"
                    className="btn btn-quiet mt-4"
                    disabled={busy}
                    onClick={() => setSelection(installed)}
                  >
                    Reset selection
                  </button>
                ) : null}
                <div className="mt-4 grid gap-2 border-t border-edge pt-3">
                  {showApply ? (
                    <>
                      <button
                        type="button"
                        data-testid="mods-apply"
                        className="btn btn-primary w-full"
                        disabled={locked || !canApply}
                        onClick={() => onApply(addons, particleMods, profileParticleMods)}
                      >
                        {running ? "Close TF2 to apply" : "Apply mods"}
                      </button>
                      <p className="t-meta" aria-live="polite">
                        {modsStatusLine(payload, selection, running)}
                      </p>
                    </>
                  ) : null}
                  <button
                    type="button"
                    data-testid="mods-revert"
                    className="btn btn-ghost w-full"
                    disabled={locked || !anythingInstalled}
                    onClick={() => setConfirmRestore(true)}
                  >
                    Restore stock files
                  </button>
                  <p className="t-meta">
                    Applying turns Preload on. Restore keeps your installed mod packs.
                  </p>
                </div>
              </aside>
            </div>
          </PaneSection>

          {report ? (
            <section className="section" data-testid="mods-report">
              <h2 className="t-section">Last install</h2>
              <p className="t-meta mt-1" aria-live="polite">
                {summarizeReport(report)}
              </p>
              {report.skipped.length > 0 ? (
                <ul className="t-meta mt-3 list-none space-y-2 p-0 break-words">
                  {report.skipped.map((notice) => (
                    <li key={`${notice.modName}-${notice.file}-${notice.reason}`}>
                      {notice.file}
                      {notice.modName ? ` (${notice.modName})` : ""} — {notice.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : status && status.skipped.length > 0 ? (
            <section className="section">
              <h2 className="t-section">Skipped last time</h2>
              <ul className="t-meta mt-3 list-none space-y-2 p-0 break-words">
                {status.skipped.map((notice) => (
                  <li key={`${notice.modName}-${notice.file}-${notice.reason}`}>
                    {notice.file}
                    {notice.modName ? ` (${notice.modName})` : ""} — {notice.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="t-meta mt-8">
            {PRELOADER_CREDIT}{" "}
            <button
              type="button"
              className="cursor-pointer border-0 bg-transparent p-0 text-ink-muted underline decoration-edge-strong underline-offset-2 hover:text-ink"
              onClick={onOpenRepo}
            >
              casual-pre-loader on GitHub
            </button>
          </p>
        </div>
      </div>
      <Modal
        open={confirmRestore && active && task === "casual"}
        role="alertdialog"
        testId="mods-restore-confirm"
        title="Restore stock files?"
        description="This restores the original particle files, reverses the material bypass and removes the Casual addon pack. Your installed mods remain in this profile."
        className="fixed top-24 left-1/2 z-50 w-[min(460px,calc(100vw-2.5rem))] -translate-x-1/2"
        onClose={() => setConfirmRestore(false)}
      >
        <div className="mt-5 flex justify-end gap-2 border-t border-edge pt-4">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmRestore(false)}>
            Cancel
          </button>
          <button
            type="button"
            data-testid="mods-restore-confirm-yes"
            className="btn btn-primary"
            disabled={locked || !anythingInstalled}
            onClick={() => {
              if (locked || !anythingInstalled) return;
              setConfirmRestore(false);
              onRevert();
            }}
          >
            Restore stock files
          </button>
        </div>
      </Modal>
    </div>
  );
}

function AddonRow({
  addon,
  checked,
  disabled,
  onToggle,
}: {
  addon: CatalogAddon;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const id = `mods-addon-${addon.id.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <li className="border-b border-edge py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="t-row">{addon.name}</span>
            <span className="badge">{addon.kind}</span>
            <span className="tnum text-[12px] text-ink-faint">{formatModBytes(addon.bytes)}</span>
          </span>
          {addon.description ? (
            <span className="t-meta mt-0.5 block">{addon.description}</span>
          ) : null}
          {addon.hasSound ? (
            <span className="mt-0.5 block text-[12px] leading-5 text-ink-faint">
              Includes sounds — best-effort on sv_pure.
            </span>
          ) : null}
        </span>
        <Switch
          checked={checked}
          disabled={disabled}
          label={addon.name}
          testId={id}
          onChange={onToggle}
        />
      </div>
    </li>
  );
}

function ParticleRow({
  mod,
  checked,
  disabled,
  onToggle,
}: {
  mod: CatalogParticleMod;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const id = `mods-particle-${mod.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const preview = mod.pcfFiles.slice(0, 3).map((file) => file.replace(/\.pcf$/, ""));
  const more = mod.pcfFiles.length - preview.length;
  return (
    <li className="border-b border-edge py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="t-row">{mod.name.replace(/_/g, " ")}</span>
            <span className="tnum text-[12px] text-ink-faint">
              {mod.pcfFiles.length} particle {mod.pcfFiles.length === 1 ? "file" : "files"} ·{" "}
              {formatModBytes(mod.bytes)}
            </span>
          </span>
          <span className="t-meta mt-0.5 block">
            {preview.join(", ")}
            {more > 0 ? ` and ${more} more` : ""}
          </span>
        </span>
        <Switch
          checked={checked}
          disabled={disabled}
          label={mod.name.replace(/_/g, " ")}
          testId={id}
          onChange={onToggle}
        />
      </div>
    </li>
  );
}

function ProfileParticleRow({
  source,
  checked,
  disabled,
  onToggle,
}: {
  source: ParticleSource;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const count = source.pcfFiles.length;
  return (
    <li className="border-b border-edge py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="t-row block truncate">{source.name}</span>
          <span className="t-meta mt-0.5 block">
            {count} particle {count === 1 ? "file" : "files"}
          </span>
        </span>
        <Switch
          checked={checked}
          disabled={disabled}
          label={source.name}
          testId={`mods-profile-particle-${modDomId(source.modId)}`}
          onChange={onToggle}
        />
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="t-meta">{label}</dt>
      <dd className="tnum m-0 text-[15px] font-medium text-ink">{value}</dd>
    </div>
  );
}

import { WarningCircle } from "@phosphor-icons/react";
