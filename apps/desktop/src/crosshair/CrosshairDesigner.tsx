import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../components/ui/Modal";
import { rangeFill } from "../components/ui/rangeFill";
import { Switch } from "../components/ui/Switch";
import {
  type CrosshairDesign,
  clampDesign,
  DESIGN_LIMITS,
  DESIGN_STYLES,
  maxDesignSize,
  renderCrosshairDesign,
} from "../lib/crosshair-designer";
import { CROSSHAIR_CANVAS_SIZE, type CrosshairColor } from "../lib/crosshair-ui";

export type CrosshairDesignerDraft = { name: string; design: CrosshairDesign };

/** The parametric designer. What the canvas shows is exactly what gets baked. */
export function CrosshairDesigner({
  open,
  initial,
  color,
  onSave,
  initialName = "",
  onClose,
  embedded = false,
  onPreview,
  value,
  onChange,
  showActions = true,
}: {
  open: boolean;
  initial: CrosshairDesign;
  color: CrosshairColor | null;
  onSave: (design: CrosshairDesign, name: string) => void;
  initialName?: string;
  onClose: () => void;
  /** The pane owns the large in-scene preview in the embedded workspace. */
  embedded?: boolean;
  onPreview?: (design: CrosshairDesign) => void;
  value?: CrosshairDesignerDraft;
  onChange?: (draft: CrosshairDesignerDraft) => void;
  /** Embedded workspaces may place these actions beside their large preview. */
  showActions?: boolean;
}) {
  const [localName, setLocalName] = useState(initialName);
  const [localDesign, setLocalDesign] = useState<CrosshairDesign>(initial);
  const name = value?.name ?? localName;
  const design = value?.design ?? localDesign;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    onPreview?.(design);
  }, [design, onPreview]);

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
    const next = clampDesign({ ...design, ...update });
    if (onChange) onChange({ name, design: next });
    else setLocalDesign(next);
  }

  const content = (
    <>
      {!embedded ? (
        <button
          type="button"
          data-testid="crosshair-designer-close"
          onClick={onClose}
          aria-label="Close designer"
          className="btn btn-ghost absolute top-3 right-3 p-2"
        >
          <X size={16} />
        </button>
      ) : null}

      <label className="t-row mt-4 block">
        Design name
        <input
          aria-label="Design name"
          className="input mt-2 w-full"
          maxLength={40}
          value={name}
          placeholder="My crosshair"
          onChange={(e) => {
            if (onChange) onChange({ name: e.target.value, design });
            else setLocalName(e.target.value);
          }}
        />
      </label>
      <div className={embedded ? "mt-4 grid gap-4" : "mt-4 grid gap-5 sm:grid-cols-[11rem_1fr]"}>
        <div>
          {!embedded ? (
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
          ) : null}
          <div className={embedded ? undefined : "mt-3"}>
            <fieldset className={embedded ? "grid grid-cols-5 gap-1.5" : "grid grid-cols-2 gap-2"}>
              <legend className="sr-only">Style</legend>
              {DESIGN_STYLES.map((style) => (
                <label
                  key={style}
                  className={`thumb cursor-pointer px-1.5 py-2 focus-within:ring-2 focus-within:ring-brand ${design.style === style ? "thumb-selected" : ""}`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    name="designer-style"
                    checked={design.style === style}
                    onChange={() => patch({ style })}
                    data-testid={`crosshair-designer-style-${style}`}
                  />
                  <span className="text-[12px] capitalize text-ink">
                    {style.replaceAll("-", " ")}
                  </span>
                </label>
              ))}
            </fieldset>
          </div>
        </div>

        <div className="grid content-start gap-3">
          {design.style === "dot" ? (
            <DesignerSlider
              id="designer-dot-radius"
              label="Radius"
              value={Math.max(design.dotSize, design.size / 4)}
              min={DESIGN_LIMITS.dotSize.min}
              max={DESIGN_LIMITS.dotSize.max}
              onChange={(dotSize) => patch({ dotSize, size: dotSize * 4 })}
            />
          ) : (
            <DesignerSlider
              id="designer-size"
              label={
                ["circle", "ring-cross", "diamond"].includes(design.style) ? "Radius" : "Length"
              }
              value={design.size}
              min={DESIGN_LIMITS.size.min}
              max={sizeMax}
              note={
                sizeCapped && design.size >= sizeMax
                  ? `Capped at ${sizeMax} px by thickness, gap and outline.`
                  : undefined
              }
              onChange={(size) => patch({ size })}
            />
          )}
          {design.style !== "dot" ? (
            <DesignerSlider
              id="designer-thickness"
              label="Thickness"
              value={design.thickness}
              min={DESIGN_LIMITS.thickness.min}
              max={DESIGN_LIMITS.thickness.max}
              onChange={(thickness) => patch({ thickness })}
            />
          ) : null}
          {["cross", "t", "x", "split", "arms"].includes(design.style) ? (
            <DesignerSlider
              id="designer-gap"
              label="Gap"
              value={design.gap}
              min={DESIGN_LIMITS.gap.min}
              max={DESIGN_LIMITS.gap.max}
              onChange={(gap) => patch({ gap })}
            />
          ) : null}
          {design.style === "arms" ? (
            <div className="flex flex-wrap gap-3">
              {(["up", "down", "left", "right"] as const).map((direction) => (
                <span key={direction} className="t-meta flex items-center gap-2 capitalize">
                  <Switch
                    label={`${direction} arm`}
                    checked={design.arms?.[direction] !== false}
                    onChange={(enabled) =>
                      patch({
                        arms: {
                          up: true,
                          down: true,
                          left: true,
                          right: true,
                          ...design.arms,
                          [direction]: enabled,
                        },
                      })
                    }
                  />
                  {direction}
                </span>
              ))}
            </div>
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
            format={(value) => `${Math.round((value / 255) * 100)}%`}
            min={DESIGN_LIMITS.opacity.min}
            max={DESIGN_LIMITS.opacity.max}
            onChange={(opacity) => patch({ opacity })}
          />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {design.style !== "dot" ? (
              <span className="flex items-center gap-2 text-xs text-ink">
                <Switch
                  checked={design.dot}
                  label="Center dot"
                  testId="crosshair-designer-dot"
                  onChange={(dot) => patch({ dot })}
                />
                Center dot
              </span>
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
            <span className="flex items-center gap-2 text-xs text-ink">
              <Switch
                checked={design.shadow}
                label="Drop shadow"
                testId="crosshair-designer-shadow"
                onChange={(shadow) => patch({ shadow })}
              />
              Drop shadow
            </span>
          </div>
        </div>
      </div>

      {showActions ? (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-edge pt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            data-testid="crosshair-designer-save"
            onClick={() => onSave(design, name.trim() || "My crosshair")}
            className="btn btn-primary"
          >
            Save to library
          </button>
        </div>
      ) : null}
    </>
  );
  return embedded ? (
    <section data-testid="crosshair-designer" aria-label="Design a crosshair">
      {content}
    </section>
  ) : (
    <Modal
      open={open}
      testId="crosshair-designer"
      title="Design a crosshair"
      className="fixed top-1/2 left-1/2 z-50 w-[min(42rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5"
      onClose={onClose}
    >
      {content}
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
  format,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  note?: string;
  compact?: boolean;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const noteId = note ? `${id}-note` : undefined;
  return (
    <div className={compact ? "min-w-0 flex-1" : undefined}>
      <div className="grid min-h-8 grid-cols-[5.5rem_minmax(0,1fr)_2.5rem] items-center gap-3">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
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
          className="range w-full"
          style={rangeFill(value, min, max)}
        />
        <output htmlFor={id} className="tnum text-right text-[13px] text-ink-muted">
          {format ? format(value) : value}
        </output>
      </div>
      {note ? (
        <p id={noteId} className="t-meta mt-1">
          {note}
        </p>
      ) : null}
    </div>
  );
}
