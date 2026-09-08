import { type ReactNode, useEffect, useRef } from "react";
import {
  type CrosshairColor,
  CUSTOM_CROSSHAIR_SHAPE,
  isBuiltinCrosshairShape,
  renderCrosshairRgba,
  tintCrosshairRgba,
} from "../lib/crosshair-ui";
import type { PreviewPixels } from "./useCrosshairDraft";

export function crosshairShapeLabel(shape: string): string {
  return shape === CUSTOM_CROSSHAIR_SHAPE
    ? "Imported PNG"
    : shape.replace(/^(design|execs)-/, "").replaceAll("-", " ");
}

export function CrosshairPreview({
  shape,
  customRgba,
  color,
  preview,
  scale = 32,
  scene,
}: {
  shape: string;
  customRgba: number[] | null;
  color: CrosshairColor | null;
  preview: PreviewPixels | null;
  scale?: number;
  scene?: ReactNode;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const builtin = isBuiltinCrosshairShape(shape) && shape !== "custom";
  const pixels =
    shape === "custom" && customRgba
      ? { width: 64, height: 64, rgba: customRgba }
      : builtin
        ? { width: 64, height: 64, rgba: renderCrosshairRgba(shape) }
        : preview;
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !pixels) return;
    const image = ctx.createImageData(pixels.width, pixels.height);
    image.data.set(tintCrosshairRgba(pixels.rgba, color));
    ctx.putImageData(image, 0, 0);
  }, [pixels, color]);
  return (
    <div className="surface relative grid aspect-video w-full place-items-center overflow-hidden bg-bg">
      {scene}
      {pixels ? (
        <canvas
          ref={ref}
          data-testid="crosshair-preview"
          width={pixels.width}
          height={pixels.height}
          aria-label={`Preview of ${crosshairShapeLabel(shape)} at size ${scale}`}
          className="relative"
          style={{
            width: `${(Math.round((pixels.width * scale) / 32) / 1280) * 100}%`,
            height: `${(Math.round((pixels.height * scale) / 32) / 720) * 100}%`,
            imageRendering: "pixelated",
          }}
        />
      ) : (
        <p className="t-meta relative rounded-md bg-bg/80 px-3 py-2">
          Preview unavailable · select or import an asset
        </p>
      )}
      <span className="eyebrow absolute bottom-2.5 left-2.5 rounded-md bg-bg/80 px-2 py-0.5">
        1280 × 720 reference
      </span>
    </div>
  );
}
