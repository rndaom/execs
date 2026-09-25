import type { ReactNode } from "react";

/** An original eight-tooth workshop cog, drawn once at module load. */
const COG_PATH = (() => {
  const teeth = 8;
  const outer = 11;
  const root = 8.4;
  const hole = 3.4;
  const point = (radius: number, angle: number) =>
    `${(12 + radius * Math.cos(angle)).toFixed(3)} ${(12 + radius * Math.sin(angle)).toFixed(3)}`;
  const step = (Math.PI * 2) / teeth;
  const parts: string[] = [];
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const start = tooth * step - Math.PI / 2;
    // Each tooth: rise, flat top, fall, then a flat root before the next tooth.
    const corners = [
      [root, start + step * 0.08],
      [outer, start + step * 0.2],
      [outer, start + step * 0.44],
      [root, start + step * 0.56],
    ] as const;
    corners.forEach(([radius, angle], index) => {
      parts.push(`${tooth === 0 && index === 0 ? "M" : "L"}${point(radius, angle)}`);
    });
  }
  parts.push("Z");
  // Counter-wound hole so the even-odd fill leaves the centre open.
  parts.push(
    `M${12 + hole} 12a${hole} ${hole} 0 1 0 ${-hole * 2} 0a${hole} ${hole} 0 1 0 ${hole * 2} 0Z`,
  );
  return parts.join("");
})();

/**
 * The app's loading indicator: a turning cog in the accent color. Global
 * reduced-motion rules stop it, leaving a still cog beside the status text.
 */
export function Spinner({
  size = 16,
  className = "",
  label,
}: {
  size?: number;
  className?: string;
  /** Accessible name when the spinner stands alone; omit when text accompanies it. */
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`spinner ${className}`.trim()}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      data-testid="spinner"
    >
      <path d={COG_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/** Loading text with the cog in front, for status lines and busy buttons. */
export function Loading({
  children,
  size = 14,
  className = "",
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`.trim()}>
      <Spinner size={size} />
      <span>{children}</span>
    </span>
  );
}
