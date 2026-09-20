import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BindsPane } from "./BindsPane";
import { ComfigPane } from "./ComfigPane";
import { CrosshairPane } from "./CrosshairPane";
import { SettingsDraftBoundary } from "./components/SettingsDraftBoundary";
import { useToast } from "./components/ui/Toast";
import { CrosshairScene } from "./crosshair/CrosshairScene";
import { GameplayPane } from "./GameplayPane";
import { HudPane } from "./HudPane";
import { AppStatusProvider, useAppStatus } from "./hooks/useAppStatus";
import { useHudResources } from "./hooks/useHudResources";
import type { SetOperationError } from "./hooks/useOperationErrors";
import { LaunchPane } from "./LaunchPane";
import type { Api } from "./lib/api";
import {
  bindsFilePath,
  configBindsFromFiles,
  shouldSyncTrackedBinds,
  syncTrackedBindsFromConfig,
} from "./lib/binds-ui";
import {
  type FilesContext,
  type FilesSource,
  isTauri,
  type ModsCatalog,
  type PreloaderReport,
  type PreloaderStatusPayload,
  type ProfileDetail,
  type SteamWriteStatus,
  type StockCrosshairSprite,
} from "./lib/bridge";
import { CFG_INCOMPLETE_MESSAGE, mapsFromFiles, usesCfgState } from "./lib/cfg-state";
import {
  type ComfigUiState,
  defaultComfigState,
  hasBaseVpk,
  toggleComfigAddon,
} from "./lib/comfig-ui";
import { analyzeFilesSnapshot } from "./lib/files-analysis";
import {
  createFilesDraftStore,
  type DirtyFileDraft,
  type FilesDraftStore,
} from "./lib/files-drafts";
import { addEditorTextToBudget, editorCfgCandidates } from "./lib/files-limits";
import { cfgHudFolder } from "./lib/files-reference";
import { blockingFindingsForFile, cfgFileMeta, hitAnalysisLimit } from "./lib/files-ui";
import { gameplayPath } from "./lib/gameplay-ui";
import { recommendedLaunchOptions } from "./lib/launch-ui";
import { type ModSelection, PRELOADER_REPO_URL } from "./lib/mods-ui";
import { SettingsBusyQueue } from "./lib/settings-busy-ui";
import { createSettingsDraftStore, type SettingsDraftStore } from "./lib/settings-drafts";
import { SETTINGS_TAB_LABELS, type SettingsTab } from "./lib/settings-ui";
import { ModsPane } from "./ModsPane";
import { SoundsPane } from "./SoundsPane";
import { ViewmodelPane } from "./ViewmodelPane";

type CfgText = { path: string; text: string; source?: FilesSource };
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
}: {
  api: Api;
  filesDraftStore?: FilesDraftStore;
  filesCloseReady?: boolean;
  settingsDraftStore?: SettingsDraftStore;
  filesSaver?: { current: ((draft: DirtyFileDraft) => Promise<boolean>) | null };
  tab: SettingsTab;
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
}) {
  const { error, dismissError } = useAppStatus();
  const toast = useToast();
  const [queueBusy, setQueueBusy] = useState(false);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [files, setFiles] = useState<CfgText[]>([]);
  const [filesContext, setFilesContext] = useState<FilesContext | null>(null);
  const [filesInspection, setFilesInspection] = useState<{
    files: CfgText[];
    detail: ProfileDetail;
    context: FilesContext;
  } | null>(null);
  const [filesLimited, setFilesLimited] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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
  const stockSpritesRequested = useRef(false);
  const [packPreviews, setPackPreviews] = useState<Record<string, StockCrosshairSprite> | null>(
    null,
  );
  const [modsPayload, setModsPayload] = useState<PreloaderStatusPayload | null>(null);
  const [modsCatalog, setModsCatalog] = useState<ModsCatalog | null>(null);
  const [modsLoading, setModsLoading] = useState(false);
  const [modsReport, setModsReport] = useState<PreloaderReport | null>(null);
  const [settingsBusyQueue] = useState(() => new SettingsBusyQueue(setQueueBusy));
  /** Rejects obsolete profile snapshots. */
  const loadRequest = useRef(0);

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

  const busy = externalBusy || queueBusy || repairBusy || loading || filesLimited;
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
  const hud = useHudResources(api, profileId, tab === "hud" && !externalBusy, refreshKey);
  const maps = useMemo(
    () => mapsFromFiles(files, layer, detail?.files),
    [files, layer, detail?.files],
  );
  const cfgComplete = useRef(maps.complete);
  cfgComplete.current = maps.complete;

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
      const next = await api.getActiveProfileDetail();
      if (stale()) {
        return;
      }
      const context = next ? await api.getFilesContext() : null;
      if (stale()) return;
      if (context && context.profileId !== next?.id)
        throw new Error("The profile changed while loading Files.");
      const candidates = editorCfgCandidates(next?.files ?? []);
      const loaded: CfgText[] = [];
      let totalBytes = 0;
      const missing: string[] = [];
      let wasLimited = candidates.limited;
      for (const file of candidates.files) {
        try {
          const content = await api.readProfileFile(file.path);
          if (stale()) return;
          if (content.text === null) {
            if (content.source?.sha256 === null && content.source.librarySha256 !== null) {
              loaded.push({ path: content.path, text: "", source: content.source });
            }
            missing.push(file.path);
            continue;
          }
          const nextTotal = addEditorTextToBudget(totalBytes, content.text);
          if (nextTotal === null) {
            wasLimited = true;
            break;
          }
          totalBytes = nextTotal;
          loaded.push({ path: content.path, text: content.text, source: content.source });
        } catch {
          if (stale()) return;
          missing.push(file.path);
        }
      }
      if (wasLimited || missing.length > 0) {
        setFilesLimited(true);
        // Keep the bounded Files inventory inspectable while settings writes remain blocked.
        if (next && context) setFilesInspection({ files: loaded, detail: next, context });
        throw new Error(
          missing.length > 0
            ? `Could not read settings: ${missing.join(", ")}. Retry before saving.`
            : "Some cfg files exceed the editor limits. Settings cannot be saved from an incomplete load.",
        );
      }
      const state = await api.getComfigState();
      if (stale()) return;
      const nextLaunch = next?.launchOptions ?? (await api.getProfileLaunchOptions());
      if (stale()) return;
      const verified = await api.getActiveProfileDetail();
      if (stale()) return;
      if (verified?.id !== next?.id)
        throw new Error("The active profile changed. Retry loading settings.");
      let nextFiles = loaded;
      const nextLayer = next?.layer ?? "comfig";
      if (opts?.syncBinds && !running) {
        const bindsPath = bindsFilePath(nextLayer);
        const managed = nextFiles.find((file) => file.path === bindsPath)?.text ?? "";
        const synced = syncTrackedBindsFromConfig(managed, configBindsFromFiles(nextFiles));
        if (synced !== managed) {
          const expected = nextFiles.find((file) => file.path === bindsPath)?.source;
          if (!expected)
            throw new Error("The Binds source identity is unavailable. Retry loading settings.");
          await api.writeOwnedFile(bindsPath, synced, expected);
          if (stale()) return;
          const refreshed = await api.readProfileFile(bindsPath);
          if (stale()) return;
          nextFiles = nextFiles.map((file) =>
            file.path === bindsPath
              ? { path: bindsPath, text: refreshed.text ?? synced, source: refreshed.source }
              : file,
          );
        }
      }
      // Publish every seed in the same React batch, only after the complete read.
      const changedProfile = detailRef.current?.id !== next?.id;
      if (changedProfile || launchRef.current === launchSeedRef.current) {
        launchRef.current = nextLaunch;
        setLaunch(nextLaunch);
      }
      if (changedProfile) {
        setLaunchSaved(null);
        setSteamWrite(null);
      }
      launchSeedRef.current = nextLaunch;
      detailRef.current = next;
      setDetail(next);
      setFiles(nextFiles);
      setFilesInspection(null);
      setFilesContext(context);
      for (const file of nextFiles)
        filesDraftStore.read(next?.id ?? null, file.path, file.text, file.source);
      filesDraftStore.markMissing(next?.id ?? null, new Set(nextFiles.map((file) => file.path)));
      setFilesLimited(false);
      setComfig(
        state
          ? { preset: state.preset, modules: state.modules, addons: state.addons }
          : defaultComfigState(),
      );
      setLaunchSeed(nextLaunch);
      loadBlocked.current = false;
      setLoadError(null);
      onError(null, "settings:read");
    } catch (err) {
      if (!stale()) {
        loadBlocked.current = true;
        setLoadError(err instanceof Error ? err.message : "Could not load settings.");
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
      .then(() => {
        if (!cancelled) {
          onError(null, "settings:read");
          if (syncBinds && bindSyncRequest !== null) {
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
    if (tab !== "crosshair" || stockSpritesRequested.current) {
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
  }, [api, tab]);

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
    if (tab !== "crosshair" || !detail?.crosshair) {
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
  }, [api, tab, crosshairLibraryKey]);

  /**
   * The one write path: every pane's save, automatic or explicit, runs through
   * here, so writes stay serialized behind the busy queue and the outcome is
   * reported in exactly one place — the toast.
   *
   * `success` names the completion for panes that do something other than save
   * ("Pack built"); `failure` carries their verb ("Could not apply").
   */
  async function runWrite(
    // biome-ignore lint/suspicious/noConfusingVoidType: Ordinary write callbacks return void; null explicitly means a cancelled picker.
    work: () => Promise<void | null>,
    copy?: { success?: string; failure?: string; source?: string },
    options?: { picker?: boolean; filesRecovery?: string },
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
    let started = !options?.picker;
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
        if (!started) {
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
      toast.finishSave(copy?.success, copy?.source);
      return true;
    } catch (err) {
      // A failure before picker completion did not reserve a save counter.
      // Other queued sources still own their active-write feedback.
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
        const committed = await api.writeOwnedFile(
          draft.path,
          draft.text,
          draft.expected as FilesSource,
        );
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

  // Preloader state is global (game files + app data), not part of the
  // profile detail, so the Mods tab loads it separately.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey re-arms the load; onError is a stable callback.
  useEffect(() => {
    if (tab !== "mods") {
      return;
    }
    let cancelled = false;
    api
      .getPreloaderStatus()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setModsPayload(payload);
        onError(null, "mods:status");
        if (payload.modsCached) {
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
  }, [api, tab, refreshKey]);

  async function refreshModsStatus() {
    setModsPayload(await api.getPreloaderStatus());
    onError(null, "mods:status");
  }

  async function writeManaged(
    path: string,
    text: string,
    scope?: "gameplay" | "crosshair" | "sounds",
  ) {
    if (!profileId) throw new Error("Select a profile before saving.");
    if (!cfgComplete.current) throw new Error(CFG_INCOMPLETE_MESSAGE);
    await api.writeManagedCfg(path, text, profileId, scope);
  }

  function pane(tab: SettingsTab) {
    // This closure belongs to the originating retained pane, even after the
    // user navigates elsewhere while its save is queued or in flight.
    const label = tab === "hud" ? "HUD options" : SETTINGS_TAB_LABELS[tab];
    function write(
      // biome-ignore lint/suspicious/noConfusingVoidType: null preserves native picker cancellation through the pane wrapper.
      work: () => Promise<void | null>,
      copy?: { success?: string; failure?: string },
      options?: { picker?: boolean },
    ) {
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
          managedText={files.find((file) => file.path === path)?.text ?? ""}
          onSave={(bindsText) => {
            return write(async () => {
              await writeManaged(path, bindsText);
            });
          }}
        />
      );
    }

    if (tab === "gameplay") {
      const path = gameplayPath(layer);
      const canUseComfigAddons =
        layer === "comfig" && detail !== null && hasBaseVpk(detail.files.map((file) => file.path));
      return (
        <GameplayPane
          profileId={profileId}
          layer={layer}
          effective={maps.effective}
          managedText={files.find((file) => file.path === path)?.text ?? ""}
          transparentViewmodels={comfig.addons.includes("transparent-viewmodels")}
          canUseComfigAddons={canUseComfigAddons}
          onToggleTransparentViewmodels={() => {
            const addons = toggleComfigAddon(comfig.addons, "transparent-viewmodels");
            void write(async () => {
              await api.setComfigAddons(addons);
            });
          }}
          onSave={(gameplayText) =>
            write(async () => {
              await writeManaged(path, gameplayText, "gameplay");
            })
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
            void write(
              async () => {
                await api.installHud(id);
                await hud.reloadLocal();
              },
              { success: "HUD installed", failure: "Could not install" },
            );
          }}
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
          layer={layer}
          effective={maps.effective}
          stockSprites={stockSprites}
          scene={<CrosshairScene api={api} />}
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
      return (
        <ViewmodelPane
          api={api}
          profileId={profileId}
          record={detail?.viewmodel ?? null}
          onBuild={(hidden, preload, hideMode) => {
            void write(
              async () => {
                await api.buildViewmodelPack(hidden, preload, hideMode);
              },
              { success: "Pack built", failure: "Could not build" },
            );
          }}
          onImport={(preload) => {
            return write(
              async () => {
                if ((await api.importViewmodels(preload)) === null) return null;
              },
              { success: "Pack imported", failure: "Could not import" },
              { picker: true },
            );
          }}
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
          // The cvars and the sound files are one change to the user, so they
          // are one write: two would mean two toasts for one edit.
          onSave={(gameplayText, pack) =>
            write(async () => {
              await writeManaged(path, gameplayText, "sounds");
              if (pack) {
                await api.applyHitsounds(pack.hit, pack.kill);
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
          profileId={profileId}
          payload={modsPayload}
          catalog={modsCatalog}
          mods={detail?.mods ?? []}
          loading={modsLoading}
          report={modsReport}
          onDownloadLibrary={() => {
            setModsLoading(true);
            api
              .downloadDefaultMods()
              .then((mods) => {
                setModsCatalog(mods.catalog);
                return refreshModsStatus().then(() => onError(null, "mods:download"));
              })
              .catch((err) => {
                onError(
                  err instanceof Error ? err.message : "Could not download the mod library.",
                  "mods:download",
                );
              })
              .finally(() => setModsLoading(false));
          }}
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
          onInstallGameBananaMod={async (id) => {
            await write(
              async () => {
                await api.installGameBananaMod(id);
                await refreshModsStatus().catch(() => {});
              },
              { success: "Mod installed", failure: "Could not install" },
            );
          }}
        />
      );
    }

    if (tab === "files") {
      return (
        <Suspense fallback={<p className="t-meta">Loading cfg workspace…</p>}>
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
            hudId={cfgHudFolder(
              filesInspection?.detail.files ?? detail?.files ?? [],
              filesInspection?.detail.hud ?? detail?.hud,
            )}
            onSave={(path, text, submission) => {
              return saveFileDraft(submission ?? { profile: profileId, path, text });
            }}
          />
        </Suspense>
      );
    }

    return (
      <LaunchPane
        value={launch}
        saved={launchSeed}
        steamWrite={steamWrite}
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
          });
        }}
      />
    );
  }

  if (visited.current.profile !== profileId) {
    visited.current = { profile: profileId, tabs: new Set() };
  }
  if (profileId) visited.current.tabs.add(tab);
  if (tab === "files" && filesInspection) visited.current.tabs.add("files");

  return (
    <AppStatusProvider
      value={{
        error,
        setError: onError,
        dismissError,
        busy,
        running: running || loading || filesLimited || loadError !== null,
      }}
    >
      {loadError ? (
        <div role="alert" className="mb-4 text-warn">
          <p>{loadError}</p>
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
      {!profileId && loading ? <p>Loading settings…</p> : null}
      {!maps.complete && usesCfgState(tab) ? (
        <p role="alert" className="mb-4 text-warn">
          {maps.reason ?? CFG_INCOMPLETE_MESSAGE}
        </p>
      ) : null}
      {[...visited.current.tabs].map((paneTab) => (
        <SettingsDraftBoundary
          key={`${profileId}:${paneTab}`}
          store={settingsDraftStore}
          profile={profileId}
          tab={paneTab}
          active={tab === paneTab}
          blocked={
            paneTab === "files"
              ? !filesCloseReady || externalBusy
              : inputsBlocked || (!maps.complete && usesCfgState(paneTab))
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
          {pane(paneTab)}
        </SettingsDraftBoundary>
      ))}
    </AppStatusProvider>
  );
}
