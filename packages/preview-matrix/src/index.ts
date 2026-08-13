import matrixData from "./matrix.json";

export interface CvarRule {
  level: string;
  when: Record<string, string>;
}

export interface PreviewModule {
  id: string;
  label: string;
  mastercomfig: string;
  weight: number;
  levels: string[];
  cvarRules: CvarRule[];
}

export interface PreviewTier {
  id: string;
  label: string;
  vector: Record<string, string>;
}

export interface PreviewMatrix {
  version: string;
  capturesAvailable: boolean;
  modules: PreviewModule[];
  tiers: PreviewTier[];
}

export const matrix = matrixData as unknown as PreviewMatrix;

export interface PreviewMatch {
  /** Nearest anchor tier id. */
  tier: string;
  tierLabel: string;
  /** Resolved level per module id; null = config doesn't touch it. */
  moduleLevels: Record<string, string | null>;
  /** Fraction of modules the config actually specified (0..1). */
  confidence: number;
  matrixVersion: string;
}

export interface MatchInput {
  /** mastercomfig modules.cfg levels (module name -> level). */
  moduleLevels: Record<string, string>;
  /** Effective cvar values from the linted bundle. */
  effective: Record<string, string>;
}

/** mastercomfig level vocabularies mapped onto our per-module level scales. */
const MASTERCOMFIG_LEVEL_ALIASES: Record<string, Record<string, string>> = {
  shadows: { off: "off", none: "off", low: "low", medium: "low", high: "high", ultra: "high" },
  texture_quality: { low: "low", medium: "medium", high: "high", ultra: "ultra" },
  lighting: { low: "low", medium: "medium", high: "high", ultra: "high", off: "low" },
  water: { off: "simple", low: "simple", medium: "simple", high: "reflective", ultra: "reflective" },
  lod: { low: "low", medium: "medium", high: "high", ultra: "high" },
  gibs: { off: "off", none: "off", low: "off", medium: "on", high: "on", on: "on" },
  ragdolls: { off: "off", none: "off", low: "off", medium: "on", high: "on", on: "on" },
};

function resolveModuleLevel(module: PreviewModule, input: MatchInput): string | null {
  // Explicit mastercomfig module wins — it states intent directly.
  const fromModules = input.moduleLevels[module.mastercomfig];
  if (fromModules) {
    const alias = MASTERCOMFIG_LEVEL_ALIASES[module.mastercomfig]?.[fromModules];
    if (alias && module.levels.includes(alias)) return alias;
    if (module.levels.includes(fromModules)) return fromModules;
  }
  // Otherwise infer from raw cvars. A rule is viable when none of its
  // conditions are contradicted by a present cvar and at least one is
  // satisfied; the rule with the most satisfied conditions wins. This lets
  // `r_shadows 0` alone resolve shadows:off while a full condition set
  // still beats a partial one.
  let bestRule: CvarRule | null = null;
  let bestSatisfied = 0;
  for (const rule of module.cvarRules) {
    let satisfied = 0;
    let contradicted = false;
    for (const [cvar, expected] of Object.entries(rule.when)) {
      const actual = input.effective[cvar];
      if (actual === undefined) continue;
      if (actual === expected) satisfied++;
      else contradicted = true;
    }
    if (!contradicted && satisfied > bestSatisfied) {
      bestSatisfied = satisfied;
      bestRule = rule;
    }
  }
  return bestRule?.level ?? null;
}

/** Weighted L1 distance between a resolved config vector and an anchor tier. */
function tierDistance(
  tier: PreviewTier,
  resolved: Record<string, string | null>,
): number {
  let distance = 0;
  for (const module of matrix.modules) {
    const level = resolved[module.id];
    if (level === null || level === undefined) continue; // unresolved dims excluded
    const tierLevel = tier.vector[module.id];
    const a = module.levels.indexOf(level);
    const b = module.levels.indexOf(tierLevel);
    if (a === -1 || b === -1) continue;
    distance += module.weight * Math.abs(a - b);
  }
  return distance;
}

/**
 * Matches a linted config's graphics settings to the preview matrix.
 * Returns null when the config touches no preview modules at all
 * (pure binds/network configs get no visual preview).
 */
export function matchPreview(input: MatchInput): PreviewMatch | null {
  const resolved: Record<string, string | null> = {};
  let resolvedCount = 0;
  for (const module of matrix.modules) {
    const level = resolveModuleLevel(module, input);
    resolved[module.id] = level;
    if (level !== null) resolvedCount++;
  }
  if (resolvedCount === 0) return null;

  let best = matrix.tiers[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const tier of matrix.tiers) {
    const d = tierDistance(tier, resolved);
    if (d < bestDistance) {
      bestDistance = d;
      best = tier;
    }
  }

  return {
    tier: best.id,
    tierLabel: best.label,
    moduleLevels: resolved,
    confidence: resolvedCount / matrix.modules.length,
    matrixVersion: matrix.version,
  };
}

/** Image key helpers — single source of truth for R2 naming. */
export function tierImageKey(scene: string, tier: string, width: number): string {
  return `preview-matrix/${matrix.version}/${scene}/tier/${tier}_${width}.webp`;
}

export function moduleImageKey(
  scene: string,
  moduleId: string,
  level: string,
  width: number,
): string {
  return `preview-matrix/${matrix.version}/${scene}/module/${moduleId}-${level}_${width}.webp`;
}
