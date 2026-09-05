# 0.1.2 release candidate

Prepared September 5, 2026 from public `v0.1.1` (`7b3c0fe`) on
`rndaom/release-0.1.2`, with the release metadata corrections from `c133265`.
The original development checkout and its uncommitted changes are preserved.
Creator ZIP import and profile-scoped preloader metadata remain excluded.

## Scope and Linear reconciliation

The retained September 5 functional audit supplies the issue acceptance criteria.
Live Linear reconciliation is blocked: no Linear connector is available in this
session, and the project page reports a network error after reload. No Linear
issue status was changed or represented as verified live.

| Issue | Candidate behavior |
|---|---|
| RND-209, RND-210 | Files drafts and selection persist per profile/path; Save and switch waits for success and preserves newer edits or failures. |
| RND-235, RND-236, RND-237 | In-flight and deferred autosaves retain the latest edit, survive pane navigation, and retry after unlock. |
| RND-249 | Incoming save acknowledgements advance draft baselines without overwriting newer edits. |
| RND-240, RND-244 | Profile identity and settings publish together after a complete read; unreadable cfgs block writes until recovery. |
| RND-241 | An older launch-options response cannot overwrite newer typing. |
| RND-242 | Managed cfg and autoexec updates use one native transaction, read current bytes under the write gate, and preserve sibling pane commands. |
| RND-250 | Lock subscription failure stays closed despite late boot samples or events. |
| RND-252 | HUD archive/metadata/Dropbox corrections, verified rankings and pagination, unified import entry, obsolete/ambiguous cache invalidation. |

Retaining panes also requires hidden keyboard listeners, modals and sound
auditions to stop; regression tests cover these lifecycle effects. Pending
autosaves pause profile changes until saved or explicitly discarded.

## Validation

- Frontend: 104 cfglint, 329 desktop and 11 release-script tests passed;
  Biome, TypeScript and the Vite production build passed. The existing bundle
  size advisory remains.
- Windows Rust: workspace formatting, locked Clippy across all targets including
  the release probe, and the locked workspace test suite passed.
- Native core fixtures: public 0.1.1 ZIP import and reverse import preserve all
  three synthetic cfg/custom files and launch options; imports stay inactive.
  Exact A-to-empty-to-A switching, Cloud file synchronization, interrupted
  `.execs-part` repair, process-lock refusal and protected-path sentinels passed.
  This external fixture harness has its own resolved lockfile; production
  workspace locked tests were run separately.
- Real budhud archive: pinned revision
  `16f7be2bb4f0dcbe46ec5f444486ab6a6ea4c7e6`, SHA-256
  `d32b6dfafeecf01a3746ffe409e6534f632028b1129728d13429ae04d50b7dad`.
  All 2,150 retained files matched the source ZIP bytes. The 262,352-byte
  textures compressed to 347 bytes exercise the public regression.
- Browser fixture walkthrough: HUD ranking, numbered pages, page jump, search,
  import chooser cancellation, Files draft retention and successful Save and
  switch passed. Gameplay navigation flushed FOV edits; a subsequent sound
  edit preserved FOV. Launch edits saved when leaving the pane.
- Native Windows UI: exact locked build with embedded frontend opened the first-run
  screen, detected TF2 without confirmation, and displayed version 0.1.2.
  Launcher and app returned unpackaged identity code 15700. Candidate closed;
  isolated settings and profiles remained absent.
- Live-source checks: mastercomfig digests, HUD thread resolution, comfig sound
  objects and GameBanana browse/search policies all passed.
- Browser transition check: created a fixture profile, switched to it, observed
  inert settings during progress and editable controls after completion.
  Locked FOV/sound drafts survived navigation while saved cfg bytes stayed unchanged.
- Packaged third-party notices: all 453 dependency packages verified.

## Remaining gates

Cross-platform CI, packaged upgrade/startup verification and the remaining UI
walkthrough are recorded below when completed. No public tag or release is
authorized by preparing this candidate.

The fixture browser does not exercise native IPC, real downloads, speakers or
game rendering. Core fixtures do not establish a Steam Cloud server round trip,
Casual-server acceptance, a real TF2 update, or Linux interactive behavior.
Native save/switch tests cannot safely use an APPDATA override alone because
Steam discovery can still reach the real Cloud folder. User profiles and live
game files were therefore not used for this validation.

## Files exit acceptance follow-up

Live Linear access was restored after the initial candidate. RND-209 explicitly
requires app-close protection; that remaining gap is now implemented in d83a1a2.
App-owned Files drafts are guarded before native close, profile/install changes,
profile creation, saving a new profile and updater installation. Save waits for
successful writes; Cancel retains exact bytes; Discard is explicit. Active writes
prevent closing, and Files editing waits for native close-listener readiness.
A failed close request stays visible and retryable. No schema or write targets change.

Seven real App/preview tests, seven native-listener tests, three native-close
modal tests and four multi-draft transaction tests cover the gap. These include
failed writes, TF2 starting while dirty, blocked cfg commands, delayed saves,
newer edits and subscription failure/cleanup. Biome and TypeScript passed.
The browser walkthrough verified Cancel, Save and Discard across install changes,
including saved-byte checks after reconfirming the fixture install. The native
Windows embedded app started and closed via Alt-F4 with isolated app data and
unpackaged identity 15700; it created no settings or profiles. Native dirty-close
fault injection uses controlled events, not a live TF2 profile. Independent
review found no blocker. A fresh package workflow records final candidate checks;
the earlier 33975206173 result applies only to 297a4c2.
