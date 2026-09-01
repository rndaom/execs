export interface CfgFile {
  /** Bundle-relative path, forward slashes, e.g. "autoexec.cfg" or "app/extra.cfg". */
  path: string;
  text: string;
}

export interface Token {
  value: string;
  line: number;
  col: number;
  quoted: boolean;
}

export interface Command {
  /** Lowercased first token. */
  name: string;
  args: string[];
  tokens: Token[];
  file: string;
  line: number;
  col: number;
}

export type FindingTier = "block" | "warn" | "info";

export interface Finding {
  ruleId: string;
  tier: FindingTier;
  message: string;
  file: string;
  line: number;
  col: number;
  /** Set when the offending command lives inside a bind/alias payload. */
  via?: string;
  /** True when a block-tier finding was demoted because it sits in an advisory (provided, non-user) file. */
  advisory?: boolean;
}

export interface CvarValue {
  value: string;
  file: string;
  line: number;
}

export type TfClass =
  | "scout"
  | "soldier"
  | "pyro"
  | "demoman"
  | "heavy"
  | "engineer"
  | "medic"
  | "sniper"
  | "spy";

export interface SummaryEntry {
  cvar: string;
  value: string;
  defaultValue?: string;
  help?: string;
}

export interface SummarySection {
  domain: string;
  label: string;
  entries: SummaryEntry[];
}

/**
 * Who authored the files being linted.
 *
 * - `"provided"` (default) — content that arrived from somewhere else and is
 *   being reviewed before it is trusted. Hostile-config rules block.
 * - `"self"` — the player's own cfg, edited in-app. `connect`, a `disconnect`
 *   bind on a gameplay key, and an `exec` the app cannot resolve are ordinary
 *   things to want in a personal config, so they report as warnings and never
 *   refuse a save. The rules that stay block-tier are the ones no personal cfg
 *   needs either: `unbindall`, rcon/password, console lockout, `sv_cheats`,
 *   and aliases shadowing engine commands.
 */
export type LintTrust = "self" | "provided";

export interface LintOptions {
  /** Who wrote these files. Default `"provided"`. See {@link LintTrust}. */
  trust?: LintTrust;
  /** exec targets outside the bundle that are considered safe. */
  externalExecAllowlist?: string[];
  /**
   * Also resolve `exec <target>` against a bundle path that equals `<target>`
   * exactly, not just against paths ending in `/cfg/<target>`.
   *
   * The engine only ever resolves exec targets relative to each search path's
   * cfg folder, so this is off by default: `exec execs_binds` from
   * `tf/cfg/overrides/autoexec.cfg` must NOT find
   * `tf/cfg/overrides/execs_binds.cfg`, exactly as in game. Enable it for flat
   * bundles that have no `cfg/` prefix at all (a bare upload of loose files).
   */
  bundleRelativeExec?: boolean;
  /**
   * Paths written by the Source engine as its local settings snapshot.
   *
   * The engine legitimately emits a top-level `unbindall`, a menu-preserving
   * ESCAPE bind, and the archived `con_enable` preference in `config.cfg`.
   * Those narrow cases are accepted for these paths only; payloads hidden in
   * binds/aliases and every other block-tier rule remain protected.
   */
  engineManagedConfigPaths?: string[];
  /**
   * Files provided by the engine, mastercomfig, or an installed pack rather
   * than authored by the user (HUD cfg folders, comfig-custom imports, Valve
   * extras). Their findings still report, but block-tier findings demote to
   * advisory warnings so provided content can never lock the user's own saves.
   */
  advisoryPaths?: string[];
}

export interface LintResult {
  findings: Finding[];
  /** Last-write-wins cvar state across the evaluated bundle. */
  effective: Map<string, CvarValue>;
  /** key (lowercased) -> payload of the final bind. */
  binds: Map<string, string>;
  /** mastercomfig modules.cfg levels, e.g. { texture_quality: "high" }. */
  moduleLevels: Record<string, string>;
  classesTouched: TfClass[];
  /**
   * Human-readable "what this changes" panel, grouped by domain.
   *
   * Computed lazily on first access and cached: the desktop lints on every
   * keystroke and never reads this.
   */
  summary: SummarySection[];
  /** True when no block-tier findings exist. */
  ok: boolean;
}
