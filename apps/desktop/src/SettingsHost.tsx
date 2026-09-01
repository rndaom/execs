import { lint } from "@execs/cfglint";
import { useEffect, useMemo, useRef, useState } from "react";
import { BindsPane } from "./BindsPane";
import { ComfigPane } from "./ComfigPane";
import { CrosshairPane } from "./CrosshairPane";
import { FilesPane } from "./FilesPane";
import { GameplayPane } from "./GameplayPane";
import { HudPane } from "./HudPane";
import { LaunchPane } from "./LaunchPane";
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
  applyCrosshairs,
  applyHudOptions,
  applyPreloaderMods,
  buildViewmodelPack,
  type ComfigPreset,
  downloadDefaultMods,
  getActiveProfileDetail,
  getComfigState,
  getDefaultMods,
  getHudCatalog,
  getHudSchema,
  getHudState,
  getPackCrosshairPreviews,
  getPreloaderStatus,
  getProfileLaunchOptions,
  getStockCrosshairSprites,
  type HudCatalogEntry,
  type HudSchemaView,
  type HudUiState,
  importComfigCustom,
  importViewmodels,
  installHud,
  isTauri,
  type ModsCatalog,
  matchHudCatalog,
  type OfficialAddon,
  openExternal,
  type PreloaderReport,
  type PreloaderStatusPayload,
  type ProfileDetail,
  readProfileFile,
  removeCrosshairs,
  removeViewmodels,
  revertPreloader,
  type SteamWriteStatus,
  type StockCrosshairSprite,
  setComfigAddons,
  setComfigModules,
  setComfigPreset,
  setGameinfoBypass,
  setProfileLaunchOptions,
  setViewmodelPreload,
  updateComfigVpks,
  updateHud,
  writeOwnedFile,
} from "./lib/bridge";
import {
  defaultComfigState,
  hasBaseVpk,
  PREVIEW_COMFIG_STATE,
  type PreviewComfigState,
  toggleComfigAddon,
} from "./lib/comfig-ui";
import { previewCrosshairRecord } from "./lib/crosshair-ui";
import { gameplayPath } from "./lib/gameplay-ui";
import { HudReloadQueue } from "./lib/hud-reload-ui";
import {
  emptyHudState,
  PREVIEW_HUD_CATALOG,
  PREVIEW_HUD_SCHEMA,
  previewInstalledState,
  schemaSupportedIds,
} from "./lib/hud-ui";
import { recommendedLaunchOptions as previewLaunchOptions } from "./lib/launch-ui";
import { PRELOADER_REPO_URL, PREVIEW_MODS_CATALOG, PREVIEW_MODS_STATUS } from "./lib/mods-ui";
import type { PreviewState } from "./lib/preview";
import { SettingsBusyQueue } from "./lib/settings-busy-ui";
import type { SettingsTab } from "./lib/settings-ui";
import { previewViewmodelRecord } from "./lib/viewmodel-ui";
import { ModsPane } from "./ModsPane";
import { ViewmodelPane } from "./ViewmodelPane";

type CfgText = { path: string; text: string };

const PREVIEW_FILES: CfgText[] = [
  {
    path: "tf/cfg/overrides/autoexec.cfg",
    text: "exec execs_binds // execs:managed\nexec execs_gameplay // execs:managed\nhost_writeconfig\n",
  },
  {
    path: "tf/cfg/overrides/danger.cfg",
    text: "unbindall\n",
  },
  {
    path: "tf/cfg/overrides/execs_binds.cfg",
    text: "// execs binds — managed, do not edit by hand\nbind w +forward\nbind space +jump\n",
  },
  {
    path: "tf/cfg/overrides/execs_gameplay.cfg",
    text: "// execs gameplay — managed, do not edit by hand\nfov_desired 90\nviewmodel_fov 70\n",
  },
  {
    path: "tf/cfg/config.cfg",
    text: "bind w +forward\nbind space +jump\nfov_desired 90\n",
  },
];

const PREVIEW_BINDS: Record<string, string> = {
  w: "+forward",
  s: "+back",
  space: "+jump",
};

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

function comfigPreviewFromState(state: {
  preset: ComfigPreset;
  modules: Record<string, string>;
  addons: OfficialAddon[];
}): PreviewComfigState {
  return {
    preset: state.preset,
    modules: state.modules,
    addons: state.addons,
  };
}

function upsertFile(files: CfgText[], path: string, text: string): CfgText[] {
  if (files.some((file) => file.path === path)) {
    return files.map((file) => (file.path === path ? { path, text } : file));
  }
  return [...files, { path, text }];
}

export function SettingsHost({
  tab,
  running,
  externalBusy,
  preview,
  refreshKey,
  bindSyncRequest,
  onBindSyncHandled,
  onBusyChange,
  onError,
}: {
  tab: SettingsTab;
  running: boolean;
  externalBusy: boolean;
  preview: PreviewState;
  refreshKey: string | number;
  bindSyncRequest: number | null;
  onBindSyncHandled: (request: number) => void;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const tauri = isTauri();
  const [localBusy, setLocalBusy] = useState(false);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [files, setFiles] = useState<CfgText[]>(() => (tauri ? [] : PREVIEW_FILES));
  // Never seed the real app with demo data: until the first reload lands, the
  // Comfig and Gameplay panes must show nothing rather than someone else's
  // preset, module overrides and addons.
  const [comfig, setComfig] = useState<PreviewComfigState>(() =>
    tauri ? defaultComfigState() : PREVIEW_COMFIG_STATE,
  );
  const [launch, setLaunch] = useState(() => previewLaunchOptions("linux"));
  const [steamWrite, setSteamWrite] = useState<SteamWriteStatus | null>(null);
  const [hudCatalog, setHudCatalog] = useState<HudCatalogEntry[]>(() =>
    tauri ? [] : PREVIEW_HUD_CATALOG,
  );
  const [hudState, setHudState] = useState<HudUiState>(() =>
    !tauri && preview === "settings-hud-installed" ? previewInstalledState() : emptyHudState(),
  );
  const [hudSchema, setHudSchema] = useState<HudSchemaView | null>(() =>
    !tauri && preview === "settings-hud-installed" ? PREVIEW_HUD_SCHEMA : null,
  );
  const [hudCatalogLoading, setHudCatalogLoading] = useState(tauri);
  const [hudCatalogError, setHudCatalogError] = useState<string | null>(null);
  const [stockSprites, setStockSprites] = useState<Record<string, StockCrosshairSprite> | null>(
    null,
  );
  const stockSpritesRequested = useRef(false);
  const [packPreviews, setPackPreviews] = useState<Record<string, StockCrosshairSprite> | null>(
    null,
  );
  const [modsPayload, setModsPayload] = useState<PreloaderStatusPayload | null>(() =>
    tauri ? null : PREVIEW_MODS_STATUS,
  );
  const [modsCatalog, setModsCatalog] = useState<ModsCatalog | null>(() =>
    tauri ? null : PREVIEW_MODS_CATALOG,
  );
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
    if (!tauri) {
      return;
    }
    // Every profile file is a separate IPC round trip, so a switch can easily
    // start a second reload that finishes first. Without this token the slower
    // (older) load writes the previous profile's files into state — and the
    // panes would then save profile A's content into profile B.
    const request = ++loadRequest.current;
    const stale = () => request !== loadRequest.current;

    const next = await getActiveProfileDetail();
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
        const content = await readProfileFile(file.path);
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
        await writeOwnedFile(bindsPath, synced);
        if (stale()) {
          return;
        }
        nextFiles = upsertFile(nextFiles, bindsPath, synced);
      }
    }
    setFiles(nextFiles);
    const state = await getComfigState();
    if (stale()) {
      return;
    }
    // A vanilla-layer profile returns null: clear the pane rather than leaving
    // the previous profile's preset and addons on screen.
    setComfig(state ? comfigPreviewFromState(state) : defaultComfigState());
    const nextLaunch = next?.launchOptions || (await getProfileLaunchOptions());
    if (stale()) {
      return;
    }
    setLaunch(nextLaunch);
  }

  async function reloadHud(refresh: boolean, showCatalogProgress = false) {
    if (!tauri) {
      return;
    }
    const request = ++hudRequest.current;
    if (showCatalogProgress) {
      setHudCatalogLoading(true);
      setHudCatalogError(null);
    }
    return hudReloadQueue.current.enqueue(async () => {
      try {
        const nextCatalog = await getHudCatalog(refresh);
        if (request !== hudRequest.current) {
          return;
        }
        setHudCatalogError(null);
        const nextState = await getHudState();
        if (request !== hudRequest.current) {
          return;
        }
        setHudCatalog(nextCatalog);
        setHudState(nextState);
        if (nextState.schemaSupported) {
          const nextSchema = await getHudSchema();
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
    if (!tauri || externalBusy) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri, refreshKey, bindSyncRequest, running, externalBusy]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload the catalog only on HUD entry or an external refresh.
  useEffect(() => {
    if (!tauri || tab !== "hud" || externalBusy) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri, tab, refreshKey, externalBusy]);

  // Decode Valve's stock crosshair sprites once, on first Crosshair visit —
  // pixel-perfect previews straight from the user's own game files.
  useEffect(() => {
    if (!tauri || tab !== "crosshair" || stockSpritesRequested.current) {
      return;
    }
    stockSpritesRequested.current = true;
    getStockCrosshairSprites()
      .then(setStockSprites)
      .catch(() => {
        /* geometry fallback stays in place */
      });
  }, [tauri, tab]);

  // Previews for library crosshairs stored in the installed pack.
  const crosshairLibraryKey = JSON.stringify(detail?.crosshair?.library ?? null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by library content.
  useEffect(() => {
    if (!tauri || tab !== "crosshair" || !detail?.crosshair?.library) {
      return;
    }
    let cancelled = false;
    getPackCrosshairPreviews()
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
  }, [tauri, tab, crosshairLibraryKey]);

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
    if (!tauri || tab !== "mods") {
      return;
    }
    let cancelled = false;
    getPreloaderStatus()
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setModsPayload(payload);
        if (payload.modsCached) {
          setModsLoading(true);
          getDefaultMods()
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
  }, [tauri, tab, refreshKey]);

  async function refreshModsStatus() {
    setModsPayload(await getPreloaderStatus());
  }

  async function writeManaged(
    path: string,
    text: string,
    stem: typeof EXECS_BINDS_STEM | typeof EXECS_GAMEPLAY_STEM,
  ) {
    await writeOwnedFile(path, text);
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
      await writeOwnedFile(autoPath, next);
    }
  }

  if (tab === "comfig") {
    return (
      <ComfigPane
        running={running}
        busy={busy}
        detail={detail}
        preview={!tauri}
        previewState={comfig}
        onApplyPreset={(preset) => {
          if (!tauri) {
            setComfig({ ...comfig, preset });
            return;
          }
          void runWrite(async () => {
            await setComfigPreset(preset);
          });
        }}
        onApplyModules={(modules) => {
          if (!tauri) {
            setComfig({ ...comfig, modules });
            return;
          }
          void runWrite(async () => {
            await setComfigModules(modules);
          });
        }}
        onToggleAddon={(id) => {
          const addons = toggleComfigAddon(comfig.addons, id);
          if (!tauri) {
            setComfig({ ...comfig, addons });
            return;
          }
          void runWrite(async () => {
            await setComfigAddons(addons);
          });
        }}
        onUpdatePackages={() => {
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            await updateComfigVpks();
          });
        }}
        onImportCustom={() => {
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            await importComfigCustom();
          });
        }}
      />
    );
  }

  if (tab === "binds") {
    const path = bindsFilePath(layer);
    return (
      <BindsPane
        running={running}
        busy={busy}
        layer={layer}
        effectiveBinds={tauri ? maps.binds : PREVIEW_BINDS}
        managedText={files.find((file) => file.path === path)?.text ?? ""}
        onSave={(bindsText) => {
          if (!tauri) {
            setFiles((current) => upsertFile(current, path, bindsText));
            return;
          }
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
      layer === "comfig" &&
      (tauri ? detail !== null && hasBaseVpk(detail.files.map((file) => file.path)) : true);
    return (
      <GameplayPane
        running={running}
        busy={busy}
        layer={layer}
        effective={maps.effective}
        managedText={files.find((file) => file.path === path)?.text ?? ""}
        transparentViewmodels={comfig.addons.includes("transparent-viewmodels")}
        canUseComfigAddons={canUseComfigAddons}
        onToggleTransparentViewmodels={() => {
          const addons = toggleComfigAddon(comfig.addons, "transparent-viewmodels");
          if (!tauri) {
            setComfig({ ...comfig, addons });
            return;
          }
          void runWrite(async () => {
            await setComfigAddons(addons);
          });
        }}
        onSave={(gameplayText) => {
          if (!tauri) {
            setFiles((current) => upsertFile(current, path, gameplayText));
            return;
          }
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
          if (!tauri) {
            setHudCatalog(PREVIEW_HUD_CATALOG);
            return;
          }
          void reloadHud(true, true)
            .then(() => onError(null))
            .catch((err) => {
              onError(err instanceof Error ? err.message : "Could not refresh the HUD catalog.");
            });
        }}
        onInstall={(id) => {
          if (!tauri) {
            const entry = hudCatalog.find((item) => item.id === id);
            if (!entry?.github) {
              return;
            }
            const supported = schemaSupportedIds().includes(id);
            setHudState({
              installed: {
                id,
                hash: entry.hash,
                source: "hudDb",
                options: {},
              },
              inferred: false,
              schemaSupported: supported,
              catalogHash: entry.hash,
              updateAvailable: false,
            });
            setHudSchema(supported ? PREVIEW_HUD_SCHEMA : null);
            return;
          }
          void runWrite(async () => {
            await installHud(id);
            await reloadHud(false);
          });
        }}
        onUpdate={() => {
          if (!tauri) {
            if (!hudState.installed || !hudState.catalogHash) {
              return;
            }
            setHudState({
              ...hudState,
              installed: { ...hudState.installed, hash: hudState.catalogHash },
              updateAvailable: false,
            });
            return;
          }
          void runWrite(async () => {
            await updateHud();
            await reloadHud(false);
          });
        }}
        onMatch={(id) => {
          if (!tauri) {
            const entry = hudCatalog.find((item) => item.id === id);
            setHudState({
              installed: {
                id,
                hash: entry?.hash ?? null,
                source: "hudDb",
                options: hudState.installed?.options ?? {},
              },
              inferred: false,
              schemaSupported: schemaSupportedIds().includes(id),
              catalogHash: entry?.hash ?? null,
              updateAvailable: false,
            });
            return;
          }
          void runWrite(async () => {
            await matchHudCatalog(id);
            await reloadHud(false);
          });
        }}
        onApplyOptions={(options) => {
          if (!tauri) {
            if (!hudState.installed) {
              return;
            }
            setHudState({
              ...hudState,
              installed: { ...hudState.installed, options },
            });
            return;
          }
          void runWrite(async () => {
            await applyHudOptions(options);
            await reloadHud(false);
          });
        }}
      />
    );
  }

  if (tab === "crosshair") {
    const path = gameplayPath(layer);
    const previewRecord =
      !tauri && preview === "settings-crosshair" ? previewCrosshairRecord() : null;
    return (
      <CrosshairPane
        running={running}
        busy={busy}
        record={detail?.crosshair ?? previewRecord}
        layer={layer}
        effective={maps.effective}
        stockSprites={stockSprites}
        packPreviews={packPreviews}
        managedText={files.find((file) => file.path === path)?.text ?? ""}
        onSaveStock={(gameplayText) => {
          if (!tauri) {
            setFiles((current) => upsertFile(current, path, gameplayText));
            return;
          }
          void runWrite(async () => {
            await writeManaged(path, gameplayText, EXECS_GAMEPLAY_STEM);
          });
        }}
        onApply={(shape, assignments, customRgba, color, library, design) => {
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            await applyCrosshairs(shape, assignments, customRgba, color, library, design);
          });
        }}
        onRemove={() => {
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            await removeCrosshairs();
          });
        }}
      />
    );
  }

  if (tab === "viewmodels") {
    const previewRecord =
      !tauri && preview === "settings-viewmodels" ? previewViewmodelRecord() : null;
    return (
      <ViewmodelPane
        running={running}
        busy={busy}
        record={detail?.viewmodel ?? previewRecord}
        onBuild={(hidden, preload, hideMode) => {
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            await buildViewmodelPack(hidden, preload, hideMode);
          });
        }}
        onImport={(preload) => {
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            await importViewmodels(preload);
          });
        }}
        onRemove={() => {
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            await removeViewmodels();
          });
        }}
        onTogglePreload={(enabled) => {
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            await setViewmodelPreload(enabled);
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
          if (!tauri) {
            return;
          }
          setModsLoading(true);
          onError(null);
          downloadDefaultMods()
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
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            try {
              const report = await applyPreloaderMods(addons, particleMods);
              setModsReport(report);
            } finally {
              // A failed apply still restored the previous install
              // backend-side; the pane must reflect that, not the old state.
              await refreshModsStatus().catch(() => {});
            }
          });
        }}
        onToggleBypass={(enabled) => {
          if (!tauri) {
            setModsPayload((current) =>
              current
                ? {
                    ...current,
                    status: { ...current.status, gameinfoBypassed: enabled },
                  }
                : current,
            );
            return;
          }
          void runWrite(async () => {
            setModsPayload(await setGameinfoBypass(enabled));
          });
        }}
        onRevert={() => {
          if (!tauri) {
            return;
          }
          void runWrite(async () => {
            try {
              await revertPreloader();
              setModsReport(null);
            } finally {
              await refreshModsStatus().catch(() => {});
            }
          });
        }}
        onOpenRepo={() => {
          void openExternal(PRELOADER_REPO_URL);
        }}
      />
    );
  }

  if (tab === "files") {
    return (
      <FilesPane
        running={running}
        busy={busy}
        files={files}
        hudId={detail?.hud?.id ?? null}
        onSave={(path, text) => {
          if (!tauri) {
            setFiles((current) => upsertFile(current, path, text));
            return;
          }
          void runWrite(async () => {
            await writeOwnedFile(path, text);
          });
        }}
      />
    );
  }

  return (
    <LaunchPane
      running={running}
      busy={busy}
      value={launch}
      steamWrite={steamWrite}
      onChange={setLaunch}
      onSave={() => {
        if (!tauri) {
          setSteamWrite("steam_open");
          return;
        }
        void runWrite(async () => {
          const result = await setProfileLaunchOptions(launch);
          setLaunch(result.launchOptions);
          setSteamWrite(result.steamWrite);
        });
      }}
    />
  );
}
