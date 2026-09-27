import { useEffect, useMemo } from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { insideTf2Emblem } from "../../../apps/desktop/src/lib/tf2-emblem";
import { DotField, type FieldMotion } from "./DotField";
import { loadInter } from "./fonts";
import { CAPTURE } from "./Stage";
import { theme } from "./theme";
import { Wordmark } from "./Wordmark";

/** A field that is simply there: formed before frame 0 and never gathered. */
const RESTING: FieldMotion = {
  burst: { x: 0, y: 0, start: -100, end: -50 },
  wave: { x: 0, y: 0, start: -1000 },
  gather: { x: 0, y: 0, start: Number.POSITIVE_INFINITY, end: Number.POSITIVE_INFINITY },
  level: () => 1,
};

/** The TF2 emblem as a centred halftone of execs orange dots, like the app's backdrop. */
function EmblemHalftone({ size, spacing = 14 }: { size: number; spacing?: number }) {
  const dots = useMemo(() => {
    const radius = size / 2;
    const scale = 11 / (radius * 0.86);
    const third = spacing / 3;
    const out: { x: number; y: number; r: number; a: number }[] = [];
    for (let y = spacing / 2; y < size; y += spacing) {
      for (let x = spacing / 2; x < size; x += spacing) {
        const dx = x - radius;
        const dy = y - radius;
        const distance = Math.hypot(dx, dy);
        if (distance > radius) continue;
        let hits = 0;
        for (let sy = -1; sy <= 1; sy += 1) {
          for (let sx = -1; sx <= 1; sx += 1) {
            if (insideTf2Emblem((dx + sx * third) * scale, (dy + sy * third) * scale)) hits += 1;
          }
        }
        const fade = 1 - distance / radius;
        if (hits > 0)
          out.push({ x, y, r: 2.9 * (0.45 + 0.55 * (hits / 9)), a: 0.5 + 0.5 * (hits / 9) });
        else if (fade > 0.05) out.push({ x, y, r: 1.1, a: 0.1 * fade });
      }
    }
    return out;
  }, [size, spacing]);
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {dots.map((dot) => (
        <circle
          key={`${dot.x}-${dot.y}`}
          cx={dot.x}
          cy={dot.y}
          r={dot.r}
          fill={dot.r > 1.2 ? theme.brand : theme.ink}
          opacity={dot.a}
        />
      ))}
    </svg>
  );
}

/** A play control that is the execs dot. */
function PlayDot({ size }: { size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size,
        background: theme.brand,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <svg
        aria-hidden="true"
        width={size * 0.36}
        height={size * 0.36}
        viewBox="0 0 10 10"
        style={{ marginLeft: size * 0.05 }}
      >
        <path d="M1.5 0.8 L9.2 5 L1.5 9.2 Z" fill={theme.onBrand} />
      </svg>
    </div>
  );
}

/** The README's placeholder for the promo video until GitHub hosts the MP4. */
export function Poster() {
  useEffect(() => {
    void loadInter();
  }, []);
  const panel = { x: 860, y: 150, width: 1000, height: 625 };
  const scale = panel.width / CAPTURE.width;
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: theme.font }}>
      <DotField motion={RESTING} />
      <div style={{ position: "absolute", left: 120, top: 250, width: 660 }}>
        <div style={{ display: "flex", justifyContent: "flex-start", marginLeft: -4 }}>
          <Wordmark size={112} />
        </div>
        <div
          style={{
            marginTop: 40,
            fontSize: 50,
            fontWeight: 600,
            letterSpacing: "-0.025em",
            lineHeight: 1.12,
            color: theme.ink,
          }}
        >
          Your Team Fortress 2 setup as profiles. Switch in one click.
        </div>
        <div style={{ marginTop: 64, display: "flex", alignItems: "center", gap: 26 }}>
          <PlayDot size={92} />
          <div>
            <div style={{ fontSize: 30, fontWeight: 600, color: theme.ink }}>
              Watch the 0.2.0 tour
            </div>
            <div style={{ marginTop: 6, fontSize: 24, color: theme.inkMuted }}>
              35 seconds, sound on
            </div>
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: panel.x,
          top: panel.y,
          width: panel.width,
          height: panel.height,
          borderRadius: 14,
          overflow: "hidden",
          border: `1px solid ${theme.edgeStrong}`,
          boxShadow: "0 40px 120px rgba(0, 0, 0, 0.55)",
        }}
      >
        <Img
          src={staticFile("captures/profiles-menu.png")}
          style={{ width: CAPTURE.width * scale, height: CAPTURE.height * scale }}
        />
      </div>
    </AbsoluteFill>
  );
}

const HIGHLIGHTS = [
  ["A calmer interface", "Warm surfaces, folded depth, class emblems."],
  ["Compare before you switch", "See what a profile changes first."],
  ["Restore points", "Keep copies; restore one as a new profile."],
  ["Where values come from", "Each setting names its cfg line."],
  ["Viewmodels per weapon", "Shown, hidden or hands only."],
  ["Health and storage", "Check your install and clean up downloads."],
] as const;

/** The 0.2.0 announcement graphic (release-0.2.0-x.png). */
export function Announcement() {
  useEffect(() => {
    void loadInter();
  }, []);
  return (
    <AbsoluteFill style={{ background: theme.bg, fontFamily: theme.font, color: theme.ink }}>
      <div style={{ position: "absolute", right: -150, top: 170 }}>
        <EmblemHalftone size={620} />
      </div>
      <div style={{ position: "absolute", left: 96, top: 72, display: "flex" }}>
        <Wordmark size={46} />
      </div>
      <div
        style={{
          position: "absolute",
          right: 96,
          top: 82,
          fontSize: 24,
          color: theme.inkFaint,
        }}
      >
        Release notes
      </div>
      <div
        style={{
          position: "absolute",
          left: 88,
          top: 140,
          fontSize: 176,
          fontWeight: 700,
          letterSpacing: "-0.05em",
          lineHeight: 1,
        }}
      >
        0.2.0
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 336,
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}
      >
        A calmer, clearer execs for your TF2 setup
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: 10,
            marginLeft: 4,
            background: theme.brand,
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 436,
          width: 960,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 48,
        }}
      >
        {HIGHLIGHTS.map(([title, line]) => (
          <div key={title} style={{ borderTop: `1px solid ${theme.edge}`, padding: "18px 0 20px" }}>
            <div style={{ fontSize: 27, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</div>
            <div
              style={{ marginTop: 8, fontSize: 21, color: theme.inkMuted, whiteSpace: "nowrap" }}
            >
              {line}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: 96,
          right: 96,
          bottom: 56,
          display: "flex",
          justifyContent: "space-between",
          fontSize: 21,
          color: theme.inkFaint,
        }}
      >
        <span>Profiles from 0.1 releases stay compatible.</span>
        <span>github.com/rndaom/execs</span>
      </div>
    </AbsoluteFill>
  );
}
