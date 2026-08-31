import type { ViewmodelCompileCapability, ViewmodelRecord, ViewmodelSource } from "./bridge";

export const EXECS_VIEWMODELS_PACK = "execs-viewmodels";
export const EXECS_VIEWMODELS_VPK = `tf/custom/${EXECS_VIEWMODELS_PACK}.vpk`;
export const EXECS_PRELOAD_STEM = "execs_preload";
export const EXECS_PRELOAD_OVERRIDES_STEM = "overrides/execs_preload";
export const EXECS_PRELOAD_LAUNCH = `+exec ${EXECS_PRELOAD_STEM}`;
export const SAFE_VIEWMODEL_COMPILE_CAPABILITY: ViewmodelCompileCapability = {
  available: false,
  reason:
    "Compile is unavailable in this release while the first-party, file-safe compiler is rebuilt. Import a prebuilt VPK instead.",
};

export const VIEWMODEL_CASUAL_COPY =
  "Compiled animations need the first-party preload to apply on Valve Casual. Community and listen servers work without it. File-safe FOV and min viewmodels stay on the Gameplay pane.";

export const VIEWMODEL_CLASSES = [
  "scout",
  "soldier",
  "pyro",
  "demoman",
  "heavy",
  "engineer",
  "medic",
  "sniper",
  "spy",
] as const;

export type ViewmodelClass = (typeof VIEWMODEL_CLASSES)[number];

export type KeepVisibleFlags = {
  draw: boolean;
  reload: boolean;
  attack: boolean;
  altAttack: boolean;
  idle: boolean;
  special: boolean;
};

export type StaticFlags = {
  draw: boolean;
  reload: boolean;
  attack: boolean;
  altAttack: boolean;
  idle: boolean;
  moreStaticIdle: boolean;
  special: boolean;
};

export type WeaponSpecificFlags = {
  keepBeamVisible: boolean;
  keepFlamesVisible: boolean;
  keepBackstabDetectionVisible: boolean;
  keepBackstabVisible: boolean;
  instantBackstabDetection: boolean;
  replaceBackstabWithNormalAttack: boolean;
  staticBackstabDetection: boolean;
  staticBackstab: boolean;
  removeShells: boolean;
  keepTracersVisible: boolean;
};

export type ViewmodelWeaponDraft = {
  originX: number;
  originY: number;
  originZ: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  hide: boolean;
  removeLeftArm: boolean;
  keep: KeepVisibleFlags;
  stat: StaticFlags;
  extra: WeaponSpecificFlags;
};

export type ViewmodelDraft = {
  classId: ViewmodelClass;
  preload: boolean;
  weapons: Record<string, ViewmodelWeaponDraft>;
};

export function emptyKeep(): KeepVisibleFlags {
  return {
    draw: false,
    reload: false,
    attack: false,
    idle: false,
    altAttack: false,
    special: false,
  };
}

export function emptyStatic(): StaticFlags {
  return {
    draw: false,
    reload: false,
    attack: false,
    altAttack: false,
    idle: false,
    moreStaticIdle: false,
    special: false,
  };
}

export function emptyExtra(): WeaponSpecificFlags {
  return {
    keepBeamVisible: false,
    keepFlamesVisible: false,
    keepBackstabDetectionVisible: false,
    keepBackstabVisible: false,
    instantBackstabDetection: false,
    replaceBackstabWithNormalAttack: false,
    staticBackstabDetection: false,
    staticBackstab: false,
    removeShells: false,
    keepTracersVisible: false,
  };
}

export function emptyWeaponDraft(): ViewmodelWeaponDraft {
  return {
    originX: 0,
    originY: 0,
    originZ: 0,
    rotateX: 0,
    rotateY: 0,
    rotateZ: 0,
    hide: false,
    removeLeftArm: false,
    keep: emptyKeep(),
    stat: emptyStatic(),
    extra: emptyExtra(),
  };
}

export function emptyViewmodelDraft(): ViewmodelDraft {
  return { classId: "scout", preload: true, weapons: {} };
}

export function seedViewmodelDraft(record: ViewmodelRecord | null | undefined): ViewmodelDraft {
  const draft = emptyViewmodelDraft();
  draft.preload = record?.preload ?? true;
  for (const [key, value] of Object.entries(record?.options ?? {})) {
    draft.weapons[key] = parseWeaponOption(value);
  }
  return draft;
}

export function serializeWeaponOption(draft: ViewmodelWeaponDraft): string {
  return JSON.stringify(draft);
}

export function parseWeaponOption(raw: string): ViewmodelWeaponDraft {
  try {
    const parsed = JSON.parse(raw) as Partial<ViewmodelWeaponDraft>;
    return {
      ...emptyWeaponDraft(),
      ...parsed,
      keep: { ...emptyKeep(), ...parsed.keep },
      stat: { ...emptyStatic(), ...parsed.stat },
      extra: { ...emptyExtra(), ...parsed.extra },
    };
  } catch {
    return emptyWeaponDraft();
  }
}

export function hasPreloadLaunch(options: string): boolean {
  const tokens = options.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === "+exec" && isPreloadStem(tokens[i + 1])) {
      return true;
    }
  }
  return false;
}

export function withPreloadLaunch(options: string, enabled: boolean): string {
  const tokens = options.split(/\s+/).filter(Boolean);
  const filtered: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] === "+exec" && isPreloadStem(tokens[i + 1])) {
      i += 1;
      continue;
    }
    filtered.push(tokens[i]);
  }
  if (enabled) {
    filtered.push("+exec", EXECS_PRELOAD_STEM);
  }
  return filtered.join(" ");
}

function isPreloadStem(value: string | undefined): boolean {
  return value === EXECS_PRELOAD_STEM || value === EXECS_PRELOAD_OVERRIDES_STEM;
}

export function previewViewmodelRecord(source: ViewmodelSource = "compiled"): ViewmodelRecord {
  return {
    id: EXECS_VIEWMODELS_PACK,
    source,
    preload: true,
    options: {},
  };
}

/** First-party itemtest listen preload. Never edits gameinfo.txt. Never stores +quit. */
export function serializePreloadCfg(): string {
  return [
    "// execs viewmodel preload — managed, do not edit by hand",
    "sv_pure 0",
    "map itemtest",
    "wait 5; disconnect",
    "",
  ].join("\n");
}
