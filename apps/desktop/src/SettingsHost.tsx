import { lint } from "@execs/cfglint";
import { useEffect, useMemo, useRef, useState } from "react";
import { BindsPane } from "./BindsPane";
import { ComfigPane } from "./ComfigPane";
import { CrosshairPane } from "./CrosshairPane";
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
import type {
  HudCatalogEntry,
  HudSchemaView,
  HudUiState,
  ModsCatalog,
  PreloaderReport,
  PreloaderStatusPayload,
  ProfileDetail,
  SteamWriteStatus,
  StockCrosshairSprite,
} from "./lib/bridge";
import {
  type ComfigUiState,
  defaultComfigState,
  hasBaseVpk,
  toggleComfigAddon,
} from "./lib/comfig-ui";
import { gameplayPath } from "./lib/gameplay-ui";
import { HudReloadQueue } from "./lib/hud-reload-ui";
import { emptyHudState } from "./lib/hud-ui";
import { recommendedLaunchOptions } from "./lib/launch-ui";
import { PRELOADER_REPO_URL } from "./lib/mods-ui";
import { SettingsBusyQueue } from "./lib/settings-busy-ui";
import type { SettingsTab } from "./lib/settings-ui";
import { ModsPane } from "./ModsPane";
import { ViewmodelPane } from "./ViewmodelPane";

type CfgText = { path: string; text: string };

function mapsFromFiles(files: CfgText[]): {
  binds: Record<string, string>;
  effective: Record<string, string>;
} {
  const result = lint(files);
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
  const [localBusy, setLocalBusy] = useState(false);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [files, setFiles] = useState<CfgText[]>([]);
  const [comfig, setComfig] = useState<ComfigUiState>(defaultComfigState);
  const [launch, setLaunch] = useState(recommendedLaunchOptions);
  const [launchSaved, setLaunchSaved] = useState<{ sent: string; saved: string } | null>(null);
  const [steamWrite, setSteamWrite] = useState<SteamWriteStatus | null>(null);
  const [hudCatalog, setHudCatalog] = useState<HudCatalogEntry[]>([]);
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
  const [settingsBusyQueue] = useState(
    () =>
      new SettingsBusyQueue((next) => {
        setLocalBusy(next);
        onBusyChange(next);
      }),
  );
  const hudRequest = useRef(0);
  const hudReloadQueue = useRef(new HudReloadQueue());
  /** Guards `reload()` the way `hudRequest` guards `reloadHud()`. */
  const loadRequest = useRef(0);

  // A write in flight when this host unmounts still calls release() on the dead
  // instance, which would leave App.settingsBusy latched true — switch, wizard
  // apply and the whole ready panel disabled with no way back but a restart.
  // biome-ignore lint/correctness/useExhaustiveDependencies: unmount only; onBusyChange is stable.
  useEffect(() => {
    return () => {
      onBusyChange(false);
    };
  }, []);

  const busy = externalBusy || localBusy;
  const layer = detail?.layer ?? "comfig";
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
    const cfgPaths = (next?.files ?? []).filter((file) => file.path.toLowerCase().endsWith(".cfg"));
    const loaded: CfgText[] = [];
    for (const file of cfgPaths) {
      // One unreadable cfg must not abort the whole load: `files` would keep
      // its stale value and every pane would reseed from its defaults, which
      // reads to the user as "my settings reverted".
      try {
        const content = await api.readProfileFile(file.path);
        if (stale()) {
          return;
        }
        if (content.text !== null) {
          loaded.push({ path: content.path, text: content.text });
        }
      } catch {
        // Tracked but unreadable (missing blob, path outside the profile).
      }
    }
    let nextFiles = loaded;
    const nextLayer = next?.layer ?? "comfig";
    if (opts?.syncBinds && !running) {
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

  // Previews for library crosshairs stored in the installed pack.
  const crosshairLibraryKey = JSON.stringify(detail?.crosshair?.library ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by library content.
  useEffect(() => {
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

  async function runWrite(work: () => Promise<void>) {
    // The queue already serializes settings work — refusing a second write
    // because one is in flight silently dropped clicks the panes had already
    // applied optimistically. Only an *external* operation still blocks, and
    // it says so instead of no-oping.
    if (externalBusy) {
      onError("Another change is still saving.");
      return;
    }
    onError(null);
    try {
      await settingsBusyQueue.run(async () => {
        await work();
        await reload();
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save that setting.");
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
            void runWrite(async () => {
              await api.updateComfigVpks();
            });
          }}
          onImportCustom={() => {
            void runWrite(async () => {
              await api.importComfigCustom();
            });
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
          onSave={(gameplayText) => {
            void runWrite(async () => {
              await writeManaged(path, gameplayText, EXECS_GAMEPLAY_STEM);
            });
          }}
        />
      );
    }

    if (tab === "hud") {
      return (
        <HudPane
          running={running}
          busy={busy}
          catalogLoading={hudCatalogLoading}
          catalogError={hudCatalogError}
          catalog={hudCatalog}
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
            void runWrite(async () => {
              await api.installHud(id);
              await reloadHud(false);
            });
          }}
          onUpdate={() => {
            void runWrite(async () => {
              await api.updateHud();
              await reloadHud(false);
            });
          }}
          onMatch={(id) => {
            void runWrite(async () => {
              await api.matchHudCatalog(id);
              await reloadHud(false);
            });
          }}
          onApplyOptions={(options) => {
            void runWrite(async () => {
              await api.applyHudOptions(options);
              await reloadHud(false);
            });
          }}
        />
      );
    }

    if (tab === "crosshair") {
      const path = gameplayPath(layer);
      return (
        <CrosshairPane
          running={running}
          busy={busy}
          record={detail?.crosshair ?? null}
          layer={layer}
          effective={maps.effective}
          stockSprites={stockSprites}
          packPreviews={packPreviews}
          managedText={files.find((file) => file.path === path)?.text ?? ""}
          onSaveStock={(gameplayText) => {
            void runWrite(async () => {
              await writeManaged(path, gameplayText, EXECS_GAMEPLAY_STEM);
            });
          }}
          onApply={(shape, assignments, customRgba, color, library, design) => {
            void runWrite(async () => {
              await api.applyCrosshairs(shape, assignments, customRgba, color, library, design);
            });
          }}
          onRemove={() => {
            void runWrite(async () => {
              await api.removeCrosshairs();
            });
          }}
        />
      );
    }

    if (tab === "viewmodels") {
      return (
        <ViewmodelPane
          running={running}
          busy={busy}
          record={detail?.viewmodel ?? null}
          onBuild={(hidden, preload, hideMode) => {
            void runWrite(async () => {
              await api.buildViewmodelPack(hidden, preload, hideMode);
            });
          }}
          onImport={(preload) => {
            void runWrite(async () => {
              await api.importViewmodels(preload);
            });
          }}
          onRemove={() => {
            void runWrite(async () => {
              await api.removeViewmodels();
            });
          }}
          onTogglePreload={(enabled) => {
            void runWrite(async () => {
              await api.setViewmodelPreload(enabled);
            });
          }}
        />
      );
    }

    if (tab === "mods") {
      return (
        <ModsPane
          running={running}
          busy={busy}
          payload={modsPayload}
          catalog={modsCatalog}
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
          onApply={(addons, particleMods) => {
            void runWrite(async () => {
              try {
                setModsReport(await api.applyPreloaderMods(addons, particleMods));
              } finally {
                // A failed apply still restored the previous install
                // backend-side; the pane must reflect that, not the old state.
                await refreshModsStatus().catch(() => {});
              }
            });
          }}
          onToggleBypass={(enabled) => {
            void runWrite(async () => {
              setModsPayload(await api.setGameinfoBypass(enabled));
            });
          }}
          onRevert={() => {
            void runWrite(async () => {
              try {
                await api.revertPreloader();
                setModsReport(null);
              } finally {
                await refreshModsStatus().catch(() => {});
              }
            });
          }}
          onOpenRepo={() => {
            void api.openExternal(PRELOADER_REPO_URL);
          }}
        />
      );
    }

    if (tab === "files") {
      return (
        <FilesPane
          files={files}
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
        steamWrite={steamWrite}
        lastSave={launchSaved}
        onChange={(next) => {
          setLaunch(next);
          setLaunchSaved(null);
        }}
        onSave={() => {
          const sent = launch;
          void runWrite(async () => {
            const result = await api.setProfileLaunchOptions(sent);
            setLaunch(result.launchOptions);
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
