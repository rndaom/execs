# 0.1.5 implementation and verification

The release starts from public v0.1.4. Eight parallel workstreams implement the
22 assigned repair issues and linked RND-283. Source fixes and tests are reviewed
again after integration; the 0.2.0 forward-port preserves its existing features.

| Issues | Research, behavior and regression evidence |
| --- | --- |
| RND-239, RND-243, RND-289 | [Independent local HUD loading, schema identity and refresh disclosure](hud-loading.md) |
| RND-265, backend RND-266 | [FlawHUD schema, animation directives and KeyValues](hud-schema.md) |
| RND-266, RND-269, RND-271, RND-272 | [Source-owned errors, completion timers and deferred drafts](feedback.md) |
| RND-268, RND-273 | [Pending-settings launch recovery and native close protection](close-transitions.md) |
| RND-270, RND-279, RND-280, RND-285 | [Picker cancellation and mutation draft preservation](mutation-drafts.md) |
| RND-275, RND-276 | [Literal pack identity, executable cfg layer and nested capture](pack-identity.md) |
| RND-277, RND-278 | [Reserved folder repair, legacy ZIP compatibility and packed credential checks](import-export.md) |
| RND-281, RND-282, RND-283, RND-284 | [Startup execution, total traversal limits, bind removals and FOV](cfg-execution.md) |
| RND-288 | [Payload timeout, exclusive lease recovery and signed retry](updater.md) |

## Integrated browser checks

The real React components and preview API run against isolated fixture data.
These checks do not invoke native IPC or change real profiles.

- Locked Gameplay off → on clears the obsolete notice. Off → on → off then
  Sounds retains the new notice and draft; reopening Gameplay retains the edit.
- The folder-repair preview names the launch blocker. At the app's 960×640
  minimum window size its review fits, Cancel restores focus, and explicit
  repair removes the warning and enables Launch.
- At the app's 1200×800 default size, the HUD fixture preserves installed
  identity, cached catalog/statistics and distinct partial-source warnings.
  Restoring sources and refreshing clears those warnings. A recovered local
  option saves through the real host and displays "HUD options saved".

## Runtime boundaries

The [retail Windows result](retail-pack-names.json) proves fixture mounting and
packed cfg execution with protected original hashes unchanged. It does not
establish every HUD's appearance, a Casual session, or a remote Steam Cloud
round trip. The previous-public-format ZIP fixture exercises unchanged bytes,
repair and export/reimport through production core APIs.

The owner chose Linux CI for package/updater verification and explicitly left
the live Linux Steam URI handoff and native TF2 check outstanding. See the
[release record](../../release-0.1.5.md) for final combined checks, PRs and the
private signed candidate. Publication is separate from preparation.
