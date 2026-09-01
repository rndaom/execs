import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/ui/Modal";
import {
  type CrosshairDesign,
  clampDesign,
  DESIGN_LIMITS,
  DESIGN_STYLES,
  maxDesignSize,
  renderCrosshairDesign,
} from "../lib/crosshair-designer";
import { CROSSHAIR_CANVAS_SIZE, type CrosshairColor } from "../lib/crosshair-ui";

/** The parametric designer. What the canvas shows is exactly what gets baked. */
export function CrosshairDesigner({
  open,
  initial,
  color,
  onSave,
  onClose,
}: {
  open: boolean;
  initial: CrosshairDesign;
  color: CrosshairColor | null;
  onSave: (design: CrosshairDesign) => void;
  onClose: () => void;
}) {
  const [design, setDesign] = useState<CrosshairDesign>(initial);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) {
      return;
    }
    const image = ctx.createImageData(CROSSHAIR_CANVAS_SIZE, CROSSHAIR_CANVAS_SIZE);
    image.data.set(renderCrosshairDesign(design, color));
    ctx.putImageData(image, 0, 0);
  }, [design, color]);

  // Thickness, gap and outline all eat into the room the arms have, so the
  // size ceiling has to move with them — otherwise the slider runs on while
  // the crosshair sits clipped flat against the sprite edge.
  const sizeMax = maxDesignSize(design);
  const sizeCapped = sizeMax < DESIGN_LIMITS.size.max;

  function patch(update: Partial<CrosshairDesign>) {
    setDesign((current) => clampDesign({ ...current, ...update }));
  }

  return (
    <Modal
      open={open}
      testId="crosshair-designer"
      title="Design your own crosshair"
      description="Rendered at real sprite size — what you see is what gets baked."
      className="fixed top-1/2 left-1/2 z-50 w-[min(42rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5"
      onClose={onClose}
    >
      <button
        type="button"
        data-testid="crosshair-designer-close"
        onClick={onClose}
        aria-label="Close designer"
        className="btn btn-ghost absolute top-3 right-3 p-2"
      >
        <X size={16} />
      </button>

      <div className="mt-4 grid gap-5 sm:grid-cols-[11rem_1fr]">
        <div>
          <div className="surface bg-bg p-3">
            <canvas
              ref={canvasRef}
              data-testid="crosshair-designer-preview"
              width={CROSSHAIR_CANVAS_SIZE}
              height={CROSSHAIR_CANVAS_SIZE}
              className="mx-auto block aspect-square w-full max-w-36"
              style={{ imageRendering: "pixelated" }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {DESIGN_STYLES.map((style) => (
              <button
                key={style}
                type="button"
                aria-pressed={design.style === style}
                data-testid={`crosshair-designer-style-${style}`}
                onClick={() => patch({ style })}
                className={`rounded-lg px-2.5 py-1.5 text-xs capitalize transition-colors ${
                  design.style === style
                    ? "bg-brand text-on-brand"
                    : "bg-panel text-ink-muted hover:text-ink"
                }`}
              >
                {style}
              </button>
            ))}
          </div>
        </div>

        <div className="grid content-start gap-3">
          <DesignerSlider
            id="designer-size"
            label={design.style === "circle" ? "Radius" : "Length"}
            value={design.size}
            min={DESIGN_LIMITS.size.min}
            max={sizeMax}
            note={
              sizeCapped
                ? `Capped at ${sizeMax} px — thickness, gap and outline all take room inside the 64 × 64 sprite.`
                : undefined
            }
            onChange={(size) => patch({ size })}
          />
          <DesignerSlider
            id="designer-thickness"
            label="Thickness"
            value={design.thickness}
            min={DESIGN_LIMITS.thickness.min}
            max={DESIGN_LIMITS.thickness.max}
            onChange={(thickness) => patch({ thickness })}
          />
          {design.style !== "circle" && design.style !== "dot" ? (
            <DesignerSlider
              id="designer-gap"
              label="Gap"
              value={design.gap}
              min={DESIGN_LIMITS.gap.min}
              max={DESIGN_LIMITS.gap.max}
              onChange={(gap) => patch({ gap })}
            />
          ) : null}
          <DesignerSlider
            id="designer-outline"
            label="Outline"
            value={design.outline}
            min={DESIGN_LIMITS.outline.min}
            max={DESIGN_LIMITS.outline.max}
            onChange={(outline) => patch({ outline })}
          />
          <DesignerSlider
            id="designer-opacity"
            label="Opacity"
            value={design.opacity}
            min={DESIGN_LIMITS.opacity.min}
            max={DESIGN_LIMITS.opacity.max}
            onChange={(opacity) => patch({ opacity })}
          />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {design.style !== "dot" ? (
              <label className="flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  data-testid="crosshair-designer-dot"
                  checked={design.dot}
                  onChange={(event) => patch({ dot: event.target.checked })}
                  className="accent-brand"
                />
                Center dot
              </label>
            ) : null}
            {design.dot && design.style !== "dot" ? (
              <DesignerSlider
                id="designer-dot-size"
                label="Dot size"
                value={design.dotSize}
                min={DESIGN_LIMITS.dotSize.min}
                max={DESIGN_LIMITS.dotSize.max}
                compact
                onChange={(dotSize) => patch({ dotSize })}
              />
            ) : null}
            <label className="flex items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                data-testid="crosshair-designer-shadow"
                checked={design.shadow}
                onChange={(event) => patch({ shadow: event.target.checked })}
                className="accent-brand"
              />
              Drop shadow
            </label>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-edge/60 pt-4">
        <button type="button" onClick={onClose} className="btn btn-ghost">
          Cancel
        </button>
        <button
          type="button"
          data-testid="crosshair-designer-save"
          onClick={() => onSave(design)}
          className="btn btn-primary"
        >
          Save to library
        </button>
      </div>
    </Modal>
  );
}

function DesignerSlider({
  id,
  label,
  value,
  min,
  max,
  note,
  compact = false,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  note?: string;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  const noteId = note ? `${id}-note` : undefined;
  return (
    <div className={compact ? "flex items-center gap-2" : undefined}>
      <div
        className={compact ? "flex items-center gap-2" : "flex items-center justify-between gap-3"}
      >
        <label htmlFor={id} className="text-xs font-medium text-ink">
          {label}
        </label>
        <output htmlFor={id} className="font-mono text-xs text-ink-muted">
          {value}
        </output>
      </div>
      <input
        id={id}
        data-testid={id}
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        aria-describedby={noteId}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`${compact ? "w-24" : "mt-1.5 w-full"} cursor-pointer accent-brand`}
      />
      {note ? (
        <p id={noteId} className="mt-1 text-[10px] leading-4 text-ink-faint">
          {note}
        </p>
      ) : null}
    </div>
  );
}
