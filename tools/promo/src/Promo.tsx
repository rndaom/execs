import { useEffect } from "react";
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadInter } from "./fonts";
import { theme } from "./theme";

export const PROMO_FPS = 30;

/** One pane per beat: screenshot from the app plus a short caption. */
const BEATS = [
  {
    shot: "settings-comfig",
    title: "Comfig",
    line: "mastercomfig presets and modules, with the official packages.",
  },
  {
    shot: "settings-hud-installed",
    title: "HUD",
    line: "Browse the catalog and install one in a click.",
  },
  {
    shot: "settings-crosshair",
    title: "Crosshair",
    line: "Stock crosshairs, community packs, or design your own.",
  },
  {
    shot: "settings-mods",
    title: "Mods",
    line: "A casual preload that keeps custom particles alive on Valve servers.",
  },
  {
    shot: "settings-sounds",
    title: "Sounds",
    line: "Hit and kill sounds from a searchable library.",
  },
  {
    shot: "switch",
    title: "Profiles",
    line: "Every setup is a named profile. Switch while the game is closed.",
  },
] as const;

const INTRO = 3.2 * PROMO_FPS;
const HOOK = 3.6 * PROMO_FPS;
const BEAT = 2.6 * PROMO_FPS;
const OUTRO = 4.2 * PROMO_FPS;

export const PROMO_DURATION_FRAMES = INTRO + HOOK + BEATS.length * BEAT + OUTRO;

function Wordmark({ size = 96, progress = 1 }: { size?: number; progress?: number }) {
  const dot = size * 0.34;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.28 }}>
      <div
        style={{
          width: dot,
          height: dot,
          borderRadius: dot * 0.25,
          background: theme.brand,
          transform: `scale(${progress})`,
        }}
      />
      <div
        style={{
          fontFamily: theme.font,
          fontWeight: 600,
          fontSize: size,
          letterSpacing: "-0.03em",
          color: theme.ink,
          lineHeight: 1,
        }}
      >
        execs
      </div>
    </div>
  );
}

function Intro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dot = spring({ frame, fps, config: { damping: 14, stiffness: 160 } });
  const text = spring({ frame: frame - 6, fps, config: { damping: 200 } });
  const tagline = interpolate(frame, [22, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fade = interpolate(frame, [INTRO - 14, INTRO], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity: fade,
        gap: 36,
      }}
    >
      <div style={{ opacity: text, transform: `translateY(${(1 - text) * 20}px)` }}>
        <Wordmark size={132} progress={dot} />
      </div>
      <div
        style={{
          fontFamily: theme.font,
          fontSize: 40,
          fontWeight: 400,
          color: theme.inkMuted,
          opacity: tagline,
          transform: `translateY(${(1 - tagline) * 12}px)`,
        }}
      >
        A desktop companion for Team Fortress 2
      </div>
    </AbsoluteFill>
  );
}

const HOOK_WORDS = ["Configs.", "Binds.", "HUD.", "Crosshair.", "Viewmodels.", "Sounds."];

function Hook() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [HOOK - 12, HOOK], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const answer = spring({ frame: frame - 48, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", opacity: fade, gap: 44 }}
    >
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", justifyContent: "center" }}>
        {HOOK_WORDS.map((word, index) => {
          const p = spring({ frame: frame - index * 6, fps, config: { damping: 200 } });
          return (
            <span
              key={word}
              style={{
                fontFamily: theme.font,
                fontWeight: 600,
                fontSize: 64,
                letterSpacing: "-0.02em",
                color: theme.ink,
                opacity: p,
                transform: `translateY(${(1 - p) * 18}px)`,
              }}
            >
              {word}
            </span>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: theme.font,
          fontSize: 44,
          fontWeight: 400,
          color: theme.inkMuted,
          opacity: answer,
          transform: `translateY(${(1 - answer) * 14}px)`,
        }}
      >
        One app. Named profiles. Nothing touched while the game runs.
      </div>
    </AbsoluteFill>
  );
}

function Beat({ shot, title, line }: (typeof BEATS)[number]) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 22, stiffness: 120 } });
  const leave = interpolate(frame, [BEAT - 10, BEAT], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = interpolate(frame, [0, BEAT], [0, -14], { easing: Easing.linear });
  const caption = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ opacity: leave }}>
      <div
        style={{
          position: "absolute",
          left: 100,
          top: 150,
          width: 480,
          opacity: caption,
          transform: `translateY(${(1 - caption) * 16}px)`,
        }}
      >
        <div
          style={{
            fontFamily: theme.font,
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: theme.brand,
            marginBottom: 20,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: theme.font,
            fontSize: 46,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.18,
            color: theme.ink,
          }}
        >
          {line}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 640,
          top: 126,
          width: 1240,
          transform: `translateX(${(1 - enter) * 80 + drift}px) scale(${0.96 + enter * 0.04})`,
          transformOrigin: "left center",
          opacity: enter,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: `0 40px 120px rgba(0,0,0,0.6), 0 0 0 1px ${theme.edgeStrong}`,
          background: theme.panel,
        }}
      >
        <Img src={staticFile(`shots/${shot}.png`)} style={{ width: "100%", display: "block" }} />
      </div>
    </AbsoluteFill>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame, fps, config: { damping: 200 } });
  const lines = ["Free and open source.", "Windows and Linux.", "Updates itself."];
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
      <div style={{ opacity: mark, transform: `translateY(${(1 - mark) * 16}px)` }}>
        <Wordmark size={110} />
      </div>
      <div style={{ display: "flex", gap: 40 }}>
        {lines.map((text, index) => {
          const p = spring({ frame: frame - 14 - index * 8, fps, config: { damping: 200 } });
          return (
            <span
              key={text}
              style={{
                fontFamily: theme.font,
                fontSize: 36,
                fontWeight: 500,
                color: theme.inkMuted,
                opacity: p,
                transform: `translateY(${(1 - p) * 12}px)`,
              }}
            >
              {text}
            </span>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 24,
          fontFamily: theme.font,
          fontSize: 40,
          fontWeight: 600,
          color: theme.ink,
          opacity: spring({ frame: frame - 44, fps, config: { damping: 200 } }),
          padding: "18px 36px",
          borderRadius: 14,
          background: theme.panelRaised,
          boxShadow: `0 0 0 1px ${theme.edgeStrong}`,
        }}
      >
        github.com/rndaom/execs
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 48,
          fontFamily: theme.font,
          fontSize: 22,
          color: theme.inkFaint,
          opacity: spring({ frame: frame - 50, fps, config: { damping: 200 } }),
        }}
      >
        Fan project. Not affiliated with Valve or Steam.
      </div>
    </AbsoluteFill>
  );
}

export function Promo() {
  useEffect(() => {
    void loadInter();
  }, []);
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <Sequence from={0} durationInFrames={INTRO}>
        <Intro />
      </Sequence>
      <Sequence from={INTRO} durationInFrames={HOOK}>
        <Hook />
      </Sequence>
      {BEATS.map((beat, index) => (
        <Sequence key={beat.shot} from={INTRO + HOOK + index * BEAT} durationInFrames={BEAT}>
          <Beat {...beat} />
        </Sequence>
      ))}
      <Sequence from={INTRO + HOOK + BEATS.length * BEAT} durationInFrames={OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}
