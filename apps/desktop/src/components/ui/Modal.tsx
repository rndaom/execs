import { type ReactNode, useEffect, useId, useRef } from "react";

const FOCUSABLE =
  'summary, a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A real modal: focus trap, focus restore on close, Escape to dismiss, and
 * Enter on the default action. Every prompt and lightbox renders through it.
 */
export function Modal({
  open,
  title,
  description,
  role = "dialog",
  scrim = true,
  testId,
  className = "",
  children,
  onClose,
  onDefaultAction,
}: {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  role?: "dialog" | "alertdialog";
  /** Dim the page behind the sheet. Off for corner prompts. */
  scrim?: boolean;
  testId?: string;
  className?: string;
  children?: ReactNode;
  onClose: () => void;
  /** Fired on Enter when focus is not already on a button or a text field. */
  onDefaultAction?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = description ? `${baseId}-description` : undefined;

  // biome-ignore lint/correctness/useExhaustiveDependencies: callbacks are read through refs on the live event.
  useEffect(() => {
    if (!open) {
      return;
    }
    restoreTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      const container = ref.current;
      if (!container) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Enter" && onDefaultAction) {
        const active = document.activeElement;
        const interactive =
          active instanceof HTMLButtonElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLAnchorElement ||
          (active instanceof HTMLInputElement && active.type !== "checkbox");
        if (!interactive) {
          event.preventDefault();
          onDefaultAction();
        }
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const start = focusable[0];
      const end = focusable[focusable.length - 1];
      if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      } else if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreTo.current?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <>
      {/* A scrim only for centred sheets; corner prompts (alertdialog) stay
          over the live page so the user can see what they are answering. */}
      {scrim ? <div className="scrim" aria-hidden="true" onClick={onClose} /> : null}
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: `role` is dynamic (dialog | alertdialog); aria-modal is valid for both. */}
      <div
        ref={ref}
        data-testid={testId}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={`overlay overlay-enter p-4 text-left ${className}`.trim()}
      >
        <p id={titleId} className="t-section">
          {title}
        </p>
        {description ? (
          <p id={descriptionId} className="t-meta mt-1">
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </>
  );
}
