import { useEffect, useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { insideTf2Emblem } from "../../../apps/desktop/src/lib/tf2-emblem";
import { loadInter } from "./fonts";
import { theme } from "./theme";
import { Wordmark } from "./Wordmark";

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

/** The headline first, then what else 0.2.0 adds. */
const HIGHLIGHTS = [
  ["Inventory", "Inspect, sort, move, craft and delete items."],
  ["Compare before you switch", "See what a profile changes first."],
  ["A new cfg editor", "Problems and command help as you type."],
  ["Restore points", "Keep copies; restore one as a new profile."],
  ["Where values come from", "Each setting names its cfg line."],
  ["Viewmodels per weapon", "Shown, hidden or hands only."],
  ["Health check", "A read-only look at your TF2 install."],
  ["Launch options", "Written to Steam before you launch."],
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
          top: 132,
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
          top: 322,
          fontSize: 42,
          fontWeight: 600,
          letterSpacing: "-0.02em",
        }}
      >
        Your TF2 backpack, now in execs
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
          top: 408,
          width: 960,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 48,
        }}
      >
        {HIGHLIGHTS.map(([title, line], index) => (
          <div
            key={title}
            style={{
              // The headline feature gets the orange rule.
              borderTop: `${index === 0 ? 2 : 1}px solid ${index === 0 ? theme.brand : theme.edge}`,
              padding: index === 0 ? "13px 0 16px" : "14px 0 16px",
            }}
          >
            <div style={{ fontSize: 25, fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</div>
            <div
              style={{ marginTop: 6, fontSize: 19, color: theme.inkMuted, whiteSpace: "nowrap" }}
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
