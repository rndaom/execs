import type { Finding } from "@execs/cfglint";
import { Badge } from "@/components/ui/badge";

const TIER_STYLE: Record<string, string> = {
  block: "bg-destructive text-destructive-foreground",
  warn: "bg-q-strange text-on-brand",
  info: "bg-secondary text-secondary-foreground",
};

export function SafetyReport({ findings }: { findings: Finding[] }) {
  const warns = findings.filter((f) => f.tier === "warn");
  const infos = findings.filter((f) => f.tier === "info");

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
      <h2 className="font-display text-xl">Safety report</h2>
      {warns.length === 0 ? (
        <p className="text-sm text-health">
          ✓ No warnings — this config passed every safety rule cleanly.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {warns.map((f, i) => (
            <li key={`${f.ruleId}-${i}`} className="flex items-start gap-2 text-sm">
              <Badge className={TIER_STYLE[f.tier]}>{f.tier}</Badge>
              <span>
                <code className="text-xs text-ink-faint">
                  {f.file}:{f.line}
                </code>{" "}
                {f.message}
                {f.via ? <span className="text-ink-faint"> (via {f.via})</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {infos.length > 0 && (
        <details className="text-sm text-ink-muted">
          <summary className="cursor-pointer text-ink-faint">
            {infos.length} informational note{infos.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {infos.map((f, i) => (
              <li key={`${f.ruleId}-${i}`}>
                <code className="text-xs text-ink-faint">
                  {f.file}:{f.line}
                </code>{" "}
                {f.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-ink-faint">
        Every upload is parsed and checked for hostile commands (server redirects, bind wipes,
        console lockouts) before it can be published. Warnings are surfaced, not hidden — read
        them before installing.
      </p>
    </section>
  );
}
