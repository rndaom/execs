import { useEffect, useRef } from "react";
import { CROSSHAIR_CANVAS_SIZE, type CrosshairColor, tintCrosshairRgba } from "../lib/crosshair-ui";
import type { PreviewPixels } from "./useCrosshairDraft";

/**
 * Paint a crosshair sprite into a 64×64 canvas, tinted the way the engine
 * tints it (RGB multiply). A sprite of another size keeps its true size
 * relative to a 64 px crosshair, centred, and is shrunk to fit only when it
 * is larger than the canvas.
 */
export function paintCrosshair(
  canvas: HTMLCanvasElement,
  pixels: PreviewPixels | null,
  color: CrosshairColor | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!pixels || pixels.width <= 0 || pixels.height <= 0) {
    return;
  }
  const scratch = document.createElement("canvas");
  scratch.width = pixels.width;
  scratch.height = pixels.height;
  const scratchCtx = scratch.getContext("2d");
  if (!scratchCtx) {
    return;
  }
  const image = scratchCtx.createImageData(pixels.width, pixels.height);
  image.data.set(tintCrosshairRgba(pixels.rgba, color));
  scratchCtx.putImageData(image, 0, 0);
  const fit = Math.min(
    1,
    CROSSHAIR_CANVAS_SIZE / pixels.width,
    CROSSHAIR_CANVAS_SIZE / pixels.height,
  );
  const width = Math.max(1, Math.round(pixels.width * fit));
  const height = Math.max(1, Math.round(pixels.height * fit));
  ctx.imageSmoothingEnabled = fit < 1;
  ctx.drawImage(
    scratch,
    Math.round((CROSSHAIR_CANVAS_SIZE - width) / 2),
    Math.round((CROSSHAIR_CANVAS_SIZE - height) / 2),
    width,
    height,
  );
}

/**
 * A small square picture of one crosshair on the app's dark ground. With a
 * device pixel per sprite pixel it is pixel-exact; smaller pictures are
 * smoothed so a one-pixel line fades instead of disappearing.
 */
export function CrosshairThumb({
  pixels,
  color,
  size = 64,
  className = "",
  testId,
  label,
}: {
  pixels: PreviewPixels | null;
  color: CrosshairColor | null;
  size?: number;
  className?: string;
  testId?: string;
  /** Present when the picture is meaningful on its own; otherwise decorative. */
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      paintCrosshair(ref.current, pixels, color);
    }
  }, [pixels, color]);
  return (
    <canvas
      ref={ref}
      data-testid={testId}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      width={CROSSHAIR_CANVAS_SIZE}
      height={CROSSHAIR_CANVAS_SIZE}
      className={`crosshair-thumb ${className}`.trim()}
      style={{
        width: size,
        height: size,
        // Crisp whenever the screen has a device pixel per sprite pixel.
        imageRendering:
          size * (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1) >=
          CROSSHAIR_CANVAS_SIZE
            ? "pixelated"
            : "auto",
      }}
    />
  );
}
