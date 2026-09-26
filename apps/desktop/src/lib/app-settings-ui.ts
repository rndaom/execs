export type MotionPreference = "system" | "reduce";

export type AppPreferences = {
  checkForUpdatesOnStartup: boolean;
  motion: MotionPreference;
};

export type AppSettingsPayload = {
  preferences: AppPreferences;
  dataDirectory: string;
};

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  checkForUpdatesOnStartup: true,
  motion: "system",
};

export const APP_SUPPORT_URL = "https://github.com/rndaom/execs/issues/new/choose";
export const APP_RELEASES_URL = "https://github.com/rndaom/execs/releases";
export const APP_NOTICES_URL = "https://github.com/rndaom/execs/blob/main/THIRD_PARTY.md";

/** No light-theme/system-theme option: the dark theme is the shared appearance. */
export const MOTION_OPTIONS = [
  { id: "system", label: "Follow system" },
  { id: "reduce", label: "Reduce" },
] satisfies { id: MotionPreference; label: string }[];

export type StorageGroupId = "profiles" | "downloads" | "retired" | "logs" | "protected" | "other";

export type StorageGroup = {
  id: StorageGroupId;
  bytes: number;
  files: number;
  unreadable: number;
  clearable: boolean;
};

export type StorageReport = {
  groups: StorageGroup[];
  totalBytes: number;
  clearableBytes: number;
  partial: boolean;
};

export type ClearReport = { freedBytes: number; failed: string[] };

export const STORAGE_GROUP_COPY: Record<StorageGroupId, { label: string; detail: string }> = {
  profiles: { label: "Profiles", detail: "Your saved profiles and their files." },
  downloads: {
    label: "Downloads",
    detail: "HUD catalog and options, and Casual setup files. Downloaded again when needed.",
  },
  retired: { label: "Retired downloads", detail: "Left over from features execs no longer has." },
  logs: { label: "Logs", detail: "Crash logs for bug reports." },
  protected: {
    label: "Recovery and sources",
    detail:
      "Recovery data, original game files, sounds you added and the saved Casual library. Always kept.",
  },
  other: { label: "Settings and other files", detail: "Kept." },
};

export function formatStorageBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** Groups worth a row: always the profiles, otherwise only what takes space. */
export function visibleStorageGroups(report: StorageReport): StorageGroup[] {
  return report.groups.filter(
    (group) => group.id === "profiles" || group.bytes > 0 || group.unreadable > 0,
  );
}

export function clearResultCopy(result: ClearReport): string {
  const freed = `Freed ${formatStorageBytes(result.freedBytes)}.`;
  if (result.failed.length === 0) return freed;
  return `${freed} ${result.failed.length === 1 ? "One item was" : `${result.failed.length} items were`} in use and kept: ${result.failed.join(", ")}. Try again later.`;
}
