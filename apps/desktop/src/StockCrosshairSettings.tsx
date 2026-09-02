import { useEffect, useMemo, useRef } from "react";
import { useAppStatus, useCanWrite } from "./hooks/useAppStatus";
import { useSeededDraft } from "./hooks/useSeededDraft";
import type { StockCrosshairSprite } from "./lib/bridge";
import {
  COLOR_MAX,
  COLOR_MIN,
  CROSSHAIR_FILES,
  CROSSHAIR_SCALE_MAX,
  CROSSHAIR_SCALE_MIN,
  type CrosshairFile,
  clampGameplay,
  type GameplaySettings,
  gameplayDirty,
  seedGameplay,
  serializeGameplay,
} from "./lib/gameplay-ui";
import {
  STOCK_CROSSHAIR_LABELS,
  type StockShapePrimitive,
  stockCrosshairPrimitives,
  stockCrosshairRenderedSize,
} from "./lib/stock-crosshair-shapes";

export function StockCrosshairSettings({
  effective,
  sprites = null,
  managedText,
  onSave,
}: {
  effective: Record<string, string>;
  /** Real sprites from the user's game files; geometry fallback when null. */
  sprites?: Record<string, StockCrosshairSprite> | null;
  managedText: string;
  onSave: (gameplayText: string) => void;
}) {
  const { running } = useAppStatus();
  const seeded = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  // Applying the crosshair pack rewrites cl_crosshair_red/green/blue in this
  // same managed file. Reseeding on every incoming change wiped whatever the
  // user was mid-edit here; `useSeededDraft` keeps a dirty draft instead.
  const [draft, setDraft] = useSeededDraft(seeded, serializeGameplay);
  const locked = !useCanWrite();
  const dirty = gameplayDirty(draft, seeded);

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
  const renderedSize = stockCrosshairRenderedSize(draft.cl_crosshair_scale);

  return (
    <form
      data-testid="stock-crosshair-settings"
      className="min-w-0"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      {/* Lead with the decision: file, scale and colour on the left, the live
          preview pinned at 360px on the right. */}
      <div className="hero-row">
        <div className="min-w-0">
          <h2 className="t-section">Default in-game crosshair</h2>
          <p className="t-meta mt-1">
            TF2's built-in crosshair is the lightweight choice that works everywhere.
          </p>

          <div className="mt-5 flex min-w-0 flex-col gap-6">
            <fieldset>
              <legend className="t-row">Crosshair</legend>
              <div
                data-testid="stock-crosshair-file"
                data-value={draft.cl_crosshair_file}
                className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8"
              >
                {CROSSHAIR_FILES.map((file) => {
                  const selected = draft.cl_crosshair_file === file;
                  const fileSprite = file === "" ? null : (sprites?.[file] ?? null);
                  const filePrimitives = stockCrosshairPrimitives(file);
                  return (
                    <label
                      key={file || "default"}
                      title={file === "" ? "Default / none" : STOCK_CROSSHAIR_LABELS[file]}
                      className={`thumb cursor-pointer focus-within:ring-2 focus-within:ring-brand ${
                        selected ? "thumb-selected" : ""
                      } ${locked ? "thumb-disabled" : ""}`}
                    >
                      <input
                        type="radio"
                        name="stock-crosshair-file"
                        data-testid={`stock-crosshair-file-${file || "default"}`}
                        value={file}
                        checked={selected}
                        disabled={locked}
                        onChange={() => patch({ cl_crosshair_file: file })}
                        className="sr-only"
                      />
                      <span className="thumb-art grid place-items-center" aria-hidden="true">
                        {fileSprite ? (
                          <StockSpriteCanvas
                            file={file}
                            sprite={fileSprite}
                            red={draft.cl_crosshair_red}
                            green={draft.cl_crosshair_green}
                            blue={draft.cl_crosshair_blue}
                            size={40}
                          />
                        ) : filePrimitives ? (
                          <StockShapeSvg
                            file={file}
                            primitives={filePrimitives}
                            color={color}
                            size={40}
                          />
                        ) : (
                          <span className="text-[10px] text-ink-faint">weapon</span>
                        )}
                      </span>
                      <span className="thumb-label">
                        {file === "" ? "None" : file.replace("crosshair", "")}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="t-meta mt-2">
                {draft.cl_crosshair_file === ""
                  ? "Default / none — each weapon draws its own crosshair."
                  : STOCK_CROSSHAIR_LABELS[draft.cl_crosshair_file]}
              </p>
            </fieldset>

            <StockSliderRow
              id="stock-crosshair-scale"
              label="Scale"
              value={draft.cl_crosshair_scale}
              min={CROSSHAIR_SCALE_MIN}
              max={CROSSHAIR_SCALE_MAX}
              disabled={locked}
              onChange={(cl_crosshair_scale) => patch({ cl_crosshair_scale })}
            />

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="t-row">Colour</h3>
                <span
                  aria-hidden="true"
                  className="size-6 rounded-md border border-edge-strong"
                  style={{ backgroundColor: color }}
                />
              </div>
              <div className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
                <StockSliderRow
                  id="stock-crosshair-red"
                  label="Red"
                  value={draft.cl_crosshair_red}
                  min={COLOR_MIN}
                  max={COLOR_MAX}
                  disabled={locked}
                  accentClass="range-red"
                  onChange={(cl_crosshair_red) => patch({ cl_crosshair_red })}
                />
                <StockSliderRow
                  id="stock-crosshair-green"
                  label="Green"
                  value={draft.cl_crosshair_green}
                  min={COLOR_MIN}
                  max={COLOR_MAX}
                  disabled={locked}
                  accentClass="range-green"
                  onChange={(cl_crosshair_green) => patch({ cl_crosshair_green })}
                />
                <StockSliderRow
                  id="stock-crosshair-blue"
                  label="Blue"
                  value={draft.cl_crosshair_blue}
                  min={COLOR_MIN}
                  max={COLOR_MAX}
                  disabled={locked}
                  accentClass="range-blue"
                  onChange={(cl_crosshair_blue) => patch({ cl_crosshair_blue })}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="hero-preview self-start">
          <div
            data-testid="stock-crosshair-preview"
            role="img"
            aria-label={`Preview of ${STOCK_CROSSHAIR_LABELS[draft.cl_crosshair_file]} at scale ${draft.cl_crosshair_scale}`}
            className="surface relative grid aspect-video w-full place-items-center bg-bg"
          >
            {sprite ? (
              <StockSpriteCanvas
                file={draft.cl_crosshair_file}
                sprite={sprite}
                red={draft.cl_crosshair_red}
                green={draft.cl_crosshair_green}
                blue={draft.cl_crosshair_blue}
                size={renderedSize}
                testId="stock-crosshair-sprite"
              />
            ) : primitives ? (
              <StockShapeSvg
                file={draft.cl_crosshair_file}
                primitives={primitives}
                color={color}
                size={renderedSize}
                testId="stock-crosshair-shape"
              />
            ) : (
              <p className="t-meta max-w-48 px-3 text-center">
                Default / none — each weapon draws its own crosshair.
              </p>
            )}
            <span className="eyebrow absolute bottom-2.5 left-2.5 rounded-md bg-bg/80 px-2 py-0.5">
              Live preview
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-ink-faint">
            <span>{STOCK_CROSSHAIR_LABELS[draft.cl_crosshair_file]}</span>
            <span className="tnum">
              {draft.cl_crosshair_red}, {draft.cl_crosshair_green}, {draft.cl_crosshair_blue}
            </span>
          </div>
          <p className="t-meta mt-2 text-ink-faint">
            Pick Default / none before using the custom crosshair builder below.
          </p>
        </div>
      </div>

      {/* A plain row, not the sticky `ApplyBar`: this is a sub-section of the
          Crosshair pane, and the pane's own ApplyBar already owns the bottom. */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-edge pt-4">
        <p className="t-meta" aria-live="polite">
          {dirty ? "Unsaved changes" : "Saved"}
        </p>
        <button
          type="submit"
          data-testid="stock-crosshair-apply"
          disabled={locked || !dirty}
          className="btn btn-primary"
        >
          {running ? "Close TF2 to save" : "Save crosshair"}
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
  testId,
}: {
  file: string;
  sprite: StockCrosshairSprite;
  red: number;
  green: number;
  blue: number;
  size: number;
  testId?: string;
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
      data-testid={testId}
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
  testId,
}: {
  file: CrosshairFile;
  primitives: StockShapePrimitive[];
  color: string;
  size: number;
  testId?: string;
}) {
  return (
    <svg
      data-testid={testId}
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
  accentClass = "",
  note,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  /** A `--color-*` token utility, never a raw hex. */
  accentClass?: string;
  note?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="t-row">
          {label}
        </label>
        <output htmlFor={id} className="tnum text-[14px] text-ink-muted">
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
        className={`range mt-3 w-full ${accentClass}`}
      />
      {note ? <p className="mt-1 text-[12px] leading-5 text-ink-faint">{note}</p> : null}
    </div>
  );
}
