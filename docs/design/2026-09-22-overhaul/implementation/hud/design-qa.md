# Foundry HUD implementation and verification

22 September 2026. Scope: the HUD workspace and RND-215 ownership boundaries. These are implementation checks against the selected Foundry concept, not a public release or completion of the native qualification matrix.

## Visual result

The HUD opens on Browse, with six genuine author previews per page, an explicit source, search, the four supported sorts, and numbered navigation plus page jumps at both ends. Installed gives the current HUD a clear identity and places its schema controls beside an author preview at the normal window size. The controls retain their saved profile/HUD identity and autosave behavior. An author screenshot is labeled as such; it does not claim to render the selected options.

The shared Foundry palette, Inter type, Phosphor icons, compact header, underline tabs, hairlines and restrained surfaces follow the selected direction. The image-generated concepts are references only; none of that generated art ships as HUD previews.

| Evidence | Verified state |
| --- | --- |
| `09-catalog-final.png` | Six useful catalog previews and the complete browsing toolbar at 1280 × 720. |
| `10-details-final.png` | HUD details, genuine preview, author/source metadata and explicit installation action. |
| `11-catalog-page-jump.png` | Page jump and last page, showing the real 13–14 of 14 fixture count. |
| `12-screenshot-viewer.png` | Screenshot viewer; ArrowRight advances and Escape closes with focus restored. |
| `13-import-dialog.png` | One Import HUD entry offers an archive or an extracted folder and discloses replacement. |
| `07-replacement-review.png` | Catalog replacement names the old/new HUD and initially focuses Keep current. |
| `08-ranking-coverage.png` | Metric coverage, missing values and source state remain explicit. |
| `06-options-saved.png` | Option edit reaches the saved fixture state. |
| `14-minimum-window-catalog.png` | Actual 960 × 640 minimum window; catalog becomes two columns without clipping the toolbar or pagination. |
| `16-installed-final.png` | Final Installed identity, options and author image at 1280 × 720. |
| `17-minimum-installed-top.png` | Final Installed at 960 × 640; controls use the available width and the preview moves below them. |

Images 01–05 record density iterations; 15 records a minimum-size scrolled state. Use 09–14 and 16–17 for the final visual result. Browser evidence uses explicitly labeled fixture data. A fresh reload, catalog installation and viewport pass produced no new browser warnings or errors. Temporary viewport overrides were reset. This pass did not operate on a player profile or TF2 files.

The shared ownership dialog and profile import review have separate evidence in `../app-settings/design-qa.md` and `../profile-management/verification.md`. Their exact-source choice and managed-option reset notices complement the HUD workspace.

## Ownership behavior

- Valid UI version 3 metadata establishes a HUD root. An ordinary mod's `info.vdf` does not establish HUD ownership. Additive manifest fields retain validated roots, the selected exact folder and any pending explicit review. Older manifests and interrupted mutation journals remain readable; journal recovery uses the original on-disk representation before hydration.
- Replacement, same-HUD updates and an explicit ownership choice preserve exact library originals in excluded recovery copies before publication. Active live HUD trees, including unknown handwritten files, move under the existing excluded backup container. Only the selected HUD is projected; inactive saved originals are neither treated as deleted nor silently adopted during later absorb/switch.
- Ownership review binds the exact profile, folder, manifest and candidate payload hashes. Read failures, portable case collisions, changed fingerprints and the running-game guard refuse the action. A second fingerprint check occurs after transaction staging. Inspection is bounded cumulatively while candidate trees are loaded.
- Replacing a HUD checks every affected live managed option cfg and autoexec against the saved profile before backup and again before commit. A changed, missing or untracked live destination is refused instead of overwriting handwritten data. Successful explicit option reset preserves the saved original cfg bytes in recovery copies.
- A generic Mods import that contains a genuine HUD returns actionable HUD-import guidance before any selected files are installed. Genuine HUD VPKs are explicitly unsupported by the current HUD importer: they must be extracted and imported as a folder. The bounded parser detects real UI3 metadata; ordinary mod VPKs and legacy opaque non-Source files retain their existing behavior. A historical HUD VPK remains readable/exportable but cannot be newly activated through switch.
- Creator/native profile ZIPs with several HUD roots require one explicit choice. Import preserves every approved payload byte and the source archive. Unselected originals stay in the inactive profile/export. If a different choice would combine the new HUD with old generated option cfgs, import leaves the profile inactive with a pending HUD review; activation is refused until the separate explicit selection/reset action completes.
- Switch and absorb share the ownership checks. Outgoing live ambiguity routes to the current profile, while target ambiguity routes to the target. Accepted removal clears explicit legacy HUD records too. If another preserved original remains, it requires a new choice instead of silently becoming selected.

## Verification

| Check | Result |
| --- | --- |
| Full Windows core crate, locked, including integration suites | 738 passed, 0 failed, 12 ignored: 709 unit tests and 29 integration tests. |
| Core Clippy, all targets, `-D warnings` | Passed. |
| Seven HUD frontend suites | 69 passed: pane interactions and logic, reload state, SettingsHost reads, ownership hook and dialog. |
| Required pinned HUD verification script on Windows | 6 passed, 0 failed: four schema option tests, one font-template test and one full catalog installation/update test. |
| Scoped Biome for `HudPane.tsx` and its new interaction suite | Passed without fixes. |
| Disposable browser preview | Catalog, details, paging, screenshot viewer, import/replacement review, installed options, focus and minimum window checked. |

Run transcripts are `core-tests-windows.txt`, `core-clippy-windows.txt` and `frontend-tests.txt` in this directory. The unit run includes 11 new Windows ownership cases, three profile ZIP cases, old-journal recovery and the legacy HUD ModRecord removal regression. The absorb integration test now covers valid HUD metadata and old opaque metadata across Update, Keep and Restore. Existing transaction, schema, source identity, dashed/case paths, write-lock and viewmodel tests passed in the same run.

The default run's 12 ignores require pinned/downloaded HUD/schema/PCF/comfig/creator corpora or explicitly selected installed TF2 assets. Six were subsequently executed and passed through `node scripts/verify-pinned-huds.mjs`; the remaining six are not presented as passes. The Unix-only portable-collision case was not executed by this Windows run.

The pinned script was read before execution. It downloads SHA-256-verified archive/schema pairs for kbnHud, hypnotizehud, rayshud, budhud and FlawHUD, plus the separate pinned hypnotizehud, kinhud and m0re-rockz catalog ZIPs, into a fresh OS temporary directory. The option/font tests completed in 34.14 s and 1.73 s. The catalog test installed and updated each of its three full packages in disposable profiles, compared every payload byte in library/live trees, exercised paths beyond MAX_PATH, and passed in 211.79 s. The exact transcript is `pinned-huds-windows.txt`. No player install is used by the script or these fixtures. No source fix was needed.

A source review of the new ownership module and related import changes found no Windows-only symbol leaking into unconditional imports. Unix test helpers stay gated and generic file/seek/hash operations remain portable. This is source review only; it does not replace Linux compilation, Clippy or execution.

## Remaining qualification

RND-215 remains In Progress. Run the Linux fixture suite, the pinned corpus on Linux and the full native desktop command/close/recovery matrix on both supported platforms before closing qualification. Exercise native catalog/update/archive/folder/Mods/profile-import flows in disposable installs, including native dialogs and interrupted replacement/restart. Windows corpus transactions and extended-path payload preservation are now qualified as described above. The browser proves renderer interaction and layout only. No retail TF2 launch, Steam Cloud write, installer, updater or release was performed by this work.
