export type SteamWriteStatus = "written" | "steam_open" | "no_account";

export function recommendedLaunchOptions(_os: "linux" | "windows"): string {
  return "-novid -nojoy -nosteamcontroller -nohltv -particles 1";
}

export function canEditLaunch(running: boolean, busy: boolean): boolean {
  return !running && !busy;
}

export function steamWriteCopy(status: SteamWriteStatus): string {
  switch (status) {
    case "written":
      return "Wrote Steam launch options.";
    case "steam_open":
      return "Saved on the profile. Steam is open — copy into TF2 Properties yourself.";
    case "no_account":
      return "Saved on the profile. Could not find a Steam userdata folder.";
  }
}
