import {
  type CfgOrigin,
  cfgPathIsEditable,
  classifyCfgOrigin,
  engineManagedLintOptions,
  lint,
  normalizeCfgPath,
} from "@execs/cfglint";

export { type CfgOrigin, classifyCfgOrigin, normalizeCfgPath } from "@execs/cfglint";

import { canWrite } from "./write-gate";

export type CfgFinding = {
  ruleId: string;
  tier: "block" | "warn" | "info";
  message: string;
  file: string;
  line: number;
  col: number;
  from?: number;
  to?: number;
  category?: "restriction" | "syntax" | "argument" | "availability" | "coverage" | "advice";
  /** Set when the offending command lives inside a bind/alias payload. */
  via?: string;
  /** Block finding demoted because it lives in a provided (non-user) file. */
  advisory: boolean;
};

export type LintBundleResult = {
  ok: boolean;
  safetyComplete: boolean;
  executionComplete: boolean;
  findings: CfgFinding[];
};

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

const ORIGIN_BADGES: Record<CfgOrigin, string | null> = {
  user: null,
  app: "managed",
  engine: "TF2",
  hud: "HUD",
  pack: "pack",
  comfigImport: "comfig",
};

export function cfgFileMeta(path: string, hudId?: string | null): CfgFileMeta {
  const origin = classifyCfgOrigin(path, hudId);

  const editable = cfgPathIsEditable(path, hudId);
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
 * make the file the user is editing unsavable.
 */
export function blockingFindingsForFile(findings: CfgFinding[], path: string | null): CfgFinding[] {
  if (path === null) {
    return [];
  }
  const target = normalizeCfgPath(path);
  return findings.filter(
    (finding) =>
      finding.tier === "block" && !finding.advisory && normalizeCfgPath(finding.file) === target,
  );
}

export function canSaveCfg(
  blockingFindings: CfgFinding[],
  running: boolean,
  busy: boolean,
  dirty: boolean,
  editable = true,
): boolean {
  return blockingFindings.length === 0 && editable && dirty && canWrite(running, busy);
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
      return "badge-error";
    case "warn":
      return "badge-warn";
    case "info":
      return "";
  }
}

export function lintBundle(
  files: { path: string; text: string }[],
  hudId?: string | null,
): LintBundleResult {
  // The player's own cfg: connect/disconnect binds and unresolvable execs warn
  // instead of refusing the save (cfglint `trust: "self"`).
  const result = lint(files, engineManagedLintOptions(files, hudId));
  return {
    ok: result.ok,
    safetyComplete: result.safetyComplete,
    executionComplete: result.executionComplete,
    findings: result.findings.map((finding) => ({
      ruleId: finding.ruleId,
      tier: finding.tier,
      message: finding.message,
      file: finding.file,
      line: finding.line,
      col: finding.col,
      from: finding.from,
      to: finding.to,
      category: finding.category,
      via: finding.via,
      advisory: finding.advisory === true,
    })),
  };
}
