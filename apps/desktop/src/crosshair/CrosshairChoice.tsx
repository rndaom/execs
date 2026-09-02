import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import type { CrosshairColor, CrosshairShape } from "../lib/crosshair-ui";
import { crosshairShapeLabel } from "./CrosshairPreview";
import { CrosshairThumb } from "./CrosshairThumb";
import type { PreviewPixels } from "./useCrosshairDraft";

/**
 * A crosshair chooser for one weapon or slot: the current pick as a small
 * picture plus its name, opening a floating grid of every choice. Replaces
 * a `<select>` full of file names with something you can see.
 */
export function CrosshairChoice({
  value,
  choices,
  color,
  customRgba,
  previewFor,
  disabled,
  mixed = false,
  label,
  testId,
  onChange,
}: {
  value: CrosshairShape;
  choices: CrosshairShape[];
  color: CrosshairColor | null;
  customRgba: number[] | null;
  previewFor: (name: string) => PreviewPixels | null;
  disabled: boolean;
  /** The weapons in a slot disagree; show a placeholder until a pick is made. */
  mixed?: boolean;
  label: string;
  testId?: string;
  onChange: (shape: CrosshairShape) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        data-testid={testId}
        data-value={mixed ? "mixed" : value}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded-lg border border-edge py-1 pr-2 pl-1 text-[13px] text-ink transition-colors duration-150 hover:border-edge-strong disabled:cursor-not-allowed disabled:opacity-50"
      >
        {mixed ? (
          <span className="thumb-art grid size-7 place-items-center text-[11px] text-ink-faint">
            …
          </span>
        ) : (
          <CrosshairThumb
            shape={value}
            customRgba={customRgba}
            color={color}
            preview={previewFor(value)}
            size={28}
          />
        )}
        <span className="max-w-24 truncate capitalize">
          {mixed ? "Mixed" : crosshairShapeLabel(value)}
        </span>
        <CaretDown size={12} className="text-ink-faint" />
      </button>
      {open ? (
        <div
          id={panelId}
          role="listbox"
          aria-label={label}
          className="overlay overlay-enter absolute top-[calc(100%+6px)] right-0 z-30 grid w-[min(22rem,calc(100vw-3rem))] grid-cols-4 gap-1.5 p-2"
        >
          {choices.map((shape) => {
            const selected = !mixed && shape === value;
            return (
              <button
                key={shape}
                type="button"
                role="option"
                aria-selected={selected}
                data-testid={testId ? `${testId}-option-${shape}` : undefined}
                title={crosshairShapeLabel(shape)}
                onClick={() => {
                  onChange(shape);
                  setOpen(false);
                }}
                className={`thumb ${selected ? "thumb-selected" : ""}`}
              >
                <CrosshairThumb
                  shape={shape}
                  customRgba={customRgba}
                  color={color}
                  preview={previewFor(shape)}
                  size={36}
                />
                <span className="thumb-label capitalize">{crosshairShapeLabel(shape)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
