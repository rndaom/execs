import { useEffect, useMemo, useRef } from "react";
import {
  DEFAULT_PULL,
  DOT_FIELD_DEFAULTS,
  type Dot,
  entrance,
  layoutDots,
  stepDots,
} from "../lib/dot-matrix";

const DOT_RADIUS = 1.75;
/** How far outside the canvas the pointer still pulls on the dots. */
const REACH = DEFAULT_PULL.radius;

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
 * The TF2 emblem drawn in execs' orange dot on a faint dot field. Dots near
 * the pointer ease aside and brighten, then settle; arriving on the pane
 * replays a short wave from the centre. Frames are drawn only while something
 * is moving, never on an idle loop, and reduced motion draws one still frame.
 */
export function DotEmblem({
  active,
  size = DOT_FIELD_DEFAULTS.size,
}: {
  /** The pane is visible; becoming visible replays the entrance. */
  active: boolean;
  size?: number;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const dots = useMemo(() => layoutDots({ ...DOT_FIELD_DEFAULTS, size }), [size]);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !active) return;
    const context = element.getContext("2d");
    if (!context) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    element.width = Math.round(size * ratio);
    element.height = Math.round(size * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const ink = token("--color-brand", "#d98449");
    const lit = token("--color-brand-hover", "#e69a61");
    const faint = token("--color-ink-faint", "#ada59e");
    const still = reducedMotion();

    const started = performance.now();
    const settleAfter = DOT_FIELD_DEFAULTS.wave + 300;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    let last = started;

    function draw(elapsed: number) {
      if (!context) return;
      context.clearRect(0, 0, size, size);
      for (const dot of dots as Dot[]) {
        const shown = still ? 1 : entrance(dot, elapsed);
        if (shown <= 0) continue;
        const x = dot.x + dot.dx;
        const y = dot.y + dot.dy;
        let alpha: number;
        let radius: number;
        if (dot.ink > 0) {
          alpha = (0.9 + 0.1 * dot.glow) * shown;
          radius = DOT_RADIUS * (0.55 + 0.45 * dot.ink) * (1 + 0.4 * dot.glow);
          context.fillStyle = dot.glow > 0.35 ? lit : ink;
        } else {
          alpha = (dot.field * 0.13 + dot.glow * 0.3) * shown;
          radius = DOT_RADIUS * (0.75 + 0.3 * dot.glow);
          context.fillStyle = faint;
        }
        if (alpha < 0.01) continue;
        context.globalAlpha = Math.min(1, alpha);
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
    }

    function tick(now: number) {
      frame = 0;
      const dt = Math.min(48, now - last);
      last = now;
      const elapsed = now - started;
      const settled = stepDots(dots, { pointer, ...DEFAULT_PULL }, dt);
      draw(elapsed);
      if (!settled || pointer !== null || elapsed < settleAfter) {
        frame = requestAnimationFrame(tick);
      }
    }

    function wake() {
      if (frame === 0) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    }

    function onPointerMove(event: PointerEvent) {
      if (!element) return;
      const bounds = element.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      const near = x > -REACH && y > -REACH && x < size + REACH && y < size + REACH;
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

    if (still) {
      for (const dot of dots) {
        dot.dx = 0;
        dot.dy = 0;
        dot.glow = 0;
      }
      draw(Number.POSITIVE_INFINITY);
      return;
    }

    for (const dot of dots) {
      dot.dx = 0;
      dot.dy = 0;
      dot.glow = 0;
    }
    frame = requestAnimationFrame(tick);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [active, dots, size]);

  return (
    <span aria-hidden="true" className="dot-emblem">
      <canvas ref={canvas} style={{ width: size, height: size }} data-testid="dot-emblem" />
    </span>
  );
}
