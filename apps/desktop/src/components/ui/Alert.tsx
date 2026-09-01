import type { ReactNode } from "react";

export type AlertTone = "error" | "warn" | "info";

const TONE_CLASS: Record<AlertTone, string> = {
  error: "border-team-red/50 bg-team-red/10 text-ink",
  warn: "border-q-strange/50 bg-q-strange/10 text-ink",
  info: "border-edge bg-panel/60 text-ink-muted",
};

/** One spelling of the inline message box the panes and onboarding screens use. */
export function Alert({
  tone = "error",
  testId,
  className = "",
  children,
}: {
  tone?: AlertTone;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <p
      role={tone === "info" ? undefined : "alert"}
      data-testid={testId}
      className={`rounded-lg border px-4 py-3 text-sm leading-5 ${TONE_CLASS[tone]} ${className}`.trim()}
    >
      {children}
    </p>
  );
}
