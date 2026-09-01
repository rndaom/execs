import type { ReactNode } from "react";

export type AlertTone = "error" | "warn" | "info";

const TONE_CLASS: Record<AlertTone, string> = {
  error: "border-error/50 bg-error/10 text-ink",
  warn: "border-warn/50 bg-warn/10 text-ink",
  info: "border-edge bg-panel text-ink-muted",
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
      className={`t-body rounded-lg border px-4 py-3 ${TONE_CLASS[tone]} ${className}`.trim()}
    >
      {children}
    </p>
  );
}
