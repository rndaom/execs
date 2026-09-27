import { useEffect, useRef } from "react";
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
import {
  type Burst,
  CAPTURE,
  type CameraKey,
  type CursorKey,
  centre,
  cursorAt,
  fit,
  grow,
  type Rect,
  type Reveal,
  Stage,
  type Tile,
  union,
} from "./Stage";
import { useSettledLayout } from "./settled";
import { theme } from "./theme";
import { at, easeInOut, easeOut, METAL_FRAMES, on, popScale, ramp, TILE_FRAMES } from "./timing";
import { Wordmark } from "./Wordmark";

type ItemBox = Rect & { label: string };
const targets = rawTargets as unknown as Record<string, Record<string, Rect>>;
const T = (shot: string, mark: string): Rect => {
  const rect = targets[shot]?.[mark];
  if (!rect) throw new Error(`Missing capture target ${shot}.${mark}; run pnpm capture.`);
  return rect;
};
const FILE_ROWS = rawTargets["files-lines"] as Rect[];
/** Item boxes by item ID for one inventory capture. */
const items = (shot: string) =>
  (rawTargets as unknown as Record<string, Record<string, ItemBox>>)[`${shot}-items`] ?? {};
function item(shot: string, match: (label: string) => boolean): { id: string; box: ItemBox } {
  const found = Object.entries(items(shot)).find(([, box]) => match(box.label));
  if (!found) throw new Error(`No item in ${shot} matches; run pnpm capture.`);
  return { id: found[0], box: found[1] };
}
const named = (shot: string, name: string) => item(shot, (label) => label.startsWith(`${name},`));
const inSlot = (shot: string, slot: number) =>
  item(shot, (label) => label.endsWith(`, slot ${slot}`));
const slotOf = (box: ItemBox) => Number(/slot (\d+)$/.exec(box.label)?.[1] ?? 0);

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
  weight = 600,
}: {
  text: string;
  size: number;
  dotAt: number;
  frame: number;
  weight?: number;
}) {
  const dot = Math.max(10, size * 0.2);
  // The dot stays with the last word, so it never wraps onto a line alone.
  const split = text.lastIndexOf(" ");
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
      {text.slice(0, split + 1)}
      <span style={{ whiteSpace: "nowrap" }}>
        {text.slice(split + 1)}
        <span
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

/** The steps an act visits, with the current one marked by a gliding dot. */
function Rail({
  frame,
  items: steps,
  until,
}: {
  frame: number;
  items: readonly (readonly [number, string])[];
  until: number;
}) {
  const start = steps[0][0];
  if (frame < start - 2 || frame >= until + 6) return null;
  const show = ramp(frame, start, 10) * (1 - ramp(frame, until, 6));
  let active = 0;
  for (let i = 0; i < steps.length; i += 1) if (steps[i][0] <= frame) active = i;
  const glide = ramp(frame, steps[active][0], 10, easeInOut);
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
      {steps.map(([, label], index) => (
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

// ------------------------------------------------------------------ intro

function Intro({ frame }: { frame: number }) {
  if (frame >= on("words") + 8) return null;
  const breathe =
    1 + 0.07 * Math.sin((frame / 30) * Math.PI * 2) * (1 - ramp(frame, on("wordmark"), 10));
  // The dot is already there on frame 0 (a GIF's first frame) and pops once.
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

/**
 * A line whose full stop is a separate dot that stays after the words leave,
 * so the dot field or the backpack's dots can be thrown out of it.
 */
function DotLine({
  frame,
  text,
  size,
  start,
  dotAt,
  textOutAt,
  dotOutAt,
  dotId,
  until,
  dotFade = 8,
}: {
  frame: number;
  text: string;
  size: number;
  start: number;
  dotAt: number;
  textOutAt: number;
  dotOutAt: number;
  dotId: string;
  until: number;
  /** Frames the dot takes to go; 1 hands it straight to another layer. */
  dotFade?: number;
}) {
  const enter = ramp(frame, start, 6);
  const textOut = ramp(frame, textOutAt, 8, easeInOut);
  const dotOut = ramp(frame, dotOutAt, dotFade, easeInOut);
  const visible = frame >= start && frame < until;
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", opacity: visible ? 1 : 0 }}
    >
      <div style={{ transform: `translateY(${(1 - enter) * 28}px)`, position: "relative" }}>
        <span style={{ opacity: enter * (1 - textOut) }}>
          <DotTitle text={text} size={size} dotAt={Number.POSITIVE_INFINITY} frame={frame} />
        </span>
        <span style={{ position: "absolute", right: 0, bottom: size * 0.24, opacity: 1 - dotOut }}>
          <span
            id={dotId}
            style={{
              display: "inline-block",
              width: size * 0.2,
              height: size * 0.2,
              borderRadius: size,
              background: theme.brand,
              transform: `scale(${popScale(frame, dotAt, 9, 1.6) * (1 - dotOut * 0.6)})`,
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

function panelGeometry(enterAt: number, settleAt: number, leaveAt: number, grows: boolean) {
  return (frame: number) => {
    const settle = ramp(frame, settleAt, 20, easeInOut);
    const enter = ramp(frame, enterAt, grows ? 12 : 8);
    const leave = ramp(frame, leaveAt, 12, easeInOut);
    const lerp = (a: number, b: number) => a + (b - a) * settle;
    return {
      x: lerp(FULL.x, RIGHT.x) + leave * 520,
      y: lerp(FULL.y, RIGHT.y),
      width: lerp(FULL.width, RIGHT.width),
      height: lerp(FULL.height, RIGHT.height),
      scale: grows ? 0.9 + 0.1 * enter : 1,
      opacity: enter * (1 - leave),
    };
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
const cornerOf = (rect: Rect, inset = 6) => ({ x: rect.x + rect.width - inset, y: rect.y + inset });
const PROGRESS = T("switch-done", "progress");
const SHAPE = (name: "circle" | "chevron" | "ring") => T("crosshair", name);
const PRIMARY_HIDDEN = T("viewmodels", "primaryHidden");
const SECONDARY_HANDS = T("viewmodels-primary", "secondaryHands");
const FILE_LINES = FILE_ROWS.slice(4, 14);
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
  // Shapes and the large sprite preview, below the pack notice line.
  { at: on("crosshair"), rect: { x: 240, y: 278, width: 780, height: 380 }, cut: true },
  { at: on("viewmodels"), rect: { x: 236, y: 290, width: 720, height: 330 }, cut: true },
  { at: at(10, 1), rect: { x: 700, y: 330, width: 700, height: 300 }, length: 12 },
  // The library: its heading, the source filter and the first rows.
  { at: on("sounds"), rect: { x: 236, y: 470, width: 1150, height: 430 }, cut: true },
  {
    at: on("clickUse") + 3,
    rect: grow(union(T("sounds-used", "hitSlot"), T("sounds-used", "hitToggle")), 20),
    length: 14,
  },
  { at: on("files"), rect: { x: 390, y: 170, width: 1030, height: 360 }, cut: true },
  { at: on("typed") - 10, rect: { x: 0, y: 60, width: 1186, height: 520 }, length: 10 },
];

function AppAct({ frame }: { frame: number }) {
  const features = [
    ["comfig", "Comfig", "Pick a preset. Tune the rest"],
    ["binds", "Binds", "Click an action. Press a key"],
    ["crosshair", "Crosshair", "Pick a shape, or draw your own"],
    ["viewmodels", "Viewmodels", "Hide any weapon, class by class"],
    ["sounds", "Sounds", "Hit sounds from TF2 and comfig.app"],
    ["files", "Files", "Edit cfgs with a linter that knows Source"],
  ] as const;
  const reveals: Reveal[] = [
    {
      src: "binds-recording",
      rect: grow(TAUNT, 1),
      at: on("clickTaunt") + 1,
      until: on("keyG") + 1,
    },
    { src: "binds-recorded", rect: grow(TAUNT, 1), at: on("keyG"), until: on("crosshair") },
    {
      src: "binds-recording-reload",
      rect: grow(RELOAD, 1),
      at: on("clickReload") + 1,
      until: on("keyR") + 1,
    },
    { src: "binds-recorded", rect: grow(RELOAD, 1), at: on("keyR"), until: on("crosshair") },
    ...FILE_LINES.map((line, index) => ({
      src: "files",
      rect: { x: 397, y: line.y, width: 1016, height: line.height },
      at: Math.round(on("typing") + index * TYPED_STEP),
      until: on("typed") + 4,
    })),
  ];
  return (
    <>
      <Stage
        visible={[on("drop"), on("news") + 14]}
        geometry={panelGeometry(on("drop"), on("settle"), on("news"), true)}
        camera={CAMERA}
        shots={[
          { src: "profiles-menu", at: on("drop") },
          { src: "compare", at: on("compareIn"), fade: 5 },
          { src: "switch-done", at: on("switchIn"), fade: 5 },
          { src: "comfig-medium", at: on("comfig") },
          { src: "comfig-high", at: on("clickHigh"), fade: 3 },
          { src: "binds", at: on("binds") },
          { src: "crosshair", at: on("crosshair") },
          { src: "crosshair-circle", at: on("clickCircle"), fade: 3 },
          { src: "crosshair-chevron", at: on("clickChevron"), fade: 3 },
          { src: "crosshair-ring", at: on("clickRing"), fade: 3 },
          { src: "viewmodels", at: on("viewmodels") },
          { src: "viewmodels-primary", at: on("clickHidden"), fade: 3 },
          { src: "viewmodels-both", at: on("clickHands"), fade: 3 },
          { src: "sounds", at: on("sounds") },
          { src: "sounds-comfig", at: on("clickFilter") + 1, fade: 4 },
          { src: "sounds-used", at: on("clickUse") + 2, fade: 5 },
          { src: "files-before", at: on("files") },
          { src: "files", at: on("typed"), fade: 4 },
        ]}
        reveals={reveals}
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
          { at: on("clickHidden") - 4, ...centre(PRIMARY_HIDDEN) },
          { at: on("clickHidden"), ...centre(PRIMARY_HIDDEN), click: true },
          { at: on("clickHands") - 3, ...centre(SECONDARY_HANDS) },
          { at: on("clickHands"), ...centre(SECONDARY_HANDS), click: true },
          { at: on("sounds"), x: 900, y: 720 },
          { at: on("clickFilter") - 3, ...centre(T("sounds", "filter")) },
          { at: on("clickFilter"), ...centre(T("sounds", "filter")), click: true },
          { at: on("clickUse") - 4, ...centre(T("sounds-comfig", "use")) },
          { at: on("clickUse"), ...centre(T("sounds-comfig", "use")), click: true },
        ]}
        cursorHidden={[
          [on("switchIn") + 6, on("comfig")],
          [on("clickHigh") + 14, on("binds")],
          [on("keyR") + 8, on("crosshair")],
          [on("clickRing") + 10, on("viewmodels")],
          [on("clickHands") + 14, on("sounds")],
          [on("clickUse") + 4, on("end")],
        ]}
        pops={[
          { at: on("applied"), x: PROGRESS.x + PROGRESS.width - 22, y: PROGRESS.y + 22 },
          { at: on("clickHigh"), ...HIGH_DOT },
          { at: on("keyG"), ...keyOf(TAUNT) },
          { at: on("keyR"), ...keyOf(RELOAD) },
          ...(["clickCircle", "clickChevron", "clickRing"] as const).map((event, index) => ({
            at: on(event),
            ...cornerOf(SHAPE((["circle", "chevron", "ring"] as const)[index]), 8),
          })),
          { at: on("clickHidden"), ...cornerOf(PRIMARY_HIDDEN, 4) },
          { at: on("clickHands"), ...cornerOf(SECONDARY_HANDS, 4) },
          { at: on("clickUse") + 5, ...centre(T("sounds-used", "hitToggle")) },
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
      <Rail
        frame={frame}
        items={features.map(([event, label]) => [on(event), label] as const)}
        until={on("news")}
      />
    </>
  );
}

// ------------------------------------------------------------------ new in 0.2.0

const NEWS_TILE = { width: 520, height: 292 };
const NEWS = [
  {
    src: "tile-compare",
    crop: { x: 272, y: 40, width: 900, height: 506 },
    label: "Compare before you switch",
  },
  {
    src: "tile-restore-points",
    crop: { x: 236, y: 190, width: 966, height: 543 },
    label: "Restore points for every profile",
  },
  {
    src: "tile-gameplay-sources",
    crop: { x: 244, y: 551, width: 620, height: 349 },
    label: "See where each value comes from",
  },
  {
    src: "tile-app-health",
    crop: { x: 640, y: 112, width: 760, height: 428 },
    label: "A health check for your install",
  },
  {
    src: "tile-files-problems",
    crop: { x: 560, y: 360, width: 830, height: 467 },
    label: "A new cfg editor",
  },
  {
    src: "tile-viewmodels-both",
    crop: { x: 236, y: 78, width: 1190, height: 669 },
    label: "Viewmodels, weapon by weapon",
  },
];

function News({ frame }: { frame: number }) {
  const start = on("news");
  if (frame < start || frame >= on("backpack") + 14) return null;
  const leave = ramp(frame, on("backpack"), 8, easeInOut);
  const title = ramp(frame, start, 12);
  return (
    <AbsoluteFill style={{ opacity: 1 - leave, transform: `scale(${1 - leave * 0.06})` }}>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 88,
          opacity: title,
          transform: `translateY(${(1 - title) * 20}px)`,
        }}
      >
        <DotTitle text="New in 0.2.0" size={72} dotAt={start + 8} frame={frame} />
      </div>
      {NEWS.map((tile, index) => {
        const appear = TILE_FRAMES[index];
        const enter = ramp(frame, appear, 12);
        // Tiles hold still once they land; a slow push-in would redraw every
        // pixel on every frame, which the README GIF pays for in size.
        const scale = Math.max(
          NEWS_TILE.width / tile.crop.width,
          NEWS_TILE.height / tile.crop.height,
        );
        const left = NEWS_TILE.width / 2 - (tile.crop.x + tile.crop.width / 2) * scale;
        const top = NEWS_TILE.height / 2 - (tile.crop.y + tile.crop.height / 2) * scale;
        return (
          <div
            key={tile.src}
            style={{
              position: "absolute",
              left: 140 + (index % 3) * (NEWS_TILE.width + 40),
              top: 214 + Math.floor(index / 3) * (NEWS_TILE.height + 84),
              width: NEWS_TILE.width,
              opacity: frame >= appear ? enter : 0,
              transform: `translateY(${(1 - enter) * 30}px)`,
            }}
          >
            <div
              style={{
                position: "relative",
                width: NEWS_TILE.width,
                height: NEWS_TILE.height,
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
            <div style={{ marginTop: 18 }}>
              <DotTitle text={tile.label} size={28} weight={500} dotAt={appear + 6} frame={frame} />
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

// ------------------------------------------------------------------ inventory

const GRID = grow(T("inv-grid", "grid"), 24);
const GRID_FOOTER = { x: 225, y: 128, width: 1160, height: 672 };
const invGeometry = panelGeometry(on("inventory") - 4, on("invSettle"), on("outro"), false);

/** Where the grid's slots sit on screen as the inventory arrives, for the dots that become items. */
const INV_VIEW = (() => {
  const panel = invGeometry(on("inventory"));
  const view = fit(GRID, panel.width, panel.height, 1);
  // The panel's 1px border offsets its content.
  return { x: panel.x + 1 + view.x, y: panel.y + 1 + view.y, scale: view.scale };
})();
const toScreen = (point: { x: number; y: number }) => ({
  x: INV_VIEW.x + point.x * INV_VIEW.scale,
  y: INV_VIEW.y + point.y * INV_VIEW.scale,
});

/** Every page-one item bloom, in a diagonal sweep from the top-left. */
const CASCADE = Object.entries(items("inv-grid")).map(([id, box]) => {
  const slot = slotOf(box) - 1;
  const diagonal = (slot % 10) + Math.floor(slot / 10);
  return { id, box, at: on("inventory") + Math.round(diagonal * 1.6) };
});
const CASCADE_END = Math.max(...CASCADE.map((entry) => entry.at)) + 12;

const NIGHTCAP = named("inv-grid", "Unusual Nightcap").box;
const RIFLE = named("inv-grid", "Dragon Slayer Sniper Rifle").box;
const GIFT = named("inv-delete-selected", "Gift Wrap").box;
const METALS = [8, 23, 38].map((slot) => inSlot("inv-selected", slot).box);
const SORT_FLIGHT = Object.entries(items("inv-crafted")).map(([id, from]) => {
  const to = items("inv-sorted")[id] ?? from;
  return { id, from, to, delay: Math.round((slotOf(to) - 1) * 0.26) };
});
const SORT_LENGTH = 16;
const SORT_END =
  on("clickQuality") + Math.max(...SORT_FLIGHT.map((f) => f.delay)) + SORT_LENGTH + 1;
const SWAP_HOME = named("inv-sorted", "Unusual Nightcap");
const SWAP_AWAY = inSlot("inv-sorted", 1);
const SWAP_END = on("dropItem") + 12;
const REVIEW = T("inv-sorted", "review");

const INV_CURSOR: CursorKey[] = [
  { at: at(17, 1), x: 700, y: 640 },
  { at: on("hoverItem") - 2, ...centre(NIGHTCAP) },
  { at: on("inspect") - 16, ...centre(NIGHTCAP) },
  { at: on("inspect") - 6, ...centre(RIFLE) },
  { at: on("inspect"), ...centre(RIFLE), click: true },
  { at: on("inspect") + 3, ...centre(RIFLE), click: true },
  { at: at(19, 0), x: 940, y: 610 },
  { at: on("selectDelete") - 4, ...centre(GIFT) },
  { at: on("selectDelete"), ...centre(GIFT), click: true },
  { at: on("clickDelete") - 5, ...centre(T("inv-delete-selected", "delete")) },
  { at: on("clickDelete"), ...centre(T("inv-delete-selected", "delete")), click: true },
  { at: on("confirmDelete") - 6, ...centre(T("inv-delete", "confirm")) },
  { at: on("confirmDelete"), ...centre(T("inv-delete", "confirm")), click: true },
  ...METALS.flatMap((box, index): CursorKey[] => [
    { at: METAL_FRAMES[index] - 3, ...centre(box) },
    { at: METAL_FRAMES[index], ...centre(box), click: true },
  ]),
  { at: on("clickCraft") - 5, ...centre(T("inv-selected", "craft")) },
  { at: on("clickCraft"), ...centre(T("inv-selected", "craft")), click: true },
  { at: on("confirmCraft") - 7, ...centre(T("inv-craft", "confirm")) },
  { at: on("confirmCraft"), ...centre(T("inv-craft", "confirm")), click: true },
  { at: on("clickDone") - 7, ...centre(T("inv-reveal", "done")) },
  { at: on("clickDone"), ...centre(T("inv-reveal", "done")), click: true },
  { at: on("clickSort") - 5, ...centre(T("inv-crafted", "sort")) },
  { at: on("clickSort"), ...centre(T("inv-crafted", "sort")), click: true },
  { at: on("clickQuality") - 5, ...centre(T("inv-sort-menu", "quality")) },
  { at: on("clickQuality"), ...centre(T("inv-sort-menu", "quality")), click: true },
  { at: on("move"), x: 860, y: 640 },
  { at: on("grab") - 4, ...centre(SWAP_HOME.box) },
  { at: on("grab"), ...centre(SWAP_HOME.box), click: true },
  { at: on("dropItem"), ...centre(SWAP_AWAY.box), click: true },
  { at: on("clickReview") - 6, ...centre(REVIEW) },
  { at: on("clickReview"), ...centre(REVIEW), click: true },
  { at: on("clickApply") - 7, ...centre(T("inv-review", "apply")) },
  { at: on("clickApply"), ...centre(T("inv-review", "apply")), click: true },
];

/** The top-left of page one: the hovered Nightcap, its card and the rifle to inspect. */
const TOP_LEFT = { x: 236, y: 176, width: 620, height: 400 };

const INV_CAMERA: CameraKey[] = [
  { at: on("inventory"), rect: GRID },
  { at: on("hoverItem") - 12, rect: TOP_LEFT, length: 12 },
  { at: on("inspect") + 7, rect: grow(T("inv-inspect", "dialog"), 30), length: 10 },
  { at: at(19, 0), rect: GRID_FOOTER, length: 10 },
  { at: on("clickDelete") + 4, rect: grow(T("inv-delete", "dialog"), 70), length: 8 },
  { at: on("confirmDelete") + 1, rect: GRID_FOOTER, length: 7 },
  { at: on("clickCraft") + 4, rect: grow(T("inv-craft", "dialog"), 36), length: 8 },
  { at: on("reveal"), rect: grow(T("inv-reveal", "dialog"), 44), cut: true },
  { at: on("clickDone") + 3, rect: GRID_FOOTER, length: 10 },
  { at: on("clickReview") + 4, rect: grow(T("inv-review", "dialog"), 24), length: 8 },
  { at: on("clickApply") + 4, rect: GRID_FOOTER, length: 8 },
];

const INV_TILES: Tile[] = [
  ...CASCADE.map(({ id, box, at: bloom }) => ({
    key: `cascade-${id}`,
    src: "inv-grid",
    crop: box,
    visible: [on("inventory"), CASCADE_END] as [number, number],
    place: (frame: number) => ({
      ...centre(box),
      scale: popScale(frame, bloom, 10, 1.12),
      opacity: ramp(frame, bloom, 3),
    }),
  })),
  {
    key: "deleted",
    src: "inv-delete-selected",
    crop: grow(GIFT, 4),
    visible: [on("confirmDelete"), on("confirmDelete") + 12],
    place: (frame: number) => ({
      ...centre(GIFT),
      scale: 1 - 0.4 * ramp(frame, on("confirmDelete"), 10),
      opacity: 1 - ramp(frame, on("confirmDelete"), 9),
    }),
  },
  ...SORT_FLIGHT.map(({ id, from, to, delay }) => ({
    key: `sort-${id}`,
    src: "inv-crafted",
    crop: from,
    visible: [on("clickQuality"), SORT_END] as [number, number],
    place: (frame: number) => {
      const t = Math.min(1, Math.max(0, (frame - on("clickQuality") - delay) / SORT_LENGTH));
      const e = easeInOut(t);
      const a = centre(from);
      const b = centre(to);
      const hop = Math.sin(Math.PI * t);
      return {
        x: a.x + (b.x - a.x) * e,
        y: a.y + (b.y - a.y) * e - hop * 18,
        scale: 1 + 0.06 * hop,
        lift: from.x === to.x && from.y === to.y ? 0 : hop * 0.7,
      };
    },
  })),
  {
    key: "swap-away",
    src: "inv-sorted",
    crop: SWAP_AWAY.box,
    visible: [on("grab"), SWAP_END],
    place: (frame: number) => {
      const t = ramp(frame, on("dropItem"), 10, easeInOut);
      const a = centre(SWAP_AWAY.box);
      const b = centre(SWAP_HOME.box);
      const hop = Math.sin(Math.PI * t);
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t - hop * 30,
        scale: 1 + 0.05 * hop,
        lift: hop * 0.6,
      };
    },
  },
  {
    key: "swap-home",
    src: "inv-sorted",
    crop: SWAP_HOME.box,
    visible: [on("grab"), SWAP_END],
    place: (frame: number) => {
      const held = cursorAt(Math.min(frame, on("dropItem")), INV_CURSOR) ?? centre(SWAP_HOME.box);
      const settle = ramp(frame, on("dropItem"), 6);
      const lifted = ramp(frame, on("grab"), 4) * (1 - settle);
      return { ...held, scale: 1 + 0.08 * lifted, lift: lifted };
    },
  },
];

const INV_BURSTS: Burst[] = [
  { at: on("confirmDelete"), rect: GIFT, count: 44, length: 26, reach: 80, seed: 3 },
  {
    at: on("reveal") + 2,
    rect: T("inv-reveal", "image"),
    count: 36,
    length: 30,
    reach: 190,
    radial: true,
    seed: 7,
  },
];

function InventoryAct({ frame }: { frame: number }) {
  const steps = [
    [at(17, 1.5), "Inspect", "Every item, as TF2 shows it", at(19, 0)],
    [at(19, 0), "Delete", "Clear out what you don't need", at(20, 0)],
    [at(20, 0), "Craft", "Craft metal and random hats", at(22, 0)],
    [at(22, 0), "Sort", "By quality, name or type", at(23, 0)],
    [at(23, 0), "Move", "Drag items anywhere", at(24, 0)],
    [at(24, 0), "Apply", "Review every move, then apply", on("outro")],
  ] as const;
  return (
    <>
      <Stage
        visible={[on("inventory") - 4, on("outro") + 14]}
        geometry={invGeometry}
        camera={INV_CAMERA}
        shots={[
          { src: "inv-grid-empty", at: on("inventory") - 4 },
          { src: "inv-grid", at: CASCADE_END },
          { src: "inv-hover", at: on("hoverItem") + 4, fade: 4 },
          { src: "inv-grid", at: on("inspect") - 15, fade: 3 },
          { src: "inv-inspect", at: on("inspect") + 4, fade: 5 },
          { src: "inv-grid", at: at(19, 0), fade: 5 },
          { src: "inv-delete-selected", at: on("selectDelete"), fade: 3 },
          { src: "inv-delete", at: on("clickDelete") + 3, fade: 4 },
          { src: "inv-deleted", at: on("confirmDelete") },
          { src: "inv-craft", at: on("clickCraft") + 3, fade: 4 },
          { src: "inv-reveal", at: on("reveal") },
          { src: "inv-crafted", at: on("clickDone") + 3, fade: 4 },
          { src: "inv-sort-menu", at: on("clickSort") + 2, fade: 3 },
          { src: "inv-sorted-empty", at: on("clickQuality") },
          { src: "inv-sorted", at: SORT_END },
          { src: "inv-sorted-swap", at: on("grab") },
          { src: "inv-moved", at: SWAP_END },
          { src: "inv-review", at: on("clickReview") + 3, fade: 4 },
          { src: "inv-applied", at: on("clickApply") + 3, fade: 4 },
        ]}
        reveals={[
          ...METALS.map((box, index) => ({
            src: "inv-selected",
            rect: grow(box, 5),
            at: METAL_FRAMES[index],
            until: on("clickCraft") + 3,
          })),
          {
            src: "inv-selected",
            rect: { x: 240, y: 738, width: 1130, height: 56 },
            at: METAL_FRAMES[2],
            until: on("clickCraft") + 3,
          },
        ]}
        tiles={INV_TILES}
        bursts={INV_BURSTS}
        cursor={INV_CURSOR}
        cursorHidden={[
          [on("inspect") + 7, at(19, 0) - 2],
          [on("reveal"), on("clickDone") - 8],
          [on("clickApply") + 8, on("end")],
        ]}
        pops={[
          ...METALS.map((box, index) => ({ at: METAL_FRAMES[index], ...cornerOf(box, 7) })),
          { at: on("dropItem"), ...cornerOf(SWAP_AWAY.box, 7) },
          { at: on("clickApply") + 6, ...cornerOf(REVIEW, 10) },
        ]}
      />
      <Caption
        frame={frame}
        eyebrow="New · Inventory"
        title="Your TF2 backpack, right in execs"
        from={on("invSettle") + 8}
        to={at(17, 1.5)}
      />
      {steps.map(([from, eyebrow, title, to]) => (
        <Caption key={eyebrow} frame={frame} eyebrow={eyebrow} title={title} from={from} to={to} />
      ))}
      <Rail
        frame={frame}
        items={steps.map(([from, label]) => [from, label] as const)}
        until={on("outro")}
      />
    </>
  );
}

/**
 * The backpack's dot: it leaves "And now, your backpack", splits into one
 * dot per slot, and each dot blooms into its item as the inventory arrives.
 */
function BackpackDots({ frame }: { frame: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useSettledLayout(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    context.clearRect(0, 0, 1920, 1080);
    const glide = on("backpackDot") + 15;
    if (frame < glide || frame >= CASCADE_END) return;
    const slots = CASCADE.map((entry) => ({ ...toScreen(centre(entry.box)), bloom: entry.at }));
    const middle = {
      x: slots.reduce((sum, slot) => sum + slot.x, 0) / slots.length,
      y: slots.reduce((sum, slot) => sum + slot.y, 0) / slots.length,
    };
    const draw = (x: number, y: number, radius: number, alpha: number) => {
      if (alpha <= 0 || radius <= 0) return;
      context.fillStyle = `rgba(217, 132, 73, ${Math.min(1, alpha)})`;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    };
    if (frame < on("split")) {
      // The title's dot glides to the middle of where the grid will be.
      const source = document.getElementById("backpack-dot");
      let from = middle;
      if (source) {
        const frameBox = element.getBoundingClientRect();
        const box = source.getBoundingClientRect();
        const ratio = frameBox.width / 1920;
        from = {
          x: (box.x + box.width / 2 - frameBox.x) / ratio,
          y: (box.y + box.height / 2 - frameBox.y) / ratio,
        };
      }
      const t = easeInOut(ramp(frame, glide, on("split") - glide, (value) => value));
      draw(from.x + (middle.x - from.x) * t, from.y + (middle.y - from.y) * t, 12 + 4 * t, 1);
      return;
    }
    const farthest = Math.max(
      ...slots.map((slot) => Math.hypot(slot.x - middle.x, slot.y - middle.y)),
    );
    const travel = on("slotsFormed") - on("split");
    for (const slot of slots) {
      const reach = Math.hypot(slot.x - middle.x, slot.y - middle.y) / farthest;
      const t = easeOut(
        Math.min(1, Math.max(0, (frame - on("split") - reach * travel * 0.35) / (travel * 0.65))),
      );
      const pulse =
        frame >= on("slotsFormed") ? 1 + 0.12 * Math.sin((frame - on("slotsFormed")) * 0.9) : 1;
      let radius = (16 - 7 * t) * pulse;
      let alpha = 1;
      if (frame >= slot.bloom) {
        // Blooming: the dot swells and fades as its item pops in.
        const b = Math.min(1, (frame - slot.bloom) / 6);
        radius = 9 + 30 * b;
        alpha = 1 - b;
      }
      draw(middle.x + (slot.x - middle.x) * t, middle.y + (slot.y - middle.y) * t, radius, alpha);
    }
  }, frame);
  return (
    <canvas
      ref={canvas}
      width={1920}
      height={1080}
      style={{ position: "absolute", inset: 0, width: 1920, height: 1080 }}
    />
  );
}

// ------------------------------------------------------------------ outro

const LOGO_Y = 470;

function Outro({ frame }: { frame: number }) {
  if (frame < on("logo") - 1) return null;
  const fade = 1 - ramp(frame, at(26, 3), 15, easeInOut);
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
  waves: [
    { x: 1260, y: 540, start: on("drop") },
    { x: 960, y: 540, start: on("inventory") },
  ],
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
      <DotLine
        frame={frame}
        text="In one profile"
        size={132}
        start={on("oneProfile")}
        dotAt={on("profileDot")}
        textOutAt={on("profileDot") + 3}
        dotOutAt={on("profileDot") + 4}
        dotId="profile-dot"
        until={on("drop")}
      />
      <AppAct frame={frame} />
      <News frame={frame} />
      <DotLine
        frame={frame}
        text="And now, your backpack"
        size={112}
        start={on("backpack") + 7}
        dotAt={on("backpackDot")}
        textOutAt={on("backpackDot") + 15}
        dotOutAt={on("backpackDot") + 15}
        dotId="backpack-dot"
        until={on("split")}
        dotFade={1}
      />
      <InventoryAct frame={frame} />
      <BackpackDots frame={frame} />
      <Outro frame={frame} />
    </AbsoluteFill>
  );
}
