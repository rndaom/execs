import { useMemo, useRef } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { fieldLayout } from "../../../apps/desktop/src/lib/dot-field";
import { useSettledLayout } from "./settled";
import { theme } from "./theme";
import { easeInOut, easeOut } from "./timing";

const SPACING = 15;
/** The app's dots are sized for 13px spacing; scale them to the video grid. */
const SIZE = 1.2;

type Point = { x: number; y: number };

export type FieldMotion = {
  /**
   * Dots leave this point and fly home over [start, end]. With `fromId` the
   * point is the centre of that element, measured from the laid-out page.
   */
  burst: Point & { start: number; end: number; fromId?: string };
  /** Ripples through the field, like the app's pointer stir. */
  waves: (Point & { start: number })[];
  /** Dots gather into this point over [start, end]. */
  gather: Point & { start: number; end: number };
  /** Overall strength, 0–1, per frame. */
  level: (frame: number) => number;
};

function hexRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
const BRAND = hexRgb(theme.brand);
const INK = hexRgb(theme.ink);

/**
 * The app's backdrop, redrawn for video: the TF2 emblem as a halftone of
 * orange dots in the bottom-right corner over a faint neutral grid, using the
 * app's own `fieldLayout`. Here it can also burst out of the caption dot,
 * ripple once and gather back into the wordmark dot.
 */
export function DotField({
  motion,
  width: WIDTH = 1920,
  height: HEIGHT = 1080,
}: {
  motion: FieldMotion;
  width?: number;
  height?: number;
}) {
  const frame = useCurrentFrame();
  const canvas = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(() => fieldLayout(WIDTH, HEIGHT, SPACING), [WIDTH, HEIGHT]);

  useSettledLayout(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    context.clearRect(0, 0, WIDTH, HEIGHT);
    const level = motion.level(frame);
    if (level <= 0 || frame < motion.burst.start) return;
    const { waves, gather } = motion;
    const burst = { ...motion.burst };
    const source = burst.fromId ? document.getElementById(burst.fromId) : null;
    if (source) {
      // The Studio preview scales the canvas; measure in composition pixels.
      const frameBox = element.getBoundingClientRect();
      const box = source.getBoundingClientRect();
      const ratio = frameBox.width / WIDTH;
      burst.x = (box.x + box.width / 2 - frameBox.x) / ratio;
      burst.y = (box.y + box.height / 2 - frameBox.y) / ratio;
    }
    let farthest = 1;
    for (const dot of layout.dots) {
      farthest = Math.max(farthest, Math.hypot(dot.x - burst.x, dot.y - burst.y));
    }
    const burstLength = burst.end - burst.start;
    const ripples = waves
      .filter((wave) => frame >= wave.start && frame < wave.start + 26)
      .map((wave) => ({
        ...wave,
        radius: (frame - wave.start) * 70,
        fade: interpolate(frame - wave.start, [0, 26], [1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }));
    for (const dot of layout.dots) {
      if (dot.alpha <= 0) continue;
      const emblem = dot.ink > 0;
      let x = dot.x;
      let y = dot.y;
      let radius = dot.radius * SIZE;
      let alpha = dot.alpha * (emblem ? 1.7 : 2.2);
      let heat = 0;

      // Out of the dot: nearer dots leave first, everything lands by `end`.
      const reach = Math.hypot(dot.x - burst.x, dot.y - burst.y) / farthest;
      const flight = interpolate(
        (frame - burst.start) / burstLength,
        [reach * 0.55, reach * 0.55 + 0.45],
        [0, 1],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      );
      if (flight < 1) {
        const eased = easeOut(flight);
        x = burst.x + (dot.x - burst.x) * eased;
        y = burst.y + (dot.y - burst.y) * eased;
        radius *= Math.min(1, flight * 2.2) * (1 + (1 - eased) * 0.6);
        heat = 1 - eased;
        alpha = interpolate(eased, [0, 1], [0.9, alpha]);
        if (flight <= 0) continue;
      }

      // A ripple: a ring that pushes dots outward as it passes.
      for (const ripple of ripples) {
        const dx = dot.x - ripple.x;
        const dy = dot.y - ripple.y;
        const distance = Math.hypot(dx, dy) || 1;
        const push = Math.exp(-(((distance - ripple.radius) / 70) ** 2)) * 9 * ripple.fade;
        x += (dx / distance) * push;
        y += (dy / distance) * push;
        alpha *= 1 + push * 0.06;
      }

      // Into the wordmark: outer dots start first, all arrive together.
      if (frame >= gather.start) {
        const pull = interpolate(frame, [gather.start, gather.end], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: easeInOut,
        });
        x += (gather.x - x) * pull;
        y += (gather.y - y) * pull;
        heat = Math.max(heat, pull);
        // Only the emblem gathers; the neutral grid falls away so its
        // rectangular edge never shows.
        alpha = emblem
          ? interpolate(pull, [0, 0.6, 1], [alpha, 0.85, 0])
          : alpha * Math.max(0, 1 - pull * 4);
        radius *= 1 - pull * 0.4;
      }

      const [r, g, b] = emblem ? BRAND : INK.map((c, i) => c + (BRAND[i] - c) * heat);
      context.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${Math.min(1, alpha * level)})`;
      context.beginPath();
      context.arc(x, y, Math.max(0.3, radius), 0, Math.PI * 2);
      context.fill();
    }
  }, frame);

  return (
    <canvas
      ref={canvas}
      width={WIDTH}
      height={HEIGHT}
      style={{ position: "absolute", inset: 0, width: WIDTH, height: HEIGHT }}
    />
  );
}
