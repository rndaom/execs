import { Composition, Still } from "remotion";
import { Promo } from "./Promo";
import { Announcement } from "./Stills";
import { DURATION, FPS } from "./timing";

export function Root() {
  return (
    <>
      <Composition
        id="Promo"
        component={Promo}
        durationInFrames={DURATION}
        fps={FPS}
        width={1920}
        height={1080}
      />
      {/* The release announcement graphic for social posts. */}
      <Still id="Announcement" component={Announcement} width={1600} height={900} />
    </>
  );
}
