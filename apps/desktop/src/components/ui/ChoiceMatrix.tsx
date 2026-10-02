import type { CSSProperties, ReactNode } from "react";

export type ChoiceMatrixColumn<Id extends string> = {
  id: Id;
  label: string;
  /** Optional tooltip for the column's cells. */
  title?: string;
};

/**
 * Column headings for a `ChoiceMatrixRow` list. Rows and headings share one
 * grid, so every choice sits under its name.
 */
export function ChoiceMatrixHead<Id extends string>({
  columns,
  label = "",
}: {
  columns: ChoiceMatrixColumn<Id>[];
  label?: ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className="choice-matrix-row choice-matrix-head"
      style={{ "--matrix-cols": columns.length } as CSSProperties}
    >
      <span>{label}</span>
      {columns.map((column) => (
        <span key={column.id}>{column.label}</span>
      ))}
    </div>
  );
}

/**
 * One row of a choice matrix: a name and one radio per column, so a slot and
 * each weapon in it read as one table instead of hiding behind menus.
 */
export function ChoiceMatrixRow<Id extends string>({
  name,
  label,
  accessibleLabel,
  detail,
  title,
  kind = "item",
  columns,
  available,
  value,
  neutralValue,
  disabled = false,
  testId,
  testIdPrefix,
  data,
  onChange,
}: {
  /** The radio group name; unique on the page. */
  name: string;
  label: ReactNode;
  accessibleLabel: string;
  detail?: ReactNode;
  title?: string;
  /** `group` heads a set of `member` rows; `item` stands alone. */
  kind?: "group" | "member" | "item";
  columns: ChoiceMatrixColumn<Id>[];
  /** Columns this row offers; the rest stay empty. Defaults to every column. */
  available?: Id[];
  /** The checked column, or null when the row is mixed. */
  value: Id | null;
  /** A default choice whose selection stays neutral, so only changed choices use the accent. */
  neutralValue?: Id;
  disabled?: boolean;
  testId?: string;
  testIdPrefix?: string;
  /** Extra `data-*` attributes for the row. */
  data?: Record<string, string>;
  onChange: (id: Id) => void;
}) {
  const dataAttributes = Object.fromEntries(
    Object.entries(data ?? {}).map(([key, val]) => [`data-${key}`, val]),
  );
  return (
    <div
      role="radiogroup"
      aria-label={accessibleLabel}
      title={title}
      data-testid={testId}
      data-member={kind === "member" ? "true" : undefined}
      className={`choice-matrix-row${kind === "group" ? " choice-matrix-group" : ""}`}
      style={{ "--matrix-cols": columns.length } as CSSProperties}
      {...dataAttributes}
    >
      <div className="choice-matrix-label">
        <p className={kind === "member" ? "t-body text-[13px]" : "t-row"}>{label}</p>
        {detail ? <p className="t-meta truncate">{detail}</p> : null}
      </div>
      {columns.map((column) =>
        available && !available.includes(column.id) ? (
          <span key={column.id} aria-hidden="true" className="choice-matrix-cell" />
        ) : (
          <label
            key={column.id}
            className="choice-matrix-cell"
            title={column.title ?? column.label}
            data-neutral={column.id === neutralValue ? "true" : undefined}
          >
            <input
              type="radio"
              name={name}
              value={column.id}
              checked={value === column.id}
              disabled={disabled}
              aria-label={`${accessibleLabel}: ${column.label}`}
              data-testid={testIdPrefix ? `${testIdPrefix}-${column.id}` : undefined}
              onChange={() => onChange(column.id)}
            />
            <span aria-hidden="true" className="choice-matrix-dot" />
          </label>
        ),
      )}
    </div>
  );
}
