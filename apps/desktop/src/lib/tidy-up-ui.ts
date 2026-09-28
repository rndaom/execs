import type { TidyReport } from "./bridge";
import { formatModBytes } from "./mods-ui";

const UPGRADE_LABELS: Record<TidyReport["managedFilesUpgraded"][number]["kind"], string> = {
  preloadHook: "Casual preload hook updated",
  bindKeyNames: "bind key names repaired",
  cheatTracers: "cheat-only tracer line removed",
};

function count(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`;
}

function sentenceList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** One quiet sentence for the notice after an automatic tidy-up. */
export function tidySummary(report: TidyReport): string {
  const parts: string[] = [];
  if (report.soundCachesRemoved.length) {
    parts.push(
      `removed ${count(report.soundCachesRemoved.length, "unused sound cache", "unused sound caches")}`,
    );
  }
  if (report.hudBackupsMoved.length) {
    parts.push(
      `moved ${count(report.hudBackupsMoved.length, "HUD backup", "HUD backups")} (${formatModBytes(report.movedBytes)}) out of TF2's folder`,
    );
  }
  if (report.hudBackupsDeleted.length) {
    parts.push(
      `deleted ${count(report.hudBackupsDeleted.length, "duplicate HUD backup", "duplicate HUD backups")}`,
    );
  }
  if (report.valveCfgsDropped.length) {
    parts.push(
      `stopped ${count(report.valveCfgsDropped.length, "profile", "profiles")} from carrying Valve's own cfgs`,
    );
  }
  if (report.managedFilesUpgraded.length) {
    parts.push(
      `updated ${count(report.managedFilesUpgraded.length, "file", "files")} older versions wrote`,
    );
  }
  if (report.downloadsRemoved.length) {
    parts.push(
      `removed ${count(report.downloadsRemoved.length, "unused download", "unused downloads")}`,
    );
  }
  if (!parts.length) return "execs checked for leftovers from earlier versions.";
  // The notice stays one short line; Details lists everything.
  const shown =
    parts.length > 2
      ? [...parts.slice(0, 2), count(parts.length - 2, "other change", "other changes")]
      : parts;
  const freed = report.freedBytes > 0 ? `, freeing ${formatModBytes(report.freedBytes)}` : "";
  return `execs tidied up after the update: ${sentenceList(shown)}${freed}.`;
}

export type TidyDetailSection = { title: string; items: string[] };

/** Everything the run did, grouped for the Details dialog. */
export function tidyDetails(report: TidyReport): TidyDetailSection[] {
  const sections: TidyDetailSection[] = [
    { title: "Sound caches removed from TF2's custom folder", items: report.soundCachesRemoved },
    {
      title: "HUD backups moved to execs data (restore or delete them in App settings → Storage)",
      items: report.hudBackupsMoved,
    },
    {
      title: "Duplicate HUD backups deleted (a profile still has every file)",
      items: report.hudBackupsDeleted,
    },
    {
      title: "Valve's own cfgs no longer saved in profiles",
      items: report.valveCfgsDropped.map(
        (entry) => `${entry.profile}: ${count(entry.count, "file", "files")}`,
      ),
    },
    {
      title: "Files older versions wrote, brought up to date",
      items: report.managedFilesUpgraded.map(
        (entry) => `${entry.profile}: ${UPGRADE_LABELS[entry.kind]}`,
      ),
    },
    { title: "Unused downloads removed", items: report.downloadsRemoved },
    { title: "Kept for now", items: report.skipped },
  ];
  return sections.filter((section) => section.items.length > 0);
}
