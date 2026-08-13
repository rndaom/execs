// @execs/cfglint — Source-engine cfg parser/linter.
// Built out in increment 3; this stub pins the public API shape.

export interface CfgFile {
  path: string;
  text: string;
}

export type FindingTier = "block" | "warn" | "info";

export interface Finding {
  ruleId: string;
  tier: FindingTier;
  message: string;
  file: string;
  line: number;
  col: number;
}

export interface LintResult {
  findings: Finding[];
  ok: boolean;
}

export function lint(_files: CfgFile[]): LintResult {
  throw new Error("cfglint is implemented in increment 3");
}
