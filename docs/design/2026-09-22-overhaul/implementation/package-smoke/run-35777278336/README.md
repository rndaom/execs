# Linux package run: old AppImage reads, Save lifecycle blocks upgrade

[Run 35777278336](https://github.com/rndaom/execs/actions/runs/35777278336) failed on 2026-09-22 after successfully building both unsigned Linux packages and opening the authenticated public 0.1.8 AppImage. **The old native Files read passed; the export, candidate replacement and Debian runtime cases did not pass.**

- PR head: `d80fe576f90fc0ca8a4e5c37ea8decb8274c4475`.
- Actual PR merge checkout: `30624b62b2af65d6fd48ecae1d62618ad2cbc1fa`, merging that head into `0c5aa21e9b16e3bd3c05c1bb4d9d7e9acddfc7be`.
- [Job 106913573706](https://github.com/rndaom/execs/actions/runs/35777278336/job/106913573706): `2026-09-22T19:59:04Z` to `2026-09-22T20:10:36Z`.
- All **48** focused harness tests passed. The unchanged notices gate passed **470** packages. The ordinary optimized AppImage and Debian build passed at `20:09:44Z`; the native runtime step failed at `20:10:32Z`.

## Exact completed scope

Both previous public assets were downloaded from the immutable `v0.1.8` release and passed the existing public-key signature verifier. The old AppImage rendered `tauri://localhost`, without a browser fixture query, in its real Wry/WebKitGTK window. Its owned PID, start time and executable matched the inspected old package ELF. Its image used a normal read-only FUSE mount under the fixture's private `TMPDIR`; extracted execution did not substitute for this check.

The native library showed both authored profiles. Real Files navigation selected `tf/cfg/config.cfg`; trusted native Ctrl+A/C and the X clipboard returned its exact **55 bytes**, SHA-256 `53c7675e94164580863502aa86b63fa40f97c3311e2b8865a1c8eeaa9352ee42`. The three completed preservation checkpoints cover before installation, after the old-image copy and after that native read: all **21 protected files**, original profile metadata, settings and synthetic live tree remained exact, with isolated Steam discovery paths absent.

| Identity | Bytes | SHA-256 |
| --- | ---: | --- |
| Public `execs_0.1.8_amd64.AppImage` | 100592120 | `06ec406e829601ae259e0fa4d2b1d4cc90c9fd76f7b56477e1e78165e4bcb0e7` |
| Public `execs_0.1.8_amd64.deb`, authenticated but not installed | 13220524 | `bb6f3628cee4dbbb37a093c4ef4bbb25c3ce6fbf64f4a3f775a39af454e99231` |
| Old AppImage inspected and running ELF | — | `1a89c77daa1dde4d66f37a584db68dc1e280d85aabd028461a4a2a049ea86369` |
| Unsigned candidate `execs_0.2.0_amd64.AppImage`, inspected but not launched | 100846072 | `f4f8fb9ec77b46a1ea32e368f4789a50e5ac379c49245cd4683eca82093db9aa` |
| Candidate AppImage packaged ELF | — | `2fc77ba4627e740ee22ac12754eb0adf027dda83eec874412e56fb7993213778` |
| Candidate build-tree ELF | — | `e0eff8183241835bb3d7bab989730b91d2c0b37add4ab651e57be5968bb11791` |

Both inspected AppImages contain packaged notices; the candidate passes the bundled-Wayland absence check. The AppImage bundler may transform its ELF, so packaged/runtime identity is distinct from the build-tree hash. The candidate Debian build completed, but its later inspection/runtime case was never reached and this receipt has no candidate Debian hash.

The host was GitHub's Ubuntu 22 image `20260907.292.1`, WebKitGTK/driver `2.50.4-0ubuntu0.22.04.1`, FUSE 3 `3.10.5-1build1` plus libfuse2 `2.9.9-5ubuntu3`, Node `v24.20.0`, Tauri CLI `2.11.4` and tauri-driver `2.0.6`. The driver executable hash is retained in the raw results.

## Exact failure and evidence limit

The primary error is `Timed out: file dialog accepts the exact owned path` at `development-package-native.mjs:317`. The helper selected the PID-owned GTK Export dialog, sent the exact private destination through native keyboard input, then required its XID to disappear from the X tree. The final checkpoint observed `exports/previous-ui-export.zip` at that requested destination with SHA-256 **`6f93d339d2c9cfdafaad7f3c754fbbe74b87a1023cd832a70802b429bc261bd2`**. The harness had not accepted a completed Save or advanced its checkpoint, so it also correctly retained `Unexpected export before native Save` against the prior empty export directory.

**The ZIP itself was not uploaded or independently inspected. Its presence/hash is not a payload-validation pass.** No candidate launch, replacement, import, switch or reopen occurred. Debian upgrade and first install stayed unstarted. Owned process cleanup passed; normal window close/process-exit-before-cleanup was never reached, and no native exit code is claimed.

The final comparison reached the export-directory assertion after the original app-data and live-tree assertions. Given the exact executed validator's order, that establishes the source comparison succeeded before the export mismatch; this is a source-backed inference from the stack, not a separately saved final checkpoint or an overall preservation pass.

The predicate incorrectly equates dialog completion with window destruction. GTK documents that `gtk_native_dialog_run()` returns after a response and hides the dialog; Xlib represents visibility separately from window-tree membership. An unmapped retained window can therefore make the old predicate time out. **This run did not capture final X11 attributes, so that mechanism remains the leading source-supported explanation, not an observed map-state fact.** A correction must observe mapped dialog ownership before input, record hidden/destroyed state afterward, refuse ambiguity and still require exact path, ZIP payload and fixture validation. [GTK native-dialog run contract](https://docs.gtk.org/gtk3/method.NativeDialog.run.html), [Xlib window tree and map-state semantics](https://xorg.freedesktop.org/archive/X11R7.7/doc/libX11/libX11/libX11.html#Obtaining_Window_Information).

## Visually inspected captures

Both the package agent and root individually inspected these unchanged PNGs:

- [Previous native Files](evidence/appimage-upgrade/previous-profile-read.png): a nonblank, usable 0.1.8 window with the correct active profile, two-file list and selected four-line/55-byte cfg.
- [Initial GTK Save dialog](evidence/appimage-upgrade/previous-export-dialog.png): authentic Save/Cancel controls, the default profile filename and private FUSE `/usr` directory **before** path entry. This image does not show the requested destination after typing.
- [Failure webview](evidence/appimage-upgrade/failure.png): the underlying Files pane and open profile menu. The WebDriver captures the webview only, so this image cannot establish native GTK visibility.

## Retained evidence

[Artifact 10716766911](https://github.com/rndaom/execs/actions/runs/35777278336/artifacts/10716766911) contains seven fixture-only files. Its API-reported ZIP digest is `sha256:638db48e9007a6c81daa3ab88aa90602b3c7ed7f93c85bb96f7411da01ef4f99`, size 153673 bytes. `gh run download` extracted the files; the original artifact ZIP was not retained. No installer/package download is included.

- [Complete normalized workflow log](workflow.log), [exact workflow metadata](workflow.gen.json), [exact artifact metadata](artifacts.gen.json).
- [Exact overall receipt](evidence/results.gen.json), [exact case receipt](evidence/appimage-upgrade/results.gen.json), [exact fixture baseline](evidence/appimage-upgrade/fixture-baseline.gen.json), [native driver log](evidence/appimage-upgrade/previous-launch-driver.log).
- [Provenance and all retained file hashes](provenance.json). Raw JSON and PNG bytes are unchanged; JSON uses `.gen.json` suffixes. Only terminal formatting/newlines are normalized in logs, without filtering lines.

The temporary 0.2.0 heading was a local harness rehearsal; no version/release heading was committed. No release workflow, tag, publication, signing secret, local player application or game launch was used. Windows NSIS remains unimplemented; candidate updater trust, full package transitions, native round trip, Steam/Cloud/engine/media and wider Linux qualification remain open. This failed run remains failed regardless of a later harness correction.
