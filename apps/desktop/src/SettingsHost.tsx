import { lint } from "@execs/cfglint";
import { useEffect, useMemo, useState } from "react";
import { BindsPane } from "./BindsPane";
import { ComfigPane } from "./ComfigPane";
import { FilesPane } from "./FilesPane";
import { GameplayPane } from "./GameplayPane";
import { HudPane } from "./HudPane";
import { LaunchPane } from "./LaunchPane";
import {
  applyHudOptions,
  getActiveProfileDetail,
  getComfigState,
  getHudCatalog,
  getHudSchema,
  getHudState,
  getProfileLaunchOptions,
  importComfigCustom,
  installHud,
  isTauri,
  matchHudCatalog,
  type OfficialAddon,
  type ProfileDetail,
  readProfileFile,
  setComfigAddons,
  setComfigModules,
  setComfigPreset,
  setProfileLaunchOptions,
  type SteamWriteStatus,
  updateComfigVpks,
  updateHud,
  writeOwnedFile,
  type ComfigPreset,
  type HudCatalogEntry,
  type HudSchemaView,
  type HudUiState,
} from "./lib/bridge";
import {
  autoexecExecPatch,
  autoexecFilePath,
  bindsFilePath,
  configBindsFromFiles,
  EXECS_BINDS_STEM,
  EXECS_GAMEPLAY_STEM,
  syncTrackedBindsFromConfig,
} from "./lib/binds-ui";
import { PREVIEW_COMFIG_STATE, type PreviewComfigState, toggleComfigAddon } from "./lib/comfig-ui";
import { gameplayPath } from "./lib/gameplay-ui";
import {
  emptyHudState,
  PREVIEW_HUD_CATALOG,
  PREVIEW_HUD_SCHEMA,
  previewInstalledState,
  schemaSupportedIds,
} from "./lib/hud-ui";
import { recommendedLaunchOptions as previewLaunchOptions } from "./lib/launch-ui";
import type { PreviewState } from "./lib/preview";
import type { SettingsTab } from "./lib/settings-ui";

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
  preview,
  refreshKey,
  onError,
}: {
  tab: SettingsTab;
  running: boolean;
  preview: PreviewState;
  refreshKey: string | number;
  onError: (message: string | null) => void;
}) {
  const tauri = isTauri();
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ProfileDetail | null>(null);
  const [files, setFiles] = useState<CfgText[]>(() => (tauri ? [] : PREVIEW_FILES));
  const [comfig, setComfig] = useState<PreviewComfigState>(PREVIEW_COMFIG_STATE);
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

  const layer = detail?.layer ?? "comfig";
  const maps = useMemo(() => mapsFromFiles(files), [files]);

  async function reload(opts?: { syncBinds?: boolean }) {
    if (!tauri) {
      return;
    }
    const next = await getActiveProfileDetail();
    setDetail(next);
    const cfgPaths = (next?.files ?? []).filter((file) => file.path.toLowerCase().endsWith(".cfg"));
    const loaded: CfgText[] = [];
    for (const file of cfgPaths) {
      const content = await readProfileFile(file.path);
      if (content.text !== null) {
        loaded.push({ path: content.path, text: content.text });
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
        nextFiles = upsertFile(nextFiles, bindsPath, synced);
      }
    }
    setFiles(nextFiles);
    const state = await getComfigState();
    if (state) {
      setComfig(comfigPreviewFromState(state));
    }
    setLaunch(next?.launchOptions || (await getProfileLaunchOptions()));
  }

  async function reloadHud(refresh: boolean) {
    if (!tauri) {
      return;
    }
    const nextCatalog = await getHudCatalog(refresh);
    const nextState = await getHudState();
    setHudCatalog(nextCatalog);
    setHudState(nextState);
    if (nextState.schemaSupported) {
      setHudSchema(await getHudSchema());
    } else {
      setHudSchema(null);
    }
  }

  useEffect(() => {
    if (!tauri) {
      return;
    }
    let cancelled = false;
    reload({ syncBinds: true })
      .then(() => {
        if (!cancelled) {
          onError(null);
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
    // reload + absorb-sync after TF2 quit / profile switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri, refreshKey]);

  useEffect(() => {
    if (!tauri || tab !== "hud") {
      return;
    }
    let cancelled = false;
    reloadHud(false)
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri, tab, refreshKey]);

  async function runWrite(work: () => Promise<void>) {
    setBusy(true);
    onError(null);
    try {
      await work();
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save that setting.");
    } finally {
      setBusy(false);
    }
  }

  async function writeManaged(
    path: string,
    text: string,
    stem: typeof EXECS_BINDS_STEM | typeof EXECS_GAMEPLAY_STEM,
  ) {
    await writeOwnedFile(path, text);
    const autoPath = autoexecFilePath(layer);
    const existing = files.find((file) => file.path === autoPath)?.text ?? "";
    const patch = autoexecExecPatch(layer, existing, stem);
    if (patch) {
      await writeOwnedFile(patch.path, patch.text);
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
        onOpenExtras={() => {
          window.open("https://comfig.app/app", "_blank", "noreferrer");
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
    return (
      <GameplayPane
        running={running}
        busy={busy}
        layer={layer}
        effective={maps.effective}
        managedText={files.find((file) => file.path === path)?.text ?? ""}
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
        catalog={hudCatalog}
        state={hudState}
        schema={hudSchema}
        onRefresh={() => {
          if (!tauri) {
            setHudCatalog(PREVIEW_HUD_CATALOG);
            return;
          }
          void runWrite(async () => {
            await reloadHud(true);
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

  if (tab === "files") {
    return (
      <FilesPane
        running={running}
        busy={busy}
        files={files}
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
