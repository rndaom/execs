import { ArrowLeft, ClipboardText, Copy } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { Segmented } from "../components/ui/Segmented";
import { Switch } from "../components/ui/Switch";
import { type CopyFeedback, copyButtonLabel, copyToClipboard } from "../lib/copy-ui";
import {
  type CrosshairDesign,
  clampDesign,
  DESIGN_LIMITS,
  DESIGN_STYLE_LABELS,
  DESIGN_STYLES,
  type DesignStyle,
  designCode,
  gapApplies,
  maxDesignSize,
  parseDesignCode,
  renderCrosshairDesign,
} from "../lib/crosshair-designer";
import { CROSSHAIR_CANVAS_SIZE, type CrosshairColor } from "../lib/crosshair-ui";
import { CrosshairThumb } from "./CrosshairThumb";

export type CrosshairDesignerDraft = { name: string; design: CrosshairDesign };

const RADIUS_STYLES: readonly DesignStyle[] = [
  "circle",
  "ring-cross",
  "diamond",
  "square",
  "triangle",
];

/**
 * The parametric designer, laid out in the pane's left column while the
 * stage on the right shows the design live at its real in-game size. What
 * the stage shows is exactly what gets baked. Save and Cancel live in the
 * pane's bottom bar.
 */
export function CrosshairDesigner({
  value,
  color,
  editing,
  onChange,
  onClose,
}: {
  value: CrosshairDesignerDraft;
  color: CrosshairColor;
  /** The saved design being edited, or null for a new one. */
  editing: string | null;
  onChange: (draft: CrosshairDesignerDraft) => void;
  onClose: () => void;
}) {
  const { name, design } = value;
  const [codeEntry, setCodeEntry] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyFeedback>("idle");
  const codeError = codeEntry !== null && codeEntry.trim() !== "" && !parseDesignCode(codeEntry);
  // Thickness, gap, outline and rotation all eat into the room the arms
  // have, so the size ceiling moves with them.
  const sizeMax = maxDesignSize(design);
  const sizeCapped = sizeMax < DESIGN_LIMITS.size.max;
  const rotation = design.rotation ?? 0;

  function patch(update: Partial<CrosshairDesign>) {
    onChange({ name, design: clampDesign({ ...design, ...update }) });
  }

  // One picture per style, drawn with the current stroke so the grid previews
  // the choice rather than a generic icon.
  const styleArt = useMemo(() => {
    const art = {} as Record<DesignStyle, number[]>;
    for (const style of DESIGN_STYLES) {
      const sample = clampDesign({
        ...design,
        style,
        rotation: 0,
        thickness: Math.max(design.thickness, 2),
        size: style === "dot" ? design.size : Math.min(design.size, 14),
      });
      art[style] = Array.from(renderCrosshairDesign(sample, null));
    }
    return art;
  }, [design]);

  return (
    <section data-testid="crosshair-designer" aria-labelledby="crosshair-designer-heading">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-quiet -ml-2"
          data-testid="crosshair-designer-back"
          onClick={onClose}
        >
          <ArrowLeft size={14} />
          Crosshairs
        </button>
        <h2 id="crosshair-designer-heading" className="t-section">
          {editing ? "Edit design" : "New design"}
        </h2>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 basis-52">
          <span className="t-row block">Name</span>
          <input
            aria-label="Design name"
            className="input mt-2 w-full"
            maxLength={40}
            value={name}
            placeholder="My crosshair"
            onChange={(event) => onChange({ name: event.target.value, design })}
          />
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="crosshair-designer-copy-code"
            onClick={async () => {
              setCopied(await copyToClipboard(designCode(design, name)));
              window.setTimeout(() => setCopied("idle"), 1800);
            }}
          >
            <Copy size={14} />
            {copyButtonLabel(copied, "Copy code")}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={codeEntry !== null}
            data-testid="crosshair-designer-paste-code"
            onClick={() => setCodeEntry((current) => (current === null ? "" : null))}
          >
            <ClipboardText size={14} />
            Paste code
          </button>
        </div>
      </div>
      {codeEntry !== null ? (
        <form
          className="mt-3 flex flex-wrap items-start gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = parseDesignCode(codeEntry);
            if (!parsed) return;
            onChange({ name: parsed.label ?? name, design: parsed.design });
            setCodeEntry(null);
          }}
        >
          <div className="min-w-0 flex-1 basis-60">
            <input
              aria-label="Design code"
              aria-invalid={codeError}
              className="input w-full font-mono text-[12px]"
              placeholder="execs-crosshair:…"
              value={codeEntry}
              onChange={(event) => setCodeEntry(event.target.value)}
            />
            {codeError ? (
              <p className="t-meta mt-1 text-[12px] text-error">
                That is not an execs design code.
              </p>
            ) : null}
          </div>
          <button type="submit" className="btn btn-ghost" disabled={!codeEntry.trim() || codeError}>
            Use code
          </button>
        </form>
      ) : null}

      <fieldset className="mt-6">
        <legend className="t-row">Shape</legend>
        <div className="crosshair-style-grid mt-3">
          {DESIGN_STYLES.map((style) => (
            <span key={style} className="crosshair-item">
              <input
                id={`designer-style-${style}`}
                type="radio"
                className="peer sr-only"
                name="designer-style"
                checked={design.style === style}
                onChange={() => patch({ style })}
                data-testid={`crosshair-designer-style-${style}`}
              />
              <label
                htmlFor={`designer-style-${style}`}
                title={DESIGN_STYLE_LABELS[style]}
                data-selected={design.style === style}
                className="crosshair-choice crosshair-choice-sm"
              >
                <span className="crosshair-choice-art" aria-hidden="true">
                  <CrosshairThumb
                    pixels={{
                      width: CROSSHAIR_CANVAS_SIZE,
                      height: CROSSHAIR_CANVAS_SIZE,
                      rgba: styleArt[style],
                    }}
                    color={color}
                    size={48}
                  />
                </span>
                <span className="crosshair-choice-name">{DESIGN_STYLE_LABELS[style]}</span>
              </label>
            </span>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 grid gap-1">
        {design.style === "dot" ? (
          <DesignerSlider
            id="designer-dot-radius"
            label="Radius"
            value={Math.max(design.dotSize, design.size / 4)}
            min={DESIGN_LIMITS.dotSize.min}
            max={DESIGN_LIMITS.dotSize.max}
            unit="px"
            onChange={(dotSize) => patch({ dotSize, size: dotSize * 4 })}
          />
        ) : (
          <DesignerSlider
            id="designer-size"
            label={RADIUS_STYLES.includes(design.style) ? "Radius" : "Length"}
            value={design.size}
            min={DESIGN_LIMITS.size.min}
            max={sizeMax}
            unit="px"
            note={
              sizeCapped && design.size >= sizeMax
                ? `Capped at ${sizeMax} px so the whole design fits the 64 px sprite.`
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
            unit="px"
            onChange={(thickness) => patch({ thickness })}
          />
        ) : null}
        {gapApplies(design.style) ? (
          <DesignerSlider
            id="designer-gap"
            label="Gap"
            value={design.gap}
            min={DESIGN_LIMITS.gap.min}
            max={DESIGN_LIMITS.gap.max}
            unit="px"
            onChange={(gap) => patch({ gap })}
          />
        ) : null}
        <DesignerSlider
          id="designer-rotation"
          label="Rotation"
          value={rotation}
          min={0}
          max={359}
          unit="°"
          onChange={(next) => patch({ rotation: next })}
          extra={
            <div className="flex gap-1">
              {[0, 45, 90].map((angle) => (
                <button
                  key={angle}
                  type="button"
                  aria-pressed={rotation === angle}
                  className={`crosshair-chip ${rotation === angle ? "crosshair-chip-selected" : ""}`}
                  onClick={() => patch({ rotation: angle })}
                >
                  {angle}°
                </button>
              ))}
            </div>
          }
        />
        {design.style === "arms" ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2 py-2">
            {(["up", "down", "left", "right"] as const).map((direction) => (
              <span key={direction} className="flex items-center gap-2 text-[13px] text-ink">
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
                <span className="capitalize">{direction}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-6 border-t border-edge pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="flex items-center gap-3 text-[14px] font-semibold text-ink">
            <Switch
              checked={design.style === "dot" || design.dot}
              disabled={design.style === "dot"}
              label="Center dot"
              testId="crosshair-designer-dot"
              onChange={(dot) => patch({ dot })}
            />
            Center dot
          </span>
          {design.style === "dot" || design.dot ? (
            <Segmented
              label="Dot shape"
              size="sm"
              value={design.dotShape === "square" ? "square" : "round"}
              options={[
                { id: "round", label: "Round" },
                { id: "square", label: "Square" },
              ]}
              onChange={(shape) => patch({ dotShape: shape === "square" ? "square" : undefined })}
            />
          ) : null}
        </div>
        {design.dot && design.style !== "dot" ? (
          <DesignerSlider
            id="designer-dot-size"
            label="Dot size"
            value={design.dotSize}
            min={DESIGN_LIMITS.dotSize.min}
            max={DESIGN_LIMITS.dotSize.max}
            unit="px"
            onChange={(dotSize) => patch({ dotSize })}
          />
        ) : null}
      </div>

      <div className="mt-6 grid gap-1 border-t border-edge pt-4">
        <DesignerSlider
          id="designer-outline"
          label="Outline"
          value={design.outline}
          min={DESIGN_LIMITS.outline.min}
          max={DESIGN_LIMITS.outline.max}
          unit="px"
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
        <div className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
          <span className="flex items-center gap-3 text-[13px] text-ink">
            <Switch
              checked={design.shadow}
              label="Drop shadow"
              testId="crosshair-designer-shadow"
              onChange={(shadow) => patch({ shadow })}
            />
            Drop shadow
          </span>
          <span className="flex items-center gap-3 text-[13px] text-ink">
            <Switch
              checked={design.smooth === true}
              label="Smooth edges"
              testId="crosshair-designer-smooth"
              onChange={(smooth) => patch({ smooth })}
            />
            Smooth edges
          </span>
        </div>
        <p className="t-meta mt-2 text-[12px]">The outline stays black.</p>
      </div>
    </section>
  );
}

function DesignerSlider({
  id,
  label,
  value,
  min,
  max,
  unit = "",
  note,
  format,
  extra,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  note?: string;
  format?: (value: number) => string;
  extra?: React.ReactNode;
  onChange: (value: number) => void;
}) {
  const noteId = note ? `${id}-note` : undefined;
  return (
    <div className="py-1">
      <div className="grid min-h-9 grid-cols-[6rem_minmax(0,1fr)_3.25rem] items-center gap-3">
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
        />
        <output htmlFor={id} className="tnum text-right text-[13px] text-ink-muted">
          {format ? format(value) : `${value}${unit === "°" ? "°" : unit ? ` ${unit}` : ""}`}
        </output>
      </div>
      {extra ? <div className="mt-1 ml-[6.75rem]">{extra}</div> : null}
      {note ? (
        <p id={noteId} className="t-meta mt-1 ml-[6.75rem] text-[12px]">
          {note}
        </p>
      ) : null}
    </div>
  );
}
