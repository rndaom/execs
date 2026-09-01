import { lint } from "@execs/cfglint";

export type CfgFinding = {
  ruleId: string;
  tier: "block" | "warn" | "info";
  message: string;
  file: string;
  line: number;
  col: number;
  /** Set when the offending command lives inside a bind/alias payload. */
  via?: string;
  /** Block finding demoted because it lives in a provided (non-user) file. */
  advisory: boolean;
};

export type LintBundleResult = {
  ok: boolean;
  findings: CfgFinding[];
};

/** Where a listed cfg file came from — drives editability and lint strictness. */
export type CfgOrigin = "user" | "app" | "engine" | "hud" | "pack" | "comfigImport";

export type CfgFileMeta = {
  path: string;
  origin: CfgOrigin;
  /** Only user-authored and app-managed files (plus config.cfg) can be edited in-app. */
  editable: boolean;
  /** Advisory files report findings but never block saves. */
  advisory: boolean;
  /** Short origin badge for the file list; null for the user's own files. */
  badge: string | null;
};

const ENGINE_MANAGED_CONFIG_PATH = "tf/cfg/config.cfg";

/** Valve-shipped cfg that can leak into snapshots — never user-authored. */
const ENGINE_EXTRA_NAMES = new Set([
  "mtp.cfg",
  "360controller.cfg",
  "360controller-linux.cfg",
  "undo360controller.cfg",
  "config_default.cfg",
]);

/** Files the app itself serializes (Binds/Gameplay/Comfig/Viewmodels panes). */
const APP_MANAGED_NAMES = new Set([
  "execs_binds.cfg",
  "execs_gameplay.cfg",
  "execs_preload.cfg",
  "modules.cfg",
  "setup_hook.cfg",
]);

const ORIGIN_BADGES: Record<CfgOrigin, string | null> = {
  user: null,
  app: "managed",
  engine: "TF2",
  hud: "HUD",
  pack: "pack",
  comfigImport: "comfig",
};

export function classifyCfgOrigin(path: string, hudId?: string | null): CfgOrigin {
  const norm = normalizeCfgPath(path);
  const name = norm.split("/").pop() ?? norm;
  if (norm === ENGINE_MANAGED_CONFIG_PATH) {
    return "engine";
  }
  if (ENGINE_EXTRA_NAMES.has(name)) {
    return "engine";
  }
  if (norm.startsWith("tf/custom/comfig-custom/")) {
    return "comfigImport";
  }
  if (norm.startsWith("tf/custom/")) {
    const hud = hudId?.toLowerCase();
    if (hud && (norm.startsWith(`tf/custom/${hud}/`) || norm.startsWith(`tf/custom/-${hud}/`))) {
      return "hud";
    }
    return "pack";
  }
  if (APP_MANAGED_NAMES.has(name)) {
    return "app";
  }
  return "user";
}

export function cfgFileMeta(path: string, hudId?: string | null): CfgFileMeta {
  const origin = classifyCfgOrigin(path, hudId);
  const isConfigCfg = normalizeCfgPath(path) === ENGINE_MANAGED_CONFIG_PATH;
  const editable = origin === "user" || origin === "app" || isConfigCfg;
  // config.cfg stays strict (with the narrow engine-managed exemptions); every
  // other non-user origin is advisory-only.
  const advisory = !editable;
  return { path, origin, editable, advisory, badge: ORIGIN_BADGES[origin] };
}

export function cfgFiles(files: { path: string }[], hudId?: string | null): CfgFileMeta[] {
  return files
    .filter((file) => file.path.toLowerCase().endsWith(".cfg"))
    .map((file) => cfgFileMeta(file.path, hudId))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Block-tier findings that belong to `path` itself.
 *
 * Advisory findings never block, and findings in *other* files are the
 * business of those files — a stray `unbindall` in an unrelated cfg must not
 * make the file the user is editing unsavable (RND-157 scopes the refusal to
 * the file being saved).
 */
export function blockingFindingsForFile(findings: CfgFinding[], path: string | null): CfgFinding[] {
  if (path === null) {
    return [];
  }
  const target = normalizeCfgPath(path);
  return findings.filter(
    (finding) =>
      finding.tier === "block" &&
      !finding.advisory &&
      normalizeCfgPath(finding.file) === target,
  );
}

export function canSaveCfg(
  blockingFindings: CfgFinding[],
  running: boolean,
  busy: boolean,
  dirty: boolean,
  editable = true,
): boolean {
  return blockingFindings.length === 0 && editable && !running && !busy && dirty;
}

/**
 * Reseed a pane draft only when the incoming content actually changed, and
 * never over unsaved edits: `reload()` hands every pane brand-new object
 * identities even when the bytes are identical, which otherwise silently
 * discards whatever the user was typing.
 */
export function shouldReseedDraft(
  prevSerialized: string | null,
  nextSerialized: string,
  dirty: boolean,
): boolean {
  if (prevSerialized === null) {
    return true;
  }
  if (prevSerialized === nextSerialized) {
    return false;
  }
  return !dirty;
}

export function findingTierClass(tier: "block" | "warn" | "info"): string {
  switch (tier) {
    case "block":
      return "bg-team-red text-ink";
    case "warn":
      return "bg-q-strange text-on-brand";
    case "info":
      return "bg-panel-raised text-ink";
  }
}

export function lintBundle(
  files: { path: string; text: string }[],
  hudId?: string | null,
): LintBundleResult {
  const engineManagedConfigPaths = files
    .filter((file) => normalizeCfgPath(file.path) === ENGINE_MANAGED_CONFIG_PATH)
    .map((file) => file.path);
  const advisoryPaths = files
    .filter((file) => cfgFileMeta(file.path, hudId).advisory)
    .map((file) => file.path);
  const result = lint(files, { engineManagedConfigPaths, advisoryPaths });
  return {
    ok: result.ok,
    findings: result.findings.map((finding) => ({
      ruleId: finding.ruleId,
      tier: finding.tier,
      message: finding.message,
      file: finding.file,
      line: finding.line,
      col: finding.col,
      via: finding.via,
      advisory: finding.advisory === true,
    })),
  };
}

export function normalizeCfgPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}
