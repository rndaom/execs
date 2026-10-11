import {
  Backpack,
  Crosshair,
  FolderOpen,
  GameController,
  Gauge,
  Keyboard,
  Monitor,
  Package,
  Play,
  SpeakerHigh,
  UserFocus,
} from "@phosphor-icons/react";
import type { ComponentType } from "react";
import type { SettingsTab } from "../../lib/settings-ui";

export type TabIcon = ComponentType<{ size?: number; weight?: "regular" | "bold" }>;

/** One icon per pane, shared by the sidebar and pane headings. */
export const SETTINGS_TAB_ICONS: Record<SettingsTab, TabIcon> = {
  comfig: Gauge,
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
