import { useId, useState } from "react";
import { hexToRgb, rgbToHex } from "../lib/color";
import { hsvToRgb, rgbToHsv } from "../lib/crosshair-color";
import type { CrosshairColor } from "../lib/crosshair-ui";

/** Colours players commonly pick for a crosshair; TF2's default first. */
export const CROSSHAIR_SWATCHES: readonly { name: string; rgb: CrosshairColor }[] = [
  { name: "TF2 default", rgb: [200, 200, 200] },
  { name: "White", rgb: [255, 255, 255] },
  { name: "Green", rgb: [0, 255, 0] },
  { name: "Cyan", rgb: [0, 255, 255] },
  { name: "Yellow", rgb: [255, 255, 0] },
  { name: "Magenta", rgb: [255, 0, 255] },
  { name: "Red", rgb: [255, 0, 0] },
  { name: "Orange", rgb: [255, 128, 0] },
];

/**
 * Crosshair colour: common swatches, a custom swatch that opens a colour
 * field, and an exact hex field. RGB stays authoritative: merely opening the
 * field never quantizes a saved colour.
 */
export function ColorPicker({
  color,
  onChange,
  compact = false,
}: {
  color: CrosshairColor;
  onChange: (color: CrosshairColor) => void;
  /** Start with the colour field closed. */
  compact?: boolean;
}) {
  const id = useId();
  const [lastHue, setLastHue] = useState(0);
  const [entry, setEntry] = useState<string | null>(null);
  const hsv = rgbToHsv(color);
  const hue = hsv.s === 0 ? lastHue : hsv.h;
  const hex = rgbToHex(...color);
  const invalid = entry !== null && hexToRgb(entry) === null;
  const [expanded, setExpanded] = useState(!compact);
  const preset = CROSSHAIR_SWATCHES.some((swatch) =>
    swatch.rgb.every((channel, index) => channel === color[index]),
  );
  function change(h: number, s: number, v: number) {
    setLastHue(h);
    setEntry(null);
    onChange(hsvToRgb(h, s, v));
  }
  function fromPointer(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    change(
      hue,
      Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / rect.height)),
    );
  }
  return (
    <fieldset className="min-w-0">
      <legend className="t-row mb-3">Color</legend>
      <div className="crosshair-swatches">
        {CROSSHAIR_SWATCHES.map((swatch) => {
          const selected = swatch.rgb.every((channel, index) => channel === color[index]);
          return (
            <button
              key={swatch.name}
              type="button"
              title={swatch.name}
              aria-label={swatch.name}
              aria-pressed={selected}
              data-testid={`crosshair-swatch-${swatch.name.toLowerCase().replaceAll(" ", "-")}`}
              className="crosshair-swatch"
              style={{ background: rgbToHex(...swatch.rgb) }}
              onClick={() => {
                setEntry(null);
                onChange(swatch.rgb);
              }}
            />
          );
        })}
        <button
          type="button"
          aria-label="Color picker"
          title={expanded ? "Close the colour field" : "Pick any colour"}
          aria-expanded={expanded}
          aria-controls={`${id}-picker`}
          data-testid="crosshair-swatch-custom"
          data-custom={!preset}
          className="crosshair-swatch crosshair-swatch-custom"
          onClick={() => setExpanded((current) => !current)}
        >
          {preset ? null : (
            <span className="crosshair-swatch-custom-dot" style={{ background: hex }} />
          )}
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <label className="crosshair-hex">
          <span className="crosshair-hex-chip" style={{ background: hex }} aria-hidden="true" />
          <span className="sr-only">Hex color</span>
          <input
            id={`${id}-hex`}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
            className="w-full min-w-0 bg-transparent tnum outline-none"
            value={entry ?? hex}
            spellCheck={false}
            maxLength={7}
            onChange={(e) => {
              const value = e.target.value;
              setEntry(value);
              const rgb = hexToRgb(value);
              if (rgb) onChange([rgb.r, rgb.g, rgb.b]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEntry(null);
            }}
          />
        </label>
        <span className="tnum text-[12px] text-ink-faint">RGB {color.join(" ")}</span>
      </div>
      {invalid ? (
        <p id={`${id}-error`} className="t-meta mt-2">
          Enter six hex digits, for example #00ff80.
        </p>
      ) : null}

      <div id={`${id}-picker`} hidden={!expanded} className="mt-3">
        <fieldset
          aria-label="Color field"
          className="relative h-28 touch-none rounded-md border border-edge-strong"
          style={{
            background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, transparent), hsl(${hue} 100% 50%)`,
          }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            fromPointer(event);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
          }}
        >
          <span
            aria-hidden="true"
            className="pointer-events-none absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
          />
        </fieldset>
        <label className="sr-only" htmlFor={`${id}-h`}>
          Hue
        </label>
        <input
          id={`${id}-h`}
          type="range"
          min={0}
          max={359}
          value={Math.round(hue)}
          onChange={(e) => change(Number(e.target.value), hsv.s || 1, hsv.v || 1)}
          className="range crosshair-hue mt-3 w-full"
        />
      </div>
    </fieldset>
  );
}
