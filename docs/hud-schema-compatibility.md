# HUD schema compatibility

The option schema remains pinned to TF2HUD.Editor commit
`17bccd15d818d12707ce89574318acbc23c85a9f`. Cached and newly downloaded
schemas pass the same validation and adapter before use.

Exact duplicate records are normalized before typed parsing and unique-ID
validation. SHA-256 fingerprints bind each correction to the complete pinned
control data. Unknown or changed duplicates still refuse options.

- rayshud's shared centered class/team key becomes one clearly named control
  editing both resources. Its duplicate health-style control using absent
  FileName variants is removed; the later control editing the loaded
  `resource/ui/hudplayerhealth.res` remains under the original saved key.
- kbnhud's second low-ammo blink color becomes `kbn_low_ammo_blink_2`. Older
  stored values under the shared `_1` key seed both colors until `_2` is saved
  explicitly. Fresh profiles retain the two distinct upstream defaults.
- An audit of all six pinned schemas found no other duplicates in budhud,
  FlawHUD or HypnotizeHUD; m0rehud remains explicitly unavailable as below.

- **HypnotizeHUD (RND-307):** hud-db uses `hypnotizehud`; older records may use
  `hypnotize-hud`. Both resolve the same schema and catalog update. An update
  retains the stored alias so it does not implicitly rename the installed tree.
- **m0rehud (RND-308):** the available schema is for m0rehud Classic. The audited
  catalog revision `4f00092352c34d3317e195db5a5c414b0143a898` lacks the required
  top-level customization assets, and the schema duplicates
  `mh_ammo_uber_style` for unrelated controls. Options are unavailable with
  guidance to the author, including for matched imports. Existing values are
  retained. An update requiring their reapplication refuses before installation;
  it cannot silently claim they were applied. No missing assets or ID migration
  are invented. All schemas reject duplicate top-level control names, while
  combo choices can remain unnamed as upstream specifies.
- **FlawHUD (RND-309):** `WriteFile` is a log-based editor integration, not an
  ordinary HUD-root file write. These controls remain visible with an unavailable
  explanation. Their old values survive saves and updates but are not applied;
  attempts to change them through IPC fail before the transaction. No cfg write
  target is added. This applies to every `WriteFile` control, including options
  nested in choices, rather than only the crosshair toggle.
- **kbnhud (RND-312):** the two size controls copied from crosshair 1 are corrected
  to `CustomCrosshair2` and `HitMarker` in their respective resources. Control IDs
  and saved values remain unchanged. The adapter requires the exact pinned old
  target (or its corrected form), so unexpected upstream edits fail explicitly.

Primary evidence:

- [Editor control contract](https://criticalflaw.ca/TF2HUD.Editor/json/controls/)
- [Pinned kbnhud schema](https://github.com/CriticalFlaw/TF2HUD.Editor/blob/17bccd15d818d12707ce89574318acbc23c85a9f/src/HUDEditor/JSON/kbnhud.json)
- [Pinned m0rehud Classic schema](https://github.com/CriticalFlaw/TF2HUD.Editor/blob/17bccd15d818d12707ce89574318acbc23c85a9f/src/HUDEditor/JSON/m0rehud-classic.json)
- [Audited m0rehud revision](https://github.com/Hypnootize/m0rehud/tree/4f00092352c34d3317e195db5a5c414b0143a898)

The unit regressions check identity rejection, alias resolution, exact corrected
targets, repeat adaptation, unavailable presentation metadata, unchanged resource
bytes, preserved saved values and rejected unsupported edits.

## 2026-09-23 schema audit

The HUD Editor's `Crosshair`/`CustomCrosshair` type now appears as a HUD overlay
glyph selector. Its allowed glyphs follow the pinned editor picker; the selected
value is written through the schema's `Files` target. It is separate from TF2's
engine crosshair and the plain glyph label is not a rendering preview. A
selected HUD can draw an additional mark, depending on its own enable control
and the files the game actually mounts.

`Special`, `SpecialParameters`, `Pulse`, `Shadow`, `WriteFile` and unknown
operation fields are visibly unavailable. Their saved values are retained and
IPC refuses edits to them. This closes rayshud's silent `rh_val_main_menu_bg`
background choice; its special background operation is not synthesized.

The pinned e.v.e Plus schema and catalog archive passed the full file-operation
probe with 52 alternate values, no refused apply, no unchanged alternate, and
idempotent reapply. Its custom image background remains visibly unavailable
because execs does not implement that editor conversion. e.v.e Plus now has
in-app options for the supported controls. The archive revision is
`2ca73c1227276fa0f6234b0ead9ec4b92ce30d09`, downloaded by immutable
`legacy.zip` URL and checked against SHA-256
`3bc50bda8d20ba3ea5d3db16bcf8d9f87ea9a23f9057c0499113af136109baec`.
The schema remains pinned to Editor commit
`17bccd15d818d12707ce89574318acbc23c85a9f` (file SHA-256
`8e2e37b9719ff6cd10da02f82aee97cebe22114d63cbcaf8c56c6308a58287e8`).
The opt-in probe is `hud_catalog_options::omitted_catalog_schema_file_operation_triage`.

Four overlapping catalog schemas remain unavailable with an ID-specific
explanation: BerryHUD's archive has multiple HUD roots; HExHUD and Community
HUD Fixes target absent animation files; SunsetHUD has an unresolved
`$hh_val_xhair_outline` reference. These findings are from pinned catalog
revisions and do not claim how a retail TF2 installation renders any option.

## Integrated Windows verification

The official Rust 1.96.0 toolchain, installed alongside the compiler initially
refused by Windows Application Control, runs without changing security policy.
The full workspace suite passes 769 tests, with 16 opt-in tests explicitly
ignored by the normal run; workspace Clippy passes with warnings denied.

Separate opt-in checks against actual pinned HUD fixtures pass all four option
tests and the font test, including full application of distinct sizes. The
three-package archive install/update probe also passes. These checks supplement
the synthetic regressions; they do not make m0rehud Classic or log-based
`WriteFile` controls supported, and they do not constitute an in-game rendering
check. Public v0.1.5 exporter compatibility also passes, preserving HUD metadata
and all profile payload bytes through import, re-export and re-import.

The signed candidate workflow
[35353749221](https://github.com/rndaom/execs/actions/runs/35353749221)
passed Windows/Linux validation, package builds and installer/updater checks;
publication was skipped. Subsequent [Windows TF2 visual acceptance](audits/2026-09-18-0.1.6/native-hud.md)
passes all six HypnotizeHUD comparisons and independent kbnhud sizes/outlines,
including a hitmarker triggered by actual damage. Those scoped retail checks do
not claim Linux gameplay or universal HUD compatibility. See the
[0.1.6 release record](release-0.1.6.md) for final publication provenance.
