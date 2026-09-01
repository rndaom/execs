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

export function crosshairShapeLabel(shape: string): string {
  return shape === CUSTOM_CROSSHAIR_SHAPE ? "imported PNG" : shape;
}

/**
 * The 64×64 live preview of whatever is currently selected.
 *
 * Community sprites are written into the pack at their own dimensions (32px and
 * 128px entries exist), so this scales any size into the canvas with
 * nearest-neighbour and centres it. The previous `width === 64` guard fell
 * through for everything else and left the user staring at an empty box.
 */
export function CrosshairPreview({
  shape,
  customRgba,
  color,
  preview,
}: {
  shape: string;
  customRgba: number[] | null;
  color: CrosshairColor | null;
  preview: PreviewPixels | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Every source draws white and takes the tint here, mirroring the engine:
    // textures ship untinted and cl_crosshair_red/green/blue colour them.
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
    // Any other size: blit through an offscreen canvas so drawImage can scale
    // it. Smoothing off — these are pixel sprites, and a blurred preview would
    // misrepresent what gets written into the pack.
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
  }, [shape, customRgba, color, preview]);

  return (
    <div className="surface bg-bg p-4">
      <canvas
        ref={canvasRef}
        data-testid="crosshair-preview"
        width={CROSSHAIR_CANVAS_SIZE}
        height={CROSSHAIR_CANVAS_SIZE}
        aria-label={`Preview of ${crosshairShapeLabel(shape)} crosshair`}
        className="mx-auto block aspect-square w-full max-w-44"
        style={{ imageRendering: "pixelated" }}
      >
        Crosshair preview
      </canvas>
    </div>
  );
}
