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
  const referenceRef = useRef<HTMLCanvasElement | null>(null);
  const detailRef = useRef<HTMLCanvasElement | null>(null);
  const builtin = isBuiltinCrosshairShape(shape) && shape !== "custom";
  const pixels =
    shape === "custom" && customRgba
      ? { width: 64, height: 64, rgba: customRgba }
      : builtin
        ? { width: 64, height: 64, rgba: renderCrosshairRgba(shape) }
        : preview;
  useEffect(() => {
    if (!pixels) return;
    for (const canvas of [referenceRef.current, detailRef.current]) {
      const ctx = canvas?.getContext("2d");
      if (!ctx) continue;
      const image = ctx.createImageData(pixels.width, pixels.height);
      image.data.set(tintCrosshairRgba(pixels.rgba, color));
      ctx.putImageData(image, 0, 0);
    }
  }, [pixels, color]);
  const detailScale = pixels ? Math.min(96 / pixels.width, 96 / pixels.height) : 1;
  return (
    <div>
      <div className="surface relative grid aspect-video w-full place-items-center overflow-hidden bg-bg">
        {scene}
        {pixels ? (
          <canvas
            ref={referenceRef}
            data-testid="crosshair-preview"
            width={pixels.width}
            height={pixels.height}
            aria-label={`Preview of ${crosshairShapeLabel(shape)} at size ${scale}`}
            className="relative"
            style={{
              width: `${(Math.round((pixels.width * scale) / 32) / 1280) * 100}%`,
              height: "auto",
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
      {pixels ? (
        <div className="mt-2 flex items-center gap-3">
          <div className="surface grid size-24 shrink-0 place-items-center bg-bg">
            <canvas
              ref={detailRef}
              data-testid="crosshair-sprite-detail"
              width={pixels.width}
              height={pixels.height}
              aria-label={`Complete sprite for ${crosshairShapeLabel(shape)}`}
              style={{
                width: Math.max(1, Math.round(pixels.width * detailScale)),
                height: Math.max(1, Math.round(pixels.height * detailScale)),
                imageRendering: "pixelated",
              }}
            />
          </div>
          <p className="t-meta">
            Sprite detail ({pixels.width} × {pixels.height} pixels). The scene above shows its
            approximate size at 1280 × 720.
          </p>
        </div>
      ) : null}
    </div>
  );
}
