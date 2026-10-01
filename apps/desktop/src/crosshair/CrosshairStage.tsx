import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Segmented } from "../components/ui/Segmented";
import {
  actualCssSize,
  COMMON_RESOLUTIONS,
  DISPLAY_SOURCE_LABELS,
  type DrawnSize,
  type GameDisplay,
  MAX_GAME_HEIGHT,
  MAX_GAME_WIDTH,
  MIN_GAME_HEIGHT,
  MIN_GAME_WIDTH,
  type MonitorSize,
  type ResolvedDisplay,
  resampleSprite,
  type SpriteFilter,
  validGameSize,
  visibleBounds,
} from "../lib/crosshair-size";
import { type CrosshairColor, tintCrosshairRgba } from "../lib/crosshair-ui";
import type { PreviewPixels } from "./useCrosshairDraft";

export type StageView = "actual" | "screen" | "zoom";
export type StageScene = "dark" | "light" | "mixed";

const VIEW_KEY = "execs.crosshair.view";
const SCENE_KEY = "execs.crosshair.scene";

function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value as T) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeChoice(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A remembered view is a convenience only.
  }
}

function screenMetrics(): { ratio: number; monitor: MonitorSize | null } {
  if (typeof window === "undefined") return { ratio: 1, monitor: null };
  const ratio = window.devicePixelRatio || 1;
  const width = window.screen?.width ?? 0;
  const height = window.screen?.height ?? 0;
  return {
    ratio,
    monitor:
      width > 0 && height > 0
        ? { width: Math.round(width * ratio), height: Math.round(height * ratio) }
        : null,
  };
}

/**
 * The crosshair as it will really look.
 *
 * - Actual size: the exact physical pixels it covers on this screen, given
 *   the game resolution and fullscreen stretching.
 * - Whole screen: the game's frame at its own aspect ratio, so its share of
 *   the screen is right.
 * - Zoom: game pixels enlarged, to check edges and the in-game resampling.
 *
 * Every view draws the game-pixel bitmap TF2 itself would draw: the sprite
 * resampled to its in-game size with the filter its texture uses.
 */
export function CrosshairStage({
  pixels,
  filter,
  drawn,
  color,
  display,
  label,
  caption,
  emptyText,
  onChangeDisplay,
}: {
  pixels: PreviewPixels | null;
  filter: SpriteFilter;
  /** Game pixels the crosshair covers; null when there is no single sprite. */
  drawn: DrawnSize | null;
  color: CrosshairColor;
  display: ResolvedDisplay;
  label: string;
  caption?: string;
  emptyText?: string;
  onChangeDisplay: (custom: GameDisplay | null) => void;
}) {
  const [view, setView] = useState<StageView>(() =>
    readChoice(VIEW_KEY, ["actual", "screen", "zoom"] as const, "actual"),
  );
  const [scene, setScene] = useState<StageScene>(() =>
    readChoice(SCENE_KEY, ["dark", "light", "mixed"] as const, "dark"),
  );
  const [metrics, setMetrics] = useState(screenMetrics);
  const frame = useRef<HTMLDivElement | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const update = () => setMetrics(screenMetrics());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const measure = () => setFrameSize({ width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const gamePixels = useMemo(() => {
    if (!pixels || !drawn || drawn.width <= 0 || drawn.height <= 0) return null;
    const resampled = resampleSprite(pixels.rgba, pixels.width, pixels.height, drawn, filter);
    return tintCrosshairRgba(resampled, color);
  }, [pixels, drawn, filter, color]);

  const game: GameDisplay = display;
  const actual = drawn ? actualCssSize(drawn, game, metrics.monitor, metrics.ratio) : null;
  const visible = useMemo(
    () => (gamePixels && drawn ? visibleBounds(gamePixels, drawn) : null),
    [gamePixels, drawn],
  );
  // Zoom fills most of the frame with what is actually drawn; the sprite's
  // empty margin may run past the edges.
  const longest = visible ? Math.max(visible.width, visible.height, 1) : 1;
  const zoom = Math.max(2, Math.min(16, Math.floor((frameSize.height * 0.72) / longest) || 2));
  const screenScale = frameSize.width > 0 ? frameSize.width / display.width : 0;
  const cssSize =
    !drawn || !actual
      ? null
      : view === "actual"
        ? actual
        : view === "zoom"
          ? { width: drawn.width * zoom, height: drawn.height * zoom }
          : { width: drawn.width * screenScale, height: drawn.height * screenScale };
  // Enlarged game pixels stay square; shrunken ones blend, as a scaler would.
  const crisp = cssSize && drawn ? cssSize.width * metrics.ratio >= drawn.width - 0.01 : true;
  const description = drawn
    ? `${label}, ${drawn.width} by ${drawn.height} pixels at ${display.width} by ${display.height}`
    : label;

  return (
    <section aria-label="Crosshair preview" className="crosshair-stage">
      <div
        ref={frame}
        data-testid="crosshair-stage"
        data-view={view}
        role="img"
        aria-label={description}
        className={`crosshair-stage-frame crosshair-scene-${scene}`}
        style={
          view === "screen" ? { aspectRatio: `${display.width} / ${display.height}` } : undefined
        }
      >
        {view === "screen" ? (
          // Faint outlines where TF2's HUD usually sits, for a sense of scale.
          <span className="crosshair-stage-hud" aria-hidden="true">
            <span className="hud-health" />
            <span className="hud-ammo" />
            <span className="hud-timer" />
            <span className="hud-feed" />
            <span className="hud-feed hud-feed-2" />
          </span>
        ) : null}
        {gamePixels && drawn && cssSize ? (
          <span className="crosshair-stage-sprite">
            <GameCanvas
              pixels={gamePixels}
              size={drawn}
              css={cssSize}
              crisp={crisp}
              testId="crosshair-preview"
            />
            {view === "zoom" && zoom >= 4 ? (
              <span
                aria-hidden="true"
                className="crosshair-stage-grid"
                style={{ backgroundSize: `${zoom}px ${zoom}px` }}
              />
            ) : null}
          </span>
        ) : (
          <p className="crosshair-stage-empty">{emptyText ?? "No preview for this crosshair"}</p>
        )}
        {view === "screen" && gamePixels && drawn && cssSize && actual ? (
          <>
            {/* On a miniature screen a real crosshair is a speck: ring where it
                is, and show it at its real size in a corner magnifier. */}
            <span
              className="crosshair-stage-locator"
              aria-hidden="true"
              style={{
                width: Math.max(cssSize.width, cssSize.height) + 14,
                height: Math.max(cssSize.width, cssSize.height) + 14,
              }}
            />
            <span
              className={`crosshair-stage-loupe crosshair-scene-${scene}`}
              data-testid="crosshair-stage-loupe"
              aria-hidden="true"
            >
              <span className="crosshair-stage-sprite">
                <GameCanvas
                  pixels={gamePixels}
                  size={drawn}
                  css={actual}
                  crisp={actual.width * metrics.ratio >= drawn.width - 0.01}
                />
              </span>
              <span className="crosshair-stage-loupe-tag">Actual size</span>
            </span>
          </>
        ) : null}
        <span className="crosshair-stage-tag" aria-hidden="true">
          {view === "actual"
            ? "Actual size on this screen"
            : view === "zoom"
              ? `${zoom}× game pixels`
              : `Whole ${display.width} × ${display.height} screen`}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Preview view"
          size="sm"
          testIdPrefix="crosshair-view"
          value={view}
          options={[
            { id: "actual", label: "Actual size" },
            { id: "screen", label: "Whole screen" },
            { id: "zoom", label: "Zoom" },
          ]}
          onChange={(next) => {
            setView(next);
            writeChoice(VIEW_KEY, next);
          }}
        />
        <fieldset className="crosshair-scenes">
          <legend className="sr-only">Preview background</legend>
          {(
            [
              ["dark", "Dark background"],
              ["light", "Bright background"],
              ["mixed", "Half dark, half bright"],
            ] as const
          ).map(([id, name]) => (
            <label key={id} title={name} className="crosshair-scene-choice">
              <input
                type="radio"
                name="crosshair-scene"
                className="peer sr-only"
                checked={scene === id}
                onChange={() => {
                  setScene(id);
                  writeChoice(SCENE_KEY, id);
                }}
              />
              <span className={`crosshair-scene-swatch crosshair-scene-${id}`} aria-hidden="true" />
              <span className="sr-only">{name}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <dl className="crosshair-specs">
        <div>
          <dt>Crosshair</dt>
          <dd className="truncate font-semibold text-ink" data-testid="crosshair-stage-label">
            {label}
          </dd>
        </div>
        <div>
          <dt>In game</dt>
          <dd className="tnum">
            <span className="text-ink" data-testid="crosshair-drawn-size">
              {!drawn
                ? (caption ?? "Depends on the weapon")
                : visible
                  ? `${visible.width} × ${visible.height} px${caption ? ` · ${caption}` : ""}`
                  : "Nothing visible"}
            </span>
            {drawn ? (
              <span
                className="block text-[12px] text-ink-faint"
                data-testid="crosshair-sprite-size"
              >
                in a {drawn.width} × {drawn.height} px sprite
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Screen</dt>
          <dd>
            <DisplayPicker display={display} onChange={onChangeDisplay} />
          </dd>
        </div>
      </dl>
    </section>
  );
}

function DisplayPicker({
  display,
  onChange,
}: {
  display: ResolvedDisplay;
  onChange: (custom: GameDisplay | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState(String(display.width));
  const [height, setHeight] = useState(String(display.height));
  const root = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setWidth(String(display.width));
    setHeight(String(display.height));
    const outside = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [open, display.width, display.height]);

  const typed = { width: Number(width), height: Number(height) };
  const typedValid = validGameSize(typed.width, typed.height);
  const choose = (next: GameDisplay) => onChange(next);

  return (
    <div ref={root} className="relative flex min-w-0 items-baseline gap-2">
      <span className="min-w-0">
        <span className="tnum block text-ink" data-testid="crosshair-display">
          {display.width} × {display.height} · {display.windowed ? "Windowed" : "Fullscreen"}
        </span>
        <span className="block text-[12px] text-ink-faint" data-testid="crosshair-display-source">
          {DISPLAY_SOURCE_LABELS[display.source]}
        </span>
      </span>
      <button
        ref={trigger}
        type="button"
        data-testid="crosshair-display-change"
        aria-expanded={open}
        aria-haspopup="dialog"
        className="crosshair-link ml-auto shrink-0"
        onClick={() => setOpen((current) => !current)}
      >
        Change
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Game resolution"
          className="overlay overlay-enter absolute top-full right-0 z-40 mt-2 w-72 p-3 text-left"
        >
          <p className="eyebrow">Game resolution</p>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {COMMON_RESOLUTIONS.map(([w, h]) => {
              const selected = w === display.width && h === display.height;
              return (
                <button
                  key={`${w}x${h}`}
                  type="button"
                  aria-pressed={selected}
                  className={`crosshair-resolution ${selected ? "crosshair-resolution-selected" : ""}`}
                  onClick={() => choose({ width: w, height: h, windowed: display.windowed })}
                >
                  {w}×{h}
                </button>
              );
            })}
          </div>
          <form
            className="mt-3 flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (typedValid) choose({ ...typed, windowed: display.windowed });
            }}
          >
            <input
              aria-label="Width"
              inputMode="numeric"
              className="input w-20 tnum"
              value={width}
              onChange={(event) => setWidth(event.target.value.replace(/\D/g, ""))}
            />
            <span className="text-ink-faint">×</span>
            <input
              aria-label="Height"
              inputMode="numeric"
              className="input w-20 tnum"
              value={height}
              onChange={(event) => setHeight(event.target.value.replace(/\D/g, ""))}
            />
            <button type="submit" className="btn btn-ghost" disabled={!typedValid}>
              Set
            </button>
          </form>
          {!typedValid && width && height ? (
            <p className="t-meta mt-1 text-[12px]">
              Use {MIN_GAME_WIDTH}–{MAX_GAME_WIDTH} × {MIN_GAME_HEIGHT}–{MAX_GAME_HEIGHT}.
            </p>
          ) : null}
          <div className="mt-3">
            <Segmented
              label="Display mode"
              size="sm"
              value={display.windowed ? "windowed" : "fullscreen"}
              options={[
                { id: "fullscreen", label: "Fullscreen" },
                { id: "windowed", label: "Windowed" },
              ]}
              onChange={(mode) =>
                choose({
                  width: display.width,
                  height: display.height,
                  windowed: mode === "windowed",
                })
              }
            />
          </div>
          <p className="t-meta mt-2 text-[12px]">
            Fullscreen below your screen's resolution is stretched to fill it, so the crosshair
            grows with it.
          </p>
          {display.source === "custom" ? (
            <button
              type="button"
              className="btn btn-quiet mt-1 -ml-2"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Use TF2's setting
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One drawing of the in-game bitmap, at whatever CSS size a view needs. */
function GameCanvas({
  pixels,
  size,
  css,
  crisp,
  testId,
}: {
  pixels: Uint8ClampedArray;
  size: DrawnSize;
  css: DrawnSize;
  crisp: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(size.width, size.height);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
  }, [pixels, size]);
  return (
    <canvas
      ref={ref}
      data-testid={testId}
      width={size.width}
      height={size.height}
      style={{
        width: `${css.width}px`,
        height: `${css.height}px`,
        imageRendering: crisp ? "pixelated" : "auto",
      }}
    />
  );
}
