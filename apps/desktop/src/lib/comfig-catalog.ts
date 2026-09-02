import type { ComfigPreset } from "./bridge";

export type ComfigPresetEntry = {
  id: ComfigPreset;
  label: string;
  /** One-line summary shown on the tile. */
  description: string;
  /** Where the preset sits on the performance ↔ fidelity axis. */
  balance: string;
  performance: string;
  fidelity: string;
};

/**
 * The one preset catalog. Both the Comfig pane and the setup wizard render
 * these, so the wizard and the Comfig pane offer one list.
 */
export const COMFIG_PRESETS: ComfigPresetEntry[] = [
  {
    id: "ultra",
    label: "Ultra",
    description: "Maximum fidelity with the highest system requirements.",
    balance: "Fidelity",
    performance: "Lowest",
    fidelity: "Maximum",
  },
  {
    id: "high",
    label: "High",
    description: "High visual quality for modern systems.",
    balance: "Quality",
    performance: "Moderate",
    fidelity: "High",
  },
  {
    id: "medium_high",
    label: "Medium high",
    description: "Sharper visuals without the full performance cost.",
    balance: "Balanced +",
    performance: "Good",
    fidelity: "High",
  },
  {
    id: "medium",
    label: "Medium",
    description: "A balanced mix of visual quality and performance.",
    balance: "Balanced",
    performance: "Great",
    fidelity: "Balanced",
  },
  {
    id: "medium_low",
    label: "Medium low",
    description: "Performance-first settings with readable detail.",
    balance: "Performance +",
    performance: "High",
    fidelity: "Moderate",
  },
  {
    id: "low",
    label: "Low",
    description: "Maximum performance with reduced visual effects.",
    balance: "Performance",
    performance: "Very high",
    fidelity: "Low",
  },
  {
    id: "very_low",
    label: "Very low",
    description: "Minimum visual cost for the highest frame rate.",
    balance: "Maximum FPS",
    performance: "Maximum",
    fidelity: "Minimal",
  },
  {
    id: "none",
    label: "None",
    description: "Skip preset tuning and configure modules yourself.",
    balance: "Manual",
    performance: "Stock",
    fidelity: "Stock",
  },
];

/** Shown by default; the rest sit behind "Show all presets". */
export const FEATURED_PRESETS = new Set<ComfigPreset>(["ultra", "high", "medium", "low"]);

export function comfigPresetById(id: ComfigPreset): ComfigPresetEntry | undefined {
  return COMFIG_PRESETS.find((preset) => preset.id === id);
}

export function comfigPresetLabel(id: ComfigPreset): string {
  return comfigPresetById(id)?.label ?? id;
}

/**
 * A preset outside the featured four keeps the full list open — collapsing it
 * would hide the selection.
 */
export function presetListExpanded(selected: ComfigPreset, showAll: boolean): boolean {
  return showAll || !FEATURED_PRESETS.has(selected);
}

export function visibleComfigPresets(
  selected: ComfigPreset,
  showAll: boolean,
): ComfigPresetEntry[] {
  return presetListExpanded(selected, showAll)
    ? COMFIG_PRESETS
    : COMFIG_PRESETS.filter((preset) => FEATURED_PRESETS.has(preset.id));
}

export type ComfigModule = {
  id: string;
  label: string;
  levels: string[];
};

export type ComfigModuleGroupId = "networking" | "graphics" | "hud" | "sound";

export type ComfigModuleGroup = {
  id: ComfigModuleGroupId;
  label: string;
  modules: ComfigModule[];
};

export const COMFIG_MODULE_GROUPS: ComfigModuleGroup[] = [
  {
    id: "networking",
    label: "Networking",
    modules: [
      { id: "packet_rate", label: "Packet rate", levels: ["congestion", "standard"] },
      {
        id: "snapshot_buffer",
        label: "Snapshot buffer",
        levels: ["auto", "off", "x1", "x2", "custom", "anim"],
      },
      { id: "packet_size", label: "Packet size", levels: ["small", "conservative", "large"] },
      {
        id: "bandwidth",
        label: "Bandwidth",
        levels: [
          "128Kbps",
          "192Kbps",
          "384Kbps",
          "512Kbps",
          "762Kbps",
          "1.0Mbps",
          "1.5Mbps",
          "2.0Mbps",
          "2.5Mbps",
          "3.0Mbps",
          "4.0Mbps",
          "6.0Mbps",
        ],
      },
      {
        id: "download",
        label: "Downloads",
        levels: ["custom", "all", "nosounds", "mapsonly", "nothing"],
      },
    ],
  },
  {
    id: "graphics",
    label: "Graphics",
    modules: [
      { id: "lod", label: "Model quality", levels: ["low", "medium", "high", "ultra"] },
      {
        id: "lighting",
        label: "Lighting",
        levels: ["very_low", "low", "medium", "high", "ultra"],
      },
      { id: "shading", label: "Shading", levels: ["low", "medium", "high"] },
      { id: "phong", label: "Phong shading", levels: ["off", "on", "rim"] },
      { id: "shadows", label: "Shadows", levels: ["off", "low", "medium", "high", "ultra"] },
      { id: "flashlight", label: "Flashlight", levels: ["off", "on"] },
      {
        id: "effects",
        label: "Effects",
        levels: ["very_low", "low", "medium", "high", "ultra"],
      },
      { id: "tracers", label: "Tracer effects", levels: ["low", "medium", "high"] },
      { id: "water", label: "Water", levels: ["very_low", "low", "medium", "high", "ultra"] },
      {
        id: "post_processing",
        label: "Post-processing",
        levels: ["off", "low", "default", "calm", "vivid", "washed", "dreamy"],
      },
      {
        id: "color_filter",
        label: "Color filter",
        levels: ["off", "grayscale", "desaturated", "warm", "cool"],
      },
      { id: "pyrovision", label: "Pyrovision", levels: ["low", "medium", "high"] },
      { id: "romevision", label: "Romevision", levels: ["off", "on"] },
      { id: "motion_blur", label: "Motion blur", levels: ["off", "low", "high"] },
      {
        id: "anti_aliasing",
        label: "Anti-aliasing",
        levels: ["off", "msaa_2x", "msaa_4x", "msaa_8x"],
      },
      {
        id: "characters",
        label: "Characters",
        levels: ["very_low", "low", "medium", "high"],
      },
      { id: "decals", label: "Decals", levels: ["off", "low", "medium", "high", "ultra"] },
      {
        id: "decals_models",
        label: "Model decals",
        levels: ["off", "low", "medium", "high"],
      },
      { id: "decals_art", label: "Map decals", levels: ["off", "on"] },
      { id: "sprays", label: "Sprays", levels: ["off", "on", "keep"] },
      { id: "gibs", label: "Gibs", levels: ["off", "low", "high"] },
      { id: "sillygibs", label: "Silly gibs", levels: ["auto", "off", "on"] },
      { id: "props", label: "Props", levels: ["low", "high", "ultra"] },
      { id: "ragdolls", label: "Ragdolls", levels: ["off", "medium", "high"] },
      { id: "3dsky", label: "3D sky", levels: ["off", "on"] },
      { id: "jigglebones", label: "Jigglebones", levels: ["off", "on", "force_on"] },
      {
        id: "texture_quality",
        label: "Texture quality",
        levels: ["low", "medium", "high", "very_high", "ultra"],
      },
      {
        id: "texture_filter",
        label: "Texture filtering",
        levels: ["blocky", "trilinear", "aniso2x", "aniso4x", "aniso8x", "aniso16x"],
      },
      { id: "ropes", label: "Ropes", levels: ["off", "low", "high", "ultra"] },
      {
        id: "fpscap",
        label: "FPS cap",
        levels: [
          "powersaver",
          "30",
          "60",
          "75",
          "120",
          "144",
          "160",
          "165",
          "180",
          "200",
          "240",
          "300",
          "360",
          "400",
          "1000",
          "unlimited",
        ],
      },
      { id: "vsync", label: "VSync", levels: ["off", "on"] },
    ],
  },
  {
    id: "hud",
    label: "HUD",
    modules: [
      { id: "messages", label: "Messages", levels: ["off", "hide", "on"] },
      { id: "outlines", label: "Outlines", levels: ["off", "low", "medium", "high", "ultra"] },
    ],
  },
  {
    id: "sound",
    label: "Sound",
    modules: [
      { id: "sound", label: "Sound", levels: ["low", "medium", "high", "very_high", "ultra"] },
      { id: "voice", label: "Voice chat", levels: ["off", "hidden", "on"] },
    ],
  },
];

export const COMFIG_MODULES: ComfigModule[] = COMFIG_MODULE_GROUPS.flatMap(
  (group) => group.modules,
);

export function comfigModuleById(id: string): ComfigModule | undefined {
  return COMFIG_MODULES.find((module) => module.id === id);
}
