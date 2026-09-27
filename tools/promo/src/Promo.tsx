import { useEffect } from "react";
import {
  AbsoluteFill,
  Audio,
  getStaticFiles,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";
import rawTargets from "../public/captures/targets.json";
import { DotField, type FieldMotion } from "./DotField";
import { loadInter } from "./fonts";
import { CAPTURE, type CameraKey, centre, grow, type Rect, Stage } from "./Stage";
import { theme } from "./theme";
import { at, easeInOut, on, popScale, ramp, TILE_FRAMES } from "./timing";
import { Wordmark } from "./Wordmark";

const targets = rawTargets as unknown as Record<string, Record<string, Rect>> & {
  "files-lines": Rect[];
};
const T = (shot: string, mark: string): Rect => {
  const rect = targets[shot]?.[mark];
  if (!rect) throw new Error(`Missing capture target ${shot}.${mark}; run pnpm capture.`);
  return rect;
};

const STATIC = new Set(getStaticFiles().map((file) => file.name));
const hasFile = (name: string) => STATIC.has(name);

const CLASSES = [
  ["scout", "Scout"],
  ["soldier", "Soldier"],
  ["pyro", "Pyro"],
  ["demoman", "Demoman"],
  ["heavy", "Heavy"],
  ["engineer", "Engineer"],
  ["medic", "Medic"],
  ["sniper", "Sniper"],
  ["spy", "Spy"],
] as const;

const WORDS = ["Configs", "Binds", "HUDs", "Crosshairs", "Viewmodels", "Hit sounds", "Mods"];

// ------------------------------------------------------------------ type

/** A title whose full stop is the execs dot. */
function DotTitle({
  text,
  size,
  dotAt,
  frame,
  dotId,
  weight = 600,
}: {
  text: string;
  size: number;
  dotAt: number;
  frame: number;
  dotId?: string;
  weight?: number;
}) {
  const dot = Math.max(10, size * 0.2);
  return (
    <span
      style={{
        fontFamily: theme.font,
        fontWeight: weight,
        fontSize: size,
        letterSpacing: "-0.03em",
        lineHeight: 1.08,
        color: theme.ink,
      }}
    >
      {text}
      <span
        id={dotId}
        style={{
          display: "inline-block",
          width: dot,
          height: dot,
          borderRadius: dot,
          marginLeft: size * 0.07,
          background: theme.brand,
          transform: `scale(${popScale(frame, dotAt, 9, 1.45)})`,
        }}
      />
    </span>
  );
}

function Caption({
  frame,
  eyebrow,
  title,
  from,
  to,
}: {
  frame: number;
  eyebrow: string;
  title: string;
  from: number;
  to: number;
}) {
  if (frame < from || frame >= to) return null;
  const enter = ramp(frame, from, 12);
  const leave = ramp(frame, to - 5, 5, easeInOut);
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        width: 500,
        top: 0,
        bottom: 60,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 22,
        opacity: enter * (1 - leave),
      }}
    >
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: 600,
          fontSize: 19,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: theme.inkFaint,
          transform: `translateY(${(1 - enter) * 10}px)`,
        }}
      >
        {eyebrow}
      </div>
      <div style={{ transform: `translateY(${(1 - enter) * 26 - leave * 12}px)` }}>
        <DotTitle text={title} size={62} dotAt={from + 8} frame={frame} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ intro

function Intro({ frame }: { frame: number }) {
  if (frame >= on("words") + 8) return null;
  const breathe =
    1 + 0.07 * Math.sin((frame / 30) * Math.PI * 2) * (1 - ramp(frame, on("wordmark"), 10));
  // The dot is already there on frame 0 (GitHub shows that frame before play) and pops once.
  const pop = frame < 12 ? 1 + 0.35 * Math.sin((Math.PI * frame) / 12) : 1;
  const dotScale = pop * breathe;
  const reveal = ramp(frame, on("wordmark"), 16);
  const lift = ramp(frame, on("classes"), 16, easeInOut);
  const tagline = ramp(frame, on("tagline"), 12) * (1 - ramp(frame, on("classes"), 8));
  const exit = ramp(frame, on("words"), 6, easeInOut);
  const size = 132 * (1 - lift * 0.4);
  return (
    <AbsoluteFill style={{ opacity: 1 - exit }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: interpolate(lift, [0, 1], [540, 250]) - size * 0.55,
        }}
      >
        <Wordmark size={size} reveal={reveal} dotScale={dotScale} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 640,
          textAlign: "center",
          fontFamily: theme.font,
          fontSize: 36,
          color: theme.inkMuted,
          opacity: tagline,
          transform: `translateY(${(1 - tagline) * 12}px)`,
        }}
      >
        for Team Fortress 2
      </div>
      <Classes frame={frame} />
    </AbsoluteFill>
  );
}

function Classes({ frame }: { frame: number }) {
  if (frame < on("classes")) return null;
  const emblems = CLASSES.every(([id]) => hasFile(`local/emblems/${id}.png`));
  const caption = ramp(frame, at(1, 2), 14);
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 400,
          display: "flex",
          justifyContent: "center",
          gap: 26,
        }}
      >
        {CLASSES.map(([id, name], index) => {
          const start = on("classes") + Math.round(index * 7.5);
          const pop = popScale(frame, start, 9, 1.22);
          const settle = ramp(frame, start + 3, 14);
          const colour = `color-mix(in srgb, ${theme.brand} ${Math.round((1 - settle) * 100)}%, ${theme.ink})`;
          return (
            <div
              key={id}
              style={{
                width: 112,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 16,
                opacity: frame >= start ? 1 : 0,
              }}
            >
              {emblems ? (
                <div
                  style={{
                    width: 100,
                    height: 100,
                    background: colour,
                    WebkitMaskImage: `url(${staticFile(`local/emblems/${id}.png`)})`,
                    WebkitMaskSize: "contain",
                    WebkitMaskRepeat: "no-repeat",
                    WebkitMaskPosition: "center",
                    transform: `scale(${pop})`,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 18,
                    background: colour,
                    transform: `scale(${pop})`,
                    margin: "41px 0",
                  }}
                />
              )}
              <div
                style={{
                  fontFamily: theme.font,
                  fontSize: 19,
                  fontWeight: 500,
                  color: theme.inkMuted,
                  opacity: ramp(frame, start + 2, 8),
                }}
              >
                {name}
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 690,
          textAlign: "center",
          opacity: caption,
          transform: `translateY(${(1 - caption) * 16}px)`,
        }}
      >
        <DotTitle
          text="Your whole Team Fortress 2 setup"
          size={56}
          dotAt={at(1, 2) + 8}
          frame={frame}
        />
      </div>
    </>
  );
}

function Words({ frame }: { frame: number }) {
  if (frame < on("words") || frame >= on("oneProfile")) return null;
  const starts = WORDS.map((_, index) => on("words") + Math.round(index * 7.5));
  let index = 0;
  for (let i = 0; i < starts.length; i += 1) if (starts[i] <= frame) index = i;
  const start = starts[index];
  const enter = ramp(frame, start, 4);
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ opacity: enter, transform: `translateY(${(1 - enter) * 28}px)` }}>
        <DotTitle text={WORDS[index]} size={150} dotAt={start + 2} frame={frame} />
      </div>
    </AbsoluteFill>
  );
}

/** "In one profile." Its dot bursts into the backdrop, so it stays laid out for measuring. */
function OneProfile({ frame }: { frame: number }) {
  const start = on("oneProfile");
  const burst = on("profileDot");
  const enter = ramp(frame, start, 6);
  const textOut = ramp(frame, burst + 3, 8, easeInOut);
  const dotOut = ramp(frame, burst + 4, 8, easeInOut);
  const visible = frame >= start && frame < on("drop");
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity: visible ? 1 : 0,
      }}
    >
      <div style={{ transform: `translateY(${(1 - enter) * 28}px)`, position: "relative" }}>
        <span style={{ opacity: enter * (1 - textOut) }}>
          <DotTitle
            text="In one profile"
            size={132}
            dotAt={Number.POSITIVE_INFINITY}
            frame={frame}
          />
        </span>
        <span
          style={{
            position: "absolute",
            right: 0,
            bottom: 132 * 0.24,
            opacity: 1 - dotOut,
          }}
        >
          <span
            id="profile-dot"
            style={{
              display: "inline-block",
              width: 132 * 0.2,
              height: 132 * 0.2,
              borderRadius: 132,
              background: theme.brand,
              transform: `scale(${popScale(frame, burst, 9, 1.6) * (1 - dotOut * 0.6)})`,
            }}
          />
        </span>
      </div>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ the app

const FULL = { x: 160, y: 40, width: 1600, height: 1000 };
const RIGHT = { x: 680, y: 100, width: 1160, height: 880 };
const WHOLE: Rect = { x: 0, y: 0, ...CAPTURE };

function panelGeometry(frame: number) {
  const settle = ramp(frame, on("settle"), 20, easeInOut);
  const enter = ramp(frame, on("drop"), 12);
  const leave = ramp(frame, on("news"), 12, easeInOut);
  const lerp = (a: number, b: number) => a + (b - a) * settle;
  return {
    x: lerp(FULL.x, RIGHT.x) + leave * 520,
    y: lerp(FULL.y, RIGHT.y),
    width: lerp(FULL.width, RIGHT.width),
    height: lerp(FULL.height, RIGHT.height),
    scale: 0.9 + 0.1 * enter,
    opacity: enter * (1 - leave),
  };
}

const HIGH = centre(T("comfig-medium", "high"));
const HIGH_DOT = {
  x: T("comfig-medium", "high").x + T("comfig-medium", "high").width - 18,
  y: T("comfig-medium", "high").y + 18,
};
const TAUNT = T("binds", "taunt");
const RELOAD = T("binds", "reload");
/** The change pop sits on the new key cap's corner, clear of its letter. */
const keyOf = (row: Rect) => ({ x: row.x + row.width - 10, y: row.y + 10 });
const PROGRESS = T("switch-done", "progress");
const SEGMENT = (row: Rect, option: 0 | 1 | 2) => ({
  x: row.x + [30, 92, 170][option],
  y: row.y + row.height / 2,
});
const SCATTERGUN = T("viewmodels-weapons", "scattergun");
const FORCE = T("viewmodels-weapons", "forceANature");
const SHORTSTOP = T("viewmodels-weapons", "shortstop");
const SHAPE = (name: "circle" | "chevron" | "ring") => T("crosshair-designer", name);
const FILE_LINES = targets["files-lines"].slice(4, 14);
const TYPED_STEP = (on("typed") - on("typing")) / FILE_LINES.length;

const CAMERA: CameraKey[] = [
  { at: on("drop"), rect: WHOLE },
  { at: on("settle"), rect: grow(T("profiles-menu", "menu"), 36), length: 20 },
  { at: on("compareIn"), rect: grow(T("compare", "dialog"), 20), length: 12 },
  { at: on("switchIn"), rect: WHOLE, length: 12 },
  { at: at(6, 1.5), rect: grow(PROGRESS, 70), length: 14 },
  { at: on("comfig"), rect: { x: 220, y: 110, width: 1180, height: 470 }, cut: true },
  { at: on("clickHigh") + 6, rect: { x: 380, y: 0, width: 1060, height: 330 }, length: 16 },
  { at: on("binds"), rect: { x: 700, y: 395, width: 600, height: 230 }, cut: true },
  { at: on("crosshair"), rect: { x: 240, y: 320, width: 720, height: 290 }, cut: true },
  { at: on("viewmodels"), rect: { x: 236, y: 95, width: 700, height: 300 }, cut: true },
  { at: on("viewmodels") + 12, rect: { x: 720, y: 140, width: 680, height: 300 }, length: 12 },
  { at: on("sounds"), rect: { x: 240, y: 560, width: 1130, height: 340 }, cut: true },
  { at: on("clickUse") + 2, rect: { x: 230, y: 50, width: 640, height: 250 }, length: 14 },
  { at: on("files"), rect: { x: 390, y: 170, width: 1030, height: 360 }, cut: true },
  { at: on("typed") - 10, rect: { x: 0, y: 60, width: 1186, height: 520 }, length: 10 },
];

function AppAct({ frame }: { frame: number }) {
  const end = on("news") + 14;
  const features = [
    ["comfig", "Comfig", "Pick a preset. Tune the rest"],
    ["binds", "Binds", "Click an action. Press a key"],
    ["crosshair", "Crosshair", "Draw your own crosshair"],
    ["viewmodels", "Viewmodels", "Hide any weapon, class by class"],
    ["sounds", "Sounds", "Choose your hit and kill sounds"],
    ["files", "Files", "Edit cfgs with a linter that knows Source"],
  ] as const;
  return (
    <>
      <Stage
        visible={[on("drop"), end]}
        geometry={panelGeometry}
        camera={CAMERA}
        shots={[
          { src: "profiles-menu", at: on("drop") },
          { src: "compare", at: on("compareIn"), fade: 5 },
          { src: "switch-done", at: on("switchIn"), fade: 5 },
          { src: "comfig-medium", at: on("comfig") },
          { src: "comfig-high", at: on("clickHigh"), fade: 3 },
          { src: "binds", at: on("binds") },
          { src: "crosshair-designer", at: on("crosshair") },
          { src: "crosshair-circle", at: on("clickCircle"), fade: 3 },
          { src: "crosshair-chevron", at: on("clickChevron"), fade: 3 },
          { src: "crosshair-ring", at: on("clickRing"), fade: 3 },
          { src: "viewmodels-scrolled", at: on("viewmodels") },
          { src: "sounds", at: on("sounds") },
          { src: "sounds-used", at: on("clickUse") + 2, fade: 6 },
          { src: "files-before", at: on("files") },
          { src: "files", at: on("typed"), fade: 4 },
        ]}
        reveals={[
          {
            src: "binds-recording",
            rect: grow(TAUNT, 1),
            at: on("clickTaunt") + 1,
            until: on("keyG") + 1,
          },
          { src: "binds-recorded", rect: grow(TAUNT, 1), at: on("keyG"), until: on("crosshair") },
          { src: "binds-recorded", rect: grow(RELOAD, 1), at: on("keyR"), until: on("crosshair") },
          {
            src: "viewmodels-weapons",
            rect: grow(SCATTERGUN, 2),
            at: on("clickHidden"),
            until: on("sounds"),
          },
          {
            src: "viewmodels-weapons",
            rect: grow(FORCE, 2),
            at: on("clickHands"),
            until: on("sounds"),
          },
          {
            src: "viewmodels-weapons",
            rect: grow(SHORTSTOP, 2),
            at: on("clickHidden2"),
            until: on("sounds"),
          },
          {
            src: "viewmodels-weapons",
            rect: grow(T("viewmodels-weapons", "toolbar"), 2),
            at: on("clickHidden2") + 3,
            until: on("sounds"),
          },
          ...FILE_LINES.map((line, index) => ({
            src: "files",
            rect: { x: 397, y: line.y, width: 1016, height: line.height },
            at: Math.round(on("typing") + index * TYPED_STEP),
            until: on("typed") + 4,
          })),
        ]}
        cursor={[
          { at: on("settle") + 12, x: 760, y: 430 },
          { at: on("clickActions") - 4, ...centre(T("profiles-menu", "actions")) },
          { at: on("clickActions"), ...centre(T("profiles-menu", "actions")), click: true },
          { at: on("clickSwitch") - 5, ...centre(T("compare", "switch")) },
          { at: on("clickSwitch"), ...centre(T("compare", "switch")), click: true },
          { at: on("comfig"), x: 900, y: 560 },
          { at: on("clickHigh") - 3, ...HIGH },
          { at: on("clickHigh"), ...HIGH, click: true },
          { at: on("binds"), x: 1040, y: 640 },
          { at: on("clickTaunt") - 2, ...centre(TAUNT) },
          { at: on("clickTaunt"), ...centre(TAUNT), click: true },
          { at: on("clickReload") - 4, ...centre(RELOAD) },
          { at: on("clickReload"), ...centre(RELOAD), click: true },
          { at: on("crosshair"), x: 700, y: 560 },
          { at: on("clickCircle") - 3, ...centre(SHAPE("circle")) },
          { at: on("clickCircle"), ...centre(SHAPE("circle")), click: true },
          { at: on("clickChevron") - 3, ...centre(SHAPE("chevron")) },
          { at: on("clickChevron"), ...centre(SHAPE("chevron")), click: true },
          { at: on("clickRing") - 3, ...centre(SHAPE("ring")) },
          { at: on("clickRing"), ...centre(SHAPE("ring")), click: true },
          { at: on("viewmodels"), x: 1060, y: 620 },
          { at: on("clickHidden") - 3, ...SEGMENT(SCATTERGUN, 1) },
          { at: on("clickHidden"), ...SEGMENT(SCATTERGUN, 1), click: true },
          { at: on("clickHands") - 1, ...SEGMENT(FORCE, 2) },
          { at: on("clickHands"), ...SEGMENT(FORCE, 2), click: true },
          { at: on("clickHidden2") - 1, ...SEGMENT(SHORTSTOP, 1) },
          { at: on("clickHidden2"), ...SEGMENT(SHORTSTOP, 1), click: true },
          { at: on("sounds"), x: 1000, y: 660 },
          { at: on("clickUse") - 3, ...centre(T("sounds", "use")) },
          { at: on("clickUse"), ...centre(T("sounds", "use")), click: true },
        ]}
        cursorHidden={[
          [on("switchIn") + 6, on("comfig")],
          [on("clickHigh") + 14, on("binds")],
          [on("keyR") + 8, on("crosshair")],
          [on("clickRing") + 10, on("viewmodels")],
          [on("clickHidden2") + 14, on("sounds")],
          [on("clickUse") + 8, on("end")],
        ]}
        pops={[
          { at: on("applied"), x: PROGRESS.x + PROGRESS.width - 22, y: PROGRESS.y + 22 },
          { at: on("clickHigh"), ...HIGH_DOT },
          { at: on("keyG"), ...keyOf(TAUNT) },
          { at: on("keyR"), ...keyOf(RELOAD) },
          ...(["clickCircle", "clickChevron", "clickRing"] as const).map((event, index) => {
            const shape = SHAPE((["circle", "chevron", "ring"] as const)[index]);
            return { at: on(event), x: shape.x + shape.width - 8, y: shape.y + 8 };
          }),
          { at: on("clickHidden"), ...SEGMENT(SCATTERGUN, 1) },
          { at: on("clickHands"), ...SEGMENT(FORCE, 2) },
          { at: on("clickHidden2"), ...SEGMENT(SHORTSTOP, 1) },
          { at: on("clickUse") + 4, ...centre(T("sounds-used", "hitToggle")) },
          { at: on("typed"), ...centre(T("files", "change")) },
        ]}
        keys={[
          { at: on("keyG"), label: "G" },
          { at: on("keyR"), label: "R" },
        ]}
      />
      <Caption
        frame={frame}
        eyebrow="Profiles"
        title="Every setup is a profile"
        from={on("settle") + 14}
        to={on("compareIn")}
      />
      <Caption
        frame={frame}
        eyebrow="Compare"
        title="See what changes before you switch"
        from={on("compareIn")}
        to={on("switchIn")}
      />
      <Caption
        frame={frame}
        eyebrow="Switch"
        title="Your whole setup in one click"
        from={on("switchIn")}
        to={on("comfig")}
      />
      {features.map(([event, eyebrow, title], index) => (
        <Caption
          key={event}
          frame={frame}
          eyebrow={eyebrow}
          title={title}
          from={on(event)}
          to={index < features.length - 1 ? on(features[index + 1][0]) : on("news")}
        />
      ))}
      <Rail frame={frame} items={features.map(([event, label]) => [on(event), label] as const)} />
    </>
  );
}

/** The six panes the montage visits, with the active one marked by a gliding dot. */
function Rail({ frame, items }: { frame: number; items: readonly (readonly [number, string])[] }) {
  const start = items[0][0];
  if (frame < start - 2 || frame >= on("news") + 6) return null;
  const show = ramp(frame, start, 10) * (1 - ramp(frame, on("news"), 6));
  let active = 0;
  for (let i = 0; i < items.length; i += 1) if (items[i][0] <= frame) active = i;
  const glide = ramp(frame, items[active][0], 10, easeInOut);
  const position = active === 0 ? 0 : active - 1 + glide;
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        bottom: 108,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        opacity: show,
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 9 + position * 34,
          width: 8,
          height: 8,
          borderRadius: 8,
          background: theme.brand,
        }}
      />
      {items.map(([, label], index) => (
        <div
          key={label}
          style={{
            marginLeft: 22,
            height: 22,
            fontFamily: theme.font,
            fontSize: 18,
            fontWeight: 500,
            color: index === active ? theme.ink : theme.inkFaint,
            opacity: index === active ? 1 : 0.55,
          }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ new in 0.2.0

const TILE = { width: 820, height: 290 };
const TILES = [
  {
    src: "compare",
    crop: { x: 400, y: 84, width: 640, height: 226 },
    label: "Compare before you switch",
  },
  {
    src: "restore-points",
    crop: { x: 380, y: 274, width: 680, height: 240 },
    label: "Restore points for every profile",
  },
  {
    src: "gameplay-sources",
    crop: { x: 226, y: 630, width: 720, height: 254 },
    label: "See where each value comes from",
  },
  {
    src: "app-health",
    crop: { x: 226, y: 322, width: 1000, height: 353 },
    label: "A health check for your install",
  },
];

function News({ frame }: { frame: number }) {
  const start = on("news");
  if (frame < start || frame >= on("logo")) return null;
  const leave = ramp(frame, on("outro"), 12, easeInOut);
  const title = ramp(frame, start, 12);
  const subline = ramp(frame, at(14, 0), 14);
  return (
    <AbsoluteFill style={{ opacity: 1 - leave, transform: `scale(${1 - leave * 0.06})` }}>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 96,
          right: 120,
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          opacity: title,
          transform: `translateY(${(1 - title) * 20}px)`,
        }}
      >
        <DotTitle text="New in 0.2.0" size={72} dotAt={start + 8} frame={frame} />
        <div
          style={{
            fontFamily: theme.font,
            fontSize: 26,
            color: theme.inkMuted,
            opacity: subline,
          }}
        >
          And a calmer interface, top to bottom
        </div>
      </div>
      {TILES.map((tile, index) => {
        const appear = TILE_FRAMES[index];
        const enter = ramp(frame, appear, 12);
        const push =
          1 +
          0.05 *
            interpolate(frame, [appear, on("outro")], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            });
        const scale = Math.max(TILE.width / tile.crop.width, TILE.height / tile.crop.height) * push;
        const left = TILE.width / 2 - (tile.crop.x + tile.crop.width / 2) * scale;
        const top = TILE.height / 2 - (tile.crop.y + tile.crop.height / 2) * scale;
        return (
          <div
            key={tile.src}
            style={{
              position: "absolute",
              left: 120 + (index % 2) * (TILE.width + 40),
              top: 236 + Math.floor(index / 2) * (TILE.height + 104),
              width: TILE.width,
              opacity: frame >= appear ? enter : 0,
              transform: `translateY(${(1 - enter) * 30}px)`,
            }}
          >
            <div
              style={{
                position: "relative",
                width: TILE.width,
                height: TILE.height,
                overflow: "hidden",
                borderRadius: 10,
                border: `1px solid ${theme.edgeStrong}`,
                background: theme.bg,
              }}
            >
              <Img
                src={staticFile(`captures/${tile.src}.png`)}
                style={{
                  position: "absolute",
                  left,
                  top,
                  width: CAPTURE.width * scale,
                  height: CAPTURE.height * scale,
                }}
              />
            </div>
            <div style={{ marginTop: 20 }}>
              <DotTitle text={tile.label} size={30} weight={500} dotAt={appear + 6} frame={frame} />
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ outro

const LOGO_Y = 470;

function Outro({ frame }: { frame: number }) {
  if (frame < on("logo") - 1) return null;
  const fade = 1 - ramp(frame, at(16, 3), 15, easeInOut);
  const reveal = ramp(frame, on("logo") + 3, 16);
  const version = ramp(frame, on("version"), 14);
  const url = ramp(frame, on("url"), 14);
  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: LOGO_Y - 150 * 0.55 }}>
        <Wordmark size={150} reveal={reveal} dotScale={popScale(frame, on("logo"), 10, 1.4)} />
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 600,
          textAlign: "center",
          fontFamily: theme.font,
          fontSize: 34,
          color: theme.inkMuted,
          opacity: version,
          transform: `translateY(${(1 - version) * 14}px)`,
        }}
      >
        Version 0.2.0 <span style={{ color: theme.brand }}>·</span> Windows and Linux{" "}
        <span style={{ color: theme.brand }}>·</span> Free and open source
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 668,
          textAlign: "center",
          fontFamily: theme.font,
          fontSize: 34,
          fontWeight: 500,
          color: theme.ink,
          opacity: url,
          transform: `translateY(${(1 - url) * 14}px)`,
        }}
      >
        github.com/rndaom/execs
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 48,
          textAlign: "center",
          fontFamily: theme.font,
          fontSize: 18,
          color: theme.inkFaint,
          opacity: url * 0.8,
        }}
      >
        A fan project. Not affiliated with Valve. Team Fortress is a trademark of Valve Corporation.
      </div>
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ composition

const FIELD: FieldMotion = {
  burst: {
    x: 960,
    y: 540,
    start: on("profileDot") + 3,
    end: on("fieldFormed"),
    fromId: "profile-dot",
  },
  wave: { x: 1260, y: 540, start: on("drop") },
  gather: { x: 960, y: LOGO_Y, start: on("outro"), end: on("logo") },
  level: (frame) => {
    const dim = ramp(frame, on("drop"), 10);
    const rise = ramp(frame, on("outro"), 6);
    // Brightest while the emblem first forms, then quiet behind the app.
    return interpolate(dim, [0, 1], [1.5, 0.6]) + rise * 0.6;
  },
};

export function Promo() {
  const frame = useCurrentFrame();
  useEffect(() => {
    void loadInter();
  }, []);
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: theme.font }}>
      {hasFile("local/soundtrack.wav") ? <Audio src={staticFile("local/soundtrack.wav")} /> : null}
      <DotField motion={FIELD} />
      <Intro frame={frame} />
      <Words frame={frame} />
      <OneProfile frame={frame} />
      <AppAct frame={frame} />
      <News frame={frame} />
      <Outro frame={frame} />
    </AbsoluteFill>
  );
}
