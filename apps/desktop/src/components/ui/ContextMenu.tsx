import type { ButtonHTMLAttributes, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ContextMenuPosition = { x: number; y: number };

export function ContextMenu({
  label,
  position,
  onClose,
  children,
}: {
  label: string;
  position: ContextMenuPosition;
  onClose: () => void;
  children: ReactNode;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const returnFocus = useRef<HTMLElement | null>(null);
  close.current = onClose;

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    // StrictMode may set up the effect again after it focused the first item.
    // Keep the original opener instead of replacing it with our own child.
    if (
      document.activeElement instanceof HTMLElement &&
      !element.contains(document.activeElement)
    ) {
      returnFocus.current = document.activeElement;
    }
    const place = () => {
      const bounds = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(position.x, window.innerWidth - bounds.width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(position.y, window.innerHeight - bounds.height - 8))}px`;
    };
    place();
    // Analysis can add menu items after opening, and zoom changes the available
    // viewport. Keep the bounded menu in view without resetting its focus.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(element);
    window.addEventListener("resize", place);
    element
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });

    const closeOutside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) close.current();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("pointerdown", closeOutside, true);
    window.addEventListener("keydown", closeOnEscape, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("pointerdown", closeOutside, true);
      window.removeEventListener("keydown", closeOnEscape, true);
      const target = returnFocus.current;
      requestAnimationFrame(() => {
        if (
          target?.isConnected &&
          (!document.activeElement || document.activeElement === document.body)
        ) {
          target.focus({ preventScroll: true });
        }
      });
    };
  }, [position.x, position.y]);

  function moveFocus(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = [
      ...(menu.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
    ];
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1 + items.length) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  }

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="overlay menu-enter fixed z-[100] max-h-[calc(100dvh-16px)] w-64 max-w-[calc(100vw-16px)] overflow-y-auto p-1 text-sm text-ink"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={moveFocus}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ContextMenuItem({
  detail,
  checked,
  onSelect,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  detail?: string;
  checked?: boolean;
  onSelect: () => void;
}) {
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {detail ? <span className="shrink-0 text-xs text-ink-faint">{detail}</span> : null}
    </>
  );
  const className =
    "flex w-full items-center gap-4 rounded-md px-2.5 py-1.5 text-left text-ink-muted transition-colors duration-150 hover:bg-edge hover:text-ink focus:bg-edge focus:text-ink focus:outline-none disabled:cursor-default disabled:opacity-40";
  return checked === undefined ? (
    <button {...props} type="button" role="menuitem" className={className} onClick={onSelect}>
      {content}
    </button>
  ) : (
    <button
      {...props}
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={className}
      onClick={onSelect}
    >
      {content}
    </button>
  );
}

export function ContextMenuSeparator() {
  return <hr className="my-1 border-edge border-t" />;
}
