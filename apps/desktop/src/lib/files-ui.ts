import { lint } from "@execs/cfglint";

export type CfgFinding = {
  ruleId: string;
  tier: "block" | "warn" | "info";
  message: string;
  file: string;
  line: number;
};

export type LintBundleResult = {
  ok: boolean;
  findings: CfgFinding[];
};

export function cfgFiles(files: { path: string }[]): { path: string }[] {
  return files
    .filter((file) => file.path.toLowerCase().endsWith(".cfg"))
    .map((file) => ({ path: file.path }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function canSaveCfg(ok: boolean, running: boolean, busy: boolean, dirty: boolean): boolean {
  return ok && !running && !busy && dirty;
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

export function lintBundle(files: { path: string; text: string }[]): LintBundleResult {
  const result = lint(files);
  return {
    ok: result.ok,
    findings: result.findings.map((finding) => ({
      ruleId: finding.ruleId,
      tier: finding.tier,
      message: finding.message,
      file: finding.file,
      line: finding.line,
    })),
  };
}
