import { Composition } from "remotion";
import { PROMO_DURATION_FRAMES, PROMO_FPS, Promo, timeline } from "./Promo";

export function Root() {
  return (
    <>
      <Composition
        id="Promo"
        component={Promo}
        durationInFrames={PROMO_DURATION_FRAMES}
        fps={PROMO_FPS}
        width={1920}
        height={1080}
      />
      {/* Same timeline at 24 fps: the README GIF. Rendered at 800 px wide. */}
      <Composition
        id="PromoGif"
        component={Promo}
        durationInFrames={timeline(24).total}
        fps={24}
        width={1920}
        height={1080}
      />
    </>
  );
}
