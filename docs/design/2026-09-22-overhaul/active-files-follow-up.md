# Pending-change review and active native Files

September 22, 2026. Product and harness commit **31b38b912f67734f3bb27fec09fef5e6ee64ae84** is pushed to [draft PR #60](https://github.com/rndaom/execs/pull/60). Foundry remains the only selected direction. All 14 original selected issues remain In Progress, 25 optional candidates remain unselected, and no merge, version change, tag or release is authorized.

## Corrected interactions

The [dialog review](implementation/close-dialog-follow-up/README.md) records eight accepted browser captures. A valid 109-character cfg path previously produced a 725px scroll width inside a 606px dialog and hid its suffix. Complete paths now wrap at 1200×800, 960×640 and 480×320. Save, Discard and Cancel remain reachable; Cancel preserves the draft and restores its opener.

The Open pane review route now moves keyboard focus to the visible destination heading after modal cleanup. An unapplied Crosshair change stays intact through App settings → Change install → Open Crosshair, and the next Tab reaches the pane's controls. Same-pane review also works; Cancel independently returns to Review changes. These are browser fixture observations, not native close evidence.

The [independent close review](implementation/active-close-review.md) also found that a settings write could begin before the next React busy-state render, leaving the close request's captured value stale. The request now consults the live write guard. A regression using the real synchronous settings-write queue fails before the correction and passes afterward. No save, discard, lock or explicit-build requirement is removed.

## Verification

| Check | Result |
| --- | --- |
| Integrated `pnpm test` | 882 desktop + 160 cfglint + 65 tooling = **1,107 passed**, zero failures, four platform skips. |
| Corrected native input harness | Complete tooling rerun: **67 passed**, zero failures, four skips. The unchanged 31b38b9 product suites plus these checks total **1,109 passed**; the first native failure remains separate. |
| TypeScript / production frontend | Passed; the existing Vite chunk-size advisory remains. |
| Formatting and whitespace | `pnpm check`: 572 files passed before these checkpoint additions; `git diff --check` passed. |
| Native harness independent review | No actionable findings after correcting the CodeMirror caret-settling rule and distinguishing observed process exit from an unknown exit code. |
| Previous committed CI | [5bda798 full CI](https://github.com/rndaom/execs/actions/runs/35767498661) and its [inactive Linux native smoke](https://github.com/rndaom/execs/actions/runs/35767498473) passed. Earlier accepted screenshots keep their original build identities. |
| Product CI | [31b38b9 CI](https://github.com/rndaom/execs/actions/runs/35770490421): all five jobs passed, including frontend, Rust and pinned HUD checks on both platforms. |
| Active Linux Files | [Run 35770490260](https://github.com/rndaom/execs/actions/runs/35770490260) failed before Save at the post-typing exact-copy assertion. Initial 4,848-byte file read and all 12 protected files passed. [Failure report and two inspected native images](implementation/linux-native/active-first-run-35770490260.md). |

The reviewed input correction is pushed in **28c0f0ed1ed5dcba61fab5414eca732b35fb1368**. [Native retry 35772324501](https://github.com/rndaom/execs/actions/runs/35772324501) passed the exact 4,881-byte draft copy, then failed editor scroll retention after Binds → Files. Selection and line/column survived; the visible viewport reset. All 12 protected files stayed exact. [Three inspected native captures and the matching browser route](implementation/native-scroll-follow-up/README.md) document the remaining defect. Additional diagnostics retain geometry before editor focus and at every Tab destination; expected outcomes are unchanged. The complete existing tooling suite now passes **70 tests**, with four platform skips. [28c0f0e full CI](https://github.com/rndaom/execs/actions/runs/35772324486) has four jobs passed and Windows Rust still running at this checkpoint.

## Active native scope

The [active runner](implementation/linux-native/active-files.md) uses the normal optimized Linux binary, external Tauri/WebKitGTK input and a disposable hosted Linux desktop. The [source-backed fixture contract](implementation/linux-native/active-fixture-plan.md) isolates HOME/XDG, requires all eight production Steam-discovery candidates to remain absent, and seeds two authored Vanilla profiles with no player data or game executable.

Its bounded sequence checks exact in-memory text, selection and both editor scroll axes across pane visits; explicit Files Save; actual native close Cancel/Discard/Save; and restart after each accepted close. A PID/executable/process-group/start-time check binds the standard X11 close request to the single owned app window. No test IPC, direct app command invocation or preview adapter is added. Fixed validators require the intended live/library helper bytes, its manifest hash and the active update time while preserving the other profile, settings, config and every unrelated file.

The retry reached the initial and selected-draft states, plus its failure capture; all three PNGs were inspected and retain their failed-run attribution. The remaining seven planned workflow captures are unexecuted. An external-driver-owned child's disappearance is observed before cleanup; its exit code remains unknown. The harness never upgrades that observation to normal exit 0.

The [development package proposal](implementation/package-smoke/development-run-plan.md) now has an independently reviewed [Linux implementation](implementation/package-smoke/development-implementation.md): AppImage manual replacement, Debian upgrade/first install and installed-app export/import/switch/reopen. Its 24 new tests pass, including the actual unchanged v0.1.8 export; together with the existing tooling suite, **94 tooling tests pass**, with four platform skips. The complete formatting check passes 579 files. No hosted package case has executed yet, and Windows NSIS remains unimplemented. Broader settings/profile transitions, installers, signed updater lifecycle, native media, Cloud, retail TF2/Casual, screen readers, PresentMon and RND-324's unresolved engine behavior retain their original acceptance. This follow-up does not replace those requirements.
