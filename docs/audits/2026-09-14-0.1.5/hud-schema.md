# HUD schema saves — RND-265 and backend RND-266

Implemented on the public 0.1.4 maintenance baseline for 0.1.5. No live TF2
installation, Steam data or user profile was edited. The regression assets in
`core/fixtures/hud-options/` are first-party synthetic text.

## Result

- Animation `comment` and `uncomment` instructions operate on command-token
  prefixes. Checkbox off reverses the instruction; a selected combo option
  applies it directly, including a choice whose value is `0`. Other commands,
  indentation, inline comments, line endings and unrelated disabled lines stay
  intact. Repeating the same option is byte-idempotent.
- HUD KeyValues uses escape-disabled parsing **and** serialization. A literal
  backslash stays one backslash. Steam library/localconfig callers retain their
  escape-enabled APIs. Unsupported quote/NUL values and malformed resources
  fail before file publication.
- The three reported control shapes also require true/false leaf selection and
  merging inside the existing file-named root header. Those are now applied.
  Unconditional and conditional variants remain distinct; explicit schema OS
  suffixes address their matching variant.
- UTF-8, UTF-8 BOM, UTF-16LE and UTF-16BE are retained. Incomplete UTF-16 code
  units and invalid surrogate sequences are refused. `#base` paths retain their
  literal backslashes, unrelated includes, condition and trailing comment.
- A rejected edit reports the outer control label/id, normalized relative HUD
  path and underlying reason, including a failure inside a nameless combo
  choice. The error does not quote the HUD file's contents. The IPC shape and
  existing profile transaction remain unchanged.

## Primary sources

- [TF2HUD.Editor list options](https://criticalflaw.ca/TF2HUD.Editor/json/options/)
  documents combo-selected animation comment/uncomment lists.
- [TF2HUD.Editor HUD files](https://criticalflaw.ca/TF2HUD.Editor/json/files/)
  documents slash variants, file-named root headers, checkbox true/false values
  and `^` conditional suffixes.
- [TF2HUD.Editor animation format](https://criticalflaw.ca/TF2HUD.Editor/json/animations/)
  distinguishes event command lists from KeyValues resources.
- [Valve KeyValues.cpp, b8cfb12](https://github.com/ValveSoftware/source-sdk-2013/blob/b8cfb12c0e083a2ef5b2f9f9b50f3902fa034474/src/tier1/KeyValues.cpp)
  initializes escape processing to false and chooses the quoted-token
  conversion from that mode. No upstream implementation was copied.

## Real-source check

Downloaded only into `G:/Projects/execs-015-evidence/hud-schema/`:

| Input | Pinned identity |
| --- | --- |
| [FlawHUD schema](https://raw.githubusercontent.com/CriticalFlaw/TF2HUD.Editor/17bccd15d818d12707ce89574318acbc23c85a9f/src/HUDEditor/JSON/flawhud.json) | `17bccd15d818d12707ce89574318acbc23c85a9f` |
| Schema SHA-256 | `18bbc2d67b9a80ea626f53ae3875aebc83748be682b654bb2f4843d2a2d33d1e` |
| [FlawHUD archive](https://codeload.github.com/CriticalFlaw/flawhud/zip/6282582e531ec1ca20b0ab85f9f1511be2f346df) | `6282582e531ec1ca20b0ab85f9f1511be2f346df` |
| Archive SHA-256 | `9d7baf1b29d38d0a3946dcabb99b06652ba8002a3992e5535dbf312fa67d6e0a` |

The [read-only probe](hud-schema-probe.rs) loads the complete 562-file HUD tree,
applies the entire schema with defaults, then repeats full-schema application
for each checkbox state, every combo choice and each number/color default.
All **82 cases** succeed and a second apply produces identical tree/cfg bytes.
Reloading the source tree confirms every input byte is unchanged. Full output
is retained outside the repository in `real-probe-results.json`.

To rerun, create a disposable Cargo binary with `execs-core` as a path
dependency and `serde_json = "1"`, use the probe as `src/main.rs`, and pass the
schema JSON path plus extracted HUD directory. Copy the workspace Cargo.lock
for the same resolved dependency versions. The probe writes only its JSON
result to stdout; it never publishes its in-memory edits.

## Checks

Windows, isolated target `G:/Projects/execs-015-evidence/target-schema`:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --locked`
  passes: 581 unit tests plus 10 integration tests; 3 unrelated installed-asset
  tests remain ignored. Focused additions test
  all three reported shapes, checkbox on/off, all four health choices, all four
  encodings, mixed-case/backslash paths, conditions, includes and idempotence.
- `core/tests/hud_schema_integrity.rs` verifies identical live/library bytes
  and manifest hashes; later malformed/unsupported edits leave all HUD, cfg,
  manifest and library bytes unchanged. Game lock and a blocked live output
  path also leave the saved options unchanged.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -p execs-core --all-targets --locked -- -D warnings`.
- `cargo fmt --all --manifest-path apps/desktop/src-tauri/Cargo.toml --check`.

The first integration fixture used a long temporary root and exceeded the
standalone Rust test executable's Windows staging-path allowance. Shortening
only that disposable test path fixed the fixture; the product's longPathAware
manifest was unchanged. Final checks use the shortened fixture.

## Limits

This is persistence and format verification, not an in-game visual test. The
pinned HUD tree lacks several Box/Text `RunEvent` prefixes referenced by its
pinned schema. Missing line-edit targets remain no-ops. Its default schema also
creates 14 absent target files, following the existing schema file-creation
contract; the fixture tests establish the intended effects where the commands
and panels actually exist. These two upstream revisions are not proof of
complete visual compatibility.

Arbitrary animation-event replacement is unsupported and fails explicitly;
this change implements only the documented comment/uncomment directive shape.
Other pre-existing schema features outside these reported controls have not
been audited for runtime effect. Resource merges retain semantic content and
encoding, while their normal KeyValues formatting can change. Linux execution
and packaged UI/game tests belong to the cumulative release matrix. No sound
or crosshair runtime issue is claimed fixed here.
