/**
 * How big a crosshair really is on the player's screen.
 *
 * TF2 draws the crosshair in screen pixels with no resolution scaling
 * (Source SDK 2013, `CHudCrosshair::Paint` and `CHudTFCrosshair::Paint`):
 *  - a weapon-script sprite (every custom crosshair) is its script
 *    width × height × `cl_crosshair_scale` / 32, rounded;
 *  - a `cl_crosshair_file` sprite (TF2's crosshair1–7) is a square of
 *    2 × round(`cl_crosshair_scale`) pixels, whatever the texture size.
 * So size 32 is a 64 px crosshair at 1280 × 720 and at 3840 × 2160 alike: the
 * higher the resolution, the smaller it looks.
 */

import { tf2LaunchArguments } from "./launch-ui";

export type DrawnSize = { width: number; height: number };

/** A weapon-script sprite: execs shapes, designs, imports and VTFs. */
export function scriptCrosshairSize(
  spriteWidth: number,
  spriteHeight: number,
  scale: number,
): DrawnSize {
  return {
    width: Math.max(0, Math.floor((spriteWidth * scale) / 32 + 0.5)),
    height: Math.max(0, Math.floor((spriteHeight * scale) / 32 + 0.5)),
  };
}

/** A `cl_crosshair_file` sprite (TF2's own crosshair1–7 when no pack runs). */
export function fileCrosshairSize(scale: number): DrawnSize {
  const half = Math.floor(scale + 0.5);
  return { width: half * 2, height: half * 2 };
}

export type GameDisplay = {
  width: number;
  height: number;
  /** Windowed and borderless-window modes are never stretched. */
  windowed: boolean;
};

export type MonitorSize = { width: number; height: number };

/**
 * Physical monitor pixels per game pixel on each axis. Fullscreen below the
 * monitor's resolution is stretched to fill it (the usual GPU scaling);
 * windowed modes draw one to one. A game resolution that does not fit inside
 * this screen is probably shown on another one, so nothing is assumed.
 */
export function stretchFactor(game: GameDisplay, monitor: MonitorSize | null): DrawnSize {
  if (
    game.windowed ||
    !monitor ||
    monitor.width <= 0 ||
    monitor.height <= 0 ||
    game.width > monitor.width ||
    game.height > monitor.height
  ) {
    return { width: 1, height: 1 };
  }
  return { width: monitor.width / game.width, height: monitor.height / game.height };
}

/**
 * CSS pixels that cover exactly the physical pixels the crosshair covers in
 * game. `devicePixelRatio` already includes Windows scaling and page zoom, so
 * the result stays true when the app is zoomed.
 */
export function actualCssSize(
  drawn: DrawnSize,
  game: GameDisplay,
  monitor: MonitorSize | null,
  devicePixelRatio: number,
): DrawnSize {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const stretch = stretchFactor(game, monitor);
  return {
    width: (drawn.width * stretch.width) / ratio,
    height: (drawn.height * stretch.height) / ratio,
  };
}

/** The crosshair's share of the screen, for a whole-screen preview. */
export function screenShare(drawn: DrawnSize, game: GameDisplay): DrawnSize {
  return { width: drawn.width / game.width, height: drawn.height / game.height };
}

/** Common TF2 resolutions offered when the saved one is wrong or missing. */
export const COMMON_RESOLUTIONS: readonly (readonly [number, number])[] = [
  [1280, 720],
  [1280, 960],
  [1366, 768],
  [1600, 900],
  [1680, 1050],
  [1920, 1080],
  [1920, 1200],
  [2560, 1080],
  [2560, 1440],
  [3440, 1440],
  [3840, 2160],
];

export const MIN_GAME_WIDTH = 640;
export const MAX_GAME_WIDTH = 7680;
export const MIN_GAME_HEIGHT = 480;
export const MAX_GAME_HEIGHT = 4320;

export function validGameSize(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= MIN_GAME_WIDTH &&
    width <= MAX_GAME_WIDTH &&
    height >= MIN_GAME_HEIGHT &&
    height <= MAX_GAME_HEIGHT
  );
}

/**
 * `-w` / `-h` / `-windowed` / `-sw` / `-fullscreen` / `-full` from a launch
 * option string. Source applies them at launch and saves them over the video
 * settings, so they win. Words before `%command%` belong to a wrapper such as
 * gamescope, whose own `-w`/`-W` sizes are not TF2's.
 */
export function launchOptionDisplay(options: string): Partial<GameDisplay> {
  const tokens = tf2LaunchArguments(options);
  const out: Partial<GameDisplay> = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index].toLowerCase();
    const next = Number(tokens[index + 1]);
    if ((token === "-w" || token === "-width") && Number.isInteger(next)) out.width = next;
    if ((token === "-h" || token === "-height") && Number.isInteger(next)) out.height = next;
    if (token === "-windowed" || token === "-sw" || token === "-window") out.windowed = true;
    if (token === "-fullscreen" || token === "-full") out.windowed = false;
  }
  return out;
}

export type DisplaySource = "custom" | "launch" | "tf2" | "screen";

export type ResolvedDisplay = GameDisplay & { source: DisplaySource };

/**
 * The display the preview assumes, most specific first: the player's own
 * choice, then launch options, then TF2's saved video setting, then the
 * monitor itself.
 */
export function resolveGameDisplay({
  custom,
  launchOptions,
  saved,
  monitor,
}: {
  custom: GameDisplay | null;
  launchOptions: string;
  saved: { width: number; height: number; windowed?: boolean; borderless?: boolean } | null;
  monitor: MonitorSize | null;
}): ResolvedDisplay {
  if (custom && validGameSize(custom.width, custom.height)) return { ...custom, source: "custom" };
  const launch = launchOptionDisplay(launchOptions);
  const savedWindowed = saved ? saved.windowed === true || saved.borderless === true : false;
  if (launch.width && launch.height && validGameSize(launch.width, launch.height)) {
    return {
      width: launch.width,
      height: launch.height,
      windowed: launch.windowed ?? savedWindowed,
      source: "launch",
    };
  }
  if (saved && validGameSize(saved.width, saved.height)) {
    return {
      width: saved.width,
      height: saved.height,
      windowed: launch.windowed ?? savedWindowed,
      source: "tf2",
    };
  }
  const width = Math.round(monitor?.width ?? 1920);
  const height = Math.round(monitor?.height ?? 1080);
  return validGameSize(width, height)
    ? { width, height, windowed: false, source: "screen" }
    : { width: 1920, height: 1080, windowed: false, source: "screen" };
}

export const DISPLAY_SOURCE_LABELS: Record<DisplaySource, string> = {
  custom: "Set here",
  launch: "From launch options",
  tf2: "From TF2's video settings",
  screen: "Your screen; TF2's setting was not found",
};

export type SpriteFilter = "nearest" | "linear";

/**
 * Resample a sprite to the game pixels TF2 actually covers. execs builds its
 * sprites point-sampled, so a size below 32 can drop whole rows of a thin
 * line; Valve's own sprites are filtered, so they blur instead. Texel centres
 * sit at +0.5 and edges clamp, as on the GPU.
 */
export function resampleSprite(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  target: DrawnSize,
  filter: SpriteFilter,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(Math.max(0, target.width * target.height * 4));
  if (width <= 0 || height <= 0 || target.width <= 0 || target.height <= 0) return out;
  const texel = (x: number, y: number, channel: number) => {
    const cx = Math.min(width - 1, Math.max(0, x));
    const cy = Math.min(height - 1, Math.max(0, y));
    return rgba[(cy * width + cx) * 4 + channel];
  };
  for (let y = 0; y < target.height; y += 1) {
    const v = ((y + 0.5) / target.height) * height;
    for (let x = 0; x < target.width; x += 1) {
      const u = ((x + 0.5) / target.width) * width;
      const index = (y * target.width + x) * 4;
      if (filter === "nearest") {
        const sx = Math.min(width - 1, Math.floor(u));
        const sy = Math.min(height - 1, Math.floor(v));
        for (let channel = 0; channel < 4; channel += 1) {
          out[index + channel] = rgba[(sy * width + sx) * 4 + channel];
        }
        continue;
      }
      const x0 = Math.floor(u - 0.5);
      const y0 = Math.floor(v - 0.5);
      const fx = u - 0.5 - x0;
      const fy = v - 0.5 - y0;
      for (let channel = 0; channel < 4; channel += 1) {
        const top = texel(x0, y0, channel) * (1 - fx) + texel(x0 + 1, y0, channel) * fx;
        const bottom = texel(x0, y0 + 1, channel) * (1 - fx) + texel(x0 + 1, y0 + 1, channel) * fx;
        out[index + channel] = Math.round(top * (1 - fy) + bottom * fy);
      }
    }
  }
  return out;
}

/**
 * The part of the drawn bitmap a player actually sees: the bounds of every
 * non-transparent game pixel. Sprites carry empty margins (TF2's own fill
 * about half of their 64 px), so this, not the sprite size, is the size to
 * judge. Null when nothing is visible.
 */
export function visibleBounds(
  rgba: ArrayLike<number>,
  size: DrawnSize,
): { x: number; y: number; width: number; height: number } | null {
  let left = size.width;
  let right = -1;
  let top = size.height;
  let bottom = -1;
  for (let y = 0; y < size.height; y += 1) {
    for (let x = 0; x < size.width; x += 1) {
      if (rgba[(y * size.width + x) * 4 + 3] === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}
