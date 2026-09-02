import type { ReactNode } from "react";

export type SegmentedOption<Id extends string> = {
  id: Id;
  label: ReactNode;
  /** Optional tooltip. */
  title?: string;
};

/**
 * A segmented control for two-to-five mutually exclusive choices — the
 * de-carded, no-dropdown answer for "pick one": a pill with a sliding
 * highlight, the selected segment in ink on the raised surface.
 *
 * Keyboard: a real radio group under the hood, so arrow keys move the
 * selection and the group is one tab stop.
 */
export function Segmented<Id extends string>({
  label,
  options,
  value,
  disabled = false,
  size = "md",
  testIdPrefix,
  onChange,
}: {
  label: string;
  options: SegmentedOption<Id>[];
  value: Id;
  disabled?: boolean;
  size?: "sm" | "md";
  testIdPrefix?: string;
  onChange: (id: Id) => void;
}) {
  const name = `segmented-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <fieldset
      className={`segmented ${size === "sm" ? "segmented-sm" : ""} ${
        disabled ? "segmented-disabled" : ""
      }`.trim()}
      disabled={disabled}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.id === value;
        const id = `${name}-${option.id}`;
        return (
          <span key={option.id} className="segmented-item">
            <input
              id={id}
              type="radio"
              name={name}
              value={option.id}
              checked={selected}
              disabled={disabled}
              data-testid={testIdPrefix ? `${testIdPrefix}-${option.id}` : undefined}
              onChange={() => onChange(option.id)}
              className="peer sr-only"
            />
            <label
              htmlFor={id}
              title={option.title}
              data-selected={selected ? "true" : "false"}
              className="segmented-label peer-focus-visible:ring-2 peer-focus-visible:ring-brand"
            >
              {option.label}
            </label>
          </span>
        );
      })}
    </fieldset>
  );
}
