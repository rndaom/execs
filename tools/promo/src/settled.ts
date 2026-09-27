import { useLayoutEffect } from "react";
import { continueRender, delayRender } from "remotion";

/**
 * Run a canvas draw that reads the page's layout once fonts are ready and the
 * layout has settled. Remotion mounts a frame before its final layout, so a
 * draw in a plain layout effect can measure a collapsed page; this one holds
 * the frame until it has drawn.
 */
export function useSettledLayout(draw: () => void, frame: number) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the draw reads the whole frame's layout.
  useLayoutEffect(() => {
    const handle = delayRender("Waiting for layout");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      continueRender(handle);
    };
    void document.fonts.ready.then(() =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (done) return;
          draw();
          finish();
        }),
      ),
    );
    return finish;
  }, [frame]);
}
