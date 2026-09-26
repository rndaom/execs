export type ProfileHealth = {
  id: string;
  name: string;
  active: boolean;
  trackedFiles: number | null;
  missingFiles: number;
  missingExamples: string[];
  uncachedDownloads: string[];
  needsLegacyLibrary: boolean;
};

export type InstallHealth = {
  tf2Root: string | null;
  libraryUsable: boolean;
  rootMismatch: boolean;
  activeLayer: "comfig" | "vanilla" | null;
  profiles: ProfileHealth[];
  recovery: {
    pendingSwitch: string | null;
    profileUpdate: boolean;
    casual: boolean;
    unknown: boolean;
  };
  steamAccountFound: boolean;
  cloudConfigPresent: boolean | null;
  hudCatalogAgeSeconds: number | null;
  legacyLibraryPresent: boolean;
  gameRunning: boolean;
};

export type HealthStatus = "ok" | "attention" | "unknown";

export type HealthItem = { id: string; title: string; status: HealthStatus; lines: string[] };

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function age(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  if (days >= 1) return plural(days, "day");
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return plural(hours, "hour");
  return "less than an hour";
}

function installItem(health: InstallHealth): HealthItem {
  if (!health.tf2Root)
    return {
      id: "install",
      title: "TF2 installation",
      status: "attention",
      lines: ["No TF2 folder is confirmed. Use Find TF2 above."],
    };
  const lines = [`Team Fortress 2 (app 440) at ${health.tf2Root}.`];
  if (health.gameRunning) lines.push("TF2 is running. Changes to your setup wait until it closes.");
  if (health.rootMismatch)
    return {
      id: "install",
      title: "TF2 installation",
      status: "attention",
      lines: [...lines, "Your profile library belongs to a different TF2 folder."],
    };
  return { id: "install", title: "TF2 installation", status: "ok", lines };
}

function loaderItem(health: InstallHealth): HealthItem {
  const title = "Config loader";
  if (health.activeLayer === "comfig")
    return {
      id: "loader",
      title,
      status: "ok",
      lines: ["mastercomfig runs your settings from tf/cfg/overrides."],
    };
  if (health.activeLayer === "vanilla")
    return {
      id: "loader",
      title,
      status: "ok",
      lines: ["TF2 runs your settings from tf/cfg (no mastercomfig)."],
    };
  return {
    id: "loader",
    title,
    status: "unknown",
    lines: [
      health.libraryUsable
        ? "No profile is active, so the loader is not known."
        : "Unknown until a profile library is available.",
    ],
  };
}

function recoveryItem(health: InstallHealth): HealthItem {
  const title = "Interrupted changes";
  const { recovery } = health;
  const lines: string[] = [];
  if (recovery.pendingSwitch)
    lines.push(
      `Switching to ${recovery.pendingSwitch} was interrupted. Switch to it again to finish.`,
    );
  if (recovery.profileUpdate)
    lines.push("A profile change was interrupted. execs finishes it before the next change.");
  if (recovery.casual)
    lines.push("A Casual setup change was interrupted. Open Mods, Casual setup to recover it.");
  if (lines.length > 0) return { id: "recovery", title, status: "attention", lines };
  if (recovery.unknown || !health.tf2Root)
    return {
      id: "recovery",
      title,
      status: "unknown",
      lines: ["Recovery state could not be read."],
    };
  return { id: "recovery", title, status: "ok", lines: ["Nothing was interrupted."] };
}

function profilesItem(health: InstallHealth): HealthItem {
  const title = "Saved profiles";
  if (!health.libraryUsable)
    return {
      id: "profiles",
      title,
      status: "unknown",
      lines: ["The profile library is not available."],
    };
  const lines: string[] = [];
  let status: HealthStatus = "ok";
  for (const profile of health.profiles) {
    if (profile.trackedFiles === null) {
      if (status === "ok") status = "unknown";
      lines.push(`${profile.name} could not be read right now.`);
    } else if (profile.missingFiles > 0) {
      status = "attention";
      const examples = profile.missingExamples.join(", ");
      lines.push(
        `${profile.name} is missing ${plural(profile.missingFiles, "saved file")} (${examples}${profile.missingFiles > profile.missingExamples.length ? ", …" : ""}). Switching to it fails until it is saved or imported again.`,
      );
    }
    if (profile.needsLegacyLibrary && !health.legacyLibraryPresent) {
      status = "attention";
      lines.push(
        `${profile.name} uses saved Casual library choices, but that library is missing and cannot be downloaded again.`,
      );
    }
  }
  if (lines.length === 0)
    lines.push(
      health.profiles.length === 0
        ? "No profiles yet."
        : `All ${plural(health.profiles.length, "profile")} have every saved file.`,
    );
  return { id: "profiles", title, status, lines };
}

function cloudItem(health: InstallHealth): HealthItem {
  const title = "Steam Cloud";
  if (!health.steamAccountFound)
    return {
      id: "cloud",
      title,
      status: "unknown",
      lines: ["No signed-in Steam account was found on this computer."],
    };
  return {
    id: "cloud",
    title,
    status: "ok",
    lines: [
      health.cloudConfigPresent
        ? "execs keeps Steam's local copy of config.cfg up to date."
        : "Steam has no local copy of config.cfg yet. execs writes one when it saves config.cfg.",
      "Steam uploads that copy when it syncs; execs cannot confirm the upload.",
    ],
  };
}

function offlineItem(health: InstallHealth): HealthItem {
  const lines: string[] = [];
  const needsDownload = health.profiles.filter((profile) => profile.uncachedDownloads.length > 0);
  if (needsDownload.length === 0) lines.push("Switching profiles works offline.");
  for (const profile of needsDownload)
    lines.push(
      `Switching to ${profile.name} needs a connection to download ${profile.uncachedDownloads.join(", ")}.`,
    );
  lines.push(
    health.hudCatalogAgeSeconds === null
      ? "Browsing HUDs needs a connection."
      : `Browsing HUDs works offline from a list saved ${age(health.hudCatalogAgeSeconds)} ago.`,
  );
  lines.push("Installing HUDs and mods, mastercomfig updates and app updates need a connection.");
  return { id: "offline", title: "Offline", status: "ok", lines };
}

export function healthItems(health: InstallHealth): HealthItem[] {
  return [
    installItem(health),
    loaderItem(health),
    recoveryItem(health),
    profilesItem(health),
    cloudItem(health),
    offlineItem(health),
  ];
}
