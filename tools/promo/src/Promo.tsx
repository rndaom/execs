import { useEffect } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { loadInter } from "./fonts";
import { theme } from "./theme";

export const PROMO_FPS = 30;

/** Product overview without third-party gameplay or HUD images. */
const BEATS = [
  {
    title: "Profiles",
    line: "Keep each setup together.",
    detail: "Switch while Team Fortress 2 is closed.",
  },
  {
    title: "Comfig",
    line: "Choose a preset. Tune its modules.",
    detail: "Official mastercomfig packages.",
  },
  {
    title: "HUD",
    line: "Find a HUD or bring your own.",
    detail: "One HUD choice per profile.",
  },
  {
    title: "Mods",
    line: "Manage your custom packs.",
    detail: "Optional Casual setup includes Restore stock files.",
  },
  {
    title: "Sounds",
    line: "Use installed effects or your own WAV.",
    detail: "Hit and kill choices stay with your profile.",
  },
  {
    title: "Files",
    line: "Edit your cfg with source-aware help.",
    detail: "Your drafts wait for an explicit Save.",
  },
] as const;

/** Scene lengths in frames for a given frame rate, so the GIF and the mp4 share one timeline. */
export function timeline(fps: number) {
  const intro = Math.round(3.2 * fps);
  const hook = Math.round(3.6 * fps);
  const beat = Math.round(2.6 * fps);
  const outro = Math.round(4.2 * fps);
  return { intro, hook, beat, outro, total: intro + hook + BEATS.length * beat + outro };
}

export const PROMO_DURATION_FRAMES = timeline(PROMO_FPS).total;

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
  const { intro: INTRO } = timeline(fps);
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
  const { hook: HOOK } = timeline(fps);
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
        One app. Named profiles. Game files stay locked while TF2 runs.
      </div>
    </AbsoluteFill>
  );
}

function Beat({ title, line, detail, number }: (typeof BEATS)[number] & { number: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 22, stiffness: 120 } });
  const { beat: BEAT } = timeline(fps);
  const leave = interpolate(frame, [BEAT - 10, BEAT], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = interpolate(frame, [0, BEAT], [12, -12], { easing: Easing.linear });
  const caption = spring({ frame: frame - 8, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill
      style={{ opacity: leave, alignItems: "center", justifyContent: "center", gap: 28 }}
    >
      <div
        style={{
          width: 1520,
          minHeight: 590,
          boxSizing: "border-box",
          padding: "76px 90px",
          border: `1px solid ${theme.edgeStrong}`,
          borderRadius: 24,
          background: theme.panel,
          boxShadow: "0 32px 100px rgba(0,0,0,0.28)",
          opacity: caption,
          transform: `translateY(${(1 - enter) * 36 + drift}px)`,
        }}
      >
        <div
          style={{
            fontFamily: theme.font,
            fontSize: 28,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: theme.brand,
            marginBottom: 46,
          }}
        >
          {String(number).padStart(2, "0")} / {String(BEATS.length).padStart(2, "0")} · {title}
        </div>
        <div
          style={{
            fontFamily: theme.font,
            fontSize: 74,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            lineHeight: 1.12,
            color: theme.ink,
          }}
        >
          {line}
        </div>
        <div
          style={{
            fontFamily: theme.font,
            fontSize: 37,
            color: theme.inkMuted,
            marginTop: 38,
          }}
        >
          {detail}
        </div>
      </div>
      <div
        style={{
          fontFamily: theme.font,
          fontSize: 24,
          color: theme.inkMuted,
        }}
      >
        Development overview · 0.2.0
      </div>
    </AbsoluteFill>
  );
}

function Outro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame, fps, config: { damping: 200 } });
  const lines = ["Free and open source.", "Windows and Linux.", "Updates when you choose."];
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
  const { fps } = useVideoConfig();
  const { intro: INTRO, hook: HOOK, beat: BEAT, outro: OUTRO } = timeline(fps);
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
        <Sequence key={beat.title} from={INTRO + HOOK + index * BEAT} durationInFrames={BEAT}>
          <Beat {...beat} number={index + 1} />
        </Sequence>
      ))}
      <Sequence from={INTRO + HOOK + BEATS.length * BEAT} durationInFrames={OUTRO}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
}
