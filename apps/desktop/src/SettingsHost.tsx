import { engineManagedLintOptions, lint } from "@execs/cfglint";
import { useEffect, useMemo, useRef, useState } from "react";
import { BindsPane } from "./BindsPane";
import { ComfigPane } from "./ComfigPane";
import { CrosshairPane } from "./CrosshairPane";
import { useToast } from "./components/ui/Toast";
import { FilesPane } from "./FilesPane";
import { GameplayPane } from "./GameplayPane";
import { HudPane } from "./HudPane";
import { AppStatusProvider, useAppStatus } from "./hooks/useAppStatus";
import { LaunchPane } from "./LaunchPane";
import type { Api } from "./lib/api";
import {
  autoexecFilePath,
  bindsFilePath,
  configBindsFromFiles,
  EXECS_BINDS_STEM,
  EXECS_GAMEPLAY_STEM,
  ensureAutoexecExecLine,
  MANAGED_EXEC_STEMS,
  managedCfgPath,
  shouldSyncTrackedBinds,
  syncTrackedBindsFromConfig,
} from "./lib/binds-ui";
import {
  type HudCatalogEntry,
  type HudSchemaView,
  type HudStat,
  type HudUiState,
  type ModsCatalog,
  type PreloaderReport,
  type PreloaderStatusPayload,
  type ProfileDetail,
  parseInvokeError,
  type SteamWriteStatus,
  type StockCrosshairSprite,
} from "./lib/bridge";
import {
  type ComfigUiState,
  defaultComfigState,
  hasBaseVpk,
  toggleComfigAddon,
} from "./lib/comfig-ui";
import { addEditorTextToBudget, editorCfgCandidates } from "./lib/files-limits";
import { gameplayPath } from "./lib/gameplay-ui";
import { HudReloadQueue } from "./lib/hud-reload-ui";
import { emptyHudState } from "./lib/hud-ui";
import { recommendedLaunchOptions } from "./lib/launch-ui";
import { type ModSelection, PRELOADER_REPO_URL } from "./lib/mods-ui";
import { SettingsBusyQueue } from "./lib/settings-busy-ui";
import type { SettingsTab } from "./lib/settings-ui";
import { ModsPane } from "./ModsPane";
import { SoundsPane } from "./SoundsPane";
import { ViewmodelPane } from "./ViewmodelPane";

type CfgText = { path: string; text: string };

function mapsFromFiles(files: CfgText[]): {
  binds: Record<string, string>;
  effective: Record<string, string>;
} {
  // Same options as the Files pane, so config.cfg's engine-managed ESCAPE bind
  // and archived console preference reach the derived maps.
  const result = lint(files, engineManagedLintOptions(files));
  const binds: Record<string, string> = {};
  for (const [key, value] of result.binds) {
    binds[key] = value;
  }
  const effective: Record<string, string> = {};
  for (const [name, entry] of result.effective) {
    effective[name] = entry.value;
  }
  return { binds, effective };
}

function upsertFile(files: CfgText[], path: string, text: string): CfgText[] {
  if (files.some((file) => file.path === path)) {
    return files.map((file) => (file.path === path ? { path, text } : file));
  }
  return [...files, { path, text }];
}

export function SettingsHost({
  api,
  tab,
  running,
  externalBusy,
  refreshKey,
  bindSyncRequest,
  onBindSyncHandled,
  onBusyChange,
  onError,
}: {
  api: Api;
  tab: SettingsTab;
  running: boolean;
  externalBusy: boolean;
  refreshKey: string | number;
  bindSyncRequest: number | null;
  onBindSyncHandled: (request: number) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const { error } = useAppStatus();
  const toast = useToast();
  const [queueBusy, setQueueBusy] = useState(false);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [files, setFiles] = useState<CfgText[]>([]);
  const [filesLimited, setFilesLimited] = useState(false);
  const [comfig, setComfig] = useState<ComfigUiState>(defaultComfigState);
  const [launch, setLaunch] = useState(recommendedLaunchOptions);
  /** What the profile actually holds — the pane's draft is diffed against it. */
  const [launchSeed, setLaunchSeed] = useState(recommendedLaunchOptions);
  const [launchSaved, setLaunchSaved] = useState<{ sent: string; saved: string } | null>(null);
  const [steamWrite, setSteamWrite] = useState<SteamWriteStatus | null>(null);
  const [hudCatalog, setHudCatalog] = useState<HudCatalogEntry[]>([]);
  const [hudStats, setHudStats] = useState<Record<string, HudStat>>({});
  const [hudState, setHudState] = useState<HudUiState>(emptyHudState);
  const [hudSchema, setHudSchema] = useState<HudSchemaView | null>(null);
  const [hudCatalogLoading, setHudCatalogLoading] = useState(true);
  const [hudCatalogError, setHudCatalogError] = useState<string | null>(null);
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
  const hudRequest = useRef(0);
  const hudReloadQueue = useRef(new HudReloadQueue());
  /** Guards `reload()` the way `hudRequest` guards `reloadHud()`. */
  const loadRequest = useRef(0);

  const repairBusy = modsPayload?.repairInProgress === true;

  // Queue work and Steam verification both own the write surface. Reflect both
  // in App so launch, profile switches, update install, and every pane disable
  // together instead of only locking controls in the Mods pane.
  useEffect(() => {
    onBusyChange(queueBusy || repairBusy);
  }, [onBusyChange, queueBusy, repairBusy]);

  // A write in flight when this host unmounts still calls release() on the dead
  // instance, which would otherwise leave App.settingsBusy latched true.
  useEffect(() => {
    return () => {
      onBusyChange(false);
    };
  }, [onBusyChange]);

  const busy = externalBusy || queueBusy || repairBusy;
  const layer = detail?.layer ?? "comfig";
  // Part of every pane's draft key: switching profiles must discard the drafts
  // on screen, even when the two profiles hold identical content.
  const profileId = detail?.id ?? null;
  const maps = useMemo(() => mapsFromFiles(files), [files]);

  async function reload(opts?: { syncBinds?: boolean }) {
    // Every profile file is a separate IPC round trip, so a switch can easily
    // start a second reload that finishes first. Without this token the slower
    // (older) load writes the previous profile's files into state — and the
    // panes would then save profile A's content into profile B.
    const request = ++loadRequest.current;
    const stale = () => request !== loadRequest.current;

    const next = await api.getActiveProfileDetail();
    if (stale()) {
      return;
    }
    setDetail(next);
    const candidates = editorCfgCandidates(next?.files ?? []);
    const loaded: CfgText[] = [];
    let totalBytes = 0;
    let wasLimited = candidates.limited;
    for (const file of candidates.files) {
      // One unreadable cfg must not abort the whole load: `files` would keep
      // its stale value and every pane would reseed from its defaults, which
      // reads to the user as "my settings reverted".
      try {
        const content = await api.readProfileFile(file.path);
        if (stale()) {
          return;
        }
        if (content.text !== null) {
          const nextTotal = addEditorTextToBudget(totalBytes, content.text);
          if (nextTotal === null) {
            wasLimited = true;
            break;
          }
          totalBytes = nextTotal;
          loaded.push({ path: content.path, text: content.text });
        }
      } catch (error) {
        // Tracked but unreadable (missing blob, path outside the profile).
        const code = parseInvokeError(error).code;
        if (code === "FileTooLarge" || code === "InvalidPath") {
          wasLimited = true;
        }
      }
    }
    setFilesLimited(wasLimited);
    let nextFiles = loaded;
    const nextLayer = next?.layer ?? "comfig";
    // Never derive a managed binds rewrite from a deliberately partial file
    // bundle: a size/count refusal can omit config.cfg or an included exec.
    if (opts?.syncBinds && !running && !wasLimited) {
      const bindsPath = bindsFilePath(nextLayer);
      const managed = nextFiles.find((file) => file.path === bindsPath)?.text ?? "";
      const synced = syncTrackedBindsFromConfig(managed, configBindsFromFiles(nextFiles));
      if (synced !== managed) {
        await api.writeOwnedFile(bindsPath, synced);
        if (stale()) {
          return;
        }
        nextFiles = upsertFile(nextFiles, bindsPath, synced);
      }
    }
    setFiles(nextFiles);
    const state = await api.getComfigState();
    if (stale()) {
      return;
    }
    // A vanilla-layer profile returns null: clear the pane rather than leaving
    // the previous profile's preset and addons on screen.
    setComfig(
      state
        ? { preset: state.preset, modules: state.modules, addons: state.addons }
        : defaultComfigState(),
    );
    const nextLaunch = next?.launchOptions || (await api.getProfileLaunchOptions());
    if (stale()) {
      return;
    }
    setLaunch(nextLaunch);
    setLaunchSeed(nextLaunch);
  }

  async function reloadHud(refresh: boolean, showCatalogProgress = false) {
    const request = ++hudRequest.current;
    if (showCatalogProgress) {
      setHudCatalogLoading(true);
      setHudCatalogError(null);
    }
    return hudReloadQueue.current.enqueue(async () => {
      try {
        const nextCatalog = await api.getHudCatalog(refresh);
        if (request !== hudRequest.current) {
          return;
        }
        setHudCatalogError(null);
        const nextState = await api.getHudState();
        if (request !== hudRequest.current) {
          return;
        }
        setHudCatalog(nextCatalog);
        setHudState(nextState);
        // Numbers are decoration on top of the catalog: fetched after it,
        // never blocking it, and a failure just leaves the sort on names.
        api
          .getHudStats(refresh)
          .then((nextStats) => {
            if (request === hudRequest.current) {
              setHudStats(nextStats);
            }
          })
          .catch(() => {});
        if (nextState.schemaSupported) {
          const nextSchema = await api.getHudSchema();
          if (request === hudRequest.current) {
            setHudSchema(nextSchema);
          }
        } else {
          setHudSchema(null);
        }
      } catch (err) {
        if (request === hudRequest.current) {
          setHudCatalogError(
            err instanceof Error ? err.message : "Check your connection and try again.",
          );
        }
        throw err;
      } finally {
        if (request === hudRequest.current) {
          setHudCatalogLoading(false);
        }
      }
    });
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
          onError(null);
          if (syncBinds && bindSyncRequest !== null) {
            onBindSyncHandled(bindSyncRequest);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Could not load settings.");
        }
      });
    return () => {
      cancelled = true;
    };
    // Ordinary mounts and profile refreshes only reload. A bind sync request is
    // issued after absorb confirms that config.cfg actually drifted.
  }, [refreshKey, bindSyncRequest, running, externalBusy]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload the catalog only on HUD entry or an external refresh.
  useEffect(() => {
    if (tab !== "hud" || externalBusy) {
      return;
    }
    let cancelled = false;
    reloadHud(false, true)
      .then(() => {
        if (!cancelled) {
          onError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Could not load the HUD catalog.");
        }
      });
    return () => {
      cancelled = true;
      hudRequest.current += 1;
      setHudCatalogLoading(false);
    };
  }, [tab, refreshKey, externalBusy]);

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
        stockSpritesRequested.current = false;
        /* geometry fallback stays in place */
      });
    return () => {
      cancelled = true;
    };
  }, [api, tab]);

  // Previews for library crosshairs stored in the installed pack. Keyed by the
  // profile too: two profiles can hold the same library name with different
  // bytes, and the stale pixels would otherwise sit on the chip until the new
  // fetch resolved.
  const crosshairLibraryKey = JSON.stringify([
    detail?.id ?? null,
    detail?.crosshair?.library ?? null,
  ]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by profile + library content.
  useEffect(() => {
    setPackPreviews(null);
    if (tab !== "crosshair" || !detail?.crosshair?.library) {
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
    work: () => Promise<void>,
    copy?: { success?: string; failure?: string },
  ): Promise<boolean> {
    // The queue already serializes settings work — refusing a second write
    // because one is in flight silently dropped clicks the panes had already
    // applied optimistically. Only an *external* operation still blocks, and
    // it says so instead of no-oping.
    if (externalBusy) {
      toast.failSave("another change is still saving", copy?.failure);
      return false;
    }
    onError(null);
    toast.startSave();
    try {
      await settingsBusyQueue.run(async () => {
        await work();
        await reload();
      });
      toast.finishSave(copy?.success);
      return true;
    } catch (err) {
      toast.failSave(err, copy?.failure);
      return false;
    }
  }

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
        if (payload.modsCached) {
          setModsLoading(true);
          api
            .getDefaultMods()
            .then((mods) => {
              if (!cancelled) {
                setModsCatalog(mods.catalog);
              }
            })
            .catch((err) => {
              if (!cancelled) {
                onError(err instanceof Error ? err.message : "Could not read the mod library.");
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
          onError(err instanceof Error ? err.message : "Could not read the preloader state.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, tab, refreshKey]);

  async function refreshModsStatus() {
    setModsPayload(await api.getPreloaderStatus());
  }

  async function writeManaged(
    path: string,
    text: string,
    stem: typeof EXECS_BINDS_STEM | typeof EXECS_GAMEPLAY_STEM,
  ) {
    await api.writeOwnedFile(path, text);
    const autoPath = autoexecFilePath(layer);
    const existing = files.find((file) => file.path === autoPath)?.text ?? "";
    // autoexec.cfg is written whole, so it has to carry every managed stem we
    // own. Patching only the stem being written drops the other pane's exec
    // line — that is how a gameplay apply silently unhooked saved binds.
    let next = ensureAutoexecExecLine(existing, stem, layer);
    for (const sibling of MANAGED_EXEC_STEMS) {
      if (sibling === stem) {
        continue;
      }
      const siblingPath = managedCfgPath(layer, sibling);
      if (siblingPath === path || files.some((file) => file.path === siblingPath)) {
        next = ensureAutoexecExecLine(next, sibling, layer);
      }
    }
    if (next !== existing) {
      await api.writeOwnedFile(autoPath, next);
    }
  }

  function pane() {
    if (tab === "comfig") {
      return (
        <ComfigPane
          detail={detail}
          state={comfig}
          onApplyPreset={(preset) => {
            void runWrite(async () => {
              await api.setComfigPreset(preset);
            });
          }}
          onApplyModules={(modules) => {
            void runWrite(async () => {
              await api.setComfigModules(modules);
            });
          }}
          onToggleAddon={(id) => {
            const addons = toggleComfigAddon(comfig.addons, id);
            void runWrite(async () => {
              await api.setComfigAddons(addons);
            });
          }}
          onUpdatePackages={() => {
            void runWrite(
              async () => {
                await api.updateComfigVpks();
              },
              { success: "Packages up to date", failure: "Could not update" },
            );
          }}
          onImportCustom={() => {
            void runWrite(
              async () => {
                await api.importComfigCustom();
              },
              { success: "comfig-custom imported", failure: "Could not import" },
            );
          }}
        />
      );
    }

    if (tab === "binds") {
      const path = bindsFilePath(layer);
      return (
        <BindsPane
          layer={layer}
          effectiveBinds={maps.binds}
          managedText={files.find((file) => file.path === path)?.text ?? ""}
          onSave={(bindsText) => {
            void runWrite(async () => {
              await writeManaged(path, bindsText, EXECS_BINDS_STEM);
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
            void runWrite(async () => {
              await api.setComfigAddons(addons);
            });
          }}
          onSave={(gameplayText) =>
            runWrite(async () => {
              await writeManaged(path, gameplayText, EXECS_GAMEPLAY_STEM);
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
          catalogLoading={hudCatalogLoading}
          catalogError={hudCatalogError}
          catalog={hudCatalog}
          stats={hudStats}
          state={hudState}
          schema={hudSchema}
          onRefresh={() => {
            void reloadHud(true, true)
              .then(() => onError(null))
              .catch((err) => {
                onError(err instanceof Error ? err.message : "Could not refresh the HUD catalog.");
              });
          }}
          onInstall={(id) => {
            void runWrite(
              async () => {
                await api.installHud(id);
                await reloadHud(false);
              },
              { success: "HUD installed", failure: "Could not install" },
            );
          }}
          onUpdate={() => {
            void runWrite(
              async () => {
                await api.updateHud();
                await reloadHud(false);
              },
              { success: "HUD updated", failure: "Could not update" },
            );
          }}
          onMatch={(id) => {
            void runWrite(
              async () => {
                await api.matchHudCatalog(id);
                await reloadHud(false);
              },
              { failure: "Could not match" },
            );
          }}
          onApplyOptions={(options) =>
            runWrite(async () => {
              await api.applyHudOptions(options);
              await reloadHud(false);
            })
          }
          onImportArchive={() => {
            void runWrite(
              async () => {
                // Cancelling the dialog is a no-op, not an error.
                if (await api.importHudArchive()) {
                  await reloadHud(false);
                }
              },
              { success: "HUD imported", failure: "Could not import" },
            );
          }}
          onImportFolder={() => {
            void runWrite(
              async () => {
                if (await api.importHudFolder()) {
                  await reloadHud(false);
                }
              },
              { success: "HUD imported", failure: "Could not import" },
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
          packPreviews={packPreviews}
          managedText={files.find((file) => file.path === path)?.text ?? ""}
          onSaveStock={(gameplayText) =>
            runWrite(async () => {
              await writeManaged(path, gameplayText, EXECS_GAMEPLAY_STEM);
            })
          }
          onApply={(shape, assignments, customRgba, color, library, design) =>
            runWrite(async () => {
              await api.applyCrosshairs(shape, assignments, customRgba, color, library, design);
            })
          }
          onRemove={() => {
            void runWrite(
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
            void runWrite(
              async () => {
                await api.buildViewmodelPack(hidden, preload, hideMode);
              },
              { success: "Pack built", failure: "Could not build" },
            );
          }}
          onImport={(preload) => {
            void runWrite(
              async () => {
                await api.importViewmodels(preload);
              },
              { success: "Pack imported", failure: "Could not import" },
            );
          }}
          onRemove={() => {
            void runWrite(
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
            runWrite(async () => {
              await writeManaged(path, gameplayText, EXECS_GAMEPLAY_STEM);
              if (pack) {
                await api.applyHitsounds(pack.hit, pack.kill);
              }
            })
          }
          onRemove={() => {
            void runWrite(
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
            onError(null);
            api
              .downloadDefaultMods()
              .then((mods) => {
                setModsCatalog(mods.catalog);
                return refreshModsStatus();
              })
              .catch((err) => {
                onError(err instanceof Error ? err.message : "Could not download the mod library.");
              })
              .finally(() => setModsLoading(false));
          }}
          onApply={(addons, particleMods, profileParticleMods) => {
            void runWrite(
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
            void runWrite(async () => {
              setModsPayload(await api.setGameinfoBypass(enabled));
            });
          }}
          onTogglePreload={(enabled) => {
            void runWrite(async () => {
              setModsPayload(await api.setProfilePreload(enabled));
            });
          }}
          onRevert={() => {
            void runWrite(
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
            void runWrite(
              async () => {
                setModsPayload(await api.recoverPreloader());
              },
              { success: "Recovery finished", failure: "Could not recover" },
            );
          }}
          onRepair={async () => {
            onError(null);
            setModsPayload((current) =>
              current ? { ...current, repairInProgress: true } : current,
            );
            try {
              await api.repairGameFiles();
              await refreshModsStatus();
            } catch (err) {
              // A retry can fail to reopen Steam while an older verification
              // lease is still valid. Ask the backend instead of optimistically
              // unlocking the renderer.
              await refreshModsStatus().catch(() => {});
              onError(err instanceof Error ? err.message : "Could not start the repair.");
              throw err;
            }
          }}
          onCompleteRepair={async (selection: ModSelection) => {
            onError(null);
            let released = false;
            try {
              const complete = await api.completeGameFileRepair();
              if (!complete) {
                await refreshModsStatus();
                onError("Steam's repair is still changing TF2 files. Wait, then confirm again.");
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
              return true;
            } catch (err) {
              onError(err instanceof Error ? err.message : "Could not confirm the repair.");
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
            onError(null);
            try {
              const cancelled = await api.cancelGameFileRepair();
              await refreshModsStatus();
              return cancelled;
            } catch (err) {
              onError(
                err instanceof Error
                  ? err.message
                  : "Could not cancel the repair lock. Close Steam and TF2 first.",
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
            void runWrite(
              async () => {
                // Cancelling the dialog is a no-op, not an error.
                if (await api.importModArchive()) {
                  await refreshModsStatus().catch(() => {});
                }
              },
              { success: "Mod imported", failure: "Could not import" },
            );
          }}
          onImportFolder={() => {
            void runWrite(
              async () => {
                if (await api.importModFolder()) {
                  await refreshModsStatus().catch(() => {});
                }
              },
              { success: "Mod imported", failure: "Could not import" },
            );
          }}
          onRemoveMod={(id) => {
            void runWrite(
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
            await runWrite(
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
        <FilesPane
          profileId={profileId}
          files={files}
          limited={filesLimited}
          hudId={detail?.hud?.id ?? null}
          onSave={(path, text) => {
            void runWrite(async () => {
              await api.writeOwnedFile(path, text);
            });
          }}
        />
      );
    }

    return (
      <LaunchPane
        value={launch}
        saved={launchSeed}
        steamWrite={steamWrite}
        lastSave={launchSaved}
        onChange={(next) => {
          setLaunch(next);
          setLaunchSaved(null);
        }}
        onSave={() => {
          const sent = launch;
          return runWrite(async () => {
            const result = await api.setProfileLaunchOptions(sent);
            setLaunch(result.launchOptions);
            setLaunchSeed(result.launchOptions);
            setLaunchSaved({ sent, saved: result.launchOptions });
            setSteamWrite(result.steamWrite);
          });
        }}
      />
    );
  }

  return (
    <AppStatusProvider value={{ error, setError: onError, busy, running }}>
      {pane()}
    </AppStatusProvider>
  );
}
