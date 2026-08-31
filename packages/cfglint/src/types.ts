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

export interface LintOptions {
  /** exec targets outside the bundle that are considered safe. */
  externalExecAllowlist?: string[];
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
  summary: SummarySection[];
  /** True when no block-tier findings exist. */
  ok: boolean;
}
