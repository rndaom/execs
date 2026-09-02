import { useEffect, useRef } from "react";
import {
  CROSSHAIR_CANVAS_SIZE,
  type CrosshairColor,
  CUSTOM_CROSSHAIR_SHAPE,
} from "../lib/crosshair-ui";
import { paintCrosshair } from "./CrosshairThumb";
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

  // Every source draws white and takes the tint in the painter, mirroring
  // the engine: textures ship untinted and cl_crosshair_red/green/blue
  // colour them.
  useEffect(() => {
    if (canvasRef.current) {
      paintCrosshair(canvasRef.current, shape, customRgba, color, preview);
    }
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
