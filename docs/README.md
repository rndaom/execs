# execs documentation

Player-facing documentation lives in the [project README](../README.md) and the
[changelog](../CHANGELOG.md). Everything in this folder is for contributors and
maintainers.

## Start here

- [AGENTS.md](../AGENTS.md): the working spec. It records every durable product and
  integrity decision in present tense.
- [CONTRIBUTING.md](../CONTRIBUTING.md): setup, checks and how changes land.
- [RELEASE.md](RELEASE.md): what counts as a public release, versioning and the ship checklist.
- [THIRD_PARTY.md](../THIRD_PARTY.md): runtime sources, licenses and how each one is used.

## Design notes

- [files-workspace-design.md](files-workspace-design.md),
  [files-editor-engine.md](files-editor-engine.md) and
  [files-reference-sources.md](files-reference-sources.md): the Files editor.
- [hud-schema-compatibility.md](hud-schema-compatibility.md): how HUD option schemas are
  pinned and validated.
- [design/2026-09-22-overhaul/](design/2026-09-22-overhaul/README.md): the 0.2.0 visual
  overhaul, its concepts, implementation reviews and qualification evidence.

## Records

These are dated evidence. They describe what was true when written and are kept
unchanged for provenance; AGENTS.md is authoritative when they differ.

- `release-*.md`, `forwardport-0.1.4.md`, `creator-import-0.1.6.md`, `hud-import-0.1.6.md`,
  `hud-paths-0.1.6.md` and `files-native-0.1.7.md`: validation records for past releases.
- [audits/](audits/): release and whole-program audits with their findings and remediation.
- [media/](media/): the app icon, promo animation and screenshots used by the README.
