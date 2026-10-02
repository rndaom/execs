import { CaretDown } from "@phosphor-icons/react";

/**
 * The one caret, so every menu button looks alike. It points down and flips
 * while its menu is open (`open`, an `aria-expanded` button or an open
 * `<details>`). Panes never fold content away behind a caret.
 */
export function Caret({ open, className = "" }: { open?: boolean; className?: string }) {
  return (
    <CaretDown
      size={12}
      weight="bold"
      aria-hidden="true"
      data-open={open || undefined}
      className={`caret caret-menu ${className}`.trim()}
    />
  );
}
