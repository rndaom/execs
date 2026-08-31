import { lookupCvar } from "./corpus.ts";
import { classifyDomain, DOMAIN_LABELS } from "./rules-data.ts";
import type { CvarValue, SummarySection } from "./types.ts";

/** Groups the effective cvar state into the human-readable "what this changes" panel. */
export function buildSummary(effective: Map<string, CvarValue>): SummarySection[] {
  const byDomain = new Map<string, SummarySection>();
  for (const [cvar, { value }] of effective) {
    const entry = lookupCvar(cvar);
    // Skip values that match the game default — they change nothing.
    if (entry?.d !== undefined && entry.d === value) continue;
    const domain = classifyDomain(cvar);
    let section = byDomain.get(domain);
    if (!section) {
      section = { domain, label: DOMAIN_LABELS[domain] ?? domain, entries: [] };
      byDomain.set(domain, section);
    }
    section.entries.push({
      cvar,
      value,
      defaultValue: entry?.d,
      help: entry?.h,
    });
  }
  const order = Object.keys(DOMAIN_LABELS);
  return [...byDomain.values()].sort((a, b) => order.indexOf(a.domain) - order.indexOf(b.domain));
}
