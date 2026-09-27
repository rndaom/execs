import { Easing, interpolate } from "remotion";
import timeline from "./timeline.json";

/**
 * One clock for the picture and the soundtrack (music/compose.mjs reads the
 * same timeline.json). At 120 BPM and 30 fps a beat is exactly 15 frames.
 */
export const FPS = timeline.fps;
export const FRAMES_PER_BEAT = (60 / timeline.bpm) * FPS;

export type EventName = keyof typeof timeline.events;

/** Frame of a zero-based bar and beat. */
export function at(bar: number, beat = 0): number {
  return Math.round((bar * 4 + beat) * FRAMES_PER_BEAT);
}

/** Frame of a named timeline event. */
export function on(name: EventName): number {
  const [bar, beat] = timeline.events[name];
  return at(bar, beat);
}

/** Picture length: the last bar plus a second of silence for the tail. */
export const DURATION = on("end") + FPS;

export const TILE_FRAMES = timeline.tiles.map(([bar, beat]) => at(bar, beat));

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);

/** 0 → 1 from `start` over `length` frames. */
export function ramp(frame: number, start: number, length: number, easing = easeOut): number {
  return interpolate(frame, [start, start + length], [0, 1], { ...clamp, easing });
}

/** A quick scale pop: 0 → overshoot → 1 over `length` frames. */
export function popScale(frame: number, start: number, length = 10, overshoot = 1.28): number {
  if (frame < start) return 0;
  const t = (frame - start) / length;
  if (t >= 1) return 1;
  if (t < 0.55) return interpolate(t, [0, 0.55], [0, overshoot], { easing: easeOut });
  return interpolate(t, [0.55, 1], [overshoot, 1], { easing: easeInOut });
}
