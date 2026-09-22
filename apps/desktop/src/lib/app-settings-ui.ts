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
