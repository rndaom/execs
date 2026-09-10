import { useId, useState } from "react";
import { hexToRgb, rgbToHex } from "../lib/color";
import { hsvToRgb, rgbToHsv } from "../lib/crosshair-color";
import type { CrosshairColor } from "../lib/crosshair-ui";

/** RGB stays authoritative: merely opening the picker never quantizes a saved color. */
export function ColorPicker({
  color,
  onChange,
}: {
  color: CrosshairColor;
  onChange: (color: CrosshairColor) => void;
}) {
  const id = useId();
  const [lastHue, setLastHue] = useState(0);
  const [entry, setEntry] = useState<string | null>(null);
  const hsv = rgbToHsv(color);
  const hue = hsv.s === 0 ? lastHue : hsv.h;
  const hex = rgbToHex(...color);
  const invalid = entry !== null && hexToRgb(entry) === null;
  function change(h: number, s: number, v: number) {
    setLastHue(h);
    setEntry(null);
    onChange(hsvToRgb(h, s, v));
  }
  return (
    <fieldset className="min-w-0 max-w-80">
      <legend className="t-row mb-3">Color</legend>
      <fieldset
        aria-label="Color field"
        className="relative h-28 touch-none rounded-md border border-edge-strong"
        style={{
          background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, transparent), hsl(${hue} 100% 50%)`,
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.getBoundingClientRect();
          change(
            hue,
            (event.clientX - rect.left) / rect.width,
            1 - (event.clientY - rect.top) / rect.height,
          );
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          change(
            hue,
            (event.clientX - rect.left) / rect.width,
            1 - (event.clientY - rect.top) / rect.height,
          );
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
        className="range mt-3 w-full"
        style={{
          background: "linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red)",
        }}
      />
      <div className="mt-3 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="size-8 shrink-0 rounded-md border border-edge-strong"
          style={{ background: hex }}
        />
        <label className="sr-only" htmlFor={`${id}-hex`}>
          Hex color
        </label>
        <input
          id={`${id}-hex`}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          className="input min-w-0 w-28 font-mono"
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
        <span className="t-meta tnum">{color.join(", ")}</span>
      </div>
      {invalid ? (
        <p id={`${id}-error`} className="t-meta mt-2">
          Enter six hex digits, for example #00ff80.
        </p>
      ) : null}
      <details className="mt-3 t-meta">
        <summary className="cursor-pointer">Saturation and brightness</summary>
        <label className="mt-2 block">
          Saturation
          <input
            aria-label="Saturation"
            type="range"
            className="range w-full"
            min={0}
            max={100}
            value={Math.round(hsv.s * 100)}
            onChange={(e) => change(hue, Number(e.target.value) / 100, hsv.v)}
          />
        </label>
        <label className="mt-2 block">
          Brightness
          <input
            aria-label="Brightness"
            type="range"
            className="range w-full"
            min={0}
            max={100}
            value={Math.round(hsv.v * 100)}
            onChange={(e) => change(hue, hsv.s, Number(e.target.value) / 100)}
          />
        </label>
      </details>
    </fieldset>
  );
}
