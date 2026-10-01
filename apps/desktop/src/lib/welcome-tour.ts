/**
 * The first-run welcome tour: four short steps that explain profiles to
 * someone who has never used execs. Each step is one idea a new player needs
 * before they change anything; the copy names what they see, not how it works.
 */

export type WelcomeStepId = "saved" | "sidebar" | "profiles" | "closed";

export type WelcomeStep = {
  id: WelcomeStepId;
  title: string;
  body: string;
};

/** How the first profile came to be: saved from the player's setup, or made fresh. */
export type WelcomeOrigin = "saved" | "created";

export function welcomeSteps(profileName: string | null, origin: WelcomeOrigin): WelcomeStep[] {
  const name = profileName?.trim() ? `“${profileName.trim()}”` : "your profile";
  return [
    {
      id: "saved",
      title: origin === "saved" ? "Your setup is saved" : "Your profile is ready",
      body:
        origin === "saved"
          ? `Saved as ${name}. Nothing in TF2 changed.`
          : `${name.charAt(0).toUpperCase()}${name.slice(1)} is active in TF2.`,
    },
    {
      id: "sidebar",
      title: "Everything is in the sidebar",
      body: "Changes save on their own.",
    },
    {
      id: "profiles",
      title: "Experiment in a new profile",
      body: "Switching back restores everything exactly.",
    },
    {
      id: "closed",
      title: "Changes wait while TF2 is running",
      body: "They apply as soon as you quit.",
    },
  ];
}

/** The next step index, clamped to the tour. */
export function welcomeStepAfter(index: number, delta: 1 | -1, count: number): number {
  return Math.min(count - 1, Math.max(0, index + delta));
}
