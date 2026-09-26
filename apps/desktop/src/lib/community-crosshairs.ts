// Earlier development builds stored Venom crosshairs in profile libraries.
// Keep only the names needed to read those profiles; this module is not a
// downloadable catalog.

export const COMMUNITY_CROSSHAIR_PREFIX = "venom_";

/** The two legacy bare names that collide with first-party shapes. */
const LEGACY_COLLISIONS = new Set(["circle", "dot"]);

export function migrateCommunityName(name: string, isBuiltin: (value: string) => boolean): string {
  return LEGACY_COLLISIONS.has(name) && isBuiltin(name)
    ? `${COMMUNITY_CROSSHAIR_PREFIX}${name}`
    : name;
}
