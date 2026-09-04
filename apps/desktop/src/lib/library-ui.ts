import type { AbsorbDelta, ProfileLibrary, ProfileSummary, SwitchStep } from "./bridge";

export function emptyLibrary(tf2Root: string, initialized: boolean): ProfileLibrary {
  return {
    initialized,
    usable: true,
    rootMismatch: false,
    tf2Root: initialized ? tf2Root : null,
    confirmedRoot: tf2Root,
    activeProfileId: null,
    profiles: [],
  };
}

export function libraryStatusCopy(library: ProfileLibrary): string {
  if (library.rootMismatch) {
    return "Profiles belong to another TF2 install.";
  }
  if (library.pendingSwitchProfileId) {
    const target = library.profiles.find(
      (profile) => profile.id === library.pendingSwitchProfileId,
    );
    return `Switch to ${target?.name ?? "the pending profile"} to finish recovery.`;
  }
  if (library.profiles.length === 0) {
    return "No profiles yet";
  }
  if (library.profiles.length === 1) {
    return "1 profile";
  }
  return `${library.profiles.length} profiles`;
}

export function canSaveCurrent(library: ProfileLibrary, running: boolean, name: string): boolean {
  return library.usable && !library.rootMismatch && !running && name.trim().length > 0;
}

/** Export reads app-data, so it stays available while TF2 is running. */
export function canExportProfile(library: ProfileLibrary, _running: boolean): boolean {
  return library.usable && !library.rootMismatch;
}

/** Import mutates the library, so the write-lock applies. */
export function canImportProfile(library: ProfileLibrary, running: boolean): boolean {
  return library.usable && !library.rootMismatch && !running;
}

/** A canceled picker returns the existing library and must not report success. */
export function newlyImportedProfile(
  before: ProfileLibrary,
  after: ProfileLibrary,
): ProfileSummary | null {
  const existing = new Set(before.profiles.map((profile) => profile.id));
  return after.profiles.find((profile) => !existing.has(profile.id)) ?? null;
}

/** Create new is for people who already have a profile. */
export function canCreateNew(library: ProfileLibrary): boolean {
  return library.usable && !library.rootMismatch && library.profiles.length > 0;
}

export function previewSavedProfile(name: string, index: number): ProfileSummary {
  return {
    id: `preview-${index}`,
    name: name.trim(),
    createdAt: "2026-08-29T00:00:00Z",
    updatedAt: "2026-08-29T00:00:00Z",
  };
}

export function previewSavedLibrary(tf2Root: string, name = "Main"): ProfileLibrary {
  const profile = previewSavedProfile(name, 1);
  return {
    ...emptyLibrary(tf2Root, true),
    activeProfileId: profile.id,
    profiles: [profile],
  };
}

export function emptyAbsorbDelta(): AbsorbDelta {
  return {
    ownedChanged: [],
    ownedMissing: [],
    packsAdded: [],
    packsRemoved: [],
    configCfg: false,
  };
}

/**
 * Should a write-lock transition trigger an absorb?
 *
 * `previous` is the last known lock state, `null` when it was never observed.
 * The Rust poller emits the current value on its first tick — often before the
 * webview registered its listener — so "unknown → closed" has to count as a
 * quit too, or a session that started with TF2 already open never absorbs.
 */
export function shouldAbsorbOnLockChange(previous: boolean | null, next: boolean): boolean {
  return next === false && previous !== false;
}

export function hasPackChanges(delta: AbsorbDelta): boolean {
  return delta.packsAdded.length > 0 || delta.packsRemoved.length > 0;
}

export function previewPackDelta(): AbsorbDelta {
  return {
    ...emptyAbsorbDelta(),
    packsAdded: ["toonhud"],
    packsRemoved: ["oldpack"],
  };
}

export const SWITCH_STEPS: { id: SwitchStep; label: string }[] = [
  { id: "closed", label: "Game closed" },
  { id: "pack", label: "Pack current" },
  { id: "remove", label: "Remove live packs" },
  { id: "write", label: "Write files" },
  { id: "cloud", label: "Cloud" },
  { id: "done", label: "Done" },
];

export function switchStepIndex(step: SwitchStep): number {
  return SWITCH_STEPS.findIndex((item) => item.id === step);
}

export function previewSwitchStep(): SwitchStep {
  return "write";
}

export function previewSwitchLibrary(tf2Root: string): ProfileLibrary {
  const main = previewSavedProfile("Main", 1);
  const alt = previewSavedProfile("Alt", 2);
  return {
    ...emptyLibrary(tf2Root, true),
    activeProfileId: main.id,
    profiles: [main, alt],
  };
}

/** Two profiles after a fake import — first stays active. */
export function previewImportedLibrary(tf2Root: string): ProfileLibrary {
  const existing = previewSavedProfile("Main", 1);
  const imported = previewSavedProfile("Imported", 2);
  return {
    ...emptyLibrary(tf2Root, true),
    activeProfileId: existing.id,
    profiles: [existing, imported],
  };
}
