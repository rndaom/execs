/** A labelled range with its current value beside the label. */
export function SliderRow({
  id,
  testId,
  label,
  description,
  value,
  inputValue,
  min,
  max,
  step = 1,
  suffix = "",
  disabled = false,
  onChange,
}: {
  id: string;
  testId: string;
  label: string;
  description: string;
  value: number;
  inputValue?: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <label htmlFor={id} className="t-row">
            {label}
          </label>
          <p id={`${id}-description`} className="t-meta mt-1">
            {description}
          </p>
        </div>
        <output
          htmlFor={id}
          className="tnum min-w-16 rounded-md border border-edge-strong bg-panel px-3 py-1.5 text-center text-[18px] font-medium text-ink"
        >
          {value}
          {suffix}
        </output>
      </div>
      <input
        id={id}
        data-testid={testId}
        type="range"
        min={min}
        max={max}
        step={step}
        value={inputValue ?? value}
        disabled={disabled}
        aria-describedby={`${id}-description`}
        onChange={(event) => onChange(Number(event.target.value))}
        className="range mt-3 block w-full"
      />
      <div className="tnum mt-1 flex justify-between text-[11px] text-ink-faint">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
