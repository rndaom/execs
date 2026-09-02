import { Composition } from "remotion";
import { PROMO_DURATION_FRAMES, PROMO_FPS, Promo } from "./Promo";

export function Root() {
  return (
    <Composition
      id="Promo"
      component={Promo}
      durationInFrames={PROMO_DURATION_FRAMES}
      fps={PROMO_FPS}
      width={1920}
      height={1080}
    />
  );
}
