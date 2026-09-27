import { type ReactNode, useId, useLayoutEffect, useRef, useState } from "react";

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
  neutralValue,
  testIdPrefix,
  onChange,
}: {
  label: string;
  options: SegmentedOption<Id>[];
  value: Id;
  disabled?: boolean;
  size?: "sm" | "md";
  /** A default choice whose selection stays neutral, so only changed choices use the accent. */
  neutralValue?: Id;
  testIdPrefix?: string;
  onChange: (id: Id) => void;
}) {
  // Per instance, not per label: two groups with the same label on one page
  // (Boost under each sound slot) must not share a radio group or ids.
  const instance = useId();
  const name = `segmented-${label.replace(/\s+/g, "-").toLowerCase()}-${instance}`;
  const group = useRef<HTMLFieldSetElement | null>(null);
  const [thumb, setThumb] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    ready: boolean;
  } | null>(null);
  const selectedIndex = options.findIndex((option) => option.id === value);

  // One raised thumb slides to the chosen label; the first placement snaps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: labels re-measure when their text changes.
  useLayoutEffect(() => {
    const root = group.current;
    if (!root) return;
    const place = () => {
      // Each option wrapper is positioned, so measure the wrapper: its offsets
      // are relative to the fieldset, unlike the label inside it.
      const items = root.querySelectorAll<HTMLElement>(".segmented-item");
      const target = selectedIndex >= 0 ? items[selectedIndex] : undefined;
      if (!target || target.offsetWidth === 0) {
        setThumb(null);
        return;
      }
      setThumb((current) => ({
        x: target.offsetLeft,
        y: target.offsetTop,
        width: target.offsetWidth,
        height: target.offsetHeight,
        ready: current !== null,
      }));
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => observer.disconnect();
  }, [selectedIndex, options.length, options.map((option) => option.id).join("|")]);

  return (
    <fieldset
      ref={group}
      className={`segmented ${size === "sm" ? "segmented-sm" : ""} ${
        disabled ? "segmented-disabled" : ""
      }`.trim()}
      data-thumb={thumb ? "true" : undefined}
      disabled={disabled}
    >
      <legend className="sr-only">{label}</legend>
      {thumb ? (
        <span
          aria-hidden="true"
          className="segmented-thumb"
          data-ready={thumb.ready ? "true" : "false"}
          data-neutral={value === neutralValue ? "true" : undefined}
          style={{
            transform: `translate(${thumb.x}px, ${thumb.y}px)`,
            width: thumb.width,
            height: thumb.height,
          }}
        />
      ) : null}
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
              data-neutral={option.id === neutralValue ? "true" : undefined}
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
