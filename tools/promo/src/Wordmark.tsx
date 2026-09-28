import { theme } from "./theme";

/**
 * The execs wordmark: the orange dot, then the name. `reveal` grows the name
 * out from behind the dot, so at 0 the dot alone sits where the mark is centred.
 */
export function Wordmark({
  size,
  reveal = 1,
  dotScale = 1,
  dotId,
}: {
  size: number;
  reveal?: number;
  dotScale?: number;
  dotId?: string;
}) {
  const dot = size * 0.3;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        id={dotId}
        style={{
          width: dot,
          height: dot,
          borderRadius: dot,
          background: theme.brand,
          transform: `scale(${dotScale})`,
          flex: "none",
        }}
      />
      <div
        style={{
          overflow: "hidden",
          maxWidth: size * 2.9 * reveal,
          marginLeft: size * 0.2 * reveal,
          whiteSpace: "nowrap",
        }}
      >
        <div
          style={{
            fontFamily: theme.font,
            fontWeight: 600,
            fontSize: size,
            letterSpacing: "-0.035em",
            lineHeight: 1.1,
            color: theme.ink,
            transform: `translateX(${(1 - reveal) * -size * 0.4}px)`,
            opacity: Math.min(1, reveal * 1.6),
          }}
        >
          execs
        </div>
      </div>
    </div>
  );
}
