import type { ProfileLibrary, ProfileSummary } from "./bridge";

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

export function canCreateProfile(library: ProfileLibrary, running: boolean, name: string): boolean {
  return library.usable && !library.rootMismatch && !running && name.trim().length > 0;
}

export function previewCreatedProfile(name: string, index: number): ProfileSummary {
  return {
    id: `preview-${index}`,
    name: name.trim(),
    createdAt: "2026-08-29T00:00:00Z",
    updatedAt: "2026-08-29T00:00:00Z",
  };
}
