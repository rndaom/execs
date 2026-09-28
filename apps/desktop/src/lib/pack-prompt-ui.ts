import type { AbsorbDelta, PackAction, PackDecision } from "./bridge";

export function packDecisions(delta: AbsorbDelta): PackDecision[] {
  return [
    ...delta.packsAdded.map((pack) => ({ pack, choice: "add" as const })),
    ...delta.packsRemoved.map((pack) => ({ pack, choice: "remove" as const })),
  ];
}

export function packConsequence(action: PackAction, added: boolean): string {
  switch (action) {
    case "add":
      return "Save this pack in the profile. Switching profiles removes it from TF2; switching back restores it.";
    case "remove":
      return "Delete the saved copy from this profile. Switching back will not restore it.";
    case "restore":
      return "Put the saved copy back in TF2 now and keep it in this profile.";
    case "keep":
      return added
        ? "Leave this pack in TF2 without saving it. Switching profiles is blocked until you add it to the profile or remove it from TF2."
        : "Keep the saved copy, but leave it missing from TF2. Switching away and back restores it.";
  }
}
