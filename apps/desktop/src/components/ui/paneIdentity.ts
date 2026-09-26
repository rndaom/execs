import {
  Backpack,
  Crosshair,
  FolderOpen,
  GameController,
  GearSix,
  Keyboard,
  Monitor,
  Package,
  Play,
  SlidersHorizontal,
  SpeakerHigh,
  UserFocus,
} from "@phosphor-icons/react";
import { type ComponentType, createContext } from "react";
import type { SettingsTab } from "../../lib/settings-ui";

export type WorkspaceTab = SettingsTab | "app";

export type PaneIcon = ComponentType<{
  size?: number;
  weight?: "regular" | "bold" | "duotone" | "fill";
}>;

/** One icon per workspace, shared by the navigation and each pane's heading. */
export const PANE_ICONS: Record<WorkspaceTab, PaneIcon> = {
  comfig: SlidersHorizontal,
  binds: Keyboard,
  gameplay: GameController,
  hud: Monitor,
  crosshair: Crosshair,
  viewmodels: UserFocus,
  sounds: SpeakerHigh,
  mods: Package,
  files: FolderOpen,
  launch: Play,
  inventory: Backpack,
  app: GearSix,
};

/** The workspace a pane renders inside, so its heading can show the same icon. */
export const PaneIdentity = createContext<WorkspaceTab | null>(null);
