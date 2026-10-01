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
  const name = profileName?.trim() ? `“${profileName.trim()}”` : "your first profile";
  return [
    {
      id: "saved",
      title: origin === "saved" ? "Your setup is saved" : "Your profile is ready",
      body:
        origin === "saved"
          ? `execs saved your TF2 setup as a profile called ${name}. Nothing in TF2 changed.`
          : `${name.charAt(0).toUpperCase()}${name.slice(1)} is set up and active in TF2.`,
    },
    {
      id: "sidebar",
      title: "Change things from the sidebar",
      body: "Crosshair, HUD, binds, sounds and more. Changes save to this profile on their own, and the orange dot lights up while one is saving.",
    },
    {
      id: "profiles",
      title: "Try ideas in a new profile",
      body: "Want a different HUD or mastercomfig? Make a new profile from the profile menu. Switching back puts everything exactly as it was.",
    },
    {
      id: "closed",
      title: "Change things while TF2 is closed",
      body: "execs only changes TF2's files when the game isn't running. If TF2 is open, your changes wait and save as soon as you quit.",
    },
  ];
}

/** The next step index, clamped to the tour. */
export function welcomeStepAfter(index: number, delta: 1 | -1, count: number): number {
  return Math.min(count - 1, Math.max(0, index + delta));
}
