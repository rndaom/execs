# Signed private package qualification

Product source: `6ecbcc007d748139149352c9db5e406272921cc6`. No product changes
follow it; subsequent work corrects qualification machinery and records evidence.

[Original candidate 35491010492](https://github.com/rndaom/execs/actions/runs/35491010492)
passed all validation and the complete Linux package job. Linux installed the
signed update from public 0.1.6, retained app data/notices, offered no repeat
update, launched AppImage/deb and executed the real packaged analysis worker at
`tauri://localhost` in 95 ms. The stock Wayland-library packaging check passed.

Windows installed and checked the same upgrade before its original worker probe
could not attach. WebView2 150+ ignores environment overrides for elevated
hosts. The CI-only recovery snapshots and restores app-specific HKLM debug and
profile values on disposable GitHub runners; shipped code/CSP is unchanged.
The standalone build must use `TAURI_ENV_PLATFORM=windows`: Vite's Windows target
emits a different worker than its default Safari target.

[Recovery 35492901345](https://github.com/rndaom/execs/actions/runs/35492901345)
passed the Windows worker job against the exact signature-verified, hash-pinned
installer. Main-thread fetch verifies JavaScript MIME and exact production worker
SHA-256 before construction. The worker executes at `http://tauri.localhost`,
returns the expected numeric finding in 40.5 ms, and records no CSP violations.
Its constructor matches the production module-worker constructor. This is the
actual installed binary, separate from the native preview fixtures.

Both platform signatures/feed verified in that recovery's final job; only its
draft target metadata edit received a workflow-token 403. Repository-owner access
updated the private target separately. The recovery workflow now emits provenance
as an artifact and leaves that metadata edit to the authorized preparation task.
The complete recovery [run 35493043167](https://github.com/rndaom/execs/actions/runs/35493043167)
passes both the signed Windows worker probe and both-platform asset verification.
Its [provenance](release-commit.json) is also uploaded to the private draft. The
earlier failed jobs are not represented as green pipelines.

Independent local verification downloaded both signed assets and ran
`node scripts/verify-release.mjs <candidate-directory> 0.1.7` successfully without
executing the installers. [Signed asset hashes](signed-assets.json), the original
[Linux installer result](linux-installer.json), both worker results, and Windows
source/fetch identities are retained here. The Windows candidate JSON records
the old draft target observed before its metadata was corrected; its pinned
source, signature and asset hash are the identity checks.

All application launches and test registry changes occurred in disposable CI.
No player data, Steam Cloud or real game launch was used. At this private
qualification stage the release remained a draft, public latest stayed 0.1.6,
and no `v0.1.7` tag had been created. Subsequent authorized publication is
recorded in [the tagged evidence](../tagged/README.md).

Primary runtime explanation: [Microsoft WebView2 elevated-host policy](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645#issuecomment-4934355430).
