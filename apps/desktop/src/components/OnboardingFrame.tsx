import type { ReactNode } from "react";

export type OnboardingStep = {
  label: string;
  state: "complete" | "current" | "upcoming";
};

/**
 * The one frame the three onboarding screens share (finder, first-run existing,
 * setup wizard) so they read as the same family: wordmark, title, and content.
 */
export function OnboardingFrame({
  title,
  lede,
  width = "narrow",
  testId,
  steps,
  compact = false,
  children,
  footer,
}: {
  title: string;
  lede?: string;
  /** A bounded setup workspace, independent of the customization sidebar. */
  width?: "narrow" | "wide";
  testId?: string;
  /** Reports confirmed setup state; these are not navigation controls. */
  steps?: readonly OnboardingStep[];
  /** Keep the longer preset/addon workspace close to its heading. */
  compact?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section
      data-testid={testId}
      className={`flex w-full flex-col items-center ${
        width === "wide" ? "max-w-[880px]" : "max-w-[640px]"
      }`}
    >
      <div className="flex w-full items-center border-b border-edge pb-4">
        <p className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-ink">
          <span aria-hidden="true" className="size-2 rounded-sm bg-brand" />
          execs
        </p>
      </div>
      <div
        className={
          compact
            ? `mt-5 grid w-full items-center gap-4 ${steps ? "min-[900px]:grid-cols-[minmax(0,1fr)_380px]" : ""}`
            : "flex w-full flex-col items-center"
        }
      >
        <div className={compact ? "min-w-0" : "flex flex-col items-center"}>
          <h1 className={`t-pane max-w-[28ch] text-balance ${compact ? "" : "mt-6 text-center"}`}>
            {title}
          </h1>
          {lede ? (
            <p
              className={`t-body mt-2 max-w-[62ch] text-ink-muted ${compact ? "" : "text-center"}`}
            >
              {lede}
            </p>
          ) : null}
        </div>

        {steps ? (
          <ol
            aria-label="Setup progress"
            className={`flex w-full max-w-[640px] ${compact ? "" : "mt-5"}`}
          >
            {steps.map((step, index) => (
              <li
                key={step.label}
                aria-current={step.state === "current" ? "step" : undefined}
                className="relative flex min-w-0 flex-1 flex-col items-center gap-1 px-2 text-center"
              >
                {index < steps.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-3.5 left-1/2 h-px w-full bg-edge-strong"
                  />
                ) : null}
                <span
                  aria-hidden="true"
                  className={`relative flex size-7 items-center justify-center rounded-full border bg-bg text-[12px] font-medium ${
                    step.state === "current"
                      ? "border-brand text-ink"
                      : "border-edge-strong text-ink-muted"
                  }`}
                >
                  {index + 1}
                </span>
                <span className="t-meta text-ink">{step.label}</span>
                <span className="text-[11px] leading-4 text-ink-faint">
                  {step.state === "complete"
                    ? "Done"
                    : step.state === "current"
                      ? "Current step"
                      : "Upcoming"}
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div className="mt-5 w-full text-left">{children}</div>

      {footer ? <div className="mt-6 w-full">{footer}</div> : null}
    </section>
  );
}
