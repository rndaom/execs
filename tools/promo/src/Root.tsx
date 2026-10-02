import { Composition, Still } from "remotion";
import { Promo } from "./Promo";
import { HEADER, INSTALL, ReadmeHeader, ReadmeInstall } from "./Readme";
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
      {/* The README's header and install steps. */}
      <Still id="ReadmeHeader" component={ReadmeHeader} {...HEADER} />
      <Still id="ReadmeInstall" component={ReadmeInstall} {...INSTALL} />
    </>
  );
}
