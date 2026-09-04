import { Check } from "@phosphor-icons/react";
import type { SwitchStep } from "../lib/bridge";
import { SWITCH_STEPS, switchStepIndex } from "../lib/library-ui";
import {
  idleSwitchProgress,
  type SwitchProgressPresenterState,
  switchProgressFraction,
} from "../lib/switch-progress-ui";

/**
 * The paced switch checklist. Stages are real backend events; the bar is
 * step-driven (revealed stages over total) and no percentage is ever shown.
 */
export function SwitchProgressList({
  switchStep,
  active,
  visible,
  detail,
}: {
  switchStep: SwitchStep | null;
  active: boolean;
  visible: boolean;
  /** Exact completion outcome supplied by the backend's Done event. */
  detail?: string | null;
}) {
  if (!visible) {
    return null;
  }
  const currentIndex = switchStep ? switchStepIndex(switchStep) : -1;
  const currentLabel = switchStep
    ? (SWITCH_STEPS[currentIndex]?.label ?? "Applying profile")
    : "Preparing…";
  const complete = !active && switchStep === "done";
  // One implementation of the fill: the tested presenter helper, not a second
  // copy of the arithmetic inline.
  const presented: SwitchProgressPresenterState = {
    ...idleSwitchProgress(),
    active,
    visible,
    visibleStep: switchStep,
  };
  const fraction = switchProgressFraction(presented);
  return (
    <section
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={active}
      aria-label="Profile progress"
      className="overlay fixed inset-x-4 bottom-4 z-50 p-4 text-left sm:left-auto sm:right-6 sm:w-[26rem]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="t-row">{complete ? "Profile applied" : "Applying profile"}</p>
        {complete ? <Check size={16} weight="bold" className="text-ok" /> : null}
      </div>
      <p data-testid="switch-progress-current" className="t-meta mt-1">
        {complete ? detail || "All steps done" : currentLabel}
      </p>

      <div
        data-testid="switch-progress-bar"
        data-fraction={fraction.toFixed(3)}
        aria-hidden="true"
        className="mt-3 h-1 overflow-hidden rounded-pill bg-bg"
      >
        <div
          className="h-full rounded-pill bg-brand transition-[width] duration-500 ease-out"
          style={{ width: `${Math.round(fraction * 100)}%` }}
        />
      </div>

      <ol data-testid="switch-progress" className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {SWITCH_STEPS.map((item, index) => {
          const done = complete || currentIndex > index;
          const current = active && item.id === switchStep;
          return (
            <li
              key={item.id}
              data-step={item.id}
              data-current={current ? "true" : "false"}
              data-done={done ? "true" : "false"}
              aria-current={current ? "step" : undefined}
              aria-label={`${item.label}: ${done ? "done" : current ? "current" : "pending"}`}
              className={`flex min-w-0 items-center gap-2 text-[12.5px] ${
                current ? "text-ink" : done ? "text-ink-muted" : "text-ink-faint"
              }`}
            >
              <span
                aria-hidden="true"
                className={`flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                  current
                    ? "border-brand text-ink"
                    : done
                      ? "border-ok/60 text-ok"
                      : "border-edge text-ink-faint"
                }`}
              >
                {done ? <Check size={9} weight="bold" /> : index + 1}
              </span>
              <span className="truncate">{item.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
