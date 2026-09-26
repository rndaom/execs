import {
  Backpack,
  Crosshair,
  FolderOpen,
  GameController,
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

/** One icon per pane, shared by the sidebar and pane headings. */
export const SETTINGS_TAB_ICONS: Record<SettingsTab, TabIcon> = {
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
