import type { AppUpdateInfo } from "./updater-ui";

const LAST_VERSION_KEY = "execs:last-launched-version";
const PENDING_RELEASE_KEY = "execs:pending-release-notes";

/** 0.1.2 predates the launch marker, so its upgrade needs one bundled handoff. */
const BUNDLED_NOTES: Record<string, string> = {
  "0.1.3": `### Added

- execs now shows these release notes after updates, with a link to the matching GitHub release.

### Fixed

- Binds now record right and middle mouse buttons correctly, keep drafts while TF2 runs, and honor binds removed through TF2's settings.
- Mods install GameBanana downloads from its numbered file-cache hosts and ask you to choose files from archives with ambiguous variants.
- Imported HUD configs can use sv_cheats and top-level unbindall; hidden bind-reset payloads remain flagged.
- Profile repair and restore work stops safely if TF2 starts during the operation.
- Imported HUD options remain editable after matching the HUD to its catalog entry.
- Profile exports with small, highly compressible assets import correctly.`,
};

/** Accessing the storage property itself can throw in restricted webviews. */
export function releaseNotesStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* Release notes are a convenience; unavailable storage must not block startup. */
  }
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    /* See safeSet. */
  }
}

function pendingRelease(storage: Storage): AppUpdateInfo | null {
  const raw = safeGet(storage, PENDING_RELEASE_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "version" in value &&
      typeof value.version === "string" &&
      "notes" in value &&
      (typeof value.notes === "string" || value.notes === null)
    ) {
      return { version: value.version, notes: value.notes };
    }
  } catch {
    /* A corrupt marker is discarded below. */
  }
  safeRemove(storage, PENDING_RELEASE_KEY);
  return null;
}

/** Preserve the exact release body before the updater restarts the app. */
export function stagePendingRelease(storage: Storage | null, release: AppUpdateInfo): void {
  if (!storage) return;
  safeSet(storage, PENDING_RELEASE_KEY, JSON.stringify(release));
}

export function clearPendingRelease(storage: Storage | null, version: string): void {
  if (!storage) return;
  if (pendingRelease(storage)?.version === version) {
    safeRemove(storage, PENDING_RELEASE_KEY);
  }
}

/**
 * Resolve at most one installed-release sheet for this launch. New installs do
 * not get an update prompt. The existing-install branch is the 0.1.3 migration
 * for users whose previous build could not record its version yet.
 */
export function installedReleaseForLaunch(
  storage: Storage | null,
  currentVersion: string,
  existingInstall: boolean,
): AppUpdateInfo | null {
  if (!storage) return null;
  const previousVersion = safeGet(storage, LAST_VERSION_KEY);
  const pending = pendingRelease(storage);
  safeSet(storage, LAST_VERSION_KEY, currentVersion);

  if (pending?.version === currentVersion) {
    return {
      version: currentVersion,
      notes: pending.notes || BUNDLED_NOTES[currentVersion] || null,
    };
  }
  if (previousVersion && previousVersion !== currentVersion) {
    return { version: currentVersion, notes: BUNDLED_NOTES[currentVersion] || null };
  }
  if (!previousVersion && existingInstall && BUNDLED_NOTES[currentVersion]) {
    return { version: currentVersion, notes: BUNDLED_NOTES[currentVersion] };
  }
  return null;
}

export function dismissInstalledRelease(storage: Storage | null, version: string): void {
  clearPendingRelease(storage, version);
}

export function githubReleaseUrl(version: string): string {
  return `https://github.com/rndaom/execs/releases/tag/v${encodeURIComponent(version)}`;
}

export type ReleaseNotesSection = { title: string | null; items: string[] };

function plainMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** The updater body is trusted as text, never HTML; this extracts its readable structure. */
export function releaseNotesSections(notes: string | null): ReleaseNotesSection[] {
  if (!notes?.trim()) return [];
  const sections: ReleaseNotesSection[] = [];
  let current: ReleaseNotesSection = { title: null, items: [] };
  const push = () => {
    if (current.items.length > 0) sections.push(current);
  };

  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{2,6}\s+(.+)$/);
    if (heading) {
      push();
      current = { title: plainMarkdown(heading[1]), items: [] };
      continue;
    }
    if (/^\s+\S/.test(raw) && !/^[-*]\s+/.test(line) && current.items.length > 0) {
      current.items[current.items.length - 1] += ` ${plainMarkdown(line)}`;
    } else {
      current.items.push(plainMarkdown(line.replace(/^[-*]\s+/, "")));
    }
  }
  push();
  return sections.filter((section) => section.items.length > 0);
}
