import { PencilSimple, Plus, X } from "@phosphor-icons/react";
import { type CrosshairShape, isBuiltinCrosshairShape } from "../lib/crosshair-ui";
import { crosshairShapeLabel } from "./CrosshairPreview";

/**
 * The base-crosshair picker: first-party shapes, the imported PNG, and every
 * library entry, plus the two doors into the designer and the community pack.
 */
export function CrosshairLibraryChips({
  choices,
  selected,
  locked,
  canBrowseCommunity,
  hasDesign,
  onSelect,
  onRemove,
  onOpenDesigner,
  onOpenCommunity,
}: {
  choices: CrosshairShape[];
  selected: CrosshairShape;
  locked: boolean;
  canBrowseCommunity: boolean;
  hasDesign: boolean;
  onSelect: (shape: CrosshairShape) => void;
  onRemove: (shape: CrosshairShape) => void;
  onOpenDesigner: () => void;
  onOpenCommunity: () => void;
}) {
  return (
    <fieldset>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <legend className="t-row">Base crosshair</legend>
          <p className="t-meta mt-0.5">Used unless a weapon has an override.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="crosshair-open-designer"
            disabled={locked}
            onClick={onOpenDesigner}
            className="btn btn-ghost"
          >
            <PencilSimple size={13} />
            {hasDesign ? "Edit your design" : "Design your own"}
          </button>
          <button
            type="button"
            data-testid="crosshair-open-community"
            disabled={locked || !canBrowseCommunity}
            onClick={onOpenCommunity}
            className="btn btn-ghost"
          >
            <Plus size={13} />
            Community crosshairs
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {choices.map((shape) => {
          const isSelected = selected === shape;
          const isLibrary = !isBuiltinCrosshairShape(shape);
          return (
            <label
              key={shape}
              className={`group/chip relative cursor-pointer rounded-lg border px-3 py-2.5 text-center text-[13px] font-medium outline-none transition-colors duration-150 focus-within:ring-2 focus-within:ring-brand ${
                isSelected
                  ? "border-transparent text-ink shadow-[inset_0_0_0_1.5px_var(--color-brand)]"
                  : "border-edge text-ink-muted hover:border-edge-strong hover:text-ink"
              }`}
            >
              <input
                type="radio"
                name="crosshair-shape"
                data-testid={`crosshair-shape-${shape}`}
                checked={isSelected}
                disabled={locked}
                onChange={() => onSelect(shape)}
                className="sr-only"
              />
              <span className={isLibrary ? "block truncate" : "capitalize"}>
                {crosshairShapeLabel(shape)}
              </span>
              {isLibrary ? (
                // Revealed on focus-within as well as hover: `hidden` until
                // hover is `display:none`, which takes the button out of the
                // tab order entirely — library entries were mouse-only.
                <button
                  type="button"
                  aria-label={`Remove ${shape} from the library`}
                  data-testid={`crosshair-library-remove-${shape}`}
                  disabled={locked}
                  onClick={(event) => {
                    event.preventDefault();
                    onRemove(shape);
                  }}
                  className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border border-edge-strong bg-panel text-ink-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-focus-within/chip:opacity-100 group-hover/chip:opacity-100"
                >
                  <X size={9} weight="bold" />
                </button>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
