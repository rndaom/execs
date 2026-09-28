# Launch and lock verification (issues 4-6)

Implemented and independently reviewed on September 28, 2026. No real TF2 launch, Steam exit/restart, player profile modification or Steam configuration modification was performed during testing. All native writes used disposable fixtures.

## Behavior

- Exact `tf.exe` process basenames now join the existing Windows and Proton TF2 names. Case and path spelling are handled; similarly named executables and servers stay excluded.
- The header releases a pending launch wait directly. Native completion checks for TF2 twice, two seconds apart, under the existing durable-operation guard. Steam may remain running. The action does not stop a process or cancel a Steam queue; the tooltip says to cancel any queued launch in Steam first.
- An unobserved launch expires after ten minutes from its original durable handoff marker time. Restart does not start a fresh ten-minute wait. The remaining wait uses a monotonic deadline, with a bounded recovery wait if legacy timestamp metadata is unavailable. Timeout also rechecks TF2 twice. The lifecycle response publishes expiry so the app explains that waiting ended and a queued Steam launch was not cancelled. A late game is still protected by the normal process write guard.
- Every mismatch asks which options to use, with the same comparison whether Steam is open or closed. Choices retain Steam options for this launch, adopt them into the profile and launch, replace them with the reviewed profile options, or cancel. The Launch pane also offers one-action adoption and reviewed replacement.
- Native reviews bind the confirmed root, active profile identity, saved profile string, chosen Steam account path and exact raw Steam string. The raw comparison exposes forbidden flags instead of silently sanitizing Steam. Replacement validates before and after Steam shutdown and before writing; adoption refuses forbidden tokens and preserves accepted raw spacing. Fresh process checks remain at mutation boundaries.
- Autosave, profile switches/retries and Viewmodel/Casual preload changes save the profile and retain pending launch state without overwriting Steam. Obsolete production unreviewed launch-sync APIs were removed. Replacement remains atomic and keeps the existing Steam backup behavior.
- The controls use existing Modal, button, typography, color and motion primitives. A hidden Launch pane or changed profile/saved value dismisses its replacement review.

## Verification

Passed locally:

- Frontend TypeScript check.
- 63 focused UI tests across LaunchPane, launch-ui, App pending-settings and lifecycle polling.
- 44 core launch-related tests, including raw external drift after Steam shutdown, adoption without modifying Steam bytes, forbidden raw options, profile/account drift, and a TF2 process appearing before the write.
- Five native launch tests, including double process observation, Steam-open release, original timeout across restart, durable marker preservation on late TF2, and the ordinary lock for a game starting after release.
- Rust formatting with `cargo fmt --all`; frontend changed files formatted with Biome.

The independent reviewer approved the final launch implementation and independently reran the relevant LaunchPane and lifecycle tests; consolidated evidence is in `review.md`. Parent verification covers the full workspace and visual browser fixtures. A packaged Steam round trip remains outside this disposable-fixture verification; no live acceptance is implied.

## Sources and limits

Reviewed project AGENTS, core process/launch/switch/Viewmodel code, lifecycle ownership and recovery tests, frontend launch draft and sync code. The sysinfo API is documented at <https://docs.rs/sysinfo/latest/sysinfo/struct.Process.html#method.name>. Steam Support's launch-options reference is <https://help.steampowered.com/en/faqs/view/7D01-D2DD-D75E-2955>, but the retrieval returned minimal content. The Valve developer Steam browser protocol page returned 403. The implementation therefore does not assume an undocumented URI cancellation acknowledgment: observed process state, the user's explicit release and the requested bounded timeout determine the wait.
