import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BindsPane } from "./BindsPane";
import { ComfigPane } from "./ComfigPane";
import { CrosshairPane } from "./CrosshairPane";
import { SettingsDraftBoundary } from "./components/SettingsDraftBoundary";
import { Loading } from "./components/ui/Spinner";
import { useToast } from "./components/ui/Toast";
import { CrosshairScene } from "./crosshair/CrosshairScene";
import { GameplayPane } from "./GameplayPane";
import { HudPane } from "./HudPane";
import { AppStatusProvider, useAppStatus } from "./hooks/useAppStatus";
import { useHudResources } from "./hooks/useHudResources";
import type { SetOperationError } from "./hooks/useOperationErrors";
import { InventoryPane } from "./InventoryPane";
import { LaunchPane } from "./LaunchPane";
import type { Api } from "./lib/api";
import { bindsFilePath, shouldSyncTrackedBinds } from "./lib/binds-ui";
import {
  type ContentIndex,
  type CrosshairSourceStatus,
  type FilesContext,
  type FilesSource,
  isTauri,
  type LaunchSyncStatus,
  type ModsCatalog,
  type PreloaderReport,
  type PreloaderStatusPayload,
  type ProfileDetail,
  parseInvokeError,
  type SteamWriteStatus,
  type StockCrosshairSprite,
} from "./lib/bridge";
import { CFG_INCOMPLETE_MESSAGE, mapsFromFiles, usesCfgState } from "./lib/cfg-state";
import {
  type ComfigUiState,
  canUseTransparentViewmodels,
  defaultComfigState,
  toggleComfigAddon,
} from "./lib/comfig-ui";
import { conditionalCfgSources } from "./lib/conditional-cfg-sources";
import { type CopyFeedback, copyButtonLabel, copyToClipboard } from "./lib/copy-ui";
import { analyzeFilesSnapshot } from "./lib/files-analysis";
import {
  createFilesDraftStore,
  type DirtyFileDraft,
  type FilesDraftStore,
} from "./lib/files-drafts";
import { cfgHudFolder } from "./lib/files-reference";
import { blockingFindingsForFile, cfgFileMeta, hitAnalysisLimit } from "./lib/files-ui";
import { gameplayPath } from "./lib/gameplay-ui";
import { hudOverlayCrosshairState } from "./lib/hud-ui";
import { recommendedLaunchOptions } from "./lib/launch-ui";
import { type ModSelection, PRELOADER_REPO_URL } from "./lib/mods-ui";
import { SettingsBusyQueue } from "./lib/settings-busy-ui";
import { createSettingsDraftStore, type SettingsDraftStore } from "./lib/settings-drafts";
import { type CfgText, readSettingsSnapshot } from "./lib/settings-loading";
import { SETTINGS_TAB_LABELS, type SettingsTab } from "./lib/settings-ui";
import { prefetchViewmodelCatalog } from "./lib/viewmodel-catalog-cache";
import { ModsPane } from "./ModsPane";
import { SoundsPane } from "./SoundsPane";
import { ViewmodelPane } from "./ViewmodelPane";

const FilesPane = lazy(() =>
  import("./FilesPane").then((module) => ({ default: module.FilesPane })),
);

export function SettingsHost({
  api,
  filesDraftStore: suppliedFilesDraftStore,
  filesSaver,
  filesCloseReady = true,
  settingsDraftStore: suppliedSettingsDraftStore,
  tab,
  activeProfileId,
  activeProfileName,
  visible = true,
  running,
  externalBusy,
  refreshKey,
  bindSyncRequest,
  onBindSyncHandled,
  onBusyChange,
  onWriteBusyChange,
  onPendingChange,
  onRecoveryChange,
  onError,
  onNavigate,
  onHudReviewRequired,
  launchSync = null,
  onLaunchOptionsSaved,
}: {
  api: Api;
  filesDraftStore?: FilesDraftStore;
  filesCloseReady?: boolean;
  settingsDraftStore?: SettingsDraftStore;
  filesSaver?: { current: ((draft: DirtyFileDraft) => Promise<boolean>) | null };
  tab: SettingsTab;
  /** Selection from the library, available before the detail IPC finishes. */
  activeProfileId?: string | null;
  activeProfileName?: string | null;
  /** Global pages retain drafts but release auditions, key capture and reads. */
  visible?: boolean;
  running: boolean;
  externalBusy: boolean;
  refreshKey: string | number;
  bindSyncRequest: number | null;
  onBindSyncHandled: (request: number) => void;
  onBusyChange: (busy: boolean) => void;
  onWriteBusyChange?: (busy: boolean) => void;
  onPendingChange?: (pending: boolean) => void;
  onRecoveryChange?: (recovery: boolean) => void;
  onError: SetOperationError;
  onNavigate?: (tab: SettingsTab) => void;
  onHudReviewRequired?: (profileId: string) => void;
  /** App's comparison of the active profile with Steam's saved launch options. */
  launchSync?: LaunchSyncStatus | null;
  /** Re-read that comparison after a launch options save or Steam write. */
  onLaunchOptionsSaved?: () => void;
}) {
  const { error, dismissError } = useAppStatus();
  const toast = useToast();
  const [queueBusy, setQueueBusy] = useState(false);
  const [loadedDetail, setDetail] = useState<ProfileDetail | null>(null);
  const [files, setFiles] = useState<CfgText[]>([]);
  const [filesContext, setFilesContext] = useState<FilesContext | null>(null);
  const [filesInspection, setFilesInspection] = useState<{
    files: CfgText[];
    detail: ProfileDetail;
    context: FilesContext;
  } | null>(null);
  const [filesLimited, setFilesLimited] = useState(false);
  const [cfgReadProblem, setCfgReadProblem] = useState<string | null>(null);
  const [cfgProblemPath, setCfgProblemPath] = useState<string | null>(null);
  const [copyCfgPathStatus, setCopyCfgPathStatus] = useState<CopyFeedback>("idle");
  const [cfgSnapshotProfileId, setCfgSnapshotProfileId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<{
    profileId: string | null;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const loadBlocked = useRef(true);
  const detailRef = useRef<ProfileDetail | null>(null);
  const launchRef = useRef(recommendedLaunchOptions());
  const launchSeedRef = useRef(recommendedLaunchOptions());
  const localFilesDraftStore = useRef(createFilesDraftStore()).current;
  const filesDraftStore = suppliedFilesDraftStore ?? localFilesDraftStore;
  const visited = useRef({ profile: null as string | null, tabs: new Set<SettingsTab>() });
  const [comfig, setComfig] = useState<ComfigUiState>(defaultComfigState);
  const [launch, setLaunch] = useState(recommendedLaunchOptions);
  /** What the profile actually holds — the pane's draft is diffed against it. */
  const [launchSeed, setLaunchSeed] = useState(recommendedLaunchOptions);
  const [launchSaved, setLaunchSaved] = useState<{ sent: string; saved: string } | null>(null);
  const [steamWrite, setSteamWrite] = useState<SteamWriteStatus | null>(null);
  const [stockSprites, setStockSprites] = useState<Record<string, StockCrosshairSprite> | null>(
    null,
  );
  const [crosshairContent, setCrosshairContent] = useState<ContentIndex | null>(null);
  const [crosshairSourceStatus, setCrosshairSourceStatus] = useState<CrosshairSourceStatus | null>(
    null,
  );
  const stockSpritesRequested = useRef(false);
  const [packPreviews, setPackPreviews] = useState<Record<string, StockCrosshairSprite> | null>(
    null,
  );
  const [modsPayload, setModsPayload] = useState<PreloaderStatusPayload | null>(null);
  const [modsCatalog, setModsCatalog] = useState<ModsCatalog | null>(null);
  const [modsLoading, setModsLoading] = useState(false);
  const [modsReport, setModsReport] = useState<PreloaderReport | null>(null);
  const [modsHudImportRequired, setModsHudImportRequired] = useState<string | null>(null);
  const [settingsBusyQueue] = useState(() => new SettingsBusyQueue(setQueueBusy));
  /** Rejects obsolete profile snapshots. */
  const loadRequest = useRef(0);
  // The header switches with the library selection. Suppress the old profile's
  // entire snapshot in the same render, before any async reload can fail.
  const identityPending = activeProfileId !== undefined && loadedDetail?.id !== activeProfileId;
  const detail = identityPending ? null : loadedDetail;
  const shownLoadError =
    loadError && (activeProfileId === undefined || loadError.profileId === activeProfileId)
      ? loadError.message
      : null;

  const [localSettingsDraftStore] = useState(createSettingsDraftStore);
  const settingsDraftStore = suppliedSettingsDraftStore ?? localSettingsDraftStore;
  useEffect(
    () => settingsDraftStore.registerWriteGuard(() => settingsBusyQueue.active),
    [settingsDraftStore, settingsBusyQueue],
  );
  useEffect(() => {
    const report = () => onPendingChange?.(settingsDraftStore.getSnapshot().length > 0);
    report();
    const stop = settingsDraftStore.subscribe(report);
    return () => {
      stop();
      onPendingChange?.(false);
    };
  }, [settingsDraftStore, onPendingChange]);

  // Read the installed Viewmodels catalog in the background so the pane opens ready.
  // It waits while TF2 runs, keeping the extra disk work away from the game.
  useEffect(() => {
    if (activeProfileId && !running) prefetchViewmodelCatalog(api.getViewmodelSourceCatalog);
  }, [api, activeProfileId, running]);

  const repairBusy = modsPayload?.repairInProgress === true;
  useEffect(() => {
    onRecoveryChange?.(modsPayload?.recoveryRequired === true);
    return () => onRecoveryChange?.(false);
  }, [onRecoveryChange, modsPayload?.recoveryRequired]);

  // Queue work and Steam verification both own the write surface. Reflect both
  // in App so launch, profile switches, update install, and every pane disable
  // together instead of only locking controls in the Mods pane.
  useEffect(() => {
    onBusyChange(queueBusy || repairBusy);
  }, [onBusyChange, queueBusy, repairBusy]);
  useEffect(() => {
    onWriteBusyChange?.(queueBusy);
    return () => onWriteBusyChange?.(false);
  }, [onWriteBusyChange, queueBusy]);

  // A write in flight when this host unmounts still calls release() on the dead
  // instance, which would otherwise leave App.settingsBusy latched true.
  useEffect(() => {
    return () => {
      onBusyChange(false);
    };
  }, [onBusyChange]);

  const busy = externalBusy || queueBusy || repairBusy || loading;
  // A switch leaves the old pane visible until its replacement snapshot loads.
  // Own saves keep inputs live so their responses cannot interrupt newer edits.
  const inputsBlocked =
    !filesCloseReady ||
    externalBusy ||
    (!queueBusy && (loadBlocked.current || loading || loadError !== null));
  const layer = detail?.layer ?? "comfig";
  // Part of every pane's draft key: switching profiles must discard the drafts
  // on screen, even when the two profiles hold identical content.
  const profileId = detail?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Profile changes invalidate guidance from the previous import attempt.
  useEffect(() => setModsHudImportRequired(null), [profileId]);
  const hud = useHudResources(
    api,
    profileId,
    visible && tab === "hud" && !externalBusy,
    refreshKey,
  );
  // Crosshair needs only the local HUD/schema to identify a possible overlay;
  // catalog and popularity reads remain owned by the HUD pane.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey explicitly re-reads local HUD state after external profile changes.
  useEffect(() => {
    if (visible && tab === "crosshair" && profileId) void hud.reloadLocal();
  }, [visible, tab, profileId, refreshKey, hud.reloadLocal]);
  const maps = useMemo(
    () => mapsFromFiles(files, layer, detail?.files, detail ?? undefined),
    [files, layer, detail],
  );
  const conditionalSources = useMemo(
    () =>
      Object.fromEntries(
        ["binds", "gameplay", "viewmodels", "crosshair", "sounds"].map((pane) => [
          pane,
          conditionalCfgSources(files, launchSeed, pane, detail ?? undefined),
        ]),
      ),
    [files, launchSeed, detail],
  );
  const [filesReviewTarget, setFilesReviewTarget] = useState<{
    id: number;
    path: string;
    line: number;
  } | null>(null);
  const filesReviewSequence = useRef(0);
  const cfgComplete = useRef(maps.complete);
  cfgComplete.current = maps.complete && !filesLimited;
  const cfgReason = useRef(maps.reason);
  cfgReason.current = cfgReadProblem ?? maps.reason;

  async function reload(opts?: { syncBinds?: boolean }) {
    // Every profile file is a separate IPC round trip, so a switch can easily
    // start a second reload that finishes first. Without this token the slower
    // (older) load writes the previous profile's files into state — and the
    // panes would then save profile A's content into profile B.
    const request = ++loadRequest.current;
    const stale = () => request !== loadRequest.current;

    loadBlocked.current = true;
    setLoading(true);
    try {
      const snapshot = await readSettingsSnapshot(api, {
        isStale: stale,
        syncBinds: opts?.syncBinds === true && !running,
      });
      if (!snapshot) return;
      const {
        detail: next,
        context,
        files: nextFiles,
        inspectedFiles: loaded,
        missing,
        incomplete: incompleteCfg,
        incompleteReason,
        comfigState: state,
        launchOptions: nextLaunch,
      } = snapshot;
      // Publish every seed in the same React batch, only after the complete read.
      const changedProfile = detailRef.current?.id !== next?.id;
      if (changedProfile || launchRef.current === launchSeedRef.current) {
        launchRef.current = nextLaunch;
        setLaunch(nextLaunch);
      }
      if (changedProfile) {
        setLaunchSaved(null);
        setSteamWrite(null);
        setModsPayload(null);
      }
      launchSeedRef.current = nextLaunch;
      detailRef.current = next;
      setDetail(next);
      // An incomplete read cannot replace a known CFG snapshot. Keep same-
      // profile values visibly stale and blocked; never carry them to another
      // profile. Other pane seeds can still publish from the verified detail.
      if (!incompleteCfg) {
        setFiles(nextFiles);
        setCfgSnapshotProfileId(next?.id ?? null);
      } else if (changedProfile) {
        setFiles([]);
        setCfgSnapshotProfileId(null);
      }
      setFilesInspection(
        incompleteCfg && next && context ? { files: loaded, detail: next, context } : null,
      );
      setFilesContext(context);
      if (!incompleteCfg) {
        for (const file of nextFiles)
          filesDraftStore.read(next?.id ?? null, file.path, file.text, file.source);
        filesDraftStore.markMissing(next?.id ?? null, new Set(nextFiles.map((file) => file.path)));
      }
      setFilesLimited(incompleteCfg);
      setCfgReadProblem(incompleteReason);
      setCfgProblemPath(missing[0] ?? null);
      setCopyCfgPathStatus("idle");
      setComfig(
        state
          ? { preset: state.preset, modules: state.modules, addons: state.addons }
          : defaultComfigState(),
      );
      setLaunchSeed(nextLaunch);
      loadBlocked.current = false;
      setLoadError(null);
      onError(null, "settings:read");
      return !incompleteCfg;
    } catch (err) {
      if (!stale()) {
        loadBlocked.current = true;
        setLoadError({
          profileId:
            activeProfileId !== undefined ? activeProfileId : (detailRef.current?.id ?? null),
          message: err instanceof Error ? err.message : "Could not load settings.",
        });
      }
      throw err;
    } finally {
      if (!stale()) setLoading(false);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh exactly when the profile/TF2 state key changes.
  useEffect(() => {
    if (externalBusy) {
      return;
    }
    let cancelled = false;
    const syncBinds = shouldSyncTrackedBinds(bindSyncRequest, running);
    const operation = syncBinds
      ? settingsBusyQueue.run(async () => {
          if (cancelled) {
            return;
          }
          await reload({ syncBinds: true });
        })
      : reload();
    operation
      .then((complete) => {
        if (!cancelled) {
          onError(null, "settings:read");
          if (syncBinds && complete && bindSyncRequest !== null) {
            onBindSyncHandled(bindSyncRequest);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Could not load settings.", "settings:read");
        }
      });
    return () => {
      cancelled = true;
      loadRequest.current += 1;
      loadBlocked.current = true;
    };
    // Ordinary mounts and profile refreshes only reload. A bind sync request is
    // issued after absorb confirms that config.cfg actually drifted.
  }, [refreshKey, bindSyncRequest, running, externalBusy]);

  // Decode Valve's stock crosshair sprites on the first Crosshair visit —
  // pixel-perfect previews straight from the user's own game files. A failure
  // releases the one-shot so the next visit retries instead of leaving the
  // fallback geometry in place for the rest of the session.
  useEffect(() => {
    if (!visible || tab !== "crosshair" || stockSpritesRequested.current) {
      return;
    }
    stockSpritesRequested.current = true;
    let cancelled = false;
    api
      .getStockCrosshairSprites()
      .then((sprites) => {
        if (!cancelled) {
          setStockSprites(sprites);
        }
      })
      .catch(() => {
        if (!cancelled) stockSpritesRequested.current = false;
        /* geometry fallback stays in place */
      });
    return () => {
      cancelled = true;
      stockSpritesRequested.current = false;
    };
  }, [api, tab, visible]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey explicitly re-reads competing sources after external profile changes.
  useEffect(() => {
    setCrosshairContent(null);
    setCrosshairSourceStatus(null);
    if (!visible || tab !== "crosshair" || !profileId) return;
    let cancelled = false;
    api
      .getCrosshairContentSources()
      .then((index) => {
        if (!cancelled) setCrosshairContent(index);
      })
      .catch(() => {
        // The pane still shows managed state; no competing-source claim is made.
      });
    api
      .getCrosshairSourceStatus()
      .then((status) => {
        if (!cancelled) setCrosshairSourceStatus(status);
      })
      .catch(() => {
        if (!cancelled) {
          setCrosshairSourceStatus({
            state: "unavailable",
            reason: "the source check failed",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, tab, visible, profileId, refreshKey, detail?.crosshair]);

  // Previews for library crosshairs stored in the installed pack. Keyed by the
  // profile too: two profiles can hold the same library name with different
  // bytes, and the stale pixels would otherwise sit on the chip until the new
  // fetch resolved.
  const crosshairLibraryKey = JSON.stringify([
    detail?.id ?? null,
    detail?.crosshair?.library ?? null,
    detail?.files.filter((file) => file.path.includes("execs-crosshairs/")),
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by profile + library content.
  useEffect(() => {
    setPackPreviews(null);
    if (!visible || tab !== "crosshair" || !detail?.crosshair) {
      return;
    }
    let cancelled = false;
    api
      .getPackCrosshairPreviews()
      .then((previews) => {
        if (!cancelled) {
          setPackPreviews(previews);
        }
      })
      .catch(() => {
        /* library chips fall back to name-only */
      });
    return () => {
      cancelled = true;
    };
  }, [api, tab, visible, crosshairLibraryKey]);

  /**
   * The one write path: every pane's save, automatic or explicit, runs through
   * here, so writes stay serialized behind the busy queue and the outcome is
   * reported in exactly one place — the toast. Quiet autosaves still report
   * failures and clear their own earlier failure after a successful retry.
   *
   * `success` names the completion for panes that do something other than save
   * ("Pack built"); `failure` carries their verb ("Could not apply").
   */
  async function runWrite(
    // biome-ignore lint/suspicious/noConfusingVoidType: Ordinary write callbacks return void; null explicitly means a cancelled picker.
    work: () => Promise<void | null>,
    copy?: { success?: string; failure?: string; source?: string },
    options?: {
      picker?: boolean;
      quiet?: boolean;
      filesRecovery?: string;
      onHandledFailure?: (reason: "review-required" | "superseded") => void;
    },
  ): Promise<boolean> {
    // The queue already serializes settings work — refusing a second write
    // because one is in flight silently dropped clicks the panes had already
    // applied optimistically. Only an *external* operation still blocks, and
    // it says so instead of no-oping.
    if (externalBusy || (loadBlocked.current && !options?.filesRecovery)) {
      toast.failSave("another change is still saving", copy?.failure, copy?.source, false);
      return false;
    }
    const expectedProfileId = options?.filesRecovery ?? profileId;
    // Picker commands include the native dialog. They must not say Saving
    // while the player is still choosing, or complete when no file was chosen.
    let started = !options?.picker && !options?.quiet;
    if (started) toast.startSave(copy?.source);
    try {
      const applied = await settingsBusyQueue.run(async () => {
        if (
          (loadBlocked.current && !options?.filesRecovery) ||
          (!options?.filesRecovery && detailRef.current?.id !== expectedProfileId) ||
          (await api.getActiveProfileDetail())?.id !== expectedProfileId
        ) {
          throw new Error("The active profile changed. Your draft has not been saved.");
        }
        if ((await work()) === null) return false;
        if (!started && !options?.quiet) {
          toast.startSave(copy?.source);
          started = true;
        }
        await reload();
        return true;
      });
      if (!applied) {
        if (started) toast.cancelSave(copy?.source);
        return false;
      }
      if (options?.quiet) toast.clearSource(copy?.source ?? "default");
      else toast.finishSave(copy?.success, copy?.source);
      return true;
    } catch (err) {
      // A failure before picker completion did not reserve a save counter.
      // Other queued sources still own their active-write feedback.
      const failure = parseInvokeError(err);
      if (
        ["HudImportRequired", "HudReviewRequired", "HudLiveReviewRequired"].includes(
          failure.code,
        ) &&
        detailRef.current?.id !== expectedProfileId
      ) {
        if (started) toast.cancelSave(copy?.source);
        options?.onHandledFailure?.("superseded");
        return false;
      }
      if (failure.code === "HudImportRequired") {
        if (started) toast.cancelSave(copy?.source);
        setModsHudImportRequired(failure.message);
        options?.onHandledFailure?.("review-required");
        return false;
      }
      if (
        (failure.code === "HudReviewRequired" || failure.code === "HudLiveReviewRequired") &&
        expectedProfileId &&
        onHudReviewRequired
      ) {
        if (started) toast.cancelSave(copy?.source);
        onHudReviewRequired(expectedProfileId);
        options?.onHandledFailure?.("review-required");
        return false;
      }
      toast.failSave(err, copy?.failure, copy?.source, started);
      return false;
    }
  }

  async function saveFileDraft(draft: DirtyFileDraft): Promise<boolean> {
    const restoreMissing =
      filesDraftStore.state(draft.profile, draft.path)?.missingReviewed === true &&
      draft.expected?.sha256 === null &&
      draft.expected.librarySha256 !== null;
    const fileProfileId = filesInspection?.detail.id ?? profileId;
    if (running || draft.profile !== fileProfileId || !draft.expected) return false;
    const hudFolder = cfgHudFolder(detail?.files ?? [], detail?.hud);
    if (
      !cfgFileMeta(draft.path, hudFolder).editable ||
      filesDraftStore.state(draft.profile, draft.path)?.conflict
    )
      return false;
    const submittedDocuments = draft.documents ?? filesDraftStore.documents(draft.profile);
    const bundle = submittedDocuments.map((file) => ({
      path: file.path,
      text: file.path === draft.path ? draft.text : file.text,
    }));
    let checked: Awaited<ReturnType<typeof analyzeFilesSnapshot>>;
    try {
      checked = await analyzeFilesSnapshot({
        profile: draft.profile,
        files: bundle,
        hudId: hudFolder,
        identity: `${draft.profile}:${draft.path}:${draft.revision ?? 0}`,
      });
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Files analysis failed. Retry before saving.",
        `files:validation:${draft.profile}:${draft.path}`,
      );
      return false;
    }
    if (
      hitAnalysisLimit(checked.result) ||
      blockingFindingsForFile(checked.result.findings, draft.path).length > 0
    ) {
      onError(
        "Resolve blocking findings in Files before saving.",
        `files:validation:${draft.profile}:${draft.path}`,
      );
      return false;
    }
    const saved = await runWrite(
      async () => {
        const committed = await api
          .writeOwnedFile(draft.path, draft.text, draft.expected as FilesSource)
          .catch(async (error: unknown) => {
            if (
              error &&
              typeof error === "object" &&
              "code" in error &&
              error.code === "FileConflict"
            ) {
              // Refresh the comparison source, keeping the original draft/token.
              // No retry or write is performed until the player reviews it.
              await reload().catch(() => {});
            }
            throw error;
          });
        const hash = committed.files.find((file) => file.path === draft.path)?.sha256;
        if (!hash)
          throw new Error(
            "The saved cfg identity is unavailable. Reload Files before another save.",
          );
        filesDraftStore.acknowledge(draft.profile, draft.path, draft.text, {
          ...(draft.expected as FilesSource),
          sha256: hash,
          librarySha256: hash,
        });
      },
      {
        source: `${draft.profile}:files:${draft.path}`,
        failure: `Could not save Files (${draft.path})`,
      },
      restoreMissing && draft.profile ? { filesRecovery: draft.profile } : undefined,
    );
    if (saved) onError(null, `files:validation:${draft.profile}:${draft.path}`);
    return saved;
  }
  useEffect(() => {
    if (!filesSaver) return;
    filesSaver.current = saveFileDraft;
    return () => {
      filesSaver.current = null;
    };
  });

  // Preloader state is shared by Mods and Viewmodels; either pane needs the
  // active profile's status before editing or building a pack.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-arms the load; onError is a stable callback.
  useEffect(() => {
    if (!visible || !profileId || (tab !== "mods" && tab !== "viewmodels")) {
      return;
    }
    let cancelled = false;
    setModsPayload(null);
    api
      .getPreloaderStatus()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setModsPayload(payload);
        onError(null, "mods:status");
        if (tab === "mods") {
          setModsLoading(true);
          api
            .getDefaultMods()
            .then((mods) => {
              if (!cancelled) {
                setModsCatalog(mods.catalog);
                onError(null, "mods:library");
              }
            })
            .catch((err) => {
              if (!cancelled) {
                onError(
                  err instanceof Error ? err.message : "Could not read the mod library.",
                  "mods:library",
                );
              }
            })
            .finally(() => {
              if (!cancelled) {
                setModsLoading(false);
              }
            });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          onError(
            err instanceof Error ? err.message : "Could not read the preloader state.",
            "mods:status",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, tab, visible, refreshKey, profileId]);

  async function refreshModsStatus() {
    setModsPayload(await api.getPreloaderStatus());
    onError(null, "mods:status");
  }

  async function writeManaged(
    path: string,
    text: string,
    scope?: "gameplay" | "crosshair" | "sounds" | "viewmodels",
  ) {
    if (!profileId) throw new Error("Select a profile before saving.");
    if (!cfgComplete.current) throw new Error(cfgReason.current ?? CFG_INCOMPLETE_MESSAGE);
    await api.writeManagedCfg(path, text, profileId, scope);
  }

  function pane(tab: SettingsTab, paneActive: boolean) {
    // This closure belongs to the originating retained pane, even after the
    // user navigates elsewhere while its save is queued or in flight.
    const label = tab === "hud" ? "HUD options" : SETTINGS_TAB_LABELS[tab];
    function write(
      // biome-ignore lint/suspicious/noConfusingVoidType: null preserves native picker cancellation through the pane wrapper.
      work: () => Promise<void | null>,
      copy?: { success?: string; failure?: string },
      options?: {
        picker?: boolean;
        quiet?: boolean;
        onHandledFailure?: (reason: "review-required" | "superseded") => void;
      },
    ) {
      if (usesCfgState(tab) && !cfgComplete.current) {
        toast.failSave(
          cfgReason.current ?? CFG_INCOMPLETE_MESSAGE,
          `Could not save ${label}`,
          `${profileId}:${tab}:${copy?.success ?? copy?.failure ?? "save"}`,
          false,
        );
        return Promise.resolve(false);
      }
      return runWrite(
        work,
        {
          source: `${profileId}:${tab}:${copy?.success ?? copy?.failure ?? "save"}`,
          success: `${label} saved`,
          failure: `Could not save ${label}`,
          ...copy,
        },
        options,
      );
    }
    if (tab === "comfig") {
      return (
        <ComfigPane
          detail={detail}
          state={comfig}
          onApplyPreset={(preset) => {
            return write(async () => {
              await api.setComfigPreset(preset);
            });
          }}
          onApplyModules={(modules) => {
            return write(async () => {
              await api.setComfigModules(modules);
            });
          }}
          onToggleAddon={(id) => {
            const addons = toggleComfigAddon(comfig.addons, id);
            return write(async () => {
              await api.setComfigAddons(addons);
            });
          }}
          onUpdatePackages={() => {
            void write(
              async () => {
                await api.updateComfigVpks();
              },
              { success: "Packages up to date", failure: "Could not update" },
            );
          }}
          onImportCustom={() => {
            return write(
              async () => {
                if ((await api.importComfigCustom()) === null) return null;
              },
              { success: "comfig-custom imported", failure: "Could not import" },
              { picker: true },
            );
          }}
        />
      );
    }

    if (tab === "binds") {
      const path = bindsFilePath(layer);
      return (
        <BindsPane
          profileId={profileId}
          layer={layer}
          effectiveBinds={maps.binds}
          bindSources={maps.bindSources}
          startupFiles={files}
          startupInventory={detail?.files}
          hudProjection={detail ?? undefined}
          managedText={files.find((file) => file.path === path)?.text ?? ""}
          blocked={inputsBlocked}
          onSave={(bindsText) => {
            return write(
              async () => {
                await writeManaged(path, bindsText);
              },
              undefined,
              { quiet: true },
            );
          }}
        />
      );
    }

    if (tab === "gameplay") {
      const path = gameplayPath(layer);
      return (
        <GameplayPane
          profileId={profileId}
          layer={layer}
          effective={maps.effective}
          managedText={files.find((file) => file.path === path)?.text ?? ""}
          onOpenViewmodels={() => onNavigate?.("viewmodels")}
          onSave={(gameplayText) =>
            write(
              async () => {
                await writeManaged(path, gameplayText, "gameplay");
              },
              undefined,
              { quiet: true },
            )
          }
        />
      );
    }

    if (tab === "hud") {
      return (
        <HudPane
          api={api}
          profileId={profileId}
          catalogLoading={hud.catalogLoading}
          catalogError={hud.catalogError}
          catalogWarning={hud.catalogWarning}
          catalog={hud.catalog}
          stats={hud.stats}
          statsLoading={hud.statsLoading}
          statsError={hud.statsError}
          previewData={import.meta.env.DEV && !isTauri()}
          state={hud.state}
          schema={hud.schema}
          stateLoading={hud.stateLoading}
          stateError={hud.stateError}
          schemaLoading={hud.schemaLoading}
          schemaError={hud.schemaError}
          onRetryLocal={() => void hud.reloadLocal()}
          onRefresh={() => hud.reload(true)}
          onInstall={(id) => {
            return write(
              async () => {
                await api.installHud(id);
                await hud.reloadLocal();
              },
              { success: "HUD installed", failure: "Could not install" },
            );
          }}
          onReturnToStock={() =>
            write(
              async () => {
                await api.returnToStockHud();
                await hud.reloadLocal();
              },
              { success: "Stock HUD restored", failure: "Could not remove the HUD" },
            )
          }
          onUpdate={() => {
            void write(
              async () => {
                await api.updateHud();
                await hud.reloadLocal();
              },
              { success: "HUD updated", failure: "Could not update" },
            );
          }}
          onMatch={(id) => {
            void write(
              async () => {
                await api.matchHudCatalog(id);
                await hud.reloadLocal();
              },
              { failure: "Could not match" },
            );
          }}
          onApplyOptions={(options) => {
            const installed = hud.state.installed;
            if (!profileId || !installed || !hud.schema) return Promise.resolve(false);
            return write(async () => {
              await api.applyHudOptions(options, profileId, installed.id);
              await hud.reloadLocal();
            });
          }}
          onImportArchive={() => {
            setModsHudImportRequired(null);
            return write(
              async () => {
                if ((await api.importHudArchive()) === null) return null;
                await hud.reloadLocal();
              },
              { success: "HUD imported", failure: "Could not import" },
              { picker: true },
            );
          }}
          onImportFolder={() => {
            setModsHudImportRequired(null);
            return write(
              async () => {
                if ((await api.importHudFolder()) === null) return null;
                await hud.reloadLocal();
              },
              { success: "HUD imported", failure: "Could not import" },
              { picker: true },
            );
          }}
        />
      );
    }

    if (tab === "crosshair") {
      const path = gameplayPath(layer);
      return (
        <CrosshairPane
          profileId={profileId}
          record={detail?.crosshair ?? null}
          hudOverlayState={hudOverlayCrosshairState(
            hud.state.installed?.id ?? null,
            hud.schema,
            hud.state.installed?.options ?? {},
          )}
          hudName={
            hud.catalog.find((entry) => entry.id === hud.state.installed?.id)?.name ??
            hud.state.installed?.id
          }
          onOpenHud={() => onNavigate?.("hud")}
          layer={layer}
          effective={maps.effective}
          stockSprites={stockSprites}
          stockArtSources={crosshairContent}
          sourceStatus={crosshairSourceStatus}
          onOpenMods={() => onNavigate?.("mods")}
          scene={<CrosshairScene />}
          packPreviews={packPreviews}
          managedText={files.find((file) => file.path === path)?.text ?? ""}
          onSaveStock={(gameplayText) =>
            write(async () => {
              await writeManaged(path, gameplayText, "crosshair");
            })
          }
          onApply={(shape, assignments, customRgba, color, library, design, settings) =>
            write(async () => {
              await api.applyCrosshairs(
                shape,
                assignments,
                customRgba,
                color,
                library,
                design,
                settings,
              );
            })
          }
          onDeactivate={() =>
            write(async () => {
              await api.deactivateCrosshairs();
            })
          }
          onRemove={() => {
            void write(
              async () => {
                await api.removeCrosshairs();
              },
              { success: "Pack removed", failure: "Could not remove" },
            );
          }}
        />
      );
    }

    if (tab === "viewmodels") {
      const path = gameplayPath(layer);
      return (
        <ViewmodelPane
          active={paneActive}
          profileId={profileId}
          record={detail?.viewmodel ?? null}
          settings={{
            effective: maps.effective,
            managedText: files.find((file) => file.path === path)?.text ?? "",
            cfgReady: maps.complete && !filesLimited,
            transparentViewmodels: comfig.addons.includes("transparent-viewmodels"),
            canUseComfigAddons: canUseTransparentViewmodels(detail?.layer ?? null),
            onOpenComfig: () => onNavigate?.("comfig"),
            onToggleTransparentViewmodels: () => {
              const addons = toggleComfigAddon(comfig.addons, "transparent-viewmodels");
              void write(async () => {
                await api.setComfigAddons(addons);
              });
            },
            onSave: (gameplayText) =>
              write(
                async () => {
                  await writeManaged(path, gameplayText, "viewmodels");
                },
                undefined,
                { quiet: true },
              ),
          }}
          profilePreload={modsPayload?.profilePreload ?? null}
          loadCatalog={api.getViewmodelSourceCatalog}
          onImport={(preload) => {
            return write(
              async () => {
                if ((await api.importViewmodels(preload)) === null) return null;
              },
              { success: "Pack imported", failure: "Could not import" },
              { picker: true },
            );
          }}
          onBuild={(request) =>
            write(
              async () => {
                await api.buildSelectedViewmodelPack(request);
              },
              { success: "Pack built", failure: "Could not build" },
            )
          }
          onRemove={() => {
            void write(
              async () => {
                await api.removeViewmodels();
              },
              { success: "Pack removed", failure: "Could not remove" },
            );
          }}
        />
      );
    }

    if (tab === "sounds") {
      const path = gameplayPath(layer);
      return (
        <SoundsPane
          api={api}
          profileId={profileId}
          record={detail?.hitsound ?? null}
          layer={layer}
          effective={maps.effective}
          managedText={files.find((file) => file.path === path)?.text ?? ""}
          sourceFiles={detail?.files}
          sourceRefreshKey={refreshKey}
          // Sound files and CVars share one recoverable native transaction.
          onSave={(gameplayText, pack) =>
            write(async () => {
              if (pack) {
                if (!profileId) throw new Error("Select a profile before saving.");
                if (!cfgComplete.current) {
                  throw new Error(cfgReason.current ?? CFG_INCOMPLETE_MESSAGE);
                }
                await api.applyHitsoundsWithSettings(
                  path,
                  gameplayText,
                  profileId,
                  pack.hit,
                  pack.kill,
                );
              } else {
                await writeManaged(path, gameplayText, "sounds");
              }
            })
          }
          onRemove={() => {
            void write(
              async () => {
                await api.removeHitsounds();
              },
              { success: "Sound files removed", failure: "Could not remove" },
            );
          }}
        />
      );
    }

    if (tab === "mods") {
      return (
        <ModsPane
          api={api}
          active={paneActive}
          previewData={import.meta.env.DEV && !isTauri()}
          profileId={profileId}
          payload={modsPayload}
          catalog={modsCatalog}
          mods={detail?.mods ?? []}
          loading={modsLoading}
          report={modsReport}
          hudImportRequired={modsHudImportRequired}
          onReviewHudImport={() => onNavigate?.("hud")}
          onDismissHudImport={() => setModsHudImportRequired(null)}
          onApply={(addons, particleMods, profileParticleMods) => {
            void write(
              async () => {
                try {
                  setModsReport(
                    await api.applyPreloaderMods(addons, particleMods, profileParticleMods),
                  );
                } finally {
                  // A failed apply still restored the previous install
                  // backend-side; the pane must reflect that, not the stale state.
                  await refreshModsStatus().catch(() => {});
                }
              },
              { success: "Mods applied", failure: "Could not apply" },
            );
          }}
          onToggleBypass={(enabled) => {
            void write(async () => {
              setModsPayload(await api.setGameinfoBypass(enabled));
            });
          }}
          onTogglePreload={(enabled) => {
            void write(async () => {
              setModsPayload(await api.setProfilePreload(enabled));
            });
          }}
          onRevert={() => {
            void write(
              async () => {
                try {
                  await api.revertPreloader();
                  setModsReport(null);
                } finally {
                  await refreshModsStatus().catch(() => {});
                }
              },
              { success: "Stock files restored", failure: "Could not restore" },
            );
          }}
          onRecover={() => {
            void write(
              async () => {
                setModsPayload(await api.recoverPreloader());
              },
              { success: "Recovery finished", failure: "Could not recover" },
            );
          }}
          onRepair={async () => {
            setModsPayload((current) =>
              current ? { ...current, repairInProgress: true } : current,
            );
            try {
              await api.repairGameFiles();
              await refreshModsStatus();
              onError(null, "mods:repair");
            } catch (err) {
              // A retry can fail to reopen Steam while an older verification
              // lease is still valid. Ask the backend instead of optimistically
              // unlocking the renderer.
              await refreshModsStatus().catch(() => {});
              onError(
                err instanceof Error ? err.message : "Could not start the repair.",
                "mods:repair",
              );
              throw err;
            }
          }}
          onCompleteRepair={async (selection: ModSelection) => {
            let released = false;
            try {
              const complete = await api.completeGameFileRepair();
              if (!complete) {
                await refreshModsStatus();
                onError(
                  "Steam's repair is still changing TF2 files. Wait, then confirm again.",
                  "mods:repair",
                );
                return false;
              }
              released = true;
              if (
                selection.addons.length > 0 ||
                selection.particleMods.length > 0 ||
                selection.profileParticleMods.length > 0
              ) {
                setModsReport(
                  await api.applyPreloaderMods(
                    selection.addons,
                    selection.particleMods,
                    selection.profileParticleMods,
                  ),
                );
              }
              await refreshModsStatus();
              onError(null, "mods:repair");
              return true;
            } catch (err) {
              onError(
                err instanceof Error ? err.message : "Could not confirm the repair.",
                "mods:repair",
              );
              await refreshModsStatus().catch(() => {});
              // Completion may have safely released maintenance before
              // re-applying the selection failed. Do not resurrect a repair
              // state the backend no longer owns.
              if (released) {
                return true;
              }
              throw err;
            }
          }}
          onCancelRepair={async () => {
            try {
              const cancelled = await api.cancelGameFileRepair();
              await refreshModsStatus();
              if (cancelled) onError(null, "mods:repair");
              return cancelled;
            } catch (err) {
              onError(
                err instanceof Error
                  ? err.message
                  : "Could not cancel the repair lock. Close Steam and TF2 first.",
                "mods:repair",
              );
              await refreshModsStatus().catch(() => {});
              throw err;
            }
          }}
          onRefreshStatus={refreshModsStatus}
          onOpenRepo={() => {
            void api.openExternal(PRELOADER_REPO_URL);
          }}
          onImportArchive={() => {
            setModsHudImportRequired(null);
            return write(
              async () => {
                if ((await api.importModArchive()) === null) return null;
                await refreshModsStatus().catch(() => {});
              },
              { success: "Mod imported", failure: "Could not import" },
              { picker: true },
            );
          }}
          onImportFolder={() => {
            setModsHudImportRequired(null);
            return write(
              async () => {
                if ((await api.importModFolder()) === null) return null;
                await refreshModsStatus().catch(() => {});
              },
              { success: "Mod imported", failure: "Could not import" },
              { picker: true },
            );
          }}
          onRemoveMod={(id) => {
            void write(
              async () => {
                await api.removeMod(id);
                // Removing a pack can take its particle sources with it.
                await refreshModsStatus().catch(() => {});
              },
              { success: "Mod removed", failure: "Could not remove" },
            );
          }}
          // Awaited by the card, so "Installing…" lasts exactly as long as the
          // install and the profile reload behind it.
          onInstallGameBananaMod={async (id, fileId) => {
            setModsHudImportRequired(null);
            let handled: "review-required" | "superseded" | null = null;
            const applied = await write(
              async () => {
                await api.installGameBananaMod(id, fileId);
                await refreshModsStatus().catch(() => {});
              },
              { success: "Mod installed", failure: "Could not install" },
              {
                onHandledFailure: (reason) => {
                  handled = reason;
                },
              },
            );
            return handled ?? applied;
          }}
        />
      );
    }

    if (tab === "files") {
      return (
        <Suspense
          fallback={
            <p className="t-meta">
              <Loading>Loading cfg workspace…</Loading>
            </p>
          }
        >
          <FilesPane
            profileId={filesInspection?.detail.id ?? profileId}
            files={filesInspection?.files ?? files}
            context={filesInspection?.context ?? filesContext}
            gameRunning={running}
            recoveryAvailable={!externalBusy && !queueBusy && !loading && !!filesInspection}
            onNavigate={onNavigate}
            draftStore={filesDraftStore}
            closeReady={filesCloseReady}
            limited={filesLimited}
            hudId={
              filesInspection?.detail.selectedHudRoot ??
              detail?.selectedHudRoot ??
              cfgHudFolder(
                filesInspection?.detail.files ?? detail?.files ?? [],
                filesInspection?.detail.hud ?? detail?.hud,
              )
            }
            reviewTarget={filesReviewTarget}
            onSave={(path, text, submission) => {
              return saveFileDraft(submission ?? { profile: profileId, path, text });
            }}
          />
        </Suspense>
      );
    }

    return (
      <LaunchPane
        profileId={profileId}
        value={launch}
        saved={launchSeed}
        steamWrite={steamWrite}
        steamSync={launchSync}
        lastSave={launchSaved}
        onChange={(next) => {
          launchRef.current = next;
          setLaunch(next);
          setLaunchSaved(null);
        }}
        onSave={() => {
          const sent = launch;
          return write(async () => {
            const result = await api.setProfileLaunchOptions(sent);
            if (detailRef.current?.id !== profileId) return;
            if (launchRef.current === sent) {
              launchRef.current = result.launchOptions;
              setLaunch(result.launchOptions);
            }
            launchSeedRef.current = result.launchOptions;
            setLaunchSeed(result.launchOptions);
            setLaunchSaved({ sent, saved: result.launchOptions });
            setSteamWrite(result.steamWrite);
            onLaunchOptionsSaved?.();
          });
        }}
      />
    );
  }

  if (visited.current.profile !== profileId) {
    visited.current = { profile: profileId, tabs: new Set() };
  }
  if (visible && profileId && tab !== "inventory") visited.current.tabs.add(tab);
  if (visible && tab === "files" && filesInspection) visited.current.tabs.add("files");

  return (
    <AppStatusProvider
      value={{
        error,
        setError: onError,
        dismissError,
        busy,
        // A reload caused by this host's own write must not look like TF2
        // starting. Autosave keeps accepting newer drafts during that reload;
        // the queue serializes their writes when the first one finishes.
        running:
          running ||
          (!queueBusy && (loading || (filesLimited && usesCfgState(tab)) || loadError !== null)),
      }}
    >
      {shownLoadError ? (
        <div role="alert" className="mb-4 text-warn">
          <p>
            {activeProfileName ? `${activeProfileName}: ` : ""}
            {shownLoadError}
          </p>
          <button
            type="button"
            className="btn btn-ghost mt-2"
            disabled={loading || externalBusy}
            onClick={() => void reload().catch(() => {})}
          >
            Retry loading settings
          </button>
        </div>
      ) : null}
      {filesLimited && (usesCfgState(tab) || tab === "files") ? (
        <div role="alert" className="mb-4 text-warn">
          <p>{cfgReadProblem}</p>
          {usesCfgState(tab) && cfgSnapshotProfileId === profileId ? (
            <p>Values below are from the last complete read and may be stale.</p>
          ) : null}
          <div className="pane-actions mt-2">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={loading || externalBusy}
              onClick={() => void reload().catch(() => {})}
            >
              Retry loading settings
            </button>
            {tab !== "files" && onNavigate ? (
              <button type="button" className="btn btn-ghost" onClick={() => onNavigate("files")}>
                Review in Files
              </button>
            ) : null}
            {cfgProblemPath && filesContext?.root ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void copyToClipboard(
                    `${filesContext.root.replace(/[\\/]+$/, "")}/${cfgProblemPath}`,
                  ).then(setCopyCfgPathStatus)
                }
              >
                {copyButtonLabel(copyCfgPathStatus, "Copy affected file path")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {identityPending && !shownLoadError ? (
        <p data-testid="settings-profile-loading">
          Loading settings for {activeProfileName ?? "the selected profile"}…
        </p>
      ) : null}
      {!profileId && loading && !identityPending ? (
        <p>
          <Loading>Loading settings…</Loading>
        </p>
      ) : null}
      {!identityPending && !filesLimited && !maps.complete && usesCfgState(tab) ? (
        <div role="alert" className="mb-4 text-warn">
          <p>{maps.reason ?? CFG_INCOMPLETE_MESSAGE}</p>
          {onNavigate && (
            <button
              type="button"
              data-testid="review-startup-cfg"
              className="btn btn-ghost mt-2"
              onClick={() => {
                if (maps.issue)
                  setFilesReviewTarget({ id: ++filesReviewSequence.current, ...maps.issue });
                onNavigate("files");
              }}
            >
              Review in Files
            </button>
          )}
        </div>
      ) : null}
      {import.meta.env.DEV ? (
        <div hidden={!visible || tab !== "inventory"}>
          <InventoryPane
            api={api}
            active={visible && tab === "inventory"}
            running={running}
            busy={busy || externalBusy}
          />
        </div>
      ) : null}
      {[...visited.current.tabs].map((paneTab) => (
        <SettingsDraftBoundary
          key={`${profileId}:${paneTab}`}
          store={settingsDraftStore}
          profile={profileId}
          tab={paneTab}
          active={visible && tab === paneTab}
          blocked={
            paneTab === "files"
              ? !filesCloseReady || externalBusy
              : inputsBlocked || (usesCfgState(paneTab) && (filesLimited || !maps.complete))
          }
          onDiscard={
            paneTab === "launch"
              ? () => {
                  launchRef.current = launchSeedRef.current;
                  setLaunch(launchSeedRef.current);
                  setLaunchSaved(null);
                }
              : undefined
          }
        >
          {!identityPending &&
          profileId &&
          visible &&
          tab === paneTab &&
          (conditionalSources[paneTab]?.length ?? 0) > 0 ? (
            <aside
              data-testid="conditional-cfg-sources"
              aria-label="Other CFG sources"
              className="pane-note mb-5"
            >
              <p>
                These controls show inspected startup CFG values. Launch commands and class CFG
                lines below may change the game result; launch command order needs TF2 validation.
              </p>
              <ul className="mt-2 space-y-1">
                {conditionalSources[paneTab].slice(0, 6).map((source) => (
                  <li key={JSON.stringify(source)}>
                    {onNavigate ? (
                      <button
                        type="button"
                        className="text-left underline underline-offset-2"
                        onClick={() => {
                          if (source.kind === "class") {
                            setFilesReviewTarget({
                              id: ++filesReviewSequence.current,
                              path: source.path,
                              line: source.line,
                            });
                          }
                          onNavigate(source.kind === "class" ? "files" : "launch");
                        }}
                      >
                        {source.kind === "class"
                          ? `${source.path}:${source.line} — ${source.label}`
                          : `Launch ${source.label}`}
                      </button>
                    ) : source.kind === "class" ? (
                      `${source.path}:${source.line} — ${source.label}`
                    ) : (
                      `Launch ${source.label}`
                    )}
                  </li>
                ))}
              </ul>
              {conditionalSources[paneTab].length > 6 ? (
                <p className="mt-1">And {conditionalSources[paneTab].length - 6} more sources.</p>
              ) : null}
            </aside>
          ) : null}
          {filesLimited && usesCfgState(paneTab) && cfgSnapshotProfileId !== profileId ? (
            <p data-testid="settings-cfg-unavailable" className="t-meta">
              CFG controls are unavailable until the listed file can be read.
            </p>
          ) : (
            pane(paneTab, visible && tab === paneTab)
          )}
        </SettingsDraftBoundary>
      ))}
    </AppStatusProvider>
  );
}
