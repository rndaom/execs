import type { ReactNode } from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { theme } from "./theme";
import { easeInOut, popScale, ramp } from "./timing";

/** Captures are 1440x900 CSS px (2880x1800 files); every coordinate here is in those CSS px. */
export const CAPTURE = { width: 1440, height: 900 } as const;

export type Rect = { x: number; y: number; width: number; height: number };
export type Shot = { src: string; at: number; fade?: number };
export type Reveal = { src: string; rect: Rect; at: number; until: number };
export type CameraKey = { at: number; rect: Rect; length?: number; cut?: boolean };
export type CursorKey = { at: number; x: number; y: number; click?: boolean };
export type Pop = { at: number; x: number; y: number };
export type KeyPress = { at: number; label: string };

export const grow = (rect: Rect, margin: number): Rect => ({
  x: rect.x - margin,
  y: rect.y - margin,
  width: rect.width + margin * 2,
  height: rect.height + margin * 2,
});
export const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

const capture = (name: string) => staticFile(`captures/${name}.png`);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function cameraRect(frame: number, keys: CameraKey[]): { rect: Rect; punch: number } {
  let index = 0;
  for (let i = 0; i < keys.length; i += 1) if (keys[i].at <= frame) index = i;
  const key = keys[index];
  const previous = keys[Math.max(0, index - 1)];
  const t = key.cut || index === 0 ? 1 : ramp(frame, key.at, key.length ?? 14, easeInOut);
  const rect = {
    x: lerp(previous.rect.x, key.rect.x, t),
    y: lerp(previous.rect.y, key.rect.y, t),
    width: lerp(previous.rect.width, key.rect.width, t),
    height: lerp(previous.rect.height, key.rect.height, t),
  };
  // A hard cut lands with a small settle, so each new pane arrives on the beat.
  const punch = key.cut ? 1 + 0.045 * (1 - ramp(frame, key.at, 12)) : 1;
  return { rect, punch };
}

/** Fit the focus rect in the panel, never showing past the capture's edges. */
function fit(rect: Rect, width: number, height: number, punch: number) {
  const cover = Math.max(width / CAPTURE.width, height / CAPTURE.height);
  const scale =
    Math.min(2.4, Math.max(cover, Math.min(width / rect.width, height / rect.height))) * punch;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const x = Math.min(0, Math.max(width - CAPTURE.width * scale, width / 2 - cx * scale));
  const y = Math.min(0, Math.max(height - CAPTURE.height * scale, height / 2 - cy * scale));
  return { scale, x, y };
}

function cursorAt(frame: number, keys: CursorKey[]) {
  if (keys.length === 0 || frame < keys[0].at) return null;
  let index = 0;
  for (let i = 0; i < keys.length; i += 1) if (keys[i].at <= frame) index = i;
  const from = keys[index];
  const to = keys[index + 1];
  if (!to) return { x: from.x, y: from.y };
  const t = interpolate(frame, [from.at, to.at], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: easeInOut,
  });
  // A slight arc reads as a hand, not a tween.
  const arc = Math.sin(t * Math.PI) * Math.min(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.12);
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) - arc };
}

function Cursor({ x, y, pressed }: { x: number; y: number; pressed: number }) {
  const size = 30 * (1 - pressed * 0.14);
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{
        position: "absolute",
        left: x - size * 0.13,
        top: y - size * 0.08,
        overflow: "visible",
      }}
    >
      <path
        d="M4 2.5 L4 19.5 L8.4 15.4 L11.3 21.8 L14.2 20.5 L11.4 14.2 L17.6 14.2 Z"
        fill={theme.ink}
        stroke={theme.bg}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type StageProps = {
  frame?: number;
  /** Panel position on screen for this frame. */
  geometry: (frame: number) => Rect & { scale?: number; opacity?: number };
  visible: [number, number];
  shots: Shot[];
  reveals?: Reveal[];
  camera: CameraKey[];
  cursor?: CursorKey[];
  cursorHidden?: [number, number][];
  pops?: Pop[];
  keys?: KeyPress[];
  children?: ReactNode;
};

/**
 * The app on screen: a window onto real 2x captures, with a camera that
 * frames the part that matters, a cursor, orange change pops, key presses,
 * and region reveals that swap in exactly the part of the interface that
 * changed.
 */
export function Stage({
  geometry,
  visible,
  shots,
  reveals = [],
  camera,
  cursor = [],
  cursorHidden = [],
  pops = [],
  keys = [],
}: StageProps) {
  const frame = useCurrentFrame();
  if (frame < visible[0] || frame >= visible[1]) return null;
  const panel = geometry(frame);
  const { rect, punch } = cameraRect(frame, camera);
  const view = fit(rect, panel.width, panel.height, punch);

  // Only the current shot and one fading predecessor stay mounted.
  let current = 0;
  for (let i = 0; i < shots.length; i += 1) if (shots[i].at <= frame) current = i;
  const mounted = shots
    .map((shot, index) => ({ shot, index }))
    .filter(
      ({ index }) => index === current || (index === current - 1 && (shots[current].fade ?? 0) > 0),
    );

  const pointer = cursorAt(frame, cursor);
  const hidden = cursorHidden.some(([from, to]) => frame >= from && frame < to);
  const press = cursor
    .filter((key) => key.click)
    .map((key) => frame - key.at)
    .filter((age) => age >= 0 && age < 14);
  const pressed = press.length
    ? interpolate(press[0], [0, 3, 8], [0, 1, 0], { extrapolateRight: "clamp" })
    : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: panel.x,
        top: panel.y,
        width: panel.width,
        height: panel.height,
        borderRadius: 14,
        overflow: "hidden",
        background: theme.bg,
        border: `1px solid ${theme.edgeStrong}`,
        boxShadow: "0 40px 120px rgba(0, 0, 0, 0.55)",
        opacity: panel.opacity ?? 1,
        transform: `scale(${panel.scale ?? 1})`,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: CAPTURE.width,
          height: CAPTURE.height,
          transformOrigin: "0 0",
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        }}
      >
        {mounted.map(({ shot, index }) => (
          <Img
            key={shot.src}
            src={capture(shot.src)}
            style={{
              position: "absolute",
              inset: 0,
              width: CAPTURE.width,
              height: CAPTURE.height,
              opacity:
                index === current && (shot.fade ?? 0) > 0
                  ? ramp(frame, shot.at, shot.fade ?? 1)
                  : 1,
            }}
          />
        ))}
        {reveals
          .filter((reveal) => frame >= reveal.at && frame < reveal.until)
          .map((reveal) => (
            <Img
              key={`${reveal.src}-${reveal.at}`}
              src={capture(reveal.src)}
              style={{
                position: "absolute",
                inset: 0,
                width: CAPTURE.width,
                height: CAPTURE.height,
                opacity: ramp(frame, reveal.at, 3),
                clipPath: `inset(${reveal.rect.y}px ${CAPTURE.width - reveal.rect.x - reveal.rect.width}px ${
                  CAPTURE.height - reveal.rect.y - reveal.rect.height
                }px ${reveal.rect.x}px)`,
              }}
            />
          ))}
        {pops
          .filter((pop) => {
            // A pop belongs to its shot: it ends at the next hard cut.
            const cut =
              camera.find((key) => key.cut && key.at > pop.at)?.at ?? Number.POSITIVE_INFINITY;
            return frame >= pop.at && frame < Math.min(pop.at + 40, cut);
          })
          .map((pop) => {
            const age = frame - pop.at;
            const ring = ramp(frame, pop.at, 18);
            const fade = 1 - ramp(frame, pop.at + 28, 12);
            const dot = 9 / Math.sqrt(view.scale);
            return (
              <div
                key={`${pop.at}-${pop.x}`}
                style={{ position: "absolute", left: pop.x, top: pop.y }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: -dot / 2,
                    top: -dot / 2,
                    width: dot,
                    height: dot,
                    borderRadius: dot,
                    background: theme.brand,
                    transform: `scale(${popScale(frame, pop.at, 9, 1.5)})`,
                    opacity: fade,
                  }}
                />
                {age < 20 ? (
                  <div
                    style={{
                      position: "absolute",
                      left: -dot * (0.6 + ring * 1.6),
                      top: -dot * (0.6 + ring * 1.6),
                      width: dot * (1.2 + ring * 3.2),
                      height: dot * (1.2 + ring * 3.2),
                      borderRadius: 999,
                      border: `${1.6 / view.scale}px solid ${theme.brand}`,
                      opacity: (1 - ring) * 0.8,
                    }}
                  />
                ) : null}
              </div>
            );
          })}
      </div>

      {pointer && !hidden ? (
        <>
          {press.length ? (
            <div
              style={{
                position: "absolute",
                left: view.x + pointer.x * view.scale - 6 - press[0] * 1.8,
                top: view.y + pointer.y * view.scale - 6 - press[0] * 1.8,
                width: 12 + press[0] * 3.6,
                height: 12 + press[0] * 3.6,
                borderRadius: 999,
                border: `2px solid ${theme.ink}`,
                opacity: interpolate(press[0], [0, 13], [0.55, 0]),
              }}
            />
          ) : null}
          <Cursor
            x={view.x + pointer.x * view.scale}
            y={view.y + pointer.y * view.scale}
            pressed={pressed}
          />
        </>
      ) : null}

      {keys
        .filter((key) => frame >= key.at && frame < key.at + 26)
        .map((key) => {
          const fade = 1 - ramp(frame, key.at + 18, 8);
          return (
            <div
              key={key.at}
              style={{
                position: "absolute",
                left: 32,
                bottom: 32,
                width: 76,
                height: 76,
                borderRadius: 10,
                background: theme.panelRaised,
                border: `1px solid ${theme.edgeStrong}`,
                borderBottomWidth: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: theme.font,
                fontWeight: 600,
                fontSize: 34,
                color: theme.ink,
                opacity: fade,
                transform: `scale(${popScale(frame, key.at, 8, 1.12)})`,
              }}
            >
              {key.label}
            </div>
          );
        })}
    </div>
  );
}
