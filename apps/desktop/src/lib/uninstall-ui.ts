export type InstallKind =
  | { kind: "windowsInstaller"; uninstaller: string }
  | { kind: "appImage"; path: string }
  | { kind: "deb"; package: string }
  | { kind: "unmanaged" };

export type UninstallInfo = {
  install: InstallKind;
  dataDirectory: string;
  /** Null when Casual setup changes could not be checked. */
  casual: { patchedFiles: number; gameinfoBypassed: boolean } | null;
};

export function casualChangesInstalled(info: UninstallInfo): boolean {
  return info.casual === null || info.casual.patchedFiles > 0 || info.casual.gameinfoBypassed;
}

export function casualChangesCopy(info: UninstallInfo): string | null {
  if (info.casual === null)
    return "execs could not check whether Casual setup changed TF2's own files.";
  const parts: string[] = [];
  if (info.casual.patchedFiles > 0)
    parts.push(
      `${info.casual.patchedFiles} particle ${info.casual.patchedFiles === 1 ? "file" : "files"}`,
    );
  if (info.casual.gameinfoBypassed) parts.push("gameinfo.txt");
  return parts.length > 0 ? `Casual setup changed TF2's own files: ${parts.join(" and ")}.` : null;
}

export function uninstallActionLabel(install: InstallKind, deleteData: boolean): string | null {
  switch (install.kind) {
    case "windowsInstaller":
      return deleteData ? "Delete data and uninstall execs…" : "Uninstall execs…";
    case "appImage":
      return deleteData ? "Delete data and this AppImage…" : "Delete this AppImage…";
    case "deb":
      return deleteData ? "Delete data and close execs…" : null;
    case "unmanaged":
      return null;
  }
}

export function debRemoveCommand(install: InstallKind): string | null {
  return install.kind === "deb" ? `sudo apt remove ${install.package}` : null;
}
