import { useEffect, useRef } from "react";
import { readKnockouts, watchKnockouts } from "../lib/backdrop-knockout";
import {
  cellsIn,
  createPointer,
  createStir,
  DOT_RADIUS_MAX,
  FIELD_SPACING,
  type FieldLayout,
  fieldLayout,
  forEachDotIn,
  leavePointer,
  movePointer,
  STIR_LIMIT,
  STIR_PUSH,
  stepStir,
} from "../lib/dot-field";

/**
 * A stirred dot brightens a little, a hint of movement rather than a glow:
 * emblem dots by a share of their own opacity, grid dots by a small amount that
 * fades out with the grid.
 */
const INK_LIFT = 0.3;
const FIELD_LIFT = 0.045;
/** Text is followed every frame for this long after a transition starts, in ms. */
const MOTION_WINDOW = 360;

const EMPTY_FIELD: FieldLayout = {
  dots: [],
  cx: 0,
  cy: 0,
  radius: 0,
  spacing: FIELD_SPACING,
  originX: 0,
  originY: 0,
  columns: 0,
  rows: 0,
  cells: new Int32Array(0),
};

type Box = { x0: number; y0: number; x1: number; y1: number };

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
 * The backdrop behind every page: the TF2 emblem as a quiet halftone of dots in
 * the bottom-right corner. The pointer stirs it: nearby dots slide aside and
 * along the pointer's motion, then spring back, brightening only a little. The
 * field clears away around the page's text and controls, so nothing is read
 * over dots. The field is painted once per size and only the stirred patch is
 * redrawn while dots move; the clearing is a small separate layer that follows
 * the text. Reduced motion keeps the still image.
 */
export function DotBackdrop() {
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const clearing = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const frameElement = host.current;
    const element = canvas.current;
    const mask = clearing.current;
    if (!frameElement || !element || !mask) return;
    const scope = frameElement.parentElement;
    // The contexts are requested once the surface has a real size.
    let context: CanvasRenderingContext2D | null = null;
    let maskContext: CanvasRenderingContext2D | null = null;
    const accent = token("--color-brand", "#d98449");
    const faint = token("--color-ink-faint", "#ada59e");
    const page = token("--color-bg", "#100f0e");
    const still = reducedMotion();

    let layout = EMPTY_FIELD;
    let stir = createStir(0);
    const pointer = createPointer();
    let width = 0;
    let height = 0;
    let ratio = 1;
    /** The stirred patch drawn last frame, which the next frame repaints too. */
    let drawn: Box | null = null;
    let textMoved = false;
    let followUntil = 0;
    let frame = 0;
    let last = 0;

    function drawDot(target: CanvasRenderingContext2D, index: number) {
      const point = layout.dots[index];
      if (point.alpha === 0) return;
      const dx = stir.ox[index];
      const dy = stir.oy[index];
      let alpha = point.alpha;
      if (dx !== 0 || dy !== 0) {
        const moved = Math.min(1, Math.hypot(dx, dy) / STIR_PUSH);
        alpha =
          point.ink > 0
            ? alpha * (1 + INK_LIFT * moved)
            : alpha + FIELD_LIFT * moved * Math.sqrt(point.field);
      }
      target.globalAlpha = alpha;
      target.fillStyle = point.ink > 0 ? accent : faint;
      target.beginPath();
      target.arc(point.x + dx, point.y + dy, point.radius, 0, Math.PI * 2);
      target.fill();
    }

    function paintField() {
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      for (let index = 0; index < layout.dots.length; index += 1) drawDot(context, index);
      context.globalAlpha = 1;
      drawn = null;
    }

    /** The box around the stirred dots, snapped outward to device pixels. */
    function stirredBox(): Box | null {
      if (stir.active.length === 0) return null;
      const margin = STIR_LIMIT + DOT_RADIUS_MAX + 1;
      return {
        x0: Math.floor((stir.minX - margin) * ratio) / ratio,
        y0: Math.floor((stir.minY - margin) * ratio) / ratio,
        x1: Math.ceil((stir.maxX + margin) * ratio) / ratio,
        y1: Math.ceil((stir.maxY + margin) * ratio) / ratio,
      };
    }

    /**
     * Repaint only the stirred patch and last frame's, dot by dot: every dot
     * whose drawing can reach into it, clipped to it.
     */
    function paintStir() {
      if (!context) return;
      const box = stirredBox();
      const area =
        box && drawn
          ? {
              x0: Math.min(box.x0, drawn.x0),
              y0: Math.min(box.y0, drawn.y0),
              x1: Math.max(box.x1, drawn.x1),
              y1: Math.max(box.y1, drawn.y1),
            }
          : (box ?? drawn);
      drawn = box;
      if (!area) return;
      const target = context;
      target.save();
      target.setTransform(ratio, 0, 0, ratio, 0, 0);
      target.beginPath();
      target.rect(area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
      target.clip();
      target.clearRect(area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
      const reach = DOT_RADIUS_MAX + 1;
      forEachDotIn(
        layout,
        area.x0 - reach,
        area.y0 - reach,
        area.x1 + reach,
        area.y1 + reach,
        (index) => drawDot(target, index),
      );
      target.restore();
    }

    /**
     * Switch off every dot that would touch the page's text or controls. The
     * clearing layer has one pixel per dot, in the page colour, scaled up
     * without smoothing: a dot is either shown or cleared, never half-covered
     * by a soft edge that could shade the page.
     */
    function paintMask() {
      if (!scope || !frameElement || !mask || !maskContext) return;
      const knockouts = readKnockouts(scope, frameElement, frameElement.getBoundingClientRect());
      maskContext.clearRect(0, 0, mask.width, mask.height);
      maskContext.fillStyle = page;
      const reach = DOT_RADIUS_MAX;
      for (let index = 0; index < knockouts.length; index += 4) {
        const { c0, r0, c1, r1 } = cellsIn(
          layout,
          knockouts[index] - reach,
          knockouts[index + 1] - reach,
          knockouts[index + 2] + reach,
          knockouts[index + 3] + reach,
        );
        if (c1 >= c0 && r1 >= r0) maskContext.fillRect(c0, r0, c1 - c0 + 1, r1 - r0 + 1);
      }
    }

    function resize() {
      if (!frameElement || !element || !mask) return;
      const bounds = frameElement.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return;
      context ??= element.getContext("2d");
      maskContext ??= mask.getContext("2d");
      if (!context || !maskContext) return;
      width = bounds.width;
      height = bounds.height;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      layout = fieldLayout(width, height);
      stir = createStir(layout.dots.length);
      // Each clearing pixel covers one grid cell, centred on its dot.
      const { spacing, originX, originY, columns, rows } = layout;
      mask.width = columns;
      mask.height = rows;
      mask.style.left = `${originX - spacing / 2}px`;
      mask.style.top = `${originY - spacing / 2}px`;
      mask.style.width = `${columns * spacing}px`;
      mask.style.height = `${rows * spacing}px`;
      paintField();
      paintMask();
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
      const following = now < followUntil;
      if (textMoved || following) {
        textMoved = false;
        paintMask();
      }
      const stirring = !still && stepStir(layout, stir, pointer, now, dt);
      if (stirring || drawn) paintStir();
      if (stirring || following || textMoved) frame = requestAnimationFrame(tick);
    }

    function wake() {
      if (frame !== 0) return;
      last = performance.now() - 16;
      frame = requestAnimationFrame(tick);
    }

    function onPointerMove(event: PointerEvent) {
      if (!element || !context || still) return;
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      if (x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
        onLeave();
        return;
      }
      // The frame clock, not the event's: both must share one timeline.
      if (movePointer(pointer, x, y, performance.now())) wake();
    }

    function onLeave() {
      if (!pointer.over) return;
      leavePointer(pointer);
      wake();
    }

    // A surface without layout (a test DOM, a hidden window) gets nothing:
    // no observers, no listeners, no drawing.
    const bounds = frameElement.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    resize();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(frameElement);
    const stopWatching = scope
      ? watchKnockouts(scope, frameElement, (moving) => {
          textMoved = true;
          if (moving) followUntil = Math.max(followUntil, performance.now() + MOTION_WINDOW);
          wake();
        })
      : null;
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      stopWatching?.();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, []);

  return (
    <div ref={host} aria-hidden="true" className="dot-backdrop">
      <canvas ref={canvas} className="dot-backdrop-field" />
      <canvas ref={clearing} className="dot-backdrop-clearing" />
    </div>
  );
}
