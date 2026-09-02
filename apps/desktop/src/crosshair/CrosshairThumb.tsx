import { useEffect, useRef } from "react";
import {
  CROSSHAIR_CANVAS_SIZE,
  type CrosshairColor,
  CUSTOM_CROSSHAIR_SHAPE,
  isBuiltinCrosshairShape,
  renderCrosshairRgba,
  tintCrosshairRgba,
} from "../lib/crosshair-ui";
import type { PreviewPixels } from "./useCrosshairDraft";

/**
 * Paint any crosshair source into a canvas: a builtin shape, the imported
 * PNG buffer, or decoded sprite pixels of any size (scaled with
 * nearest-neighbour and centred). Shared by the big preview, the chips, the
 * community grid and the weapon popover so they cannot disagree.
 */
export function paintCrosshair(
  canvas: HTMLCanvasElement,
  shape: string,
  customRgba: number[] | null,
  color: CrosshairColor | null,
  preview: PreviewPixels | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const exact = (rgba: number[] | Uint8ClampedArray) => {
    const image = ctx.createImageData(CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
    image.data.set(tintCrosshairRgba(rgba, color));
    ctx.putImageData(image, 0, 0);
  };
  if (shape === CUSTOM_CROSSHAIR_SHAPE && customRgba) {
    exact(customRgba);
    return;
  }
  if (isBuiltinCrosshairShape(shape)) {
    exact(renderCrosshairRgba(shape));
    return;
  }
  if (!preview || preview.width <= 0 || preview.height <= 0) {
    return;
  }
  if (preview.width === CROSSHAIR_CANVAS_SIZE && preview.height === CROSSHAIR_CANVAS_SIZE) {
    exact(preview.rgba);
    return;
  }
  const scratch = document.createElement("canvas");
  scratch.width = preview.width;
  scratch.height = preview.height;
  const scratchCtx = scratch.getContext("2d");
  if (!scratchCtx) {
    return;
  }
  const image = scratchCtx.createImageData(preview.width, preview.height);
  image.data.set(tintCrosshairRgba(preview.rgba, color));
  scratchCtx.putImageData(image, 0, 0);
  const scale = Math.min(
    CROSSHAIR_CANVAS_SIZE / preview.width,
    CROSSHAIR_CANVAS_SIZE / preview.height,
  );
  const width = Math.max(1, Math.round(preview.width * scale));
  const height = Math.max(1, Math.round(preview.height * scale));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    scratch,
    Math.round((CROSSHAIR_CANVAS_SIZE - width) / 2),
    Math.round((CROSSHAIR_CANVAS_SIZE - height) / 2),
    width,
    height,
  );
}

/** A small square picture of one crosshair, on the app's dark ground. */
export function CrosshairThumb({
  shape,
  customRgba = null,
  color,
  preview,
  size = 48,
  className = "",
  testId,
}: {
  shape: string;
  customRgba?: number[] | null;
  color: CrosshairColor | null;
  preview: PreviewPixels | null;
  size?: number;
  className?: string;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      paintCrosshair(ref.current, shape, customRgba, color, preview);
    }
  }, [shape, customRgba, color, preview]);
  return (
    <canvas
      ref={ref}
      data-testid={testId}
      width={CROSSHAIR_CANVAS_SIZE}
      height={CROSSHAIR_CANVAS_SIZE}
      className={`thumb-art ${className}`.trim()}
      style={{ width: size, height: size }}
    />
  );
}
