import type { ReactNode } from "react";

/**
 * The one selectable tile. Flat and hairline-bordered; the selected state is a
 * 1.5px accent ring, a 6% accent wash and a small dot — never a check mark,
 * never a coloured label (AGENTS.md, "Design decisions").
 *
 * Renders a real `input` so radio groups keep arrow-key semantics and
 * checkboxes stay checkboxes; the visible tile is its `label`.
 */
export function OptionTile({
  id,
  name,
  type = "radio",
  value,
  title,
  description,
  meta,
  selected,
  disabled = false,
  testId,
  className = "",
  children,
  onSelect,
}: {
  id: string;
  /** Required for `radio` so the group behaves as one. */
  name?: string;
  type?: "radio" | "checkbox";
  value?: string;
  title: ReactNode;
  description?: ReactNode;
  /** Small footer content (stat pairs, counts). */
  meta?: ReactNode;
  selected: boolean;
  disabled?: boolean;
  testId?: string;
  className?: string;
  children?: ReactNode;
  onSelect: () => void;
}) {
  return (
    <div className="relative min-w-0">
      <input
        id={id}
        type={type}
        name={name}
        value={value}
        data-testid={testId}
        checked={selected}
        disabled={disabled}
        onChange={onSelect}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        className={`tile h-full cursor-pointer peer-focus-visible:outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${
          selected ? "tile-selected" : ""
        } ${disabled ? "tile-disabled" : ""} ${className}`.trim()}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="t-row min-w-0">{title}</span>
          {selected ? <span className="tile-check" aria-hidden="true" /> : null}
          {selected ? <span className="sr-only">Selected</span> : null}
        </span>
        {description ? <span className="t-meta block">{description}</span> : null}
        {children}
        {meta ? <span className="mt-auto block pt-3">{meta}</span> : null}
      </label>
    </div>
  );
}
