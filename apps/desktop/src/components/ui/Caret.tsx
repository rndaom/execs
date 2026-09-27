import { CaretDown, CaretRight } from "@phosphor-icons/react";

/**
 * The one caret, so every chooser and fold looks alike. A menu or chooser
 * caret points down and flips while its menu is open (`open`, an
 * `aria-expanded` button or an open `<details>`); a fold caret points right
 * and turns down while its `<details>` is open.
 */
export function Caret({
  fold = false,
  open,
  className = "",
}: {
  fold?: boolean;
  open?: boolean;
  className?: string;
}) {
  const Icon = fold ? CaretRight : CaretDown;
  return (
    <Icon
      size={12}
      weight="bold"
      aria-hidden="true"
      data-open={open || undefined}
      className={`caret ${fold ? "caret-fold" : "caret-menu"} ${className}`.trim()}
    />
  );
}
