import type { ReactNode } from "react";

export type ChoiceChip<Id extends string> = {
  id: Id;
  label: ReactNode;
  /** Optional tooltip. */
  title?: string;
};

/**
 * One choice from more options than a `Segmented` control holds: the same
 * flat pill, wrapping onto further lines instead of hiding the options in a
 * menu. `glyph` lays single characters out as an even grid.
 */
export function ChoiceChips<Id extends string>({
  label,
  options,
  value,
  disabled = false,
  neutralValue,
  variant = "text",
  testId,
  chipTestIdPrefix,
  className = "",
  onChange,
}: {
  label: string;
  options: ChoiceChip<Id>[];
  value: Id;
  disabled?: boolean;
  /** A default choice whose selection stays neutral, so only changed choices use the accent. */
  neutralValue?: Id;
  variant?: "text" | "glyph";
  testId?: string;
  chipTestIdPrefix?: string;
  className?: string;
  onChange: (id: Id) => void;
}) {
  return (
    <fieldset
      data-testid={testId}
      data-value={value}
      disabled={disabled}
      className={`choice-chips${variant === "glyph" ? " choice-chips-glyph" : ""} ${className}`.trim()}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            title={option.title}
            data-testid={chipTestIdPrefix ? `${chipTestIdPrefix}-${option.id}` : undefined}
            data-neutral={option.id === neutralValue ? "true" : undefined}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className="choice-chip"
          >
            {option.label}
          </button>
        );
      })}
    </fieldset>
  );
}
