# 0.1.7 verification

This record covers a private candidate, not a published release. The complete
scope and remaining gates are in [the release record](../../release-0.1.7.md).

## Implementation and independent review

- [Profile reconciliation](../../release-0.1.7-rnd-247.md) updates accepted mod
  and HUD removals inside the existing transaction; partial counts and bytes,
  Keep/Restore, export/import and switch regressions are exercised.
- [Files native saves](../../files-native-0.1.7.md) bind edits to profile, root,
  loader and live/library bytes. Independent review found and corrected both a
  live-source change between initial validation and transaction preparation,
  and a same-library-byte save that failed to restore reviewed live drift.
- [Language contract](../../../packages/cfglint/LANGUAGE.md) and
  [catalog provenance](../../../packages/cfglint/CATALOG.md) distinguish source
  syntax, save policy, runtime context and analysis coverage. Independent
  probes include nested bind/alias payloads, quoted spans, Unicode, CRLF and
  literal backslashes; imported-content restrictions remain separately tested.

## Local native evidence

Integrated Windows workspace Clippy (`--all-targets --locked -- -D warnings`),
formatting and tests pass for the integrated core tree. The suite passes 789
tests; 16 existing opt-in asset/network cases are excluded from the ordinary
run. The pinned-HUD gate remains separately invoked by CI.

The [public-profile probe](public-profile-compatibility.json) uses the actual
public 0.1.6 exporter and candidate importer, with synthetic filesystem roots.
Its 12 payload files include opaque Advanced Options bytes, nested cfgs,
independent dashed packs, HUD/mod metadata and a shared base VPK. Imports do
not activate a profile or alter the existing active profile, and the re-export
ZIP is byte-identical. The JSON records exact source commits and core trees.

The [frontend baseline](baseline-bundle.json) records the unchanged 0.1.6 UI
before Files integration. It is a bundle measurement, not a startup-time or
memory claim.

## Platform and UI qualification

See [the native qualification record](qualification/README.md). Results there
must distinguish browser fixtures, production-transformed native fixtures,
actual packaged-origin checks and real input/screen-reader observations.
No real player profile or live-game mutation is part of these fixtures.
