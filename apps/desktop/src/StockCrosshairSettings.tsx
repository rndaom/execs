import { useEffect, useMemo, useRef, useState } from "react";
import type { StockCrosshairSprite } from "./lib/bridge";
import {
  COLOR_MAX,
  COLOR_MIN,
  CROSSHAIR_FILES,
  CROSSHAIR_SCALE_MAX,
  CROSSHAIR_SCALE_MIN,
  type CrosshairFile,
  canApplyGameplay,
  clampGameplay,
  type GameplayLayer,
  type GameplaySettings,
  gameplayDirty,
  gameplayPath,
  seedGameplay,
  serializeGameplay,
} from "./lib/gameplay-ui";
import {
  STOCK_CROSSHAIR_LABELS,
  type StockShapePrimitive,
  stockCrosshairPrimitives,
} from "./lib/stock-crosshair-shapes";

export function StockCrosshairSettings({
  running,
  busy,
  layer,
  effective,
  sprites = null,
  managedText,
  onSave,
}: {
  running: boolean;
  busy: boolean;
  layer: GameplayLayer;
  effective: Record<string, string>;
  /** Real sprites from the user's game files; geometry fallback when null. */
  sprites?: Record<string, StockCrosshairSprite> | null;
  managedText: string;
  onSave: (gameplayText: string) => void;
}) {
  const seeded = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  const [draft, setDraft] = useState(seeded);
  const locked = !canApplyGameplay(running, busy);
  const dirty = gameplayDirty(draft, seeded);

  useEffect(() => {
    setDraft(seeded);
  }, [seeded]);

  function patch(update: Partial<GameplaySettings>) {
    setDraft((current) => ({ ...current, ...update }));
  }

  function apply() {
    if (locked) {
      return;
    }
    const next = clampGameplay(draft);
    setDraft(next);
    onSave(serializeGameplay(next));
  }

  // TF2 tints the drawn crosshair by cl_crosshair_red/green/blue at full
  // opacity. There is no alpha cvar — cl_crosshair_alpha is CS:GO's, and TF2
  // logs it as an unknown command.
  const color = `rgb(${draft.cl_crosshair_red}, ${draft.cl_crosshair_green}, ${draft.cl_crosshair_blue})`;
  const primitives = stockCrosshairPrimitives(draft.cl_crosshair_file);
  const sprite =
    draft.cl_crosshair_file === "" ? null : (sprites?.[draft.cl_crosshair_file] ?? null);
  // Engine rule: rendered size = sprite size × cl_crosshair_scale / 32.
  const renderedSize = Math.round((64 * draft.cl_crosshair_scale) / 32);

  return (
    <form
      data-testid="stock-crosshair-settings"
      className="min-w-0"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Default in-game crosshair</h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-5 text-ink-muted">
            TF2's built-in crosshair is the lightweight choice that works everywhere.
          </p>
        </div>
        <span className="font-mono text-[11px] text-ink-faint">{gameplayPath(layer)}</span>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[15rem_1fr]">
        <div>
          <div
            data-testid="stock-crosshair-preview"
            role="img"
            aria-label={`Preview of ${STOCK_CROSSHAIR_LABELS[draft.cl_crosshair_file]} at scale ${draft.cl_crosshair_scale}`}
            className="surface relative grid aspect-square w-full place-items-center bg-black"
          >
            {sprite ? (
              <StockSpriteCanvas
                file={draft.cl_crosshair_file}
                sprite={sprite}
                red={draft.cl_crosshair_red}
                green={draft.cl_crosshair_green}
                blue={draft.cl_crosshair_blue}
                size={renderedSize}
              />
            ) : primitives ? (
              <StockShapeSvg
                file={draft.cl_crosshair_file}
                primitives={primitives}
                color={color}
                size={renderedSize}
              />
            ) : (
              <p className="max-w-40 px-3 text-center text-xs leading-5 text-ink-muted">
                Default / none — each weapon draws its own crosshair.
              </p>
            )}
            <span className="absolute bottom-2.5 left-2.5 rounded-md bg-bg/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-ink-faint">
              Live preview
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-ink-faint">
            <span>{STOCK_CROSSHAIR_LABELS[draft.cl_crosshair_file]}</span>
            <span className="font-mono">
              {draft.cl_crosshair_red}, {draft.cl_crosshair_green}, {draft.cl_crosshair_blue}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label
              className="flex flex-col gap-2 text-[13px] font-medium text-ink"
              htmlFor="stock-crosshair-file"
            >
              Crosshair file
              <select
                id="stock-crosshair-file"
                data-testid="stock-crosshair-file"
                value={draft.cl_crosshair_file}
                disabled={locked}
                onChange={(event) =>
                  patch({ cl_crosshair_file: event.target.value as CrosshairFile })
                }
                className="field px-3 py-2.5 text-sm font-normal text-ink outline-none transition-colors focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-50"
              >
                {CROSSHAIR_FILES.map((file) => (
                  <option key={file || "default"} value={file}>
                    {file === "" ? "Default / none" : `${file} — ${STOCK_CROSSHAIR_LABELS[file]}`}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal leading-5 text-ink-muted">
                Choose Default / none before using the custom crosshair builder below.
              </span>
            </label>

            <StockSliderRow
              id="stock-crosshair-scale"
              label="Scale"
              value={draft.cl_crosshair_scale}
              min={CROSSHAIR_SCALE_MIN}
              max={CROSSHAIR_SCALE_MAX}
              disabled={locked}
              onChange={(cl_crosshair_scale) => patch({ cl_crosshair_scale })}
            />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-[13px] font-medium text-ink">Color</h3>
              <span
                aria-hidden="true"
                className="size-6 rounded-md border border-edge-strong"
                style={{ backgroundColor: color }}
              />
            </div>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <StockSliderRow
                id="stock-crosshair-red"
                label="Red"
                value={draft.cl_crosshair_red}
                min={COLOR_MIN}
                max={COLOR_MAX}
                disabled={locked}
                accentColor="#b8383b"
                onChange={(cl_crosshair_red) => patch({ cl_crosshair_red })}
              />
              <StockSliderRow
                id="stock-crosshair-green"
                label="Green"
                value={draft.cl_crosshair_green}
                min={COLOR_MIN}
                max={COLOR_MAX}
                disabled={locked}
                accentColor="#729e42"
                onChange={(cl_crosshair_green) => patch({ cl_crosshair_green })}
              />
              <StockSliderRow
                id="stock-crosshair-blue"
                label="Blue"
                value={draft.cl_crosshair_blue}
                min={COLOR_MIN}
                max={COLOR_MAX}
                disabled={locked}
                accentColor="#5885a2"
                onChange={(cl_crosshair_blue) => patch({ cl_crosshair_blue })}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-edge/60 pt-4">
        <p className="text-xs text-ink-muted" aria-live="polite">
          {dirty ? "Default crosshair has unsaved changes" : "Default crosshair is up to date"}
        </p>
        <button
          type="submit"
          data-testid="stock-crosshair-apply"
          disabled={locked || !dirty}
          className="btn btn-primary"
        >
          {running ? "Close TF2 to apply" : "Apply default crosshair"}
        </button>
      </div>
    </form>
  );
}

/** The real Valve sprite, tinted the way the engine tints it (RGB multiply). */
function StockSpriteCanvas({
  file,
  sprite,
  red,
  green,
  blue,
  size,
}: {
  file: string;
  sprite: StockCrosshairSprite;
  red: number;
  green: number;
  blue: number;
  size: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    const image = ctx.createImageData(sprite.width, sprite.height);
    for (let i = 0; i < sprite.rgba.length; i += 4) {
      image.data[i] = (sprite.rgba[i] * red) / 255;
      image.data[i + 1] = (sprite.rgba[i + 1] * green) / 255;
      image.data[i + 2] = (sprite.rgba[i + 2] * blue) / 255;
      image.data[i + 3] = sprite.rgba[i + 3];
    }
    ctx.putImageData(image, 0, 0);
  }, [sprite, red, green, blue]);

  return (
    <canvas
      ref={canvasRef}
      data-testid="stock-crosshair-sprite"
      data-file={file}
      width={sprite.width}
      height={sprite.height}
      className="max-h-[85%] max-w-[85%]"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}

function StockShapeSvg({
  file,
  primitives,
  color,
  size,
}: {
  file: CrosshairFile;
  primitives: StockShapePrimitive[];
  color: string;
  size: number;
}) {
  return (
    <svg
      data-testid="stock-crosshair-shape"
      data-file={file || "default"}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      className="max-h-[85%] max-w-[85%]"
      shapeRendering="crispEdges"
    >
      {primitives.map((primitive, index) => {
        const key = `${file}-${index}`;
        if (primitive.kind === "rect") {
          return (
            <rect
              key={key}
              x={primitive.x}
              y={primitive.y}
              width={primitive.w}
              height={primitive.h}
              fill={color}
            />
          );
        }
        if (primitive.kind === "ring") {
          return (
            <circle
              key={key}
              cx={primitive.cx}
              cy={primitive.cy}
              r={primitive.r}
              fill="none"
              stroke={color}
              strokeWidth={primitive.stroke}
              shapeRendering="auto"
            />
          );
        }
        if (primitive.kind === "disc") {
          return (
            <circle
              key={key}
              cx={primitive.cx}
              cy={primitive.cy}
              r={primitive.r}
              fill={color}
              shapeRendering="auto"
            />
          );
        }
        return (
          <line
            key={key}
            x1={primitive.x1}
            y1={primitive.y1}
            x2={primitive.x2}
            y2={primitive.y2}
            stroke={color}
            strokeWidth={primitive.w}
            shapeRendering="auto"
          />
        );
      })}
    </svg>
  );
}

function StockSliderRow({
  id,
  label,
  value,
  min,
  max,
  disabled,
  accentColor,
  note,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  accentColor?: string;
  note?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
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
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full cursor-pointer accent-brand disabled:cursor-not-allowed disabled:opacity-50"
        style={accentColor ? { accentColor } : undefined}
      />
      {note ? <p className="mt-1 text-[10px] leading-4 text-ink-faint">{note}</p> : null}
    </div>
  );
}
