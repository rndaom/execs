# Combined release scope — research for the visual overhaul

Historical research snapshot before planning consolidation. The seven 0.1.9 issues have since moved into 0.2.0; see the [current combined plan](../combined-release-plan.md) and [verified consolidation](../combined-release-consolidation.json). The optional candidate pool remains unchanged.

Read-only research completed September 22, 2026. Sources were the current local repository, GitHub API/public release pages, and the connected Linear project and all 171 project issues (one complete page). This report changes no product code, issue, milestone, branch, tag or release.

## Recommendation

Use **0.2.0** for the combined release: inherit the published 0.1.8 baseline, absorb the remaining 0.1.9 work, complete the selected 0.2.0 behavior, and add the owner-requested whole-application redesign. Skip a ceremonial 0.1.9 release. The [release playbook](../../../RELEASE.md) and [Linear project](https://linear.app/rndaom/project/execs-a89f9a30e95c) already allow combining/skipping provisional patch checkpoints; all four local product files already say 0.2.0.

The owner’s September 22 request explicitly broadens the release to include the overhaul. Record that decision when updating planning; the former “three features or one large feature” budget cannot silently exclude the overhaul the owner requested. At the same time, **combining release plans does not select every optional idea stored in the 0.2.0 candidate pool**. The appropriate starting scope is 14 existing selected repair/feature/gate records, plus the overhaul, with the 25 candidates kept visibly separate until chosen.

October 1, 2026 is the existing provisional minor target, not evidence that an all-app redesign and all qualification can fit. Replan around a chosen direction and tested implementation without promising that old date.

## Verified baseline and important drift

| Surface | Observed state | Planning implication |
| --- | --- | --- |
| [Public latest](https://github.com/rndaom/execs/releases/tag/v0.1.8) | v0.1.8; published 2026-09-21 02:26:18 UTC; stable, not draft/prerelease; tag commit `85aaf6bc0dd28f43351d4cb5cdb62502737688d5`. | 0.1.8 is the current player experience and previous-public baseline for the next updater/profile compatibility check. |
| [PR #59](https://github.com/rndaom/execs/pull/59) | Merged into `rndaom/release-0.1` at 2026-09-21 01:57:12 UTC. | Mods discovery/removal changes are already shipped, not future redesign ideas. |
| Remote main | GitHub API returns `0c5aa21e9b16e3bd3c05c1bb4d9d7e9acddfc7be`, last merge [PR #58](https://github.com/rndaom/execs/pull/58). | Main has the Files Hotfix 2 forward-port but not the 0.1.8 Mods forward-port. |
| Current workspace | `rndaom/inventory-manager` at `9ac45a3847b65da087661b1c08cf719fc6b9df11`. | It adds Inventory prototypes atop main. Its Mods screenshots alone would miss the shipped redesign. |
| Existing 0.1.8 forward-port | Local `rndaom/forwardport-0.1.8` at `d5d65e347fe05394d98a41c8db3027c8207bd480`; no corresponding GitHub PR found in the current list. | Integrate and qualify this work for profile-owned preloaders before the combined release; visual audit can inspect it separately now. |
| Local release documentation | `docs/RELEASE.md:6` still calls 0.1.7+2 latest; local changelog has no 0.1.8 or 0.1.7+2 heading, and carries shipped Files hotfix notes under Unreleased. | Reconcile historical notes during release preparation. Do not use this branch’s prose to infer public status. |
| Inventory | `AGENTS.md:24` explicitly says development-only, hidden/refused in release builds, future minor work not assigned to 0.2.0. | Include its development UI in a complete visual audit, but label it as such. Do not imply shipping Inventory is already selected. |

The public release and current Linear project summary agree on 0.1.8. Older embedded project/issue descriptions still mention 0.1.4, 0.1.5 or 0.1.6 baselines. They are historical evidence, not current version facts.

## The actual remaining 0.1.9 scope

The milestone description lists six themes, but its **live membership has seven issues** because RND-325 was added later. Status is one In Progress, one Todo and five Backlog; none are Done.

| Issue | Live status | Work to carry into the combined release |
| --- | --- | --- |
| [RND-246](https://linear.app/rndaom/issue/RND-246/clear-stale-update-offers-when-a-later-check-reports-no-update) | Backlog | Clear obsolete update offers after an authoritative no-update result; prevent older concurrent checks restoring stale offers. |
| [RND-290](https://linear.app/rndaom/issue/RND-290/show-an-actionable-startup-error-when-durable-maintenance-preflight) | Backlog | Show an actionable native startup error when durable maintenance preflight fails; retain recovery state and the fail-closed write guard. |
| [RND-291](https://linear.app/rndaom/issue/RND-291/keep-each-settings-pane-at-a-predictable-scroll-position) | Backlog | Give first visits a predictable top position; restore/reset per-pane scroll consistently and keep active navigation visible at minimum size. |
| [RND-292](https://linear.app/rndaom/issue/RND-292/make-meaningful-helper-and-status-text-meet-minimum-contrast) | Backlog | Make meaningful small helper, error and status text meet 4.5:1 against its actual background. |
| [RND-294](https://linear.app/rndaom/issue/RND-294/correct-installer-platform-and-casual-compatibility-claims-in-player) | Backlog | Correct installer, Windows/Linux viewmodel capability, cfg surface and Casual compatibility documentation; refresh public media. |
| [RND-325](https://linear.app/rndaom/issue/RND-325/audit-execs-windows-polling-for-periodic-tf2-frame-stalls) | Todo | Measure possible companion polling contribution to TF2 frame stalls; do not infer causation from timing correlation. |
| [RND-251](https://linear.app/rndaom/issue/RND-251/run-the-cumulative-windows-and-linux-functional-release-matrix-before) | In Progress | Complete final-candidate Windows/Linux, installer/updater, profile, Steam Cloud, real-game and Casual/preloader validation. A browser audit is only one evidence layer. |

This work has direct design consequences. Navigation/scroll and legible helper text should be solved by the new system. Startup errors, stale update offers, progress, failure, retry and reduced-motion settings need explicit designs rather than only attractive resting screens. RND-325 makes restrained rendering and measurement while TF2 is active especially relevant; its current evidence does **not** establish execs as the cause of the frame-stall problem.

## The actual selected 0.2.0 scope

Live membership contains **32 issues: seven without the candidate label and 25 with it**. All seven selected records are unfinished: three Todo and four Backlog.

| Issue | Live status | Selected behavior or gate |
| --- | --- | --- |
| [RND-213](https://linear.app/rndaom/issue/RND-213/delete-profiles-safely-from-the-profile-menu) | Backlog | Add safe profile deletion, with explicit active/last-profile choices, export opportunity, write-lock refusal and recoverable ordering. |
| [RND-214](https://linear.app/rndaom/issue/RND-214/add-app-settings-for-updates-motion-install-location-and-support) | Backlog | Add global app settings: startup update check, Follow system/Reduce motion, confirmed install change, diagnostics/support/credits. Global preferences stay out of profile exports. |
| [RND-202](https://linear.app/rndaom/issue/RND-202/replace-shared-preloader-selections-with-the-target-profile-during) | Todo | Finish command-level profile-owned preloader switching, migration, cleanup and rollback. Substantial core code is merged, but this issue was reopened for incomplete integration. |
| [RND-274](https://linear.app/rndaom/issue/RND-274/switch-local-only-particle-profiles-without-requiring-the-default-mod) | Backlog | Let profiles containing only local particle sources switch without the default-library download; preserve strict validation when library content is selected. |
| [RND-215](https://linear.app/rndaom/issue/RND-215/enforce-one-hud-per-profile-across-replacement-import-switch-and) | Backlog | Enforce one managed/mounted HUD through install, import, Mods import, switch and absorb, with safe review of legacy/multiple HUDs. |
| [RND-324](https://linear.app/rndaom/issue/RND-324/make-the-execs-tf2-preload-hook-startup-safe) | Todo | Make the preload startup hook idempotent and explicit, with clear failures and no avoidable startup side effects. Acceptance needs engine validation. |
| [RND-208](https://linear.app/rndaom/issue/RND-208/validate-and-publish-020-after-the-functional-fixes-and-profile) | Todo | Qualify and publish the final minor candidate after selected features, maintenance fixes and compatibility gates. The current design request does not publish anything. |

Creator ZIP review/import [RND-201](https://linear.app/rndaom/issue/RND-201/import-creator-cfgcustom-zips-with-a-themed-trust-review-and-real) is Done and shipped in 0.1.6. Files workspace [RND-228](https://linear.app/rndaom/issue/RND-228/rebuild-files-as-a-profile-aware-tf2-config-workspace-for-017) is Done and shipped in 0.1.7 with subsequent hotfix usability changes. These are inherited features to redesign and preserve, not additional unimplemented feature commitments.

Selected particle-source removal [RND-248](https://linear.app/rndaom/issue/RND-248/prevent-removing-particle-source-mods-while-their-preloader-selections) is Done for the shipped 0.1.8 maintenance/global-preloader model. The profile-owned minor integration is still incomplete under RND-202; “Done” on the maintenance issue does not prove that different architecture is qualified.

## Optional 0.2.0 pool — not selected by milestone membership

These 25 records carry `execs-candidate`. Preserve that distinction in any merged milestone. The combined release is not automatically a commitment to implement all of them. Some overlap naturally with visual reorganization, but they add behavior beyond reskinning existing controls.

| Issue | Candidate | Live status |
| --- | --- | --- |
| [RND-191](https://linear.app/rndaom/issue/RND-191/windows-code-signing-authenticode-for-the-installer-and-updater) | Windows code signing (Authenticode) for the installer and updater | Todo |
| [RND-204](https://linear.app/rndaom/issue/RND-204/trim-redundant-comments-across-panes-shared-ui-hooks-and-rust-commands) | Trim redundant comments across panes, shared UI, hooks, and Rust commands | In Progress |
| [RND-217](https://linear.app/rndaom/issue/RND-217/expand-binds-with-combat-weapon-communication-and-menu-actions) | Expand Binds with combat, weapon, communication and menu actions | Backlog |
| [RND-218](https://linear.app/rndaom/issue/RND-218/review-bind-conflicts-and-provide-explicit-clear-and-secondary-key) | Review bind conflicts and provide explicit clear and secondary-key actions | Backlog |
| [RND-219](https://linear.app/rndaom/issue/RND-219/add-precise-mouse-and-zoom-sensitivity-controls-to-gameplay) | Add precise mouse and zoom sensitivity controls to Gameplay | Backlog |
| [RND-220](https://linear.app/rndaom/issue/RND-220/add-a-curated-gameplay-section-for-reload-healing-and-damage-feedback) | Add a curated Gameplay section for reload, healing and damage feedback | Backlog |
| [RND-221](https://linear.app/rndaom/issue/RND-221/add-a-safe-uninstall-and-leave-tf2-as-is-flow-in-app-settings) | Add a safe uninstall and leave-TF2-as-is flow in app settings | Backlog |
| [RND-222](https://linear.app/rndaom/issue/RND-222/rename-profiles-without-rebuilding-or-copying-their-contents) | Rename profiles without rebuilding or copying their contents | Backlog |
| [RND-223](https://linear.app/rndaom/issue/RND-223/duplicate-any-saved-profile-without-switching-it-into-the-game) | Duplicate any saved profile without switching it into the game | Backlog |
| [RND-225](https://linear.app/rndaom/issue/RND-225/bring-visibility-fov-and-transparent-viewmodels-together-in-viewmodels) | Bring visibility, FOV and transparent viewmodels together in Viewmodels | Backlog |
| [RND-226](https://linear.app/rndaom/issue/RND-226/add-whole-profile-viewmodel-visibility-presets-with-an-exact-change) | Add whole-profile viewmodel visibility presets with an exact change review | Backlog |
| [RND-227](https://linear.app/rndaom/issue/RND-227/simplify-sounds-browsing-around-the-selected-hit-or-kill-sound) | Simplify Sounds browsing around the selected hit or kill sound | Backlog |
| [RND-229](https://linear.app/rndaom/issue/RND-229/show-which-particle-mod-wins-each-conflicting-file-before-apply) | Show which particle mod wins each conflicting file before Apply | Backlog |
| [RND-230](https://linear.app/rndaom/issue/RND-230/add-return-to-stock-hud-without-changing-the-rest-of-the-profile) | Add Return to stock HUD without changing the rest of the profile | Backlog |
| [RND-231](https://linear.app/rndaom/issue/RND-231/show-whether-profile-launch-options-are-copied-pending-or-saved-to) | Show whether profile launch options are copied, pending or saved to Steam | Backlog |
| [RND-232](https://linear.app/rndaom/issue/RND-232/show-local-storage-usage-and-safely-clear-rebuildable-caches-in) | Show local storage usage and safely clear rebuildable caches in Settings | Backlog |
| [RND-267](https://linear.app/rndaom/issue/RND-267/let-linux-users-build-custom-per-class-viewmodel-setups-inside-execs) | Let Linux users build custom per-class viewmodel setups inside execs | Backlog |
| [RND-295](https://linear.app/rndaom/issue/RND-295/preview-profile-differences-before-switching) | Preview profile differences before switching | Backlog |
| [RND-296](https://linear.app/rndaom/issue/RND-296/show-local-installation-health-and-offline-readiness) | Show local installation health and offline readiness | Backlog |
| [RND-297](https://linear.app/rndaom/issue/RND-297/add-bounded-local-profile-restore-points-with-a-change-review) | Add bounded local profile restore points with a change review | Backlog |
| [RND-298](https://linear.app/rndaom/issue/RND-298/review-gamebanana-file-variants-before-choosing-a-download) | Review GameBanana file variants before choosing a download | Backlog |
| [RND-299](https://linear.app/rndaom/issue/RND-299/explain-the-cfg-source-and-class-context-of-a-setting) | Explain the cfg source and class context of a setting | Backlog |
| [RND-300](https://linear.app/rndaom/issue/RND-300/extract-settings-loading-and-mutation-coordination-from-settingshost) | Extract settings loading and mutation coordination from SettingsHost | Backlog |
| [RND-301](https://linear.app/rndaom/issue/RND-301/keep-serialized-rust-records-and-typescript-bridge-types-in-sync) | Keep serialized Rust records and TypeScript bridge types in sync | Backlog |
| [RND-302](https://linear.app/rndaom/issue/RND-302/remove-or-restrict-unused-whole-backup-gameinfo-restoration-helpers) | Remove or restrict unused whole-backup gameinfo restoration helpers | Backlog |

Good candidates for **design exploration** include Sounds browsing (RND-227), a clearer viewmodel home (RND-225) and launch-option status (RND-231). That is not an implementation assignment. GameBanana variant choice, restore points, expanded bindings, sensitivity, Linux compilation and uninstall need separate functional design and validation if selected. Avoid showing them as real shipped controls in a fidelity comparison without a clear concept label.

## Shipped 0.1.8 visual surface missing from this branch

The [0.1.8 source/evidence record](https://github.com/rndaom/execs/blob/v0.1.8/docs/audits/2026-09-20-0.1.8-mods/README.md) and a source-tree comparison show the main visible delta is Mods:

1. Mods opens on **Browse**, with separate **Browse / Installed / Casual setup** tasks. Installed includes a count; switching tasks retains their state.
2. A compact status summary and recovery warnings remain visible without putting the entire Casual setup first.
3. GameBanana browsing exposes search, server sort, maturity, reset and refresh together, truthful result scope, and pagination above and below results.
4. Cards identify GameBanana, author/category/date and available metrics; distinguish added/updated time; keep absent metrics unknown; expose named View/Install actions, progress and retry.
5. Installed mods have specific Remove/source actions and a single **Import mod** dialog offering archive/VPK or extracted-folder paths.
6. Casual setup groups preload behavior, default library, profile particle sources, skipped files, credits and stock restoration. Apply appears for a real draft.
7. Search/paging/refresh have distinct state and focus behavior; failed or hidden category reads recover without stale results taking over.

The source changes are `ModsPane.tsx`, `GameBananaBrowser.tsx`, `ModList.tsx`, new `GameBananaCard.tsx`/`GameBananaPagination.tsx` and their browser hook/helpers. Bridge/preview/host changes support the same UI.

### Minimal safe capture route

The existing clean worktree at `C:/Users/Random/.codex/worktrees/release-0-1-8/execs` is at `215307f4c9e120f70de93660b19278e5b6f9bf0e`. It has **zero diff from v0.1.8 across apps/desktop/src**, verified using `git diff --stat v0.1.8 rndaom/release-0.1.8 -- apps/desktop/src`. Serve its browser fixture on a separate port and visit `?preview=settings-mods`. No checkout or branch changes are needed.

The existing forward-port worktree at `C:/Users/Random/.codex/worktrees/forwardport-0-1-8/execs` has the same runtime frontend as v0.1.8; only a test file differs in the frontend tree. It is suitable for an explicitly labeled minor-track comparison. Do not merge it merely to obtain screenshots.

Capture all three tasks, browser filters/paging, install feedback and the Import mod dialog. Keep current development Inventory screenshots distinct. Browser fixtures establish appearance and interaction hierarchy; they do not certify native installation, Steam Cloud, screen-reader behavior or real-game rendering.

## Dependencies and risk for the overhaul

| Workstream | Dependency / risk | Design and implementation response |
| --- | --- | --- |
| New shell and navigation | RND-291; retained drafts; first-run and minimum 960×640 support. | Decide per-pane scroll behavior, visible current context, keyboard routes and compact layouts together. Preserve session drafts across navigation. |
| New tokens, typography and motion | RND-292 and RND-214; existing Inter/token/motion contract; frame-stall investigation RND-325. | Make tokens, contrast and focus measurable. Include Follow system/Reduce motion and reduced-motion equivalents. Measure native rendering; do not let motion obscure saving or locks. |
| Profiles | RND-213; imported-profile trust; exact replacement; preloader RND-202/RND-274. | Design deletion and switching as explicit operations with real consequences, failure/recovery and active/last-profile states. |
| HUD | RND-215 spans HUD, Mods import, profile import, switch and absorb. | A prettier catalog alone does not fix ownership. Show chosen HUD, reviewed replacement/legacy handling and preserved originals consistently. |
| Mods | 0.1.8 source drift plus unfinished minor preloader integration. | Base design on shipped Browse/Installed/Casual separation and complete forward-port integrity work before release. |
| Updates and startup | RND-246 and RND-290. | Design offer/no-update/download/failure/retry and native pre-window failure states. Visible progress must remain truthful. |
| Release qualification | RND-251 feeds RND-208. | Run candidate-specific native Windows/Linux, keyboard/accessibility, updater/profile compatibility and documented live coverage after implementation. Screenshots and generated concepts do not satisfy these gates. |
| Inventory | Development-only; Steam-account ownership differs from profile ownership. | Audit and concept-label the pane. Keep account context distinct from profile settings, and avoid implying live rearrangement or 0.2.0 shipment. |
| Optional feature creep | 25 candidates share the same milestone. | Choose explicitly. A concept can reserve space without promising new functionality. |

## Suggested release-plan rewrite for the parent task

This is a proposal, not an external edit performed by this research task:

- Consolidate remaining 0.1.9 work under **0.2.0 — application overhaul and profile management**; leave a short 0.1.9 note that it is absorbed, rather than creating a tag.
- Preserve the 14 selected existing records above and add an overhaul epic covering evidence capture, three complete visual directions, owner choice, system tokens/motion, pane implementation and native qualification.
- Keep the 25 candidates separately labeled and visible; choose additions only after the release scope and chosen design are concrete.
- Add the missing 0.1.8 forward-port/profile-preloader integration as an explicit dependency.
- Replace stale public-baseline statements with 0.1.8; correct the selected-feature history so creator import and Files are inherited, not still pending.
- Keep the original October 1 date provisional or unset it while estimating the selected direction. Do not claim milestone completion percentage measures release readiness.
- Preserve additive profile compatibility, write targets, locking/recovery, updater URL/key and both supported platforms through the redesign.
- Defer release publication actions until an implementation candidate exists and the owner authorizes shipping. This current request authorizes audit and design exploration.

## Evidence and limits

[Machine-readable scope snapshot](release-scope-evidence.json) preserves milestone text, 39 live issue memberships/statuses/labels/URLs, and the verified source refs. Important primary sources are the [Linear project](https://linear.app/rndaom/project/execs-a89f9a30e95c), linked issues above, [0.1.8 public release](https://github.com/rndaom/execs/releases/tag/v0.1.8), [PR #59](https://github.com/rndaom/execs/pull/59), [PR #58](https://github.com/rndaom/execs/pull/58), local `AGENTS.md`, `CHANGELOG.md` and `docs/RELEASE.md`.

This is planning/source research, not a fresh functional defect reproduction. It retains the recorded distinction between public, implemented-but-incomplete, and candidate work. No tests, packages, signature re-verification, gameplay changes, issue mutations, PR creation, branch changes or publication were performed. Repo hooks were initialized to `.githooks`; no Cursor co-author hook was found in the local Git hook paths and no commit was created.
