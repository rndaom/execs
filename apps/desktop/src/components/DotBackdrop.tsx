import { useEffect, useRef } from "react";
import {
  type FieldLayout,
  fieldLayout,
  LENS_RADIUS,
  type Lens,
  lensInfluence,
  stepLens,
} from "../lib/dot-field";

const INK_RADIUS = 2.5;
const FIELD_RADIUS = 1.05;
const INK_ALPHA = 0.3;
const FIELD_ALPHA = 0.07;

function reducedMotion() {
  return (
    document.documentElement.dataset.motion === "reduce" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

function token(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * The backdrop behind every page: the TF2 emblem as a quiet halftone of dots in the
 * bottom-right corner. Near the pointer a soft lens swells the dots and warms
 * them toward the accent, trailing the cursor with an ease. The static field is
 * drawn once per size; frames run only while the lens moves or fades, and
 * reduced motion keeps the still image.
 */
export function DotBackdrop() {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const frameElement = host.current;
    const element = canvas.current;
    if (!frameElement || !element) return;
    // The context is requested once the surface has a real size.
    let context: CanvasRenderingContext2D | null = null;
    const accent = token("--color-brand", "#d98449");
    const faint = token("--color-ink-faint", "#ada59e");
    const still = reducedMotion();

    let layout: FieldLayout = { dots: [], cx: 0, cy: 0, radius: 0 };
    let width = 0;
    let height = 0;
    let ratio = 1;
    const layer = document.createElement("canvas");
    const lens: Lens = { x: 0, y: 0, strength: 0 };
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    let last = 0;

    function dot(target: CanvasRenderingContext2D, x: number, y: number, radius: number) {
      target.beginPath();
      target.arc(x, y, radius, 0, Math.PI * 2);
      target.fill();
    }

    function paintStatic() {
      const target = layer.getContext("2d");
      if (!target) return;
      layer.width = Math.round(width * ratio);
      layer.height = Math.round(height * ratio);
      target.setTransform(ratio, 0, 0, ratio, 0, 0);
      target.clearRect(0, 0, width, height);
      for (const point of layout.dots) {
        if (point.ink > 0) {
          target.globalAlpha = INK_ALPHA * point.weight * (0.55 + 0.45 * point.ink);
          target.fillStyle = accent;
          dot(target, point.x, point.y, INK_RADIUS * (0.4 + 0.6 * point.ink));
        } else if (point.field > 0.02) {
          target.globalAlpha = FIELD_ALPHA * point.field * point.weight;
          target.fillStyle = faint;
          dot(target, point.x, point.y, FIELD_RADIUS);
        }
      }
      target.globalAlpha = 1;
    }

    function draw() {
      if (!context) return;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, element?.width ?? 0, element?.height ?? 0);
      context.drawImage(layer, 0, 0);
      if (lens.strength < 0.004) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      for (const point of layout.dots) {
        if (Math.abs(point.x - lens.x) > LENS_RADIUS || Math.abs(point.y - lens.y) > LENS_RADIUS) {
          continue;
        }
        const influence = lensInfluence(lens, point.x, point.y);
        if (influence < 0.01) continue;
        // Draw over the resting dot: larger and warmer, never moved.
        if (point.ink > 0) {
          context.globalAlpha = Math.min(1, INK_ALPHA * point.weight + 0.42 * influence);
          context.fillStyle = accent;
          dot(
            context,
            point.x,
            point.y,
            INK_RADIUS * (0.4 + 0.6 * point.ink) * (1 + 0.5 * influence),
          );
        } else if (point.field > 0.02) {
          context.globalAlpha = Math.min(1, 0.2 * influence * (0.4 + point.field));
          context.fillStyle = accent;
          dot(context, point.x, point.y, FIELD_RADIUS * (1 + 0.7 * influence));
        }
      }
      context.globalAlpha = 1;
    }

    function resize() {
      if (!frameElement || !element) return;
      const bounds = frameElement.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;
      context ??= element.getContext("2d");
      if (!context) return;
      width = bounds.width;
      height = bounds.height;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      layout = fieldLayout(width, height);
      paintStatic();
      draw();
    }

    function tick(now: number) {
      frame = 0;
      // About 120 draws a second is plenty, even on high-refresh displays.
      if (now - last < 7.5) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(48, now - last);
      last = now;
      const settled = stepLens(lens, pointer, dt);
      draw();
      if (!settled) frame = requestAnimationFrame(tick);
    }

    function wake() {
      if (still || frame !== 0) return;
      last = performance.now() - 16;
      frame = requestAnimationFrame(tick);
    }

    function onPointerMove(event: PointerEvent) {
      if (!element || !context) return;
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      // The lens only wakes where the emblem is; the thin field elsewhere
      // would show nothing for the work.
      const near =
        x >= 0 &&
        y >= 0 &&
        x <= bounds.width &&
        y <= bounds.height &&
        Math.hypot(x - layout.cx, y - layout.cy) < layout.radius * 1.35;
      const next = near ? { x, y } : null;
      if (next === null && pointer === null) return;
      pointer = next;
      wake();
    }

    function onLeave() {
      if (pointer === null) return;
      pointer = null;
      wake();
    }

    // A surface without layout (a test DOM, a hidden window) gets nothing:
    // no observers, no listeners, no drawing.
    const bounds = frameElement.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(frameElement);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  return (
    <div ref={host} aria-hidden="true" className="dot-backdrop">
      <canvas ref={canvas} />
    </div>
  );
}
