import { Crosshair, DotsThree, PencilSimple, Plus, UploadSimple } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import {
  ContextMenu,
  ContextMenuItem,
  type ContextMenuPosition,
  ContextMenuSeparator,
} from "../components/ui/ContextMenu";
import type { CrosshairColor, CrosshairShape } from "../lib/crosshair-ui";
import { CrosshairThumb } from "./CrosshairThumb";
import type { PreviewPixels } from "./useCrosshairDraft";

export type GalleryGroup = { id: string; title: string; note?: string; items: CrosshairShape[] };

/**
 * The one crosshair picker: every choice is a crisp picture with its name,
 * grouped by where it comes from. The player's own crosshairs carry their
 * actions on a ⋯ button and on right-click.
 */
export function CrosshairGallery({
  groups,
  value,
  color,
  pixelsFor,
  labelFor,
  isDesign,
  isOwn,
  onSelect,
  onNewDesign,
  onImport,
  onEdit,
  onDuplicate,
  onCopyCode,
  onRemove,
}: {
  groups: GalleryGroup[];
  value: CrosshairShape;
  color: CrosshairColor;
  pixelsFor: (name: string) => PreviewPixels | null;
  labelFor: (name: string) => string;
  /** Whether a choice has designer parameters to open. */
  isDesign: (name: string) => boolean;
  /** Whether a choice belongs to the player (and can be removed). */
  isOwn: (name: string) => boolean;
  onSelect: (name: CrosshairShape) => void;
  onNewDesign: () => void;
  onImport: (file: File) => void;
  onEdit: (name: CrosshairShape) => void;
  onDuplicate: (name: CrosshairShape) => void;
  onCopyCode: (name: CrosshairShape) => void;
  onRemove: (name: CrosshairShape) => void;
}) {
  const [menu, setMenu] = useState<{ name: string; position: ContextMenuPosition } | null>(null);
  const hasActions = (name: string) => isOwn(name) || isDesign(name);

  return (
    <div className="crosshair-gallery" data-testid="crosshair-gallery">
      {groups.map((group) => (
        <fieldset key={group.id} className="crosshair-gallery-group">
          <legend className="eyebrow">{group.title}</legend>
          {group.note ? <p className="t-meta mb-3 text-[12px]">{group.note}</p> : null}
          <div className="crosshair-grid">
            {group.items.map((name) => {
              const selected = value === name;
              const label = labelFor(name);
              const actions = hasActions(name);
              return (
                <div key={name} className="crosshair-item">
                  <input
                    id={`crosshair-choice-${name}`}
                    type="radio"
                    name="crosshair-base"
                    value={name}
                    data-testid={`crosshair-shape-${name}`}
                    checked={selected}
                    onChange={() => onSelect(name)}
                    className="peer sr-only"
                  />
                  <label
                    htmlFor={`crosshair-choice-${name}`}
                    title={label}
                    data-selected={selected}
                    onContextMenu={
                      actions
                        ? (event) => {
                            event.preventDefault();
                            setMenu({ name, position: { x: event.clientX, y: event.clientY } });
                          }
                        : undefined
                    }
                    className="crosshair-choice"
                  >
                    <ChoiceArt name={name} pixels={pixelsFor(name)} color={color} />
                    <span className="crosshair-choice-name">{label}</span>
                  </label>
                  {actions ? (
                    <button
                      type="button"
                      aria-label={`More actions for ${label}`}
                      data-testid={`crosshair-actions-${name}`}
                      className="crosshair-choice-more"
                      onClick={(event) => {
                        const bounds = event.currentTarget.getBoundingClientRect();
                        setMenu({ name, position: { x: bounds.left, y: bounds.bottom + 4 } });
                      }}
                    >
                      <DotsThree size={14} weight="bold" />
                    </button>
                  ) : null}
                </div>
              );
            })}
            {group.id === "yours" ? (
              <>
                <ActionChoice
                  testId="crosshair-new-design"
                  icon={<Plus size={20} />}
                  label="New design"
                  onClick={onNewDesign}
                />
                <label
                  className="crosshair-choice crosshair-choice-action"
                  data-testid="crosshair-import"
                >
                  <span className="crosshair-choice-art" aria-hidden="true">
                    <UploadSimple size={20} />
                  </span>
                  <span className="crosshair-choice-name">Import</span>
                  <input
                    data-testid="crosshair-import-file"
                    type="file"
                    accept="image/png,.png,.vtf"
                    aria-label="Import a PNG or VTF crosshair"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) onImport(file);
                    }}
                  />
                </label>
              </>
            ) : null}
          </div>
        </fieldset>
      ))}

      {menu ? (
        <ContextMenu
          label={`${labelFor(menu.name)} actions`}
          position={menu.position}
          onClose={() => setMenu(null)}
        >
          {isDesign(menu.name) ? (
            <>
              <ContextMenuItem
                data-testid="crosshair-menu-edit"
                onSelect={() => {
                  setMenu(null);
                  (isOwn(menu.name) ? onEdit : onDuplicate)(menu.name);
                }}
              >
                <span className="flex items-center gap-2">
                  <PencilSimple size={14} />
                  {isOwn(menu.name) ? "Edit design" : "Customize"}
                </span>
              </ContextMenuItem>
              {isOwn(menu.name) ? (
                <ContextMenuItem
                  onSelect={() => {
                    setMenu(null);
                    onDuplicate(menu.name);
                  }}
                >
                  Duplicate
                </ContextMenuItem>
              ) : null}
              <ContextMenuItem
                onSelect={() => {
                  setMenu(null);
                  onCopyCode(menu.name);
                }}
              >
                Copy share code
              </ContextMenuItem>
            </>
          ) : null}
          {isOwn(menu.name) ? (
            <>
              {isDesign(menu.name) ? <ContextMenuSeparator /> : null}
              <ContextMenuItem
                data-testid="crosshair-menu-remove"
                onSelect={() => {
                  setMenu(null);
                  onRemove(menu.name);
                }}
              >
                Remove from library
              </ContextMenuItem>
            </>
          ) : null}
        </ContextMenu>
      ) : null}
    </div>
  );
}

/** A choice's picture: the sprite, or a symbol for choices with no single one. */
export function ChoiceArt({
  name,
  pixels,
  color,
  size = 64,
}: {
  name: string;
  pixels: PreviewPixels | null;
  color: CrosshairColor;
  size?: number;
}) {
  return (
    <span className="crosshair-choice-art" aria-hidden="true">
      {pixels ? (
        <CrosshairThumb pixels={pixels} color={color} size={size} />
      ) : name === "tf-default" ? (
        <Crosshair size={22} className="text-ink-faint" />
      ) : (
        <span className="text-[10.5px] leading-tight text-ink-faint">Other pack</span>
      )}
    </span>
  );
}

function ActionChoice({
  testId,
  icon,
  label,
  onClick,
}: {
  testId: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className="crosshair-choice crosshair-choice-action"
      onClick={onClick}
    >
      <span className="crosshair-choice-art" aria-hidden="true">
        {icon}
      </span>
      <span className="crosshair-choice-name">{label}</span>
    </button>
  );
}
