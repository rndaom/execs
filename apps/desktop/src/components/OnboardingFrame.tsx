import type { ReactNode } from "react";

/**
 * The one frame the three onboarding screens share (finder, first-run existing,
 * setup wizard) so they read as the same family: wordmark, eyebrow, a balanced
 * title, one short lede, then the content column.
 */
export function OnboardingFrame({
  eyebrow,
  icon,
  title,
  lede,
  width = "narrow",
  testId,
  children,
  footer,
}: {
  eyebrow: string;
  icon?: ReactNode;
  title: string;
  lede?: string;
  /** 640px for the finder and first-existing screens, 880px for the wizard. */
  width?: "narrow" | "wide";
  testId?: string;
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
      <p className="flex items-center gap-2.5 text-[17px] font-semibold tracking-tight text-ink">
        <span aria-hidden="true" className="size-2 rounded-sm bg-brand" />
        execs
      </p>

      <div className="eyebrow mt-10 flex items-center gap-2">
        {icon}
        <span>{eyebrow}</span>
      </div>
      <h1 className="t-pane mt-3 max-w-[20ch] text-center text-balance">{title}</h1>
      {lede ? <p className="t-body mt-3 max-w-[62ch] text-center text-ink-muted">{lede}</p> : null}

      <div className="mt-10 w-full text-left">{children}</div>

      {footer ? <div className="mt-10 w-full">{footer}</div> : null}
    </section>
  );
}
