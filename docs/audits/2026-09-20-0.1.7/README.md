# 0.1.7 verification

This record covers preparation and the published 0.1.7 release. The complete
scope and qualification limits are in [the release record](../../release-0.1.7.md).
[Public verification](public-verification.json) independently checks anonymous
delivery, signatures and provenance. [Tagged package evidence](tagged/README.md)
records the final release run separately from private candidate qualification.

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

## Integrated frontend evidence

The combined maintenance tree passes Biome, TypeScript, production build and the
full frontend suite (160 cfglint, 634 desktop and 21 release-script tests, with
three Linux-only script cases skipped on Windows). Subsequent mixed-source,
Focus and concise-completion regressions pass their focused suites. CI reruns the
complete final tree on Linux. CodeMirror and the Files pane load on demand.

The September 20 browser pass used only the in-memory preview at 1280×720 and
960×640. It created `practice/session.cfg`, entered `fov_desired banana`, saved
immediately with Ctrl+S, displayed the non-blocking numeric warning at line 1,
column 13, and navigated back to that exact argument. Opening tools scrolls and
focuses their contents. The minimum window keeps editor actions visible and the
source area usable. This pass found and corrected the Focus button retaining
button focus; its regression also protects selection and scroll. It does not
claim native filesystem persistence or screen-reader acceptance.

The final incoming-reference review found and corrected links that reopened the
selected target instead of its caller. At product commit `4e5fb39`, a browser
pass followed autoexec's outgoing link into the managed binds file, then used
`Referenced by` to return to autoexec line 1. The ownership disclosure displays
caller locations and explicitly labels deferred bind/alias candidates. Its
regression retains an unsaved draft and verifies that navigation performs no
save. Biome, TypeScript and the production build pass after this correction.
The native timing runs retain their earlier exact source identities; this
follow-up changes graph labels/navigation, not the editor or worker engine.

The catalog's verified argument diagnostics cover sourced constraints and
runtime flags. It does not claim exhaustive engine key/arity validation where
no verified source exists; the language contract records that boundary.

## Acceptance evidence map

| Scope | Implementation and regression evidence |
| --- | --- |
| RND-247 | `absorb_integrity.rs`; `release-0.1.7-rnd-247.md` |
| RND-313 | `FilesEditor.test.tsx`; `files-workspace-design.md`; native layout captures |
| RND-314–316 | cfglint catalog, authoring, trust, execution and generator tests; `CATALOG.md` and `LANGUAGE.md` |
| RND-317 | `files-drafts.test.ts`, `SettingsHost.files.test.tsx`, `files_workspace_tests.rs`; `files-native-0.1.7.md` |
| RND-318 | `files-analysis.test.ts`; native worker benchmark and packaged-origin probe |
| RND-319 | `files-completion.test.ts`, `files-completion-catalog.test.ts`, native completion input/speech |
| RND-320, RND-322 | `files-reference.test.ts`, `files-ui.test.ts`, shared `lint-options.test.ts`; `files-reference-sources.md` |
| RND-321 | `files-create.test.ts`, source-bound host tests and native vanilla/comfig creation tests |
| RND-323 | Native qualification record, bounded speech limitations, and final signed private candidate run 35491010492 |

This mapping identifies inspectable evidence, not blanket accessibility
certification. The release record links the authoritative package/CI results;
readiness requires those gates to pass and retains the documented speech limits.
