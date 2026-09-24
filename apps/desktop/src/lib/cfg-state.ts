import { type CfgFile, createCfgResolver, engineManagedLintOptions, lint } from "@execs/cfglint";
import type { GameplayLayer } from "./gameplay-ui";

/** Entry points use the selected cfg layer, including mastercomfig's user hooks. */
export function startupCfgEntryPoints(
  search: ReturnType<typeof createCfgResolver>,
  layer: GameplayLayer,
): string[] {
  const startupTargets =
    layer === "comfig"
      ? ["config", "overrides/pre_init", "overrides/setup_hook", "overrides/autoexec"]
      : ["config", "autoexec"];
  return startupTargets.map(search.startup).filter((path) => path !== null);
}

/** Startup user settings only; Files independently reviews every cfg's safety. */
export function mapsFromFiles(
  files: CfgFile[],
  layer: GameplayLayer,
  inventory: readonly { path: string }[] = files,
  hudProjection?: { hudRoots?: readonly string[]; selectedHudRoot?: string | null },
) {
  const retained = new Set((hudProjection?.hudRoots ?? []).map((root) => root.toLowerCase()));
  const selected = hudProjection?.selectedHudRoot?.toLowerCase() ?? null;
  const isInactiveHud = ({ path }: { path: string }) => {
    if (!selected) return false;
    const root = /^tf\/custom\/([^/]+)\//.exec(path.replaceAll("\\", "/").toLowerCase())?.[1];
    return root !== undefined && retained.has(root) && root !== selected;
  };
  const mountedFiles = files.filter((file) => !isInactiveHud(file));
  const mountedInventory = inventory.filter((file) => !isInactiveHud(file));
  const search = createCfgResolver(mountedFiles.map((file) => file.path));
  // mastercomfig's packaged autoexec owns launch and calls these user hooks in
  // order. Its user autoexec lives in overrides; a stray vanilla autoexec is
  // not another startup root for that layer.
  const entryPoints = startupCfgEntryPoints(search, layer);
  const result = lint(mountedFiles, {
    ...engineManagedLintOptions(mountedFiles),
    entryPoints,
  });
  const prefix = layer === "comfig" ? "overrides/" : "";
  // Native saves update only the user's autoexec and managed cfgs. If a pack
  // shadows that route, a successful disk write cannot establish the selected
  // settings. Do not rewrite provided pack files to make the save execute.
  const shadowed =
    ["autoexec", "execs_binds", "execs_gameplay"].some((stem) => {
      const target = `${prefix}${stem}`;
      const resolved = search.resolve(target);
      return resolved !== null && resolved !== `tf/cfg/${target}.cfg`;
    }) ||
    (layer === "comfig" && search.resolve("autoexec")?.startsWith("tf/custom/") === true);
  // If native cannot resolve a projection, multiple HUD-like roots with CFG
  // bytes remain ambiguous. Otherwise inactive retained roots are excluded.
  const hudRoots = new Set(
    mountedInventory.flatMap(({ path }) => {
      const marker = /^tf\/custom\/([^/]+)\/(?:info\.vdf$|resource\/ui\/)/.exec(
        path.replaceAll("\\", "/").toLowerCase(),
      );
      return marker ? [marker[1]] : [];
    }),
  );
  const uncertainHuds =
    hudRoots.size > 1 &&
    mountedFiles.some(({ path }) => {
      const cfg = /^tf\/custom\/([^/]+)\/cfg\//.exec(path.replaceAll("\\", "/").toLowerCase());
      return cfg !== null && hudRoots.has(cfg[1]);
    });
  const complete = result.executionComplete && !shadowed && !uncertainHuds;
  const unresolved = result.findings.find(
    (finding) =>
      finding.ruleId === "execution-incomplete" || finding.ruleId === "execution-unsupported",
  );
  const unknownCommand = /^Startup (\S+) has no inspected implementation/.exec(
    unresolved?.message ?? "",
  )?.[1];
  const catalogHint = result.findings.find(
    (finding) =>
      finding.ruleId === "unknown-command" &&
      finding.file === unresolved?.file &&
      finding.line === unresolved.line &&
      finding.message.startsWith(`\`${unknownCommand}\``),
  );
  const suggestion = /did you mean `([^`]+)`\?/.exec(catalogHint?.message ?? "")?.[1];
  return {
    binds: complete ? Object.fromEntries(result.binds) : {},
    bindSources: complete ? Object.fromEntries(result.bindSources) : {},
    effective: complete
      ? Object.fromEntries([...result.effective].map(([name, entry]) => [name, entry.value]))
      : {},
    complete,
    issue:
      !uncertainHuds && !shadowed && unresolved
        ? { path: unresolved.file, line: unresolved.line }
        : null,
    reason: uncertainHuds
      ? CFG_HUD_PROJECTION_MESSAGE
      : shadowed
        ? CFG_SHADOWED_MESSAGE
        : unresolved
          ? unknownCommand
            ? `Cannot derive startup settings after \`${unknownCommand}\` at ${unresolved.file}:${unresolved.line}.${suggestion ? ` Did you mean \`${suggestion}\`?` : " This may be a plugin command or external alias."} Review this line in Files.`
            : `Cannot derive startup settings after ${unresolved.file}:${unresolved.line}. Review this line in Files.`
          : null,
  };
}

export const CFG_INCOMPLETE_MESSAGE =
  "Startup settings could not be resolved. Review the startup cfg in Files before changing these settings.";

export const CFG_SHADOWED_MESSAGE =
  "A custom pack overrides the cfg files used to save these settings. Adjust or remove that pack before changing these controls.";

export const CFG_HUD_PROJECTION_MESSAGE =
  "This profile keeps more than one HUD's cfg files. Use Save current as… to capture only the currently mounted setup before changing these controls.";

export function usesCfgState(tab: string): boolean {
  return ["binds", "gameplay", "crosshair", "sounds"].includes(tab);
}
