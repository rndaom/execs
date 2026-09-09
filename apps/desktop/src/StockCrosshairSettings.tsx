import { type ReactNode, useEffect, useMemo, useRef } from "react";
import { ColorPicker } from "./crosshair/ColorPicker";
import { useAppStatus } from "./hooks/useAppStatus";
import { useAutosave } from "./hooks/useAutosave";
import { draftRecordKey, useSeededDraft } from "./hooks/useSeededDraft";
import type { StockCrosshairSprite } from "./lib/bridge";
import {
  CROSSHAIR_FILES,
  CROSSHAIR_SCALE_MAX,
  CROSSHAIR_SCALE_MIN,
  type CrosshairFile,
  clampGameplay,
  type GameplaySettings,
  seedGameplay,
  serializeGameplay,
  serializeGameplayScope,
} from "./lib/gameplay-ui";
import {
  STOCK_CROSSHAIR_LABELS,
  type StockShapePrimitive,
  stockCrosshairPrimitives,
  stockCrosshairRenderedSize,
} from "./lib/stock-crosshair-shapes";

export function StockCrosshairSettings({
  profileId,
  effective,
  sprites = null,
  managedText,
  onSave,
}: {
  /** The profile this draft belongs to; a switch discards it. */
  profileId: string | null;
  effective: Record<string, string>;
  /** Real sprites from the user's game files; geometry fallback when null. */
  sprites?: Record<string, StockCrosshairSprite> | null;
  managedText: string;
  /** Resolves when the write settles; the toast reports it. */
  onSave: (gameplayText: string) => Promise<unknown>;
}) {
  const controls = useCrosshairControls(profileId, effective, managedText, onSave);
  return <CrosshairControls {...controls} sprites={sprites} />;
}

export function useCrosshairControls(
  profileId: string | null,
  effective: Record<string, string>,
  managedText: string,
  onSave: (text: string) => Promise<unknown>,
  enabled = true,
) {
  const { running } = useAppStatus();
  const seeded = useMemo(() => seedGameplay(managedText, effective), [managedText, effective]);
  // Applying the crosshair pack rewrites cl_crosshair_red/green/blue in this
  // same managed file. Reseeding on every incoming change wiped whatever the
  // user was mid-edit here; `useSeededDraft` keeps a dirty draft instead.
  const [draft, setDraft] = useSeededDraft(
    seeded,
    (value) => serializeGameplayScope(value, "crosshair"),
    draftRecordKey(profileId, "stock-crosshair"),
  );
  const token = serializeGameplayScope(draft, "crosshair");
  const dirty = token !== serializeGameplayScope(seeded, "crosshair");
  // Nothing here is disabled: these are drafts of one managed cfg, and the
  // write lock defers the save rather than taking the controls away.
  const text = serializeGameplay(clampGameplay(draft));
  useAutosave({ dirty: dirty && enabled, locked: running, token, save: () => onSave(text) });

  function patch(update: Partial<GameplaySettings>) {
    setDraft((current) => clampGameplay({ ...current, ...update }));
  }

  return { draft, patch, setDraft, dirty, reset: () => setDraft(seeded) };
}

export function CrosshairControls({
  draft,
  patch,
  sprites = null,
  custom = false,
  preview,
  scene,
}: {
  draft: GameplaySettings;
  patch: (update: Partial<GameplaySettings>) => void;
  sprites?: Record<string, StockCrosshairSprite> | null;
  custom?: boolean;
  preview?: ReactNode;
  scene?: ReactNode;
}) {
  // TF2 tints the drawn crosshair by cl_crosshair_red/green/blue at full
  // opacity. There is no alpha cvar — cl_crosshair_alpha is CS:GO's, and TF2
  // logs it as an unknown command.
  const color = `rgb(${draft.cl_crosshair_red}, ${draft.cl_crosshair_green}, ${draft.cl_crosshair_blue})`;
  const primitives = stockCrosshairPrimitives(draft.cl_crosshair_file);
  const sprite =
    draft.cl_crosshair_file === "" ? null : (sprites?.[draft.cl_crosshair_file] ?? null);
  const renderedSize = stockCrosshairRenderedSize(draft.cl_crosshair_scale);

  return (
    <section data-testid="stock-crosshair-settings" className="min-w-0">
      {/* Lead with the decision: file, scale and colour on the left, the live
          preview pinned at 360px on the right. */}
      <div className="hero-row crosshair-hero">
        <div className="min-w-0">
          <h2 className="t-section">{custom ? "Custom crosshair" : "In-game crosshair"}</h2>

          <div className="mt-5 flex min-w-0 flex-col gap-6">
            {!custom ? (
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
                        title={file === "" ? "Weapon default" : STOCK_CROSSHAIR_LABELS[file]}
                        className={`thumb cursor-pointer focus-within:ring-2 focus-within:ring-brand ${
                          selected ? "thumb-selected" : ""
                        }`}
                      >
                        <input
                          aria-label={STOCK_CROSSHAIR_LABELS[file]}
                          type="radio"
                          name="stock-crosshair-file"
                          data-testid={`stock-crosshair-file-${file || "default"}`}
                          value={file}
                          checked={selected}
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
                          {file === "" ? "Weapon default" : file.replace("crosshair", "")}
                        </span>
                      </label>
                    );
                  })}
                </div>
                <p className="t-meta mt-2">{STOCK_CROSSHAIR_LABELS[draft.cl_crosshair_file]}</p>
              </fieldset>
            ) : null}

            <StockSliderRow
              id="stock-crosshair-scale"
              label="Size"
              value={draft.cl_crosshair_scale}
              min={CROSSHAIR_SCALE_MIN}
              max={CROSSHAIR_SCALE_MAX}
              onChange={(cl_crosshair_scale) => patch({ cl_crosshair_scale })}
            />

            <ColorPicker
              color={[draft.cl_crosshair_red, draft.cl_crosshair_green, draft.cl_crosshair_blue]}
              onChange={([cl_crosshair_red, cl_crosshair_green, cl_crosshair_blue]) =>
                patch({ cl_crosshair_red, cl_crosshair_green, cl_crosshair_blue })
              }
            />
          </div>
        </div>

        <div className="hero-preview self-start">
          {preview ?? (
            <div
              data-testid="stock-crosshair-preview"
              role="img"
              aria-label={`Preview of ${STOCK_CROSSHAIR_LABELS[draft.cl_crosshair_file]} at scale ${draft.cl_crosshair_scale}`}
              className="surface relative grid aspect-video w-full place-items-center overflow-hidden bg-bg"
              style={{ containerType: "inline-size" }}
            >
              {scene}
              {sprite ? (
                <StockSpriteCanvas
                  file={draft.cl_crosshair_file}
                  sprite={sprite}
                  red={draft.cl_crosshair_red}
                  green={draft.cl_crosshair_green}
                  blue={draft.cl_crosshair_blue}
                  size={renderedSize}
                  reference
                  testId="stock-crosshair-sprite"
                />
              ) : primitives ? (
                <StockShapeSvg
                  file={draft.cl_crosshair_file}
                  primitives={primitives}
                  color={color}
                  size={renderedSize}
                  reference
                  testId="stock-crosshair-shape"
                />
              ) : (
                <p className="t-meta relative max-w-48 rounded-md bg-bg/80 px-3 py-2 text-center">
                  Each weapon draws its own crosshair.
                </p>
              )}
              <span className="eyebrow absolute bottom-2.5 left-2.5 rounded-md bg-bg/80 px-2 py-0.5">
                1280 × 720 reference
              </span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-3 text-[12px] text-ink-faint">
            <span>
              {custom
                ? "Custom · size applies to every weapon"
                : STOCK_CROSSHAIR_LABELS[draft.cl_crosshair_file]}
            </span>
            <span className="tnum">
              {draft.cl_crosshair_red}, {draft.cl_crosshair_green}, {draft.cl_crosshair_blue}
            </span>
          </div>
        </div>
      </div>
    </section>
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
  reference = false,
}: {
  file: string;
  sprite: StockCrosshairSprite;
  red: number;
  green: number;
  blue: number;
  size: number;
  testId?: string;
  reference?: boolean;
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
      className="relative"
      style={{
        width: reference ? `${(size / 1280) * 100}cqw` : size,
        height: reference ? `${(size / 1280) * 100}cqw` : size,
        imageRendering: "pixelated",
      }}
    />
  );
}

function StockShapeSvg({
  file,
  primitives,
  color,
  size,
  testId,
  reference = false,
}: {
  file: CrosshairFile;
  primitives: StockShapePrimitive[];
  color: string;
  size: number;
  testId?: string;
  reference?: boolean;
}) {
  return (
    <svg
      data-testid={testId}
      data-file={file || "default"}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      style={
        reference
          ? { width: `${(size / 1280) * 100}cqw`, height: `${(size / 1280) * 100}cqw` }
          : undefined
      }
      aria-hidden="true"
      className="relative"
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
  accentClass = "",
  note,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
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
        onChange={(event) => onChange(Number(event.target.value))}
        className={`range mt-3 w-full ${accentClass}`}
      />
      {note ? <p className="mt-1 text-[12px] leading-5 text-ink-faint">{note}</p> : null}
    </div>
  );
}
