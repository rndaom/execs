import type { SummarySection } from "@execs/cfglint";

export function WhatThisChanges({
  summary,
  moduleLevels,
}: {
  summary: SummarySection[];
  moduleLevels: Record<string, string>;
}) {
  const hasModules = Object.keys(moduleLevels).length > 0;
  if (summary.length === 0 && !hasModules) return null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-edge bg-panel p-4">
      <h2 className="font-display text-xl">What this config changes</h2>
      {hasModules && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(moduleLevels).map(([module, level]) => (
            <span
              key={module}
              className="rounded-pill border border-q-vintage px-3 py-1 text-xs text-q-vintage"
            >
              {module.replace(/_/g, " ")}: {level}
            </span>
          ))}
        </div>
      )}
      {summary.map((section) => (
        <div key={section.domain}>
          <h3 className="mb-1 text-sm font-semibold text-ink-muted">{section.label}</h3>
          <ul className="flex flex-col gap-0.5">
            {section.entries.map((e) => (
              <li key={e.cvar} className="flex items-baseline gap-2 text-sm" title={e.help}>
                <code className="text-brand">{e.cvar}</code>
                <span>{e.value}</span>
                {e.defaultValue !== undefined && (
                  <span className="text-xs text-ink-faint">(default {e.defaultValue})</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
