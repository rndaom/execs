export type RestorePoint = {
  id: string;
  profileId: string;
  profileName: string;
  label?: string;
  /** Milliseconds since the Unix epoch. */
  createdAt: number;
  bytes: number;
};

export type RestorePointList = { points: RestorePoint[]; keepPerProfile: number };

export const KEEP_OPTIONS = [
  { id: "3", label: "3" },
  { id: "5", label: "5" },
  { id: "10", label: "10" },
] as const;

export function restorePointTime(point: RestorePoint, locale?: string): string {
  return new Date(point.createdAt).toLocaleString(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function restorePointTitle(point: RestorePoint, locale?: string): string {
  return point.label ?? `Saved ${restorePointTime(point, locale)}`;
}

/** Profile names are limited to 80 characters; the suffix wins over the name. */
export function restoredProfileName(point: RestorePoint, locale?: string): string {
  const suffix = ` (restored ${new Date(point.createdAt).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  })})`;
  return `${point.profileName.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`;
}

export type RestorePointGroup = {
  profileId: string;
  profileName: string;
  deleted: boolean;
  points: RestorePoint[];
};

/** The chosen profile first, then other saved profiles, then deleted ones. */
export function groupRestorePoints(
  points: RestorePoint[],
  profiles: { id: string; name: string }[],
  selectedId: string | null,
): RestorePointGroup[] {
  const groups = new Map<string, RestorePointGroup>();
  for (const point of points) {
    const saved = profiles.find((profile) => profile.id === point.profileId);
    const group = groups.get(point.profileId) ?? {
      profileId: point.profileId,
      profileName: saved?.name ?? point.profileName,
      deleted: !saved,
      points: [],
    };
    group.points.push(point);
    groups.set(point.profileId, group);
  }
  if (selectedId && !groups.has(selectedId)) {
    const saved = profiles.find((profile) => profile.id === selectedId);
    if (saved)
      groups.set(selectedId, {
        profileId: selectedId,
        profileName: saved.name,
        deleted: false,
        points: [],
      });
  }
  const rank = (group: RestorePointGroup) =>
    group.profileId === selectedId ? 0 : group.deleted ? 2 : 1;
  return [...groups.values()].sort(
    (a, b) => rank(a) - rank(b) || a.profileName.localeCompare(b.profileName),
  );
}
