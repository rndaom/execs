import type { AbsorbDelta, ProfileLibrary, ProfileSummary } from "./bridge";

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
