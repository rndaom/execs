import { CaretDown } from "@phosphor-icons/react";
import { useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AutosaveActivity } from "../hooks/useAutosave";
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
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const panelId = useId();
  const active = useContext(AutosaveActivity);

  useEffect(() => {
    if (!active) setOpen(false);
  }, [active]);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const anchor = trigger.current?.getBoundingClientRect();
      const menu = panel.current?.getBoundingClientRect();
      if (!anchor || !menu) return;
      const top =
        anchor.bottom + 6 + menu.height <= window.innerHeight - 12
          ? anchor.bottom + 6
          : Math.max(12, anchor.top - menu.height - 6);
      setPosition({
        top: Math.min(top, window.innerHeight - menu.height - 12),
        left: Math.max(
          12,
          Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 12),
        ),
      });
    }
    place();
    const selected =
      panel.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]') ??
      panel.current?.querySelector<HTMLButtonElement>('[role="option"]');
    selected?.focus({ preventScroll: true });
    if (selected && panel.current) {
      panel.current.scrollTop = Math.max(
        0,
        selected.offsetTop - panel.current.clientHeight / 2 + selected.clientHeight / 2,
      );
    }
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      if (
        root.current &&
        event.target instanceof Node &&
        !root.current.contains(event.target) &&
        !panel.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
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
        ref={trigger}
        type="button"
        data-testid={testId}
        data-value={mixed ? "mixed" : value}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-2 rounded border border-edge py-1 pr-2 pl-1 text-[13px] text-ink transition-colors duration-150 hover:border-edge-strong disabled:cursor-not-allowed disabled:opacity-50"
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
      {open && active
        ? createPortal(
            <div
              ref={panel}
              id={panelId}
              role="listbox"
              aria-label={label}
              style={position}
              onBlur={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  event.relatedTarget !== trigger.current &&
                  !event.currentTarget.contains(event.relatedTarget)
                )
                  setOpen(false);
              }}
              onKeyDown={(event) => {
                const options = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]'),
                ];
                const index = options.indexOf(document.activeElement as HTMLButtonElement);
                const offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 4, ArrowUp: -4 }[
                  event.key
                ];
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? options.length - 1
                      : offset === undefined
                        ? null
                        : (index + offset + options.length) % options.length;
                if (next !== null) {
                  event.preventDefault();
                  options[next]?.focus();
                }
              }}
              className="overlay overlay-enter fixed z-50 grid max-h-[calc(100vh-24px)] w-[min(22rem,calc(100vw-24px))] grid-cols-4 gap-1.5 overflow-y-auto p-2"
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
                      trigger.current?.focus({ preventScroll: true });
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
