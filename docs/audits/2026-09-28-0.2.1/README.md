# 0.2.1 development fixes

This work follows the [September 27 issue list](https://linear.app/rndaom/document/021-issue-list-154e1b4f5037).
It is development work on top of `80ce433d`, not a release. Product versions remain 0.2.0;
no release tag, updater change, installer publication, or release workflow is part of this work.

## Reviewed plan

| Item | Decision | Verification required |
| --- | --- | --- |
| 1. Settings after TF2 closes | Verify the already merged fix in #144: synchronize binds only when the managed file exists, and acknowledge a completed reload. | SettingsHost regression, no unexpected binds write. |
| 2. Mouse 4 and Mouse 5 | Preserve the whole input gesture, including release cancellation. Use a recording-scoped GTK bridge where WebKit does not translate side buttons. | Event sequence tests, native mapping, Windows/Linux compile; physical button behavior remains a separate check. |
| 3. Unbuilt Viewmodels/Crosshair choices | Use the issue's accepted explicit-build alternative. Register every unbuilt choice, retain it through navigation and failures, acknowledge only the exact successful build, and guard destructive transitions. | Locked/failed/in-flight builds, close/profile/launch guards, source refresh, preset Undo, hidden Crosshair draft. |
| 4. Archive choices | Review separate VPK and loose-content candidates before an atomic multi-pack install. Bind a single-use token to the source bytes and profile/install context. | Mixed and peer roots, split sets, readme bounds, source changes, cancel/replay, HUD routing, aggregate limits. |
| 5. RAR | Select a decoder only after checking RAR4/RAR5 solid support, resource limits and license terms. | Normal/solid/encrypted/multi-volume/malformed/oversized fixtures and both native platforms. |
| 6. Casual notes | Describe content restrictions and preload requirements conservatively. Do not label a model/material pack as verified in retail Casual without a real match. | Sound exemptions, hook/particle state, partial scans; retail acceptance remains distinct. |
| 7. Pack conflicts | Bounded read-only scan for duplicate virtual paths, mixed model components and whole sound-script overrides. Report incomplete/ambiguous results. | Loose/VPK sources, order/case ties, model families, malformed packs and global budgets. |
| 8. New particle filenames | Qualify sources before selection; clearly refuse unsupported carrier mappings instead of guessing a destructive merge. Keep Apply validation. | Gory Gibbing-shaped fixture, stock budget/parse failures, removable saved unsupported choices, no live writes. |
| 9. Leftover sound caches | Remove only the exact sibling cache of a VPK actually removed, after transaction commit where applicable. Preserve surviving/drifted packs and links. | Switch, explicit removal, recovery, game lock, links and folder repair. |

Separate agents researched each workstream. A reviewer checked the plans before implementation
and checked the resulting code independently. Changes use existing pane components, theme tokens,
disclosures, dialogs, pending-change indicators and motion conventions.

## Evidence and limits

The unchanged baseline passed `pnpm test` before implementation. Integrated verification:

- `pnpm test`: 1,276 desktop tests and 170 cfg parser tests passed; repository scripts passed
  112 tests with five existing platform-dependent skips.
- `pnpm check`, frontend production build, workspace Clippy with warnings denied, and the
  notices check passed. Notices include all 467 dependencies and the approved UnRAR terms.
- Browser fixture checks at 960×640 and 1200×800 covered existing styling, archive review layout,
  cancellation without an error/success message, confirmed installation, and Viewmodels draft
  retention through navigation with Launch blocked while changes remain pending.
- Windows Rust workspace: 1,079 passed, 33 existing optional/external-fixture tests ignored.
  Parallel compilation first exceeded the local paging-file limit; `-j 1` completed successfully.
  The final split-VPK correction then passed all eight chooser tests, full workspace Clippy
  and `cargo fmt --check`. Hosted Windows/Linux CI is required on the pull request.

Per-workstream evidence: [mouse recording](binds.md), [RAR decoding and licensing](rar.md),
and [Casual/conflict diagnostics](mod-content-audit.md). The chooser tests bind confirmation to
the exact source and current profile revision, reject replay and changed unselected sources,
and verify atomic multi-pack installation and HUD refusal. Builder tests cover failed/in-flight
builds, source refresh, hidden custom Crosshair drafts and exit guards. Particle tests exercise
the actual planner against synthetic stock data, including unsupported filenames and DX8 budgets.
Cache tests cover removal, switch, rollback, committed recovery, inactive profiles and retained packs.

The final review also found and corrected release-event suppression, repeated particle scans,
cancelled GameBanana reviews appearing as failures, and the metadata budget for disabled split VPKs.

## Remaining manual acceptance

Physical Mouse 4/5 presses still require checks in Windows WebView2 and Linux WebKitGTK.
Automated events and native mapping tests do not establish device event ordering. Content notes
remain conservative; no real Casual match was run to qualify individual model/material packs.
RAR's dictionary bound is not a total process-memory cap; its explicit format restrictions are
documented in the decoder report. These are development fixes, not packaged-release acceptance.
All installation and operation tests used fixtures; the owner's TF2, profiles and Steam Cloud
were not modified by verification.
