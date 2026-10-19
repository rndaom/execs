import { useCallback, useEffect, useState } from "react";

/**
 * Switch to a profile, then start TF2 once it is the one in the game.
 *
 * `request` runs the switch the way the header menu does (unsaved edits are
 * settled first). The launch waits for the switch to finish; a switch that
 * ends without that profile in the game (blocked, declined, failed) never
 * starts TF2.
 */
export function useSwitchAndPlay({
  request,
  switchProfile,
  activeProfileId,
  switching,
  launchBlockReason,
  launch,
  onBlocked,
}: {
  request: (run: () => Promise<void>) => void;
  switchProfile: (id: string) => Promise<void>;
  activeProfileId: string | null;
  /** The switch's progress is still showing. */
  switching: boolean;
  launchBlockReason: string | null;
  launch: () => void;
  /** The switch worked but the game cannot start; say why. */
  onBlocked: (reason: string) => void;
}): (id: string) => void {
  // The profile whose switch just returned. It is acted on once the progress
  // list is done, so the launch never overlaps the switch.
  const [settled, setSettled] = useState<string | null>(null);

  const switchAndPlay = useCallback(
    (id: string) => {
      request(async () => {
        await switchProfile(id);
        setSettled(id);
      });
    },
    [request, switchProfile],
  );

  useEffect(() => {
    if (settled === null || switching) return;
    setSettled(null);
    if (activeProfileId !== settled) return;
    if (launchBlockReason) onBlocked(launchBlockReason);
    else launch();
  }, [settled, switching, activeProfileId, launchBlockReason, launch, onBlocked]);

  return switchAndPlay;
}
