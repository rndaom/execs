import {
  Backpack,
  Crosshair,
  FolderOpen,
  GameController,
  House,
  Keyboard,
  Monitor,
  Package,
  Play,
  SlidersHorizontal,
  SpeakerHigh,
  UserFocus,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import type { SettingsTab } from "../../lib/settings-ui";

export type TabIcon = ComponentType<{ size?: number; weight?: "regular" | "bold" }>;

/** One icon per pane, shared by the sidebar and the Home profile details. */
export const SETTINGS_TAB_ICONS: Record<SettingsTab, TabIcon> = {
  home: House,
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
};
