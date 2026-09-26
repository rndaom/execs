// Native records the UI reads, checked against their TypeScript bridge types.
// The JSON fixtures are written by `execs-core`'s contract tests from fully
// populated Rust records; see `src-tauri/core/src/contracts.rs`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  CrosshairRecord,
  HitsoundEntry,
  HitsoundRecord,
  HudRecord,
  ModRecord,
  ProfileDetail,
  ProfileFile,
  ProfileLibrary,
  ProfileSummary,
  ViewmodelBuildRecipe,
  ViewmodelRecord,
} from "./bridge";
import { createPreviewApi } from "./preview-bridge";

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K;
}[keyof T];

/** Both lists are checked by the compiler against the TypeScript type. */
type Shape<T> = { keys: Record<keyof T, true>; required: Record<RequiredKeys<T>, true> };

function shape<T>(keys: Record<keyof T, true>, required: Record<RequiredKeys<T>, true>): Shape<T> {
  return { keys, required };
}

const PROFILE_FILE = shape<ProfileFile>(
  { path: true, sha256: true, storage: true },
  { path: true, sha256: true, storage: true },
);
const HUD = shape<HudRecord>(
  { id: true, hash: true, source: true, options: true },
  { id: true, source: true, options: true },
);
const CROSSHAIR = shape<CrosshairRecord>(
  {
    id: true,
    sourceChanged: true,
    sourceScriptsSha256: true,
    inactive: true,
    scale: true,
    stock: true,
    shape: true,
    assignments: true,
    color: true,
    library: true,
    design: true,
  },
  { id: true, shape: true, assignments: true },
);
const RECIPE = shape<ViewmodelBuildRecipe>(
  { schema: true, catalog: true, choices: true, sourceFingerprints: true },
  { schema: true, catalog: true, choices: true, sourceFingerprints: true },
);
const VIEWMODEL = shape<ViewmodelRecord>(
  { id: true, sourceChanged: true, source: true, preload: true, options: true, buildRecipe: true },
  { id: true, source: true, preload: true, options: true },
);
const HITSOUND_ENTRY = shape<HitsoundEntry>(
  { name: true, source: true, token: true, hash: true, boost: true },
  { name: true, source: true },
);
const HITSOUND = shape<HitsoundRecord>({ sourceChanged: true, hit: true, kill: true }, {});
const MOD = shape<ModRecord>(
  { id: true, name: true, source: true, pack: true, files: true, bytes: true, installedAt: true },
  { id: true, name: true, source: true, pack: true, files: true, bytes: true, installedAt: true },
);
const DETAIL = shape<ProfileDetail>(
  {
    id: true,
    name: true,
    launchOptions: true,
    layer: true,
    files: true,
    hudRoots: true,
    selectedHudRoot: true,
    hud: true,
    crosshair: true,
    viewmodel: true,
    hitsound: true,
    mods: true,
  },
  { id: true, name: true, launchOptions: true, layer: true, files: true },
);
const SUMMARY = shape<ProfileSummary>(
  { id: true, name: true, createdAt: true, updatedAt: true, unsafeCustomFolders: true },
  { id: true, name: true, createdAt: true, updatedAt: true },
);
const LIBRARY = shape<ProfileLibrary>(
  {
    initialized: true,
    usable: true,
    rootMismatch: true,
    tf2Root: true,
    confirmedRoot: true,
    activeProfileId: true,
    interruptedProfileId: true,
    pendingSwitchProfileId: true,
    profiles: true,
  },
  {
    initialized: true,
    usable: true,
    rootMismatch: true,
    tf2Root: true,
    confirmedRoot: true,
    activeProfileId: true,
    profiles: true,
  },
);

type Json = Record<string, unknown>;

function fixture(name: string): Json {
  return JSON.parse(readFileSync(new URL(`./contracts/${name}.gen.json`, import.meta.url), "utf8"));
}

function expectShape<T>(label: string, value: unknown, { keys, required }: Shape<T>) {
  expect(value, label).toBeTypeOf("object");
  const record = value as Json;
  for (const key of Object.keys(record)) {
    expect(
      Object.hasOwn(keys, key),
      `${label}.${key} is sent by Rust but missing from the TypeScript type`,
    ).toBe(true);
  }
  for (const key of Object.keys(required)) {
    expect(
      Object.hasOwn(record, key),
      `${label}.${key} is required in TypeScript but not sent by Rust`,
    ).toBe(true);
  }
}

/** Every field the preview sends must have the native value's JSON type. */
function expectSameTypes(label: string, native: Json, preview: Json) {
  for (const [key, value] of Object.entries(preview)) {
    const nativeValue = native[key];
    if (value === null || value === undefined || nativeValue === null || nativeValue === undefined)
      continue;
    const kind = (item: unknown) => (Array.isArray(item) ? "array" : typeof item);
    expect(kind(value), `${label}.${key}: preview and native types differ`).toBe(kind(nativeValue));
  }
}

describe("native record contracts", () => {
  it("profile detail and every nested record match their TypeScript types", () => {
    const detail = fixture("profile-detail");
    expectShape("ProfileDetail", detail, DETAIL);
    for (const file of detail.files as Json[]) expectShape("ProfileFile", file, PROFILE_FILE);
    expectShape("HudRecord", detail.hud, HUD);
    expectShape("CrosshairRecord", detail.crosshair, CROSSHAIR);
    expectShape("ViewmodelRecord", detail.viewmodel, VIEWMODEL);
    expectShape("ViewmodelBuildRecipe", (detail.viewmodel as Json).buildRecipe, RECIPE);
    const hitsound = detail.hitsound as Json;
    expectShape("HitsoundRecord", hitsound, HITSOUND);
    expectShape("HitsoundEntry", hitsound.hit, HITSOUND_ENTRY);
    expectShape("HitsoundEntry", hitsound.kill, HITSOUND_ENTRY);
    for (const mod of detail.mods as Json[]) expectShape("ModRecord", mod, MOD);
    // Enumerated values the UI switches on.
    expect(new Set((detail.files as ProfileFile[]).map((file) => file.storage))).toEqual(
      new Set<ProfileFile["storage"]>(["exclusive", "shared"]),
    );
    expect((detail.mods as ModRecord[]).map((mod) => mod.source.kind)).toEqual([
      "gamebanana",
      "local",
      "external",
    ]);
    expect(detail.layer satisfies unknown).toBe("comfig" satisfies ProfileDetail["layer"]);
    expect((detail.hud as HudRecord).source).toBe("hudDb" satisfies HudRecord["source"]);
    expect((detail.viewmodel as ViewmodelRecord).source).toBe(
      "stockBuilt" satisfies ViewmodelRecord["source"],
    );
    expect((hitsound.hit as HitsoundEntry).source).toBe("file" satisfies HitsoundEntry["source"]);
    expect((detail.crosshair as CrosshairRecord).color).toEqual([255, 128, 0]);
  });

  it("the profile library matches its TypeScript type", () => {
    const library = fixture("profile-library");
    expectShape("ProfileLibrary", library, LIBRARY);
    for (const profile of library.profiles as Json[])
      expectShape("ProfileSummary", profile, SUMMARY);
  });

  it("preview fixtures send the same shapes as native", async () => {
    const api = createPreviewApi("settings-sounds");
    const detail = (await api.getActiveProfileDetail()) as unknown as Json;
    expectShape("preview ProfileDetail", detail, DETAIL);
    expectSameTypes("ProfileDetail", fixture("profile-detail"), detail);
    const library = (await api.getProfileLibrary()) as unknown as Json;
    expectShape("preview ProfileLibrary", library, LIBRARY);
    expectSameTypes("ProfileLibrary", fixture("profile-library"), library);
  });
});
