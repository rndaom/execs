import { type ReactNode, useContext, useId, useLayoutEffect, useRef } from "react";
import { AutosaveActivity } from "../../hooks/useAutosave";

const FOCUSABLE =
  'summary, a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ModalEntry = {
  node: HTMLDivElement;
  scrim: HTMLDivElement | null;
  order: number;
  restoreTo: HTMLElement | null;
};

const stacks = new WeakMap<Document, ModalEntry[]>();
let nextOrder = 0;

function updateStack(stack: ModalEntry[]) {
  stack.forEach((entry, index) => {
    const top = index === stack.length - 1;
    // Each new scrim covers the previous dialog, regardless of JSX order.
    entry.node.style.zIndex = String(51 + index * 2);
    entry.node.toggleAttribute("inert", !top);
    entry.node.setAttribute("aria-modal", String(top));
    if (entry.scrim) {
      entry.scrim.style.zIndex = String(50 + index * 2);
      entry.scrim.toggleAttribute("inert", !top);
    }
  });
}

function focusFirst(node: HTMLElement) {
  (node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus();
}

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
  const active = useContext(AutosaveActivity);
  const ref = useRef<HTMLDivElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const order = useRef<number | null>(null);
  const callbacks = useRef({ onClose, onDefaultAction });
  callbacks.current = { onClose, onDefaultAction };
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = description ? `${baseId}-description` : undefined;

  useLayoutEffect(() => {
    if (!open) {
      order.current = null;
      return;
    }
    // A loading/hidden pane can resume beneath an exit guard. Its still-open
    // modal keeps its original position instead of jumping back to the top.
    if (order.current === null) order.current = nextOrder++;
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const doc = node.ownerDocument;
    const stack = stacks.get(doc) ?? [];
    stacks.set(doc, stack);
    const entry: ModalEntry = {
      node,
      scrim: scrim ? scrimRef.current : null,
      order: order.current,
      restoreTo: doc.activeElement instanceof HTMLElement ? doc.activeElement : null,
    };
    stack.push(entry);
    stack.sort((a, b) => a.order - b.order);
    updateStack(stack);
    if (stack.at(-1) === entry) focusFirst(node);

    function onKeyDown(event: KeyboardEvent) {
      if (stack.at(-1) !== entry) return;
      const container = entry.node;
      if (!["Escape", "Enter", "Tab"].includes(event.key)) return;
      // Closing the top dialog must not deliver the same key to the next one.
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        callbacks.current.onClose();
        return;
      }
      if (event.key === "Enter") {
        const active = doc.activeElement;
        const interactive =
          active instanceof HTMLButtonElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLAnchorElement ||
          (active instanceof HTMLInputElement && active.type !== "checkbox");
        if (!interactive && callbacks.current.onDefaultAction) {
          event.preventDefault();
          callbacks.current.onDefaultAction();
        }
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === doc.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const start = focusable[0];
      const end = focusable[focusable.length - 1];
      if (!container.contains(doc.activeElement) || doc.activeElement === container) {
        event.preventDefault();
        (event.shiftKey ? end : start).focus();
      } else if (!event.shiftKey && doc.activeElement === end) {
        event.preventDefault();
        start.focus();
      } else if (event.shiftKey && doc.activeElement === start) {
        event.preventDefault();
        end.focus();
      }
    }

    doc.addEventListener("keydown", onKeyDown, true);
    return () => {
      doc.removeEventListener("keydown", onKeyDown, true);
      const wasTop = stack.at(-1) === entry;
      stack.splice(stack.indexOf(entry), 1);
      // If a lower dialog disappears, preserve its opener for eventual restore
      // without stealing focus from the dialog the user is answering now.
      for (const remaining of stack) {
        if (remaining.restoreTo && node.contains(remaining.restoreTo)) {
          remaining.restoreTo = entry.restoreTo;
        }
      }
      updateStack(stack);
      if (!wasTop) return;
      const top = stack.at(-1);
      const restore = entry.restoreTo;
      if (
        restore?.isConnected &&
        !restore.closest("[inert], [hidden]") &&
        (!top || top.node.contains(restore))
      ) {
        restore.focus();
      } else if (top) {
        focusFirst(top.node);
      }
    };
  }, [open, active, scrim]);

  if (!open || !active) {
    return null;
  }

  return (
    <>
      {/* A scrim only for centred sheets; corner prompts (alertdialog) stay
          over the live page so the user can see what they are answering. */}
      {scrim ? (
        <div
          ref={scrimRef}
          className="scrim"
          aria-hidden="true"
          onClick={() => {
            const node = ref.current;
            if (node && stacks.get(node.ownerDocument)?.at(-1)?.node === node) {
              callbacks.current.onClose();
            }
          }}
        />
      ) : null}
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
