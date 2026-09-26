import type { ReactNode } from "react";
import { EMBLEM_QUADRANT_PATH, EMBLEM_TILT } from "../../lib/tf2-emblem";

/*
 * A flat redraw of the Team Fortress 2 emblem. The geometry lives in
 * lib/tf2-emblem; one quadrant is turned four times, so the mark is exactly
 * four-fold symmetric and a quarter turn loops without a seam.
 */
/** The TF2 emblem as a flat, single-colour mark. */
export function Tf2Mark({
  size = 24,
  className = "",
  title,
}: {
  size?: number;
  className?: string;
  /** Accessible name when the mark stands alone. */
  title?: string;
}) {
  return (
    <svg
      viewBox="-12 -12 24 24"
      width={size}
      height={size}
      className={className || undefined}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <g transform={`rotate(${EMBLEM_TILT})`} fill="currentColor">
        {[0, 90, 180, 270].map((turn) => (
          <path key={turn} d={EMBLEM_QUADRANT_PATH} transform={`rotate(${turn})`} />
        ))}
      </g>
    </svg>
  );
}

/**
 * The app's loading indicator: the TF2 emblem stepping through quarter turns
 * in the accent colour. Global reduced-motion rules stop it, leaving a still
 * emblem beside the status text.
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
    <span
      className={`spinner ${className}`.trim()}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-testid="spinner"
      style={{ width: size, height: size }}
    >
      <Tf2Mark size={size} />
    </span>
  );
}

/** Loading text with the emblem in front, for status lines and busy buttons. */
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

/**
 * A whole-surface wait: a large emblem over one line of status. Used where a
 * pane or screen has nothing to show until a read finishes.
 */
export function LoadingState({
  children,
  testId,
  className = "",
}: {
  children: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <div
      data-testid={testId}
      role="status"
      className={`loading-state enter-fade ${className}`.trim()}
    >
      <Spinner size={40} />
      <p className="t-meta">{children}</p>
    </div>
  );
}
